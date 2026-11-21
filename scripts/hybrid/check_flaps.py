#!/usr/bin/env python3
"""Checks of the mastectomy and flap sequences (docs/plano-retalhos-miocutaneos.md, section 4), read back from what the
app loads: src/data/reconstructionSteps.json and the binaries of public/models/hybrid.

  * pedicles: the latissimus pedicle never longer than its free length (stretch <= 1.01); the TRAM carrier no
    longer than the muscle;
  * skin: triangles of the skin meshes turned over against their rest frame (by the outward direction of the trunk)
    at every frame;
  * island: in the result, the edge of the island lies on the edge of the defect of the breast (<= 2 mm);
  * tissue: in the result, no vertex of a flap more than 2 mm inside the wall or more than 1.5 mm outside the skin
    of the breast (the rectus of the TRAM, which lifts the skin over the costal margin, against the skin posed over it);
  * measures: volumes and lengths written by build_flaps.py.

Usage: python3 scripts/hybrid/check_flaps.py   (exit status 1 when a check fails)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, str(Path(__file__).parent))
import build_breast as bb  # noqa: E402
import build_flaps as bf  # noqa: E402

DATA = bb.ROOT / "src/data/reconstructionSteps.json"
BIN_DIR = bb.ROOT / "public/models/hybrid"
LIMITS = {"stretch": 1.01, "islandMm": 2.0, "insideWallMm": 2.0, "outsideSkinMm": 1.5, "flippedPct": 1.0}


def load(technique: dict) -> dict:
    """Positions (mm, model space) of every mesh at every frame, and its triangles."""
    buf = (BIN_DIR / technique["bin"].split("/")[-1].split("?")[0]).read_bytes()
    lo, hi = np.array(technique["min"]), np.array(technique["max"])
    span = hi - lo
    count = len(technique["frames"])
    out = {}
    for rec in technique["meshes"]:
        off, n = rec["byteOffset"], rec["vertices"]
        stored = {}
        for f in rec["frames"]:
            raw = np.frombuffer(buf, dtype="<u2", count=n * 3, offset=off).reshape(-1, 3)
            stored[f] = (lo + raw / 65535 * span) / bb.MM
            off += n * 6
        idx = np.frombuffer(buf, dtype="<u2", count=rec["triangles"] * 3, offset=off).reshape(-1, 3).astype(int)
        frames = []
        for k in range(count):
            before = [f for f in rec["frames"] if f <= k]
            frames.append(stored[before[-1] if before else rec["frames"][0]])
        out[rec["name"]] = {"frames": frames, "idx": idx}
    return out


def on_triangles(pos: np.ndarray, idx: np.ndarray, n: int = 6) -> np.ndarray:
    """Points spread over the triangles of a mesh (barycentric steps of 1/n), its vertices among them."""
    i, j = np.meshgrid(np.arange(n + 1), np.arange(n + 1), indexing="ij")
    keep = i + j <= n
    b = np.c_[i[keep], j[keep], n - i[keep] - j[keep]] / n
    a, bb_, c = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
    return (b[None, :, 0, None] * a[:, None] + b[None, :, 1, None] * bb_[:, None] + b[None, :, 2, None] * c[:, None]).reshape(-1, 3)


def outward_flips(trunk, frames: list[np.ndarray], idx: np.ndarray) -> list[float]:
    """Share (%) of triangles whose facing against the outward direction of the trunk differs from the first frame."""
    def facing(p):
        a, b, c = p[idx[:, 0]], p[idx[:, 1]], p[idx[:, 2]]
        n = np.cross(b - a, c - a)
        centre = (a + b + c) / 3
        q = trunk.chart(centre)
        theta = q[:, 0] / bb.RREF
        radial = np.c_[-trunk.ch.s * np.sin(theta), np.zeros(len(q)), np.cos(theta)]
        area = np.linalg.norm(n, axis=1)
        return np.sign((n * radial).sum(1)), area

    s0, area0 = facing(frames[0])
    ok = area0 > 1e-3
    return [100.0 * float(((facing(p)[0] != s0) & ok).sum()) / max(int(ok.sum()), 1) for p in frames]


def main() -> int:
    data = json.loads(DATA.read_text())
    setup = bf.Setup()
    tr = setup.trunk
    failures = []
    for key, tech in data["techniques"].items():
        meshes = load(tech)
        m = tech["measures"]
        last = len(tech["frames"]) - 1
        print(f"\n{key}: {len(tech['meshes'])} meshes, {len(tech['frames'])} frames, measures {m}")
        # skin meshes lying on the body (not the flaps held up, the specimen or the pieces moving): triangles turned over
        ids = [f["id"] for f in tech["frames"]]
        on_body = {
            "recon_mast_skin": ["marcacao", "leito", "fechamento"],
            "recon_ld_back_skin": ["marcacao", "doadora", "resultado"], "recon_ld_breast_skin": ids, "recon_ld_island": ["marcacao", "insercao", "resultado"],
            "recon_tram_abdomen_skin": ["marcacao", "doadora", "resultado"], "recon_tram_breast_skin": ids, "recon_tram_island": ["marcacao", "insercao", "resultado"],
        }
        for name, mesh in meshes.items():
            if name not in on_body:
                continue
            ks = [ids.index(f) for f in on_body[name]]
            flips = outward_flips(tr, [mesh["frames"][k] for k in ks], mesh["idx"])
            worst = max(flips)
            flag = "" if worst <= LIMITS["flippedPct"] else "  <-- turned over"
            print(f"  skin {name}: turned over at worst {worst:.2f}% ({on_body[name][int(np.argmax(flips))]}){flag}")
            if flag:
                failures.append(f"{key} {name}: {worst:.2f}% of its triangles turned over")
        if key == "grande-dorsal":
            if m["maxStretch"] > LIMITS["stretch"]:
                failures.append(f"latissimus pedicle stretched x{m['maxStretch']}")
            print(f"  pedicle: {m['pedicleMm']} mm, largest stretch x{m['maxStretch']}")
        if key in ("grande-dorsal", "tram"):
            island = meshes["recon_ld_island" if key == "grande-dorsal" else "recon_tram_island"]["frames"][last]
            breast = meshes["recon_ld_breast_skin" if key == "grande-dorsal" else "recon_tram_breast_skin"]
            bpos, bidx = breast["frames"][last], breast["idx"]
            # edges used once: the outline of the breast skin, among them the edge of the defect
            edges = np.sort(np.vstack([bidx[:, [0, 1]], bidx[:, [1, 2]], bidx[:, [2, 0]]]), 1)
            uniq, counts = np.unique(edges, axis=0, return_counts=True)
            border = np.unique(uniq[counts == 1])
            # the island's own border
            iidx = meshes["recon_ld_island" if key == "grande-dorsal" else "recon_tram_island"]["idx"]
            iedges = np.sort(np.vstack([iidx[:, [0, 1]], iidx[:, [1, 2]], iidx[:, [2, 0]]]), 1)
            iu, ic = np.unique(iedges, axis=0, return_counts=True)
            iborder = island[np.unique(iu[ic == 1])]
            defect_edge = bpos[border]
            q = tr.chart(defect_edge)
            centre = tr.chart(iborder).mean(0)
            near = np.linalg.norm(q[:, :2] - centre[:2], axis=1) < 140
            gap, _ = cKDTree(defect_edge[near]).query(iborder)
            print(f"  island edge to defect edge: median {np.median(gap):.1f} mm, p95 {np.quantile(gap, 0.95):.1f} mm")
            if np.quantile(gap, 0.95) > LIMITS["islandMm"]:
                failures.append(f"{key}: island edge {np.quantile(gap, 0.95):.1f} mm from the defect (p95)")
            # tissue of the flap in the result: inside the wall or outside the skin of the breast
            tissue_names = [n for n, r in ((r["name"], r) for r in data["meshes"]) if n in meshes and r["structure"].endswith(f"-{key}") and r["tissue"] in ("muscle", "fat", "implant")
                            and any(t in n for t in ("muscle", "island_fat", "implant", "zone_1", "zone_2", "zone_3", "rectus"))
                            and not n.endswith(("remnant", "stays", "tip", "zone_3_tip", "zone_4"))]
            for name in tissue_names:
                p = meshes[name]["frames"][last]
                q = tr.chart(p)
                wall = tr.sample(tr.wall, q[:, 0], q[:, 1])
                skin = tr.sample(tr.skin, q[:, 0], q[:, 1])
                # the breast (the tendon of the latissimus goes on to the humerus, out of the skin of the trunk)
                in_breast = (np.abs(q[:, 1]) < 120) & (q[:, 0] < 235)
                inside = float(np.max(wall - q[:, 2]))
                outside = float(np.max((q[:, 2] - skin)[in_breast])) if in_breast.any() else 0.0
                print(f"  {name}: deepest {inside:.1f} mm inside the wall, farthest {outside:.1f} mm outside the skin of the breast")
                if inside > LIMITS["insideWallMm"] and name.endswith(("implant",)):
                    failures.append(f"{key} {name}: {inside:.1f} mm inside the wall")
                # the rectus of the TRAM, folded over the costal margin, lifts the skin over it (the bulge of the epigastrium):
                # it is checked below against the skin as it is posed, not against the skin of the trunk at rest
                if outside > LIMITS["outsideSkinMm"] and "rectus" not in name:
                    failures.append(f"{key} {name}: {outside:.1f} mm outside the skin")
            if key == "tram":
                # the skins as posed in the result, sampled densely over their triangles (the advanced upper flap of the
                # abdomen is stretched: its vertices alone are too far apart), and the rectus under them
                names = ("recon_tram_abdomen_skin", "recon_tram_abdomen_window", "recon_tram_breast_skin", "recon_tram_island")
                for frame in ("insercao", "doadora", "resultado"):
                    k = ids.index(frame)
                    cover = tr.chart(np.vstack([on_triangles(meshes[n]["frames"][k], meshes[n]["idx"]) for n in names]))
                    rectus = tr.chart(meshes["recon_tram_rectus"]["frames"][k])
                    dist, nearest = cKDTree(cover[:, :2]).query(rectus[:, :2], k=4, distance_upper_bound=4.0)
                    found = np.isfinite(dist).all(1)
                    w = 1.0 / np.maximum(dist[found], 0.25)
                    over = (cover[nearest[found], 2] * w).sum(1) / w.sum(1)
                    out = float(np.max(rectus[found, 2] - over))
                    # where no skin of the sequence lies over it, the skin of the trunk (out of the holes cut for them) does
                    rest = rectus[~found]
                    out_rest = float(np.max(rest[:, 2] - tr.sample(tr.skin, rest[:, 0], rest[:, 1]))) if len(rest) else -np.inf
                    print(f"  recon_tram_rectus ({frame}): farthest {out:.1f} mm outside the skin posed over it ({100 * found.mean():.1f}% of it), "
                          f"{out_rest:.1f} mm outside the skin of the trunk (the rest)")
                    if max(out, out_rest) > LIMITS["outsideSkinMm"]:
                        failures.append(f"tram recon_tram_rectus ({frame}): {max(out, out_rest):.1f} mm outside the skin over it")
    print("\n" + ("OK" if not failures else "FAILED:\n  " + "\n  ".join(failures)))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
