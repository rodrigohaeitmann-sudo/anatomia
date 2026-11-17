#!/usr/bin/env python3
"""Body habitus checks (docs/plano-pele-habito-vasos.md, phases D and I).

  * waist perimeter (convex hull of the section, as a tape) at rest and in every state, skin with breast maps and habitus;
  * contact: the hanging pouch against the abdomen widened by the habitus (no skin may pass through the other);
  * vessels, nerves, nodes and fasciae: how far the habitus moves them (by their depth in the subcutaneous layer) and
    that none ends up outside the skin.
Writes assets/build/checks/habitus.json; exits 1 when the waist misses its target by more than WAIST_TOLERANCE_MM or the
pouch passes through the abdomen, unless --report.
Usage: python3 scripts/hybrid/build_habitus.py && python3 scripts/hybrid/check_habitus.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import ConvexHull

sys.path.insert(0, str(Path(__file__).parent))
import build_breast as bb  # noqa: E402
import build_habitus as bh  # noqa: E402

OUT = bb.ROOT / "assets/build/checks/habitus.json"
WAIST_TOLERANCE_MM = 10.0
SECTIONS_MM = (-240.0, -180.0, -120.0, -90.0)
# as in HybridModel.tsx: the arm keeps its shape (and its own deformation in the arm poses)
ARM_STRUCTURES = {"brachial-vessels", "arm-nerves", "circumflex-humeral-vessels"}


def perimeter(points: np.ndarray, y: float) -> float:
    sel = np.abs(points[:, 1] - y) < 2.5
    xz = points[sel][:, [0, 2]]
    v = xz[ConvexHull(xz).vertices]
    return float(np.linalg.norm(np.diff(np.vstack([v, v[:1]]), axis=0), axis=1).sum())


def main() -> None:
    habitus = bh.load()
    breasts = bh.breasts()
    skin, _ = bb.mesh(bb.SKIN)
    states = [s["id"] for s in bb.STATES]
    carried = [skin.copy() for _ in states]
    for breast in breasts.values():
        for k, moved in enumerate(bb.deform(breast, breast.ch.to_chart(skin))):
            carried[k] += breast.ch.to_model(moved) - skin
    offsets = habitus.displacements(skin, skin=True)
    report: dict = {"perimeters": {}, "contact": {}, "structures": {}}
    failures = []
    rest = {y: perimeter(skin, y) for y in SECTIONS_MM}
    report["perimeters"]["rest"] = {f"{y:.0f}": round(p, 1) for y, p in rest.items()}
    g = habitus.g
    for k, sid in enumerate(states):
        final = carried[k] + offsets[k]
        report["perimeters"][sid] = {f"{y:.0f}": round(perimeter(final, y) - rest[y], 1) for y in SECTIONS_MM}
        target = bh.WAIST_GAIN_MM.get(sid, 0.0)
        gain = perimeter(final, bh.WAIST_Y_MM) - perimeter(carried[k], bh.WAIST_Y_MM)
        if abs(gain - target) > WAIST_TOLERANCE_MM:
            failures.append(f"{sid}: cintura +{gain:.0f} mm, alvo +{target:.0f}")
        # contact: pouch skin (moved by the maps below the rest folds) against the abdomen with the habitus
        shift = np.linalg.norm(carried[k] - skin, axis=1)
        pouch = carried[k][(shift > 5.0) & (carried[k][:, 1] < -64.0)]
        if len(pouch):
            q = g.chart(pouch)
            abdomen = g.sample(habitus.rs, q[:, 0], q[:, 1]) + (0 if habitus.offsets[k] is None else g.sample(habitus.offsets[k], q[:, 0], q[:, 1]) * (1 - np.clip(g.sample(habitus.mask, q[:, 0], q[:, 1]), 0, 1)))
            gap = q[:, 2] - abdomen
            front = gap > -30  # pouch points over the abdomen (not the ones round its sides)
            report["contact"][sid] = {"pouchPoints": int(len(pouch)), "minGapMm": round(float(gap[front].min()), 1) if front.any() else None, "insideMm": round(float(max(0.0, -gap[front].min())), 1) if front.any() else 0.0}
    # vessels, nerves, nodes and fasciae
    for rec in bb.MANIFEST["meshes"]:
        if rec["tissue"] not in ("artery", "vein", "nerve", "lymph-node", "fascia") or rec["structure"] in ARM_STRUCTURES:
            continue
        pos, _ = bb.mesh(rec["name"])
        moved = habitus.displacements(pos)[-1]
        amount = np.linalg.norm(moved, axis=1)
        if amount.max() < 0.5:
            continue
        q = g.chart(pos + moved)
        skin_r = g.sample(habitus.rs, q[:, 0], q[:, 1]) + g.sample(habitus.offsets[-1], q[:, 0], q[:, 1]) * (1 - np.clip(g.sample(habitus.mask, q[:, 0], q[:, 1]), 0, 1))
        report["structures"][rec["sourceName"]] = {"maxMm": round(float(amount.max()), 1), "medianMovedMm": round(float(np.median(amount[amount > 0.5])), 1), "outsideSkin": int((q[:, 2] > skin_r + 1.0).sum())}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n")
    print("perímetro em repouso (mm):", report["perimeters"]["rest"])
    for sid in states:
        print(f"   {sid:8s} ganho (mm) por altura: {report['perimeters'][sid]}; contato: {report['contact'].get(sid)}")
    print("vasos, nervos, linfonodos e fáscias movidos pelo hábito em", states[-1])
    for name, row in sorted(report["structures"].items(), key=lambda kv: -kv[1]["maxMm"])[:14]:
        print(f"   {name[:56]:56s} até {row['maxMm']:5.1f} mm (mediana {row['medianMovedMm']:4.1f}); vértices fora da pele: {row['outsideSkin']}")
    print(f"wrote {OUT.relative_to(bb.ROOT)}")
    if failures and "--report" not in sys.argv:
        print("FALHOU:\n  " + "\n  ".join(failures))
        sys.exit(1)
    print("ok" if not failures else f"{len(failures)} limites excedidos (--report)")


if __name__ == "__main__":
    main()
