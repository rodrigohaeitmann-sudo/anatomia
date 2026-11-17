#!/usr/bin/env python3
"""Skin smoothness checks (docs/plano-pele-habito-vasos.md, phase A).

1. Creases of the breast map: smooth rest skin lines (cubic sample of the chart's skin radius, smoothed over 2 mm), at
   several heights above the nipple and along several meridians, are carried to every state (breast map and body
   habitus); the turning angle concentrated within 0.25 mm, minus the rest line's own, shows slope jumps of the map.
   Limit: CREASE_MAX_DEG.
2. Skin moved outside the breasts: vertices lower than LOW_Y_MM that any state moves more than 0.5 mm. Limit: none.
3. Facets: edge length and stretch of the shipped skin over the breast in every state, desktop and phone (report;
   the app refines the skin, checked by check_skin_app.mjs).
4. Crop borders: length of every boundary loop against a smoothed copy, and the sawtooth (distance of the border
   vertices from the smoothed loop). Limits: BORDER_RATIO_MAX, SAWTOOTH_P95_MAX_MM.

Writes assets/build/checks/skin.json. Exits 1 when a limit is exceeded, unless --report.
Usage: node scripts/hybrid/decode_model.mjs && node scripts/hybrid/decode_model.mjs --mobile && python3 scripts/hybrid/check_skin.py
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter, gaussian_filter1d, map_coordinates

sys.path.insert(0, str(Path(__file__).parent))
import build_breast as bb  # noqa: E402

try:
    import build_habitus as bh  # noqa: E402
except ImportError:  # before the body habitus exists
    bh = None

MM = bb.MM
OUT = bb.ROOT / "assets/build/checks/skin.json"
CREASE_LINES_MM = (-20.0, 30.0, 70.0, 110.0, 130.0)
CREASE_COLUMNS_MM = (60.0, 90.0, 120.0, 150.0, 180.0)
CREASE_MAX_DEG = 8.0
FOLD_BAND_MM = 12.0  # the fold itself creases (the pouch hangs over it): not measured within this distance
LOW_Y_MM = -200.0
BORDER_RATIO_MAX = 1.05
SAWTOOTH_P95_MAX_MM = 0.5
STATE_IDS = [s["id"] for s in bb.STATES]


def load(dirname: str, name: str) -> tuple[np.ndarray, np.ndarray]:
    pos = np.fromfile(bb.ROOT / f"assets/build/{dirname}/{name}.pos.bin", dtype=np.float32).reshape(-1, 3).astype(np.float64) / MM
    idx = np.fromfile(bb.ROOT / f"assets/build/{dirname}/{name}.idx.bin", dtype=np.uint32).reshape(-1, 3).astype(np.int64)
    return pos, idx


def carried(breasts: dict, pts: np.ndarray, skin: bool = True) -> list[np.ndarray]:
    """Model points (mm) in every state: both breast maps, then the body habitus (`skin`: the points are the skin)."""
    out = [pts.copy() for _ in STATE_IDS]
    for breast in breasts.values():
        ch = breast.ch
        for k, moved in enumerate(bb.deform(breast, ch.to_chart(pts))):
            out[k] += ch.to_model(moved) - pts
    if bh is not None and bh.OUT_JSON.exists():
        for k, delta in enumerate(bh.displacements(pts, skin)):
            out[k] += delta
    return out


def turning(p: np.ndarray) -> np.ndarray:
    seg = np.diff(p, axis=0)
    t = seg / np.maximum(np.linalg.norm(seg, axis=1)[:, None], 1e-12)
    return np.degrees(np.arccos(np.clip(np.einsum("ij,ij->i", t[:-1], t[1:]), -1, 1)))


def creases(breasts: dict) -> dict:
    """Horizontal lines (fixed height above the nipple) and vertical lines (fixed u, from the abdomen to the clavicle)."""
    out = {}
    for side, breast in breasts.items():
        ch = breast.ch
        # the skin at a scale of a few mm: the chart's skin radius is binned (highest sample per 2 mm cell)
        skin = gaussian_filter(breast.RS, 1.0)
        lines = [(f"v{v:+.0f}", np.arange(0.0, 230.0, 0.25), None, v) for v in CREASE_LINES_MM]
        lines += [(f"u{u:.0f}", None, np.arange(-200.0, 170.0, 0.25), u) for u in CREASE_COLUMNS_MM]
        for name, us, vs, fixed in lines:
            u = us if us is not None else np.full_like(vs, fixed)
            v = vs if vs is not None else np.full_like(us, fixed)
            rs = map_coordinates(skin, [(u - bb.U_RANGE[0]) / bb.CELL, (v - bb.V_RANGE[0]) / bb.CELL], order=3, mode="nearest")
            rest = ch.to_model(np.stack([u, v, rs], 1))
            base = turning(rest)
            along = u if us is not None else v
            # the inframammary fold is a real crease where the pouch hangs over it: left out of the measure
            fold = np.abs(v - breast.curve("fold", u))[1:-1] < FOLD_BAND_MM
            for sid, moved in zip(STATE_IDS, carried(breasts, rest)):
                excess = np.where(fold, 0.0, turning(moved) - base)
                i = int(np.argmax(excess))
                out[f"{side} {name} {sid}"] = {"maxDeg": round(float(excess.max()), 2), "p995Deg": round(float(np.percentile(excess, 99.5)), 2), "at": round(float(along[i + 1]), 2)}
    return out


def low_movers(breasts: dict) -> dict:
    pos, _ = load("model-meshes", bb.SKIN)
    low = pos[:, 1] < LOW_Y_MM
    out = {}
    for sid, moved in zip(STATE_IDS, carried(breasts, pos[low])):
        disp = np.linalg.norm(moved - pos[low], axis=1)
        if bh is not None and bh.OUT_JSON.exists():  # the habitus moves the abdomen on purpose: only the breast maps count
            disp = np.linalg.norm(moved - pos[low] - bh.displacements(pos[low], skin=True)[STATE_IDS.index(sid)], axis=1)
        out[sid] = {"moved": int((disp > 0.5).sum()), "maxMm": round(float(disp.max()), 2)}
    return out


def facets(breasts: dict) -> dict:
    out = {}
    for dirname in ("model-meshes", "model-meshes-mobile"):
        pos, idx = load(dirname, bb.SKIN)
        e = np.vstack([idx[:, [0, 1]], idx[:, [1, 2]], idx[:, [2, 0]]])
        rest = np.linalg.norm(pos[e[:, 0]] - pos[e[:, 1]], axis=1)
        states = carried(breasts, pos)
        moving = np.zeros(len(pos), bool)
        for moved in states:
            moving |= np.linalg.norm(moved - pos, axis=1) > 0.5
        sel = moving[e[:, 0]] & moving[e[:, 1]]
        entry = {"vertices": len(pos), "restEdgeMedianMm": round(float(np.median(rest)), 2), "restEdgeP95Mm": round(float(np.percentile(rest, 95)), 2)}
        for sid, moved in zip(STATE_IDS, states):
            length = np.linalg.norm(moved[e[sel, 0]] - moved[e[sel, 1]], axis=1)
            stretch = length / np.maximum(rest[sel], 1e-9)
            entry[sid] = {"edgeP95Mm": round(float(np.percentile(length, 95)), 2), "edgeMaxMm": round(float(length.max()), 2), "stretchMax": round(float(stretch.max()), 2)}
        out[dirname] = entry
    return out


def borders() -> dict:
    out = {}
    for dirname in ("model-meshes", "model-meshes-mobile"):
        pos, idx = load(dirname, bb.SKIN)
        _, weld = np.unique(np.round(pos, 3), axis=0, return_inverse=True)
        weld = weld.ravel()
        f = weld[idx]
        points = np.zeros((weld.max() + 1, 3))
        points[weld] = pos
        e = np.sort(np.vstack([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]]), axis=1)
        edges, count = np.unique(e, axis=0, return_counts=True)
        neighbours = defaultdict(list)
        for a, b in edges[count == 1]:
            neighbours[a].append(b)
            neighbours[b].append(a)
        seen, loops = set(), []
        for start in list(neighbours):
            if start in seen:
                continue
            loop, prev, cur = [start], None, start
            seen.add(start)
            while True:
                nxt = [n for n in neighbours[cur] if n != prev and n not in seen]
                if not nxt:
                    break
                prev, cur = cur, nxt[0]
                loop.append(cur)
                seen.add(cur)
            if len(loop) > 20:
                loops.append(points[loop])
        entry = []
        for loop in sorted(loops, key=len, reverse=True):
            # resampled by arc length (0.5 mm) and smoothed over 2 mm: a sawtooth stands out, a rounded corner does not
            closed = np.vstack([loop, loop[:1]])
            arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(closed, axis=0), axis=1))]
            s = np.arange(0, arc[-1], 0.5)
            fine = np.stack([np.interp(s, arc, closed[:, k]) for k in range(3)], 1)
            smooth = gaussian_filter1d(fine, 4, axis=0, mode="wrap")
            length = arc[-1]
            smooth_length = np.linalg.norm(np.diff(np.vstack([smooth, smooth[:1]]), axis=0), axis=1).sum()
            dev = np.linalg.norm(fine - smooth, axis=1)
            entry.append({"vertices": len(loop), "centreMm": np.round(loop.mean(0)).tolist(), "lengthRatio": round(float(length / smooth_length), 3),
                          "sawtoothP95Mm": round(float(np.percentile(dev, 95)), 2), "sawtoothMaxMm": round(float(dev.max()), 2)})
        out[dirname] = entry
    return out


def main() -> None:
    axis = bb.trunk_axis()
    breasts = {side: bb.Breast(side, axis) for side in ("op", "contra")}
    report = {"creases": creases(breasts), "lowMovers": low_movers(breasts), "facets": facets(breasts), "borders": borders()}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n")
    failures = []
    worst = max(report["creases"].items(), key=lambda item: item[1]["maxDeg"])
    print(f"vincos do mapa: pior {worst[1]['maxDeg']:.1f}° em {worst[0]} (em {worst[1]['at']} mm); limite {CREASE_MAX_DEG}°")
    for key, value in report["creases"].items():
        if value["maxDeg"] > CREASE_MAX_DEG:
            failures.append(f"vinco de {value['maxDeg']:.1f}° em {key} (em {value['at']} mm)")
    for sid, value in report["lowMovers"].items():
        print(f"pele abaixo de y = {LOW_Y_MM:.0f} mm movida pela mama em {sid}: {value['moved']} vértices (máx {value['maxMm']} mm)")
        if value["moved"]:
            failures.append(f"{value['moved']} vértices do abdome movidos pela mama em {sid}")
    for dirname, entry in report["facets"].items():
        g4 = entry[STATE_IDS[-1]]
        print(f"{dirname}: {entry['vertices']} vértices, aresta em repouso {entry['restEdgeMedianMm']} mm (p95 {entry['restEdgeP95Mm']}); {STATE_IDS[-1]}: p95 {g4['edgeP95Mm']} mm, máx {g4['edgeMaxMm']} mm, estiramento ×{g4['stretchMax']}")
    for dirname, loops in report["borders"].items():
        for loop in loops:
            print(f"{dirname}: borda de {loop['vertices']} vértices em {loop['centreMm']}: ×{loop['lengthRatio']} do contorno liso, dente p95 {loop['sawtoothP95Mm']} mm (máx {loop['sawtoothMaxMm']})")
            if loop["lengthRatio"] > BORDER_RATIO_MAX or loop["sawtoothP95Mm"] > SAWTOOTH_P95_MAX_MM:
                failures.append(f"borda serrilhada em {dirname} {loop['centreMm']}")
    print(f"wrote {OUT.relative_to(bb.ROOT)}")
    if failures and "--report" not in sys.argv:
        print("FALHOU:\n  " + "\n  ".join(failures))
        sys.exit(1)
    print("ok" if not failures else f"{len(failures)} limites excedidos (--report)")


if __name__ == "__main__":
    main()
