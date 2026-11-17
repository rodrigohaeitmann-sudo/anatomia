#!/usr/bin/env python3
"""Vessels and nerves in the arm poses (docs/plano-pele-habito-vasos.md, phases A and H).

For every pose (last keyframe, desktop variant) and every vessel and nerve of the operated side:
  * share of vertices that stay put (< 0.5 mm) and share of the limb beyond the elbow that stays put;
  * largest displacement;
  * stretch of the mesh edges (p99 and largest), the measure of a part left behind while the rest moves.
And, for the schematic branches of the breast that follow their source vessel (`follow` in breastAnatomy.json):
the source vertex nearest the root must lie within ROOT_GAP_MAX_MM of it.

Limits: STRETCH_P99_MAX, STRETCH_MAX, no static vertex beyond the elbow. Writes assets/build/checks/poses.json and
exits 1 when a limit is exceeded, unless --report.
Usage: npm run poses:hybrid && python3 scripts/hybrid/check_pose_followers.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = json.loads((ROOT / "src/data/hybridTorsoManifest.json").read_text())
MM = MANIFEST["landmarks"]["unitsPerMm"]
POSES = json.loads((ROOT / "src/data/armPoses.json").read_text())
ANATOMY = json.loads((ROOT / "src/data/breastAnatomy.json").read_text())
OUT = ROOT / "assets/build/checks/poses.json"
STRETCH_P99_MAX = 1.6
STRETCH_MAX = 4.0
ROOT_GAP_MAX_MM = 3.0
STATIC_MM = 0.5
MIN_EDGE_MM = 0.3


def mesh(name: str) -> tuple[np.ndarray, np.ndarray]:
    pos = np.fromfile(ROOT / f"assets/build/model-meshes/{name}.pos.bin", dtype=np.float32).reshape(-1, 3).astype(np.float64) / MM
    idx = np.fromfile(ROOT / f"assets/build/model-meshes/{name}.idx.bin", dtype=np.uint32).reshape(-1, 3).astype(np.int64)
    return pos, idx


def main() -> None:
    info = POSES["variants"]["desktop"]
    index = np.fromfile(ROOT / "public" / info["index"].lstrip("/"), dtype=np.uint32)
    stored = {m["name"]: m for m in info["meshes"]}
    keyframes, step = POSES["keyframes"], POSES["stepMm"]
    joints = {k: np.array(v) / MM for k, v in POSES["joints"].items() if isinstance(v, list) and len(v) == 3}
    gh, elbow = joints.get("gh"), joints.get("elbow")
    axis = (elbow - gh) / np.linalg.norm(elbow - gh) if gh is not None and elbow is not None else None
    reach = float(np.linalg.norm(elbow - gh)) if axis is not None else np.inf
    followers = [m for m in MANIFEST["meshes"] if m["tissue"] in ("artery", "vein", "nerve") and not m["sourceName"].startswith("Right")]
    geometry = {m["name"]: mesh(m["name"]) for m in followers}
    report: dict = {"poses": {}, "roots": {}}
    failures = []
    for pose in POSES["poses"]:
        raw = np.fromfile(ROOT / "public" / info["poses"][pose["id"]]["file"].lstrip("/"), dtype=np.int16)
        per = info["vertices"] * 3
        last = raw[(keyframes - 1) * per: keyframes * per].reshape(-1, 3).astype(np.float64) * step
        rows = {}
        for m in followers:
            pos, idx = geometry[m["name"]]
            disp = np.zeros_like(pos)
            entry = stored.get(m["name"])
            if entry:
                ids = index[entry["offset"]: entry["offset"] + entry["count"]]
                disp[ids] = last[entry["offset"]: entry["offset"] + entry["count"]]
            magnitude = np.linalg.norm(disp, axis=1)
            edges = np.vstack([idx[:, [0, 1]], idx[:, [1, 2]], idx[:, [2, 0]]])
            rest = np.linalg.norm(pos[edges[:, 0]] - pos[edges[:, 1]], axis=1)
            posed = np.linalg.norm((pos + disp)[edges[:, 0]] - (pos + disp)[edges[:, 1]], axis=1)
            ok = rest > MIN_EDGE_MM  # slivers of a few hundredths of a mm make any ratio meaningless
            stretch = posed[ok] / rest[ok]
            beyond = ((pos - gh) @ axis > reach) if axis is not None else np.zeros(len(pos), bool)
            row = {
                "structure": m["sourceName"],
                "staticPct": round(float((magnitude < STATIC_MM).mean() * 100), 1),
                "beyondElbowStaticPct": round(float((magnitude[beyond] < STATIC_MM).mean() * 100), 1) if beyond.any() else 0.0,
                "maxMm": round(float(magnitude.max()), 1),
                "stretchP99": round(float(np.percentile(stretch, 99)), 2),
                "stretchMax": round(float(stretch.max()), 2),
            }
            rows[m["name"]] = row
            if row["stretchP99"] > STRETCH_P99_MAX or row["stretchMax"] > STRETCH_MAX:
                failures.append(f"{pose['id']}: {m['sourceName']} estica ×{row['stretchP99']} (p99), ×{row['stretchMax']} (máx)")
            if row["beyondElbowStaticPct"] > 0:
                failures.append(f"{pose['id']}: {m['sourceName']} tem {row['beyondElbowStaticPct']}% parado além do cotovelo")
        report["poses"][pose["id"]] = rows
        worst = sorted(rows.values(), key=lambda r: -r["stretchMax"])[:5]
        print(f"== {pose['id']}: piores " + "; ".join(f"{r['structure']} ×{r['stretchMax']} (p99 ×{r['stretchP99']}, {r['staticPct']}% parado)" for r in worst))
    # schematic branches that follow their source vessel
    for item in ANATOMY["meshes"]:
        follow = ANATOMY["geometry"].get(item["name"], {}).get("follow")
        if not follow:
            continue
        points = np.array(ANATOMY["geometry"][item["name"]]["points"]).reshape(-1, 3) / MM
        parent = mesh(follow["parent"])[0]
        gap = float(cKDTree(parent).query(points[0])[0])
        report["roots"][item["name"]] = {"parent": follow["parent"], "gapMm": round(gap, 2)}
        print(f"raiz de {item['name']}: {gap:.2f} mm do vértice mais próximo de {follow['parent']}")
        if gap > ROOT_GAP_MAX_MM:
            failures.append(f"raiz de {item['name']} a {gap:.1f} mm do vaso de origem")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}")
    if failures and "--report" not in sys.argv:
        print("FALHOU:\n  " + "\n  ".join(failures[:40]))
        sys.exit(1)
    print("ok" if not failures else f"{len(failures)} limites excedidos (--report)")


if __name__ == "__main__":
    main()
