#!/usr/bin/env python3
"""Pilot for phases 2-3 of docs/plano-mamoplastia.md: pre-operative marking and surgical pieces.

Status: PILOT, kept as the library of build_mammaplasty.py, which ships the markings and pieces to the
app: the standing skin chart (Standing), the bezier helper and the review renderer (tube, splat) live
here. Running this file still gives the original pilot report, where the pieces were cut in the rest
chart; build_mammaplasty.py designs them on the standing breast instead (see docs/plano-mamoplastia.md).
Every dimension (areola, limbs, angle, pedicle bases, flap thickness) is a proposal to be confirmed by
the specialist.

1. Standing chart. The skin of a breast state (the ptotic breast, as in the standing patient) is
   unrolled into (X, s): X across the breast, s the length of skin down each meridian from the
   horizontal through point A. Every chart point keeps its pre-image on the rest skin, so whatever
   is drawn here can be carried to any other state by the breast map.
2. Marking. Lines are drawn on the standing skin with true lengths: the straightest line from a
   point, with a heading, for a length (a discrete geodesic). Point A is the projection of the
   inframammary fold on the breast meridian. Keyhole (Wise) pattern: areola opening around the new
   nipple position, two limbs, horizontal limbs to the ends of the fold incision.
3. Pieces. A piece is the tissue under a region of skin, between two depth surfaces of the rest
   chart (skin, flap thickness, chest wall): the rest shape of the model is the supine one, close to
   the breast on the table, where the cuts go straight down to the wall. Pieces are closed meshes;
   volume times density gives the weight.

Usage: python3 scripts/hybrid/pilot_mammaplasty.py [--state ptose-2] [--angle 90] [--figures DIR]
       (needs the decoded model, see build_breast.py; shapely; matplotlib for --figures)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import trimesh
from scipy.ndimage import gaussian_filter, gaussian_filter1d, map_coordinates
from scipy.spatial import Delaunay
from shapely.geometry import MultiPoint, Point, Polygon

sys.path.insert(0, str(Path(__file__).parent))
import build_breast as bb  # noqa: E402

CELL, RREF = bb.CELL, bb.RREF
DENSITY = 0.95  # g/mL, fatty breast tissue

# Proposed dimensions (mm, degrees)
AREOLA_D = 42.0
LIMB = 50.0
RIM = 10.0  # dermoglandular rim kept around the areola on a pedicle
INFERIOR_BASE = 80.0
SUPERIOR_THICKNESS = 25.0
FOLD_MARGIN = 15.0  # the fold incision stops this far from each end of the fold
LEFT_ON_FASCIA = 5.0  # tissue left on the pectoral fascia under a resection


# --------------------------------------------------------------------------------------------------
# 1. standing chart
# --------------------------------------------------------------------------------------------------
class Standing:
    """Skin of one breast in a state, unrolled: X = mm across (lateral +), s = mm of skin down each meridian
    from the horizontal through the reference height (the fold height on the breast meridian)."""

    def __init__(self, breast: bb.Breast, state: int, samples: int = 500):
        self.b, self.k = breast, state
        ch = breast.ch
        lo, hi = breast.fold_range
        self.us = np.arange(lo - 6, hi + 6.01, 1.0)
        self.um = float(ch.nipple[0])
        fold = np.interp(self.us, ch.us, breast.fold)
        top = np.interp(self.us, ch.us, breast.top) + 25.0
        t = np.linspace(0, 1, samples)
        self.V = top[:, None] + (fold - top)[:, None] * t[None, :]  # rest heights, top -> fold
        u = np.repeat(self.us[:, None], samples, 1)
        moved = self.to_state(np.stack([u, self.V, self.skin_r(u, self.V)], -1).reshape(-1, 3)).reshape(len(self.us), samples, 3)
        self.P = ch.to_model(moved)  # the standing skin as a surface P[column, sample]
        steps = np.linalg.norm(np.diff(self.P, axis=1), axis=2)
        self.S = np.concatenate([np.zeros((len(self.us), 1)), np.cumsum(steps, 1)], 1)
        im = int(np.argmin(np.abs(self.us - self.um)))
        self.fold_height = float(fold[im])
        ref = np.empty(len(self.us))
        for i in range(len(self.us)):
            below = np.nonzero(moved[i, :, 1] <= self.fold_height)[0]
            if len(below) and below[0] > 0:
                j = below[0]
                f = (moved[i, j - 1, 1] - self.fold_height) / max(moved[i, j - 1, 1] - moved[i, j, 1], 1e-9)
                ref[i] = self.S[i, j - 1] + f * (self.S[i, j] - self.S[i, j - 1])
            else:
                ref[i] = self.S[i, -1]  # the skin of this column never comes down to that height
        self.Sref = gaussian_filter1d(ref, 3.0, mode="nearest")
        at_ref = int(np.argmin(np.abs(self.S[im] - self.Sref[im])))
        self.rho = float(moved[im, at_ref, 2] / RREF)  # mm of skin per mm of u at point A
        self.s_fold = self.S[:, -1] - self.Sref

    def skin_r(self, u, v):
        return map_coordinates(self.b.RS, [(u - bb.U_RANGE[0]) / CELL, (v - bb.V_RANGE[0]) / CELL], order=1, mode="nearest")

    def to_state(self, q: np.ndarray) -> np.ndarray:
        return q if self.k < 0 else bb.deform(self.b, q)[self.k]

    # ---- chart <-> rest skin ---------------------------------------------------------------------
    def rest_uv(self, xs: np.ndarray) -> np.ndarray:
        xs = np.atleast_2d(xs)
        u = self.um + xs[:, 0] / self.rho
        fi = np.clip(u - self.us[0], 0, len(self.us) - 1.001)
        i0 = np.floor(fi).astype(int)
        w = fi - i0
        v = np.empty(len(xs))
        for n in range(len(xs)):
            a, b = (np.interp(xs[n, 1], self.S[i] - self.Sref[i], self.V[i]) for i in (i0[n], i0[n] + 1))
            v[n] = a * (1 - w[n]) + b * w[n]
        return np.stack([u, v], 1)

    def chart_of_rest(self, u: float, v: float) -> np.ndarray:
        i = int(np.clip(round(u - self.us[0]), 0, len(self.us) - 1))
        return np.array([(u - self.um) * self.rho, np.interp(-v, -self.V[i], self.S[i] - self.Sref[i])])

    def fold_s(self, x):
        return np.interp(self.um + np.asarray(x) / self.rho, self.us, self.s_fold)

    def skin(self, xs: np.ndarray, lift: float = 0.0) -> np.ndarray:
        """Rest chart points (u, v, r) on the skin for chart points; lift > 0 raises them off the skin."""
        uv = self.rest_uv(xs)
        return np.c_[uv, self.skin_r(uv[:, 0], uv[:, 1]) + lift]

    def model(self, chart_points: np.ndarray) -> np.ndarray:
        return self.b.ch.to_model(self.to_state(chart_points))

    def length(self, xs: np.ndarray) -> float:
        return bb.polyline_length(self.model(self.skin(xs)))

    # ---- the standing skin as a parametric surface -------------------------------------------------
    def surf(self, i: float, j: float) -> np.ndarray:
        ni, nj = self.P.shape[:2]
        i, j = float(np.clip(i, 0, ni - 1.001)), float(np.clip(j, 0, nj - 1.001))
        i0, j0 = int(i), int(j)
        a, b = i - i0, j - j0
        return self.P[i0, j0] * (1 - a) * (1 - b) + self.P[i0 + 1, j0] * a * (1 - b) + self.P[i0, j0 + 1] * (1 - a) * b + self.P[i0 + 1, j0 + 1] * a * b

    def tangents(self, i: float, j: float):
        return self.surf(i + 0.5, j) - self.surf(i - 0.5, j), self.surf(i, j + 0.5) - self.surf(i, j - 0.5)

    def index_of(self, xs) -> tuple[float, float]:
        i = float(np.clip(self.um + xs[0] / self.rho - self.us[0], 0, len(self.us) - 1.001))
        i0 = int(i)
        a, b = (np.interp(xs[1], self.S[k] - self.Sref[k], np.arange(self.S.shape[1])) for k in (i0, i0 + 1))
        return i, float(a * (1 - (i - i0)) + b * (i - i0))

    def chart_at(self, i: float, j: float) -> np.ndarray:
        i0, j0 = int(min(i, len(self.us) - 1.001)), int(min(j, self.S.shape[1] - 1.001))
        a, b = i - i0, j - j0
        s0, s1 = ((self.S[k, j0] - self.Sref[k]) * (1 - b) + (self.S[k, j0 + 1] - self.Sref[k]) * b for k in (i0, i0 + 1))
        return np.array([(self.us[0] + i - self.um) * self.rho, s0 * (1 - a) + s1 * a])

    def march(self, start, heading_deg: float, length: float, step: float = 1.0) -> np.ndarray:
        """Straightest line on the skin from a chart point (a discrete geodesic). Heading from 'down the skin',
        + towards lateral. Returns chart points every `step` mm of true length."""
        i, j = self.index_of(start)
        tu, tt = self.tangents(i, j)
        down = tt / np.linalg.norm(tt)
        across = tu - (tu @ down) * down
        across /= np.linalg.norm(across)
        h = np.radians(heading_deg)
        direction = np.cos(h) * down + np.sin(h) * across
        out, p, travelled = [self.chart_at(i, j)], self.surf(i, j), 0.0
        while travelled < length - 1e-9:
            target = p + min(step, length - travelled) * direction
            for _ in range(4):  # project the step back onto the surface
                tu, tt = self.tangents(i, j)
                di, dj = np.linalg.lstsq(np.stack([tu, tt], 1), target - self.surf(i, j), rcond=None)[0]
                i = float(np.clip(i + np.clip(di, -3, 3), 0, self.P.shape[0] - 1.001))
                j = float(np.clip(j + np.clip(dj, -6, 6), 0, self.P.shape[1] - 1.001))
            q = self.surf(i, j)
            move = q - p
            n = float(np.linalg.norm(move))
            if n < 1e-6:
                break
            travelled += n
            tu, tt = self.tangents(i, j)
            normal = np.cross(tu, tt)
            normal /= np.linalg.norm(normal)
            direction = move / n - (move / n @ normal) * normal
            direction /= np.linalg.norm(direction)
            p = q
            out.append(self.chart_at(i, j))
        return np.array(out)

    def ring(self, centre, radius: float, n: int = 48) -> np.ndarray:
        """Circle of skin at `radius` (true length) from a chart point."""
        return np.array([self.march(centre, a, radius)[-1] for a in np.linspace(0, 360, n, endpoint=False)])


# --------------------------------------------------------------------------------------------------
# 2. marking
# --------------------------------------------------------------------------------------------------
def bezier(p0, p1, p2, n: int = 50) -> np.ndarray:
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 2 * p0 + 2 * t * (1 - t) * p1 + t**2 * p2


def wise_pattern(st: Standing, angle_deg: float, new_nipple_drop: float = 0.0):
    """Keyhole (Wise) pattern on the standing skin. Named points, closed outline and separate lines (chart)."""
    rk = AREOLA_D / 2
    centre = np.array([0.0, 0.0])
    if new_nipple_drop:
        centre = st.march(centre, 0.0, new_nipple_drop)[-1]
    medial = st.march(centre, -angle_deg / 2, rk + LIMB)
    lateral = st.march(centre, angle_deg / 2, rk + LIMB)
    root = int(round(rk))
    b, c = medial[-1], lateral[-1]
    lo, hi = st.b.fold_range
    xd, xe = (lo + FOLD_MARGIN - st.um) * st.rho, (hi - FOLD_MARGIN - st.um) * st.rho
    d, e = np.array([xd, float(st.fold_s(xd))]), np.array([xe, float(st.fold_s(xe))])

    def horizontal(start, end):
        # leaves the limb end across the lower pole, then follows the breast border up to the end of the fold
        control = np.array([end[0] + 0.25 * (start[0] - end[0]), start[1] + 8.0])
        curve = bezier(start, control, end)
        curve[:, 1] = np.minimum(curve[:, 1], st.fold_s(curve[:, 0]) - 0.5)
        return curve

    fold_x = np.linspace(xe, xd, 120)
    fold = np.c_[fold_x, st.fold_s(fold_x)]
    arc = np.array([st.march(centre, a, rk)[-1] for a in np.linspace(-angle_deg / 2, -(360 - angle_deg / 2), 64)])
    bd, ce = horizontal(b, d), horizontal(c, e)
    outline = np.vstack([arc, lateral[root:], ce, fold, bd[::-1], medial[root:][::-1]])
    points = {"A": np.array([0.0, 0.0]), "novo mamilo": centre, "B": b, "C": c, "D": d, "E": e}
    lines = {"fechadura": arc, "ramo medial": medial[root:], "ramo lateral": lateral[root:], "horizontal medial": bd, "horizontal lateral": ce, "sulco": fold}
    return points, outline, lines


# --------------------------------------------------------------------------------------------------
# 3. regions and pieces
# --------------------------------------------------------------------------------------------------
def hull(*point_sets) -> Polygon:
    return MultiPoint(np.vstack(point_sets)).convex_hull


def regions(st: Standing, points: dict, outline: np.ndarray, lines: dict, angle_deg: float) -> dict:
    """Skin regions in the standing chart: pattern, areola, pedicles and resections."""
    nipple = st.chart_of_rest(st.um, 0.0)
    wise = Polygon(outline).buffer(0)
    xs = np.linspace(-130, 140, 400)
    mound = Polygon(np.vstack([np.c_[xs, st.fold_s(xs)], [[140, -250], [-130, -250]]])).buffer(0)  # skin above the fold
    rim = st.ring(nipple, AREOLA_D / 2 + RIM)
    keyhole = st.ring(points["novo mamilo"], AREOLA_D / 2)
    # base of the inferior pedicle: the fold, INFERIOR_BASE / 2 of true length either side of the meridian
    probe = np.linspace(0, 70, 141)

    def reach(sign):
        pts = np.c_[sign * probe, st.fold_s(sign * probe)]
        cum = np.r_[0, np.cumsum(np.linalg.norm(np.diff(st.model(st.skin(pts)), axis=0), axis=1))]
        return sign * float(np.interp(INFERIOR_BASE / 2, cum, probe))

    base_x = np.linspace(reach(-1), reach(1), 40)
    base = np.c_[base_x, st.fold_s(base_x)]
    upper_medial = np.array([st.march(points["novo mamilo"], a, AREOLA_D / 2)[-1] for a in np.linspace(-180, -angle_deg / 2, 16)])
    pedicles = {
        "inferior": hull(rim, base).intersection(mound),
        "superior": hull(keyhole, rim),
        "superomedial": hull(upper_medial, lines["ramo medial"][:36], rim),
        "medial": hull(lines["ramo medial"], rim),
        "lateral": hull(lines["ramo lateral"], rim),
        "central": Polygon(rim),
    }
    pedicles = {k: v.intersection(mound).buffer(0) for k, v in pedicles.items()}
    resections = {
        "ferradura (pedículo inferior)": wise.difference(pedicles["inferior"]).buffer(0),
        "central inferior (pedículo superior)": wise.difference(pedicles["superior"]).buffer(0),
    }
    return {"wise": wise, "nipple": nipple, "areola": Polygon(st.ring(nipple, AREOLA_D / 2)), "pedicles": pedicles, "resections": resections}


def prism(st: Standing, region: Polygon, top, bottom, spacing: float = 3.0, layers: int = 6):
    """Closed mesh of the tissue under a skin region between two depth surfaces (functions of rest u, v).
    Vertices are rest chart points (u, v, r)."""
    minx, miny, maxx, maxy = region.bounds
    gx, gy = np.meshgrid(np.arange(minx, maxx + spacing, spacing), np.arange(miny, maxy + spacing, spacing))
    inner = region.buffer(-spacing * 0.6)
    grid = np.array([p for p in np.c_[gx.ravel(), gy.ravel()] if inner.contains(Point(p))]).reshape(-1, 2)
    rings = [region.exterior, *region.interiors]
    border = np.vstack([np.array([ring.interpolate(s).coords[0] for s in np.arange(0, ring.length, spacing * 0.7)]) for ring in rings])
    pts = np.vstack([grid, border])
    tri = Delaunay(pts).simplices
    keep = region.buffer(0.05)
    tri = tri[[keep.contains(Point(c)) for c in pts[tri].mean(1)]]
    # consistent winding (scipy does not guarantee it)
    a, b, c = pts[tri[:, 0]], pts[tri[:, 1]], pts[tri[:, 2]]
    flip = ((b - a)[:, 0] * (c - a)[:, 1] - (b - a)[:, 1] * (c - a)[:, 0]) < 0
    tri[flip] = tri[flip][:, ::-1]
    uv = st.rest_uv(pts)
    r_top = top(uv[:, 0], uv[:, 1])
    r_bottom = np.minimum(bottom(uv[:, 0], uv[:, 1]), r_top - 0.5)
    n = len(pts)
    verts = np.vstack([np.c_[uv, r_top + (r_bottom - r_top) * layer / layers] for layer in range(layers + 1)])
    faces = [tri, tri[:, ::-1] + layers * n]
    edges = np.vstack([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]])
    _, inverse, counts = np.unique(np.sort(edges, 1), axis=0, return_inverse=True, return_counts=True)
    boundary = edges[counts[inverse.ravel()] == 1]
    for layer in range(layers):
        p, q = boundary[:, 0] + layer * n, boundary[:, 1] + layer * n
        faces += [np.c_[q, p, p + n], np.c_[q, p + n, q + n]]
    return verts, np.vstack(faces)


def build_piece(st: Standing, region, top, bottom) -> dict:
    polygons = [g for g in (region.geoms if region.geom_type == "MultiPolygon" else [region]) if g.area > 60]
    verts, faces, offset = [], [], 0
    for polygon in polygons:
        v, f = prism(st, polygon, top, bottom)
        verts.append(v)
        faces.append(f + offset)
        offset += len(v)
    verts, faces = np.vstack(verts), np.vstack(faces)
    rest = trimesh.Trimesh(st.b.ch.to_model(verts), faces, process=False)
    # closed: every edge is used an even number of times (the triangulation of a region may pinch at a vertex,
    # which makes an edge of the wall belong to four faces; the surface still encloses the volume)
    _, uses = np.unique(np.sort(rest.edges, axis=1), axis=0, return_counts=True)
    return {"chart": verts, "faces": faces, "volumeMl": abs(float(rest.volume)) / 1000, "closed": bool((uses % 2 == 0).all())}


def depth_surfaces(st: Standing):
    """Depth surfaces of the rest chart: just under the skin, chest wall (back of the adipose body), flap."""
    ch = st.b.ch
    fat = next(n for n in bb.SIDE_MESHES[ch.side] if "fat" in n)
    back = gaussian_filter(bb.fill_nan(ch.radius_field(*bb.mesh(fat), outer=False)), 2.0)
    sample = lambda g: (lambda u, v: map_coordinates(g, [(u - bb.U_RANGE[0]) / CELL, (v - bb.V_RANGE[0]) / CELL], order=1, mode="nearest"))
    skin, back_r = sample(st.b.RS), sample(back)
    top = lambda u, v: skin(u, v) - 0.6
    wall = lambda u, v: np.minimum(back_r(u, v) + 1.0, skin(u, v) - 3.0)
    flap = lambda mm: (lambda u, v: np.maximum(skin(u, v) - mm, wall(u, v)))
    above_fascia = lambda u, v: np.minimum(back_r(u, v) + LEFT_ON_FASCIA, skin(u, v) - 3.0)
    return top, wall, flap, above_fascia


# --------------------------------------------------------------------------------------------------
# report and figures
# --------------------------------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--state", default="ptose-2")
    parser.add_argument("--angle", type=float, default=90.0, help="angle between the keyhole limbs (degrees)")
    parser.add_argument("--figures", type=Path)
    args = parser.parse_args()
    state = [s["id"] for s in bb.STATES].index(args.state)
    axis = bb.trunk_axis()
    breast = bb.Breast("op", axis)
    st = Standing(breast, state)
    points, outline, lines = wise_pattern(st, args.angle)
    reg = regions(st, points, outline, lines, args.angle)
    top, wall, flap, above_fascia = depth_surfaces(st)

    model_point = lambda xs: st.model(st.skin(np.atleast_2d(xs)))[0]
    notch = bb.layer_landmark("esterno.incisura-jugular")
    report = {
        "state": args.state,
        "limbAngleDeg": args.angle,
        "linesMm": {k: round(st.length(v), 1) for k, v in lines.items()},
        "pointAToNippleMm": round(st.length(np.c_[np.zeros(60), np.linspace(0, reg["nipple"][1], 60)]), 1),
        "notchToPointAMm": round(float(np.linalg.norm(model_point(points["A"]) - notch)), 1),
        "limbEndsApartMm": round(float(np.linalg.norm(model_point(points["B"]) - model_point(points["C"]))), 1),
    }
    report["horizontalLimbsMinusFoldMm"] = round(report["linesMm"]["horizontal medial"] + report["linesMm"]["horizontal lateral"] - report["linesMm"]["sulco"], 1)
    pieces = {}
    for name, region in reg["pedicles"].items():
        pieces[f"pedículo {name}"] = build_piece(st, region, top, flap(SUPERIOR_THICKNESS) if name == "superior" else wall)
    for name, region in reg["resections"].items():
        pieces[f"ressecção {name}"] = build_piece(st, region, top, above_fascia)
    report["pieces"] = {k: {"volumeMl": round(p["volumeMl"], 1), "weightG": round(p["volumeMl"] * DENSITY), "closedMesh": p["closed"], "triangles": int(len(p["faces"]))} for k, p in pieces.items()}

    print(f"Estado {args.state} · ângulo entre os ramos {args.angle:.0f}°")
    for key, value in report["linesMm"].items():
        print(f"  {key:20s} {value:6.1f} mm")
    print(f"  ponto A → mamilo atual (pele) {report['pointAToNippleMm']} mm · fúrcula → ponto A (reta) {report['notchToPointAMm']} mm · B–C {report['limbEndsApartMm']} mm")
    print(f"  ramos horizontais − sulco: {report['horizontalLimbsMinusFoldMm']:+.1f} mm")
    for key, value in report["pieces"].items():
        print(f"  {key:44s} {value['volumeMl']:6.1f} mL ≈ {value['weightG']:4d} g  {'fechada' if value['closedMesh'] else 'ABERTA'}")
    out = bb.ROOT / "assets/build/mammaplasty-pilot.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n")
    print(f"wrote {out.relative_to(bb.ROOT)}")
    if args.figures:
        figures(st, points, outline, lines, reg, pieces, args.figures)


def tube(points3d: np.ndarray, radius: float = 0.9, sides: int = 6):
    p = np.asarray(points3d)
    d = np.gradient(p, axis=0)
    d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
    a = np.cross(d, [0.0, 1.0, 0.0])
    a /= np.maximum(np.linalg.norm(a, axis=1, keepdims=True), 1e-9)
    b = np.cross(d, a)
    ang = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    verts = (p[:, None, :] + radius * (np.cos(ang)[None, :, None] * a[:, None, :] + np.sin(ang)[None, :, None] * b[:, None, :])).reshape(-1, 3)
    faces = [[i * sides + k, i * sides + (k + 1) % sides, (i + 1) * sides + k] for i in range(len(p) - 1) for k in range(sides)]
    faces += [[i * sides + (k + 1) % sides, (i + 1) * sides + (k + 1) % sides, (i + 1) * sides + k] for i in range(len(p) - 1) for k in range(sides)]
    return verts, np.array(faces)


def splat(layers, yaw: float, pitch: float, centre, half: float = 135.0, size: int = 620, spacing: float = 0.5) -> np.ndarray:
    """Tiny orthographic renderer (surface samples through a z-buffer): opaque layers, then translucent ones on top."""
    y, p = np.radians(yaw), np.radians(pitch)
    rot = np.array([[1, 0, 0], [0, np.cos(p), -np.sin(p)], [0, np.sin(p), np.cos(p)]]) @ np.array([[np.cos(y), 0, np.sin(y)], [0, 1, 0], [-np.sin(y), 0, np.cos(y)]])
    image = np.ones((size, size, 3)) * np.array([0.05, 0.07, 0.12])
    depth = np.full(size * size, -np.inf)
    flat = image.reshape(-1, 3)
    light = np.array([0.4, 0.5, 0.8]) / np.linalg.norm([0.4, 0.5, 0.8])
    for pos, idx, color, alpha in sorted(layers, key=lambda layer: layer[3] < 1):
        a, b, c = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
        normal = np.cross(b - a, c - a)
        area = 0.5 * np.linalg.norm(normal, axis=1)
        normal /= np.maximum(2 * area[:, None], 1e-12)
        tri = np.repeat(np.arange(len(idx)), np.maximum(1, np.ceil(area / spacing**2).astype(int)))
        gen = np.random.default_rng(1)
        s, t = gen.random(len(tri)), gen.random(len(tri))
        fold = s + t > 1
        s[fold], t[fold] = 1 - s[fold], 1 - t[fold]
        q = (a[tri] + (b[tri] - a[tri]) * s[:, None] + (c[tri] - a[tri]) * t[:, None] - np.array(centre)) @ rot.T
        shade = 0.35 + 0.65 * np.abs((normal[tri] @ rot.T) @ light)
        px = ((q[:, 0] / half * 0.5 + 0.5) * size).astype(int)
        py = ((-q[:, 1] / half * 0.5 + 0.5) * size).astype(int)
        ok = (px >= 0) & (px < size) & (py >= 0) & (py < size)
        lin, z, shade = (py * size + px)[ok], q[ok, 2], shade[ok]
        order = np.argsort(z)
        lin, z, shade = lin[order], z[order], shade[order]
        _, last = np.unique(lin[::-1], return_index=True)
        sel = len(lin) - 1 - last  # nearest sample of every pixel
        lin, z, shade = lin[sel], z[sel], shade[sel]
        front = z > depth[lin]
        col = np.array(color)[None, :] * shade[front, None]
        if alpha >= 1:
            flat[lin[front]] = col
            depth[lin[front]] = z[front]
        else:
            flat[lin[front]] = flat[lin[front]] * (1 - alpha) + col * alpha
    return np.clip(image, 0, 1)


def figures(st: Standing, points, outline, lines, reg, pieces, out: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    out.mkdir(parents=True, exist_ok=True)
    ch = st.b.ch
    # ---- standing chart with the pattern and the pedicle regions ----
    fig, ax = plt.subplots(figsize=(8.5, 8.5))
    xs = np.linspace(-110, 125, 300)
    ax.plot(xs, st.fold_s(xs), color="#c2410c", lw=1.5, label="sulco inframamário (fim da pele da mama)")
    palette = {"inferior": "#16a34a", "superior": "#2563eb", "superomedial": "#0891b2", "medial": "#7c3aed", "lateral": "#db2777", "central": "#ca8a04"}
    for name, region in reg["pedicles"].items():
        for geom in region.geoms if region.geom_type == "MultiPolygon" else [region]:
            ax.fill(*geom.exterior.xy, color=palette[name], alpha=0.16)
            ax.plot(*geom.exterior.xy, color=palette[name], lw=1, label=f"pedículo {name}")
    ax.plot(outline[:, 0], outline[:, 1], "k-", lw=2, label="padrão de Wise")
    ax.fill(*reg["areola"].exterior.xy, color="#7c2d12", alpha=0.5)
    for name, p in points.items():
        ax.plot(*p, "o", color="#111827", ms=4)
        ax.annotate(name, p, textcoords="offset points", xytext=(5, -4), fontsize=10, weight="bold")
    handles, labels = ax.get_legend_handles_labels()
    unique = dict(zip(labels, handles))
    ax.legend(unique.values(), unique.keys(), fontsize=8, loc="lower center", ncol=2)
    ax.invert_yaxis()
    ax.set_aspect("equal")
    ax.grid(alpha=0.25)
    ax.set_xlabel("X: através da mama (mm, lateral +)")
    ax.set_ylabel("s: pele abaixo do ponto A, ao longo do meridiano (mm)")
    ax.set_title("Carta da pele em pé (mama ptótica): marcação e regiões dos pedículos — piloto")
    fig.savefig(out / "mamoplastia-piloto-carta.png", dpi=90, bbox_inches="tight")
    plt.close(fig)

    # ---- 3D: marking on the skin, pieces inside ----
    axis = (ch.xc, ch.zc)
    other = bb.Breast("contra" if ch.side == "op" else "op", axis)
    skin_pos, skin_idx = bb.mesh(bb.SKIN)
    skin_pos = ch.to_model(st.to_state(ch.to_chart(skin_pos)))
    if st.k >= 0:
        skin_pos = other.ch.to_model(bb.deform(other, other.ch.to_chart(skin_pos))[st.k])
    nac = [(ch.to_model(st.to_state(ch.to_chart(pos))), idx) for pos, idx in (bb.mesh(n) for n in bb.SIDE_MESHES[ch.side] if "nipple" in n or "areola" in n)]
    wall_names = bb.names(lambda m: m["structure"] in ("chest-wall", "costal-cartilages") and m["tissue"] in ("bone", "cartilage") and "vertebra" not in m["sourceName"].lower())
    muscle_names = bb.names(lambda m: m["structure"] == "pectoralis-major")
    skin_color, nac_color = (0.92, 0.74, 0.64), (0.55, 0.30, 0.24)
    context = [(*bb.mesh(n), (0.86, 0.83, 0.75), 1.0) for n in wall_names] + [(*bb.mesh(n), (0.66, 0.27, 0.24), 1.0) for n in muscle_names]
    marks = [(*tube(st.model(st.skin(xs, lift=0.8))), (0.85, 0.1, 0.1) if name == "sulco" else (0.1, 0.2, 0.9), 1.0) for name, xs in lines.items()]
    meridian = np.c_[np.zeros(160), np.linspace(-150, float(st.fold_s(0)), 160)]
    marks.append((*tube(st.model(st.skin(meridian, lift=0.8)), radius=0.6), (0.08, 0.08, 0.08), 1.0))
    centre = tuple(ch.to_model(st.to_state(ch.nipple[None]))[0] + np.array([8.0, 28.0, -30.0]))
    side = 1 if ch.side == "op" else -1
    views = [(0, 0), (40 * side, 0), (25 * side, -45)]
    surface = [(skin_pos, skin_idx, skin_color, 1.0)] + [(p, i, nac_color, 1.0) for p, i in nac]
    plt.imsave(out / "mamoplastia-piloto-marcacao.png", np.hstack([splat(surface + marks, yaw, pitch, centre) for yaw, pitch in views]))

    def inside(named):
        layers = context + [(ch.to_model(st.to_state(pieces[n]["chart"])), pieces[n]["faces"], color, 1.0) for n, color in named]
        layers += [(p, i, nac_color, 1.0) for p, i in nac] + marks[:5] + [(skin_pos, skin_idx, skin_color, 0.22)]
        return np.hstack([splat(layers, yaw, pitch, centre) for yaw, pitch in views])

    green, orange, blue = (0.25, 0.72, 0.38), (0.92, 0.45, 0.15), (0.25, 0.5, 0.9)
    plt.imsave(out / "mamoplastia-piloto-pediculo-inferior.png", inside([("pedículo inferior", green), ("ressecção ferradura (pedículo inferior)", orange)]))
    plt.imsave(out / "mamoplastia-piloto-pediculo-superior.png", inside([("pedículo superior", blue), ("ressecção central inferior (pedículo superior)", orange)]))
    print(f"figures in {out}")


if __name__ == "__main__":
    main()
