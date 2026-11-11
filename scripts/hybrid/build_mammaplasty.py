#!/usr/bin/env python3
"""Reduction mammaplasty on the model: marking, pedicle and resection of three techniques
(docs/plano-mamoplastia.md, fases 2 e 3).

Everything is designed on the standing ptotic breast (ptosis grade II with moderate hypertrophy), as in
the consulting room, and shipped in rest coordinates: the breast map of the app (src/lib/breastMap.ts)
carries markings and pieces to the standing breast together with skin, gland and vessels.

1. Marking. Lines are drawn on the unrolled standing skin (pilot_mammaplasty.Standing) with true lengths.
   Point A, the new position of the nipple, is the projection of the inframammary fold on the breast
   meridian. Patterns: inverted T without keyhole (Pitanguy), keyhole (Wise), vertical with dome.
2. Pieces. A pedicle or a resection is the tissue behind a region of the breast seen from the front,
   from the skin straight back towards the chest (the way the textbooks draw them): to the chest wall,
   to the skin of the underside where the breast hangs below the fold, or to a flap thickness. Under the
   medial and lateral skin flaps of the inverted T the wedges are taken below the flap thickness, and the
   inferior pedicle keeps its root on the wall, under the plane of the horizontal septum. The pieces are
   closed meshes built in the standing breast and pulled back to rest by inverting the breast map
   (Newton); volume times density is the weight.
3. What each pedicle keeps. The schematic vessels and nerves of build_breast_anatomy.py are followed
   from their origin to the nipple: a branch that crosses a resection is cut by that technique.

Every dimension (areola, limbs, angles, pedicle bases, flap thickness, tissue left on the fascia) is a
proposal written at the top of this file, to be confirmed by the specialist.

Outputs:
  src/data/mammaplasty.json                 structures, marking centre lines, points, measurements
  public/models/hybrid/mammaplasty.bin      piece meshes (rest positions int16, indices uint16)

Usage: node scripts/hybrid/decode_model.mjs && python3 scripts/hybrid/build_breast_anatomy.py && \\
       python3 scripts/hybrid/build_mammaplasty.py [--figures DIR]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import trimesh
from scipy.ndimage import gaussian_filter, map_coordinates
from scipy.spatial import Delaunay, cKDTree
from shapely.geometry import MultiPoint, Point, Polygon, box
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).parent))
import build_breast as bb  # noqa: E402
from pilot_mammaplasty import Standing, bezier  # noqa: E402

OUT_JSON = bb.ROOT / "src/data/mammaplasty.json"
OUT_BIN = bb.ROOT / "public/models/hybrid/mammaplasty.bin"
ANATOMY_JSON = bb.ROOT / "src/data/breastAnatomy.json"
SOURCE = "Plano cirúrgico (este projeto)"
LICENSE = "Gerado neste projeto sobre as malhas do modelo (CC BY-SA 4.0, como a obra derivada)"
MM = bb.MM
RREF, CELL = bb.RREF, bb.CELL

STATE = "ptose-2"  # the breast that is marked and operated
DENSITY = 0.95  # g/mL, fatty breast tissue

# Proposed dimensions (mm, degrees)
AREOLA_D = 42.0  # new areola
LIMB = 50.0  # vertical limb, from the edge of the areola
T_ANGLE = 120.0  # angle between the limbs of the inverted T patterns
RIM = 10.0  # dermoglandular rim kept around the areola on a pedicle
INFERIOR_BASE = 80.0  # base of the inferior pedicle on the fold
SUPERIOR_THICKNESS = 25.0  # dermoglandular thickness of the superior pedicle
SUPEROMEDIAL_BASE = 80.0  # base of the superomedial pedicle along the pattern
FOLD_MARGIN = 15.0  # the fold incision stops this far from each end of the fold
LEFT_ON_FASCIA = 5.0  # tissue left on the pectoral fascia under a resection
FLAP_THICKNESS = 15.0  # medial and lateral skin flaps of the inverted T; also how deep an incision of the pattern cuts
ROOT_HEIGHT = 55.0  # the inferior pedicle stays on the wall this far above the fold (up to the fifth rib, origin of the septum)
ROOT_TOP_WIDTH = 46.0  # width of that root at its upper end (INFERIOR_BASE at the fold)
DOME_RISE = 21.0  # top of the dome above the new nipple (upper edge of the new areola)
DOME_BASE = 21.0  # the dome ends this far below the new nipple (lower edge of the new areola)
DOME_HALF = 34.0  # half-width of the dome at its base
VERTICAL_HALF = 48.0  # widest half-width of the vertical pattern
VERTICAL_STOP = 30.0  # the vertical pattern ends this far above the fold (skin length)

MARK_LIFT = 0.5  # the pen line sits on the skin
MARK_RADIUS = 0.75
COLORS = {"marking": "#2536a8", "reference": "#111827", "pedicle": "#3fae6b", "resection": "#e08a2e"}


# --------------------------------------------------------------------------------------------------
# the standing breast seen from the front
# --------------------------------------------------------------------------------------------------
class Front:
    """Tissue column behind every cell of the standing chart (u, v): from `bottom` to the front skin."""

    def __init__(self, st: Standing) -> None:
        self.st = st
        b, ch = st.b, st.b.ch
        lo, hi = b.fold_range
        self.u0, self.v0, self.cell = lo - 40.0, -160.0, 2.0
        nu, nv = int((hi + 40 - self.u0) / self.cell) + 1, int((170 - self.v0) / self.cell) + 1
        # the skin of the breast (from the fold up), densely, carried to the standing breast
        us = np.arange(lo - 8, hi + 8.01, 0.5)
        fold, top = np.interp(us, ch.us, b.fold), np.interp(us, ch.us, b.top) + 30.0
        t = np.linspace(0, 1, 1000)
        v = fold[:, None] + (top - fold)[:, None] * t[None]
        u = np.repeat(us[:, None], len(t), 1)
        moved = st.to_state(np.stack([u, v, st.skin_r(u, v)], -1).reshape(-1, 3))
        iu = np.round((moved[:, 0] - self.u0) / self.cell).astype(int)
        iv = np.round((moved[:, 1] - self.v0) / self.cell).astype(int)
        ok = (iu >= 0) & (iu < nu) & (iv >= 0) & (iv < nv)
        front = np.full((nu, nv), -np.inf)
        under = np.full((nu, nv), np.inf)
        np.maximum.at(front, (iu[ok], iv[ok]), moved[ok, 2])
        np.minimum.at(under, (iu[ok], iv[ok]), moved[ok, 2])
        seen = np.isfinite(front)
        # chest wall: back of the adipose body (pectoral fascia), which does not move
        fat = next(n for n in bb.SIDE_MESHES[ch.side] if "fat" in n)
        back = gaussian_filter(bb.fill_nan(ch.radius_field(*bb.mesh(fat), outer=False)), 2.0)
        gu, gv = np.meshgrid(self.u0 + self.cell * np.arange(nu), self.v0 + self.cell * np.arange(nv), indexing="ij")
        wall = map_coordinates(back, [(gu - bb.U_RANGE[0]) / CELL, (gv - bb.V_RANGE[0]) / CELL], order=1, mode="nearest")
        fold_here = np.interp(gu, ch.us, b.fold)
        # below the fold the breast hangs free: the column ends on the skin of its underside
        hanging = seen & (gv < fold_here - 1.0)
        front_f = gaussian_filter(np.where(seen, front, 0.0), 1.2) / np.maximum(gaussian_filter(seen.astype(float), 1.2), 1e-6)
        under_f = gaussian_filter(np.where(seen, under, 0.0), 1.2) / np.maximum(gaussian_filter(seen.astype(float), 1.2), 1e-6)
        self.front = np.where(seen, front_f, np.nan)
        self.deep = np.where(hanging, under_f + 0.6, wall + 1.0)  # full thickness
        self.spare = np.where(hanging, under_f + 0.6, wall + LEFT_ON_FASCIA)  # a layer is left on the fascia
        # where the skin is seen edge-on (the outline of the breast) there is no column to speak of: stop short of it
        thick = seen & (self.front - self.deep > 7.0)
        cells = [box(self.u0 + (i - 0.5) * self.cell, self.v0 + (j - 0.5) * self.cell, self.u0 + (i + 0.5) * self.cell, self.v0 + (j + 0.5) * self.cell) for i, j in np.argwhere(thick)]
        tidy = lambda shape: shape.buffer(5.0).buffer(-7.0).buffer(2.0).simplify(0.4)  # noqa: E731
        self.domain = tidy(unary_union(cells))
        self.hanging = tidy(unary_union([cell for cell, (i, j) in zip(cells, np.argwhere(thick)) if hanging[i, j]])).intersection(self.domain)
        self.wall = wall
        self.front_filled = bb.fill_nan(self.front)

    def sample(self, field: np.ndarray, uv: np.ndarray) -> np.ndarray:
        return map_coordinates(field, [(uv[:, 0] - self.u0) / self.cell, (uv[:, 1] - self.v0) / self.cell], order=1, mode="nearest")

    def top(self, uv):  # just under the skin
        return self.sample(self.front_filled, uv) - 0.6

    def bottom_full(self, uv):
        return self.sample(self.deep, uv)

    def bottom_spare(self, uv):
        return self.sample(self.spare, uv)

    def flap(self, thickness: float):
        return lambda uv: np.maximum(self.top(uv) - thickness, self.bottom_full(uv))

    def ramp(self, v_full: float, v_none: float):
        """Surface that goes from the front skin (at height v_full) back to the wall (at v_none): an oblique plane."""
        def surface(uv):
            f = np.clip((v_none - uv[:, 1]) / (v_none - v_full), 0, 1)
            deep = self.bottom_full(uv)
            return deep + (self.top(uv) - deep) * f
        return surface

    def fade(self, uv: np.ndarray, width: float = 6.0) -> np.ndarray:
        """0 on the outline of the breast seen from the front, 1 from `width` mm inside: pieces end there as a
        feather edge instead of a wall of uneven height."""
        outline = self.domain.exterior if self.domain.geom_type == "Polygon" else unary_union([g.exterior for g in self.domain.geoms])
        distance = np.array([outline.distance(Point(p)) for p in uv])
        t = np.clip(distance / width, 0, 1)
        return t * t * (3 - 2 * t)

    def project(self, chart_xs: np.ndarray) -> np.ndarray:
        """Points of the unrolled skin chart seen from the front: standing chart (u, v)."""
        return self.st.to_state(self.st.skin(chart_xs))[:, :2]

    def contains(self, region: Polygon, top, bottom, standing_points: np.ndarray) -> np.ndarray:
        """Which standing chart points (u, v, r) lie inside the piece `region` x [bottom, top]."""
        uv = standing_points[:, :2]
        inside = np.array([region.contains(Point(p)) for p in uv])
        return inside & (standing_points[:, 2] <= top(uv) + 0.6) & (standing_points[:, 2] >= bottom(uv))


class Inverse:
    """Standing chart -> rest chart: the breast map inverted by Newton iterations."""

    def __init__(self, breast: bb.Breast, state: int) -> None:
        self.b, self.k = breast, state
        lo, hi = breast.fold_range
        u, v, d = np.meshgrid(np.arange(lo - 10, hi + 10.1, 5.0), np.arange(-70.0, 140.1, 5.0), np.array([0.5, 3, 7, 12, 20, 30, 45, 60, 80, 100.0]), indexing="ij")
        rest = np.stack([u.ravel(), v.ravel(), breast.base(u.ravel(), v.ravel()) + d.ravel()], 1)
        self.rest = rest
        self.moved = self.forward(rest)
        self.tree = cKDTree(self.moved)

    def forward(self, q: np.ndarray) -> np.ndarray:
        return bb.deform(self.b, q)[self.k]

    def __call__(self, target: np.ndarray, iterations: int = 14) -> tuple[np.ndarray, np.ndarray]:
        _, near = self.tree.query(target)
        q = self.rest[near] + (target - self.moved[near])
        h = 0.05
        for _ in range(iterations):
            f = self.forward(q)
            error = target - f
            jac = np.stack([(self.forward(q + h * np.eye(3)[c]) - f) / h for c in range(3)], -1)
            jac += 1e-6 * np.eye(3)
            step = np.linalg.solve(jac, error[..., None])[..., 0]
            norm = np.linalg.norm(step, axis=1, keepdims=True)
            q = q + step * np.minimum(1.0, 8.0 / np.maximum(norm, 1e-9))
        return q, np.linalg.norm(self.forward(q) - target, axis=1)


# --------------------------------------------------------------------------------------------------
# markings (unrolled standing skin: X across, s down the skin from point A)
# --------------------------------------------------------------------------------------------------
def fold_ends(st: Standing):
    lo, hi = st.b.fold_range
    xd, xe = (lo + FOLD_MARGIN - st.um) * st.rho, (hi - FOLD_MARGIN - st.um) * st.rho
    return np.array([xd, float(st.fold_s(xd))]), np.array([xe, float(st.fold_s(xe))])


def horizontal_limb(st: Standing, start, end) -> np.ndarray:
    """From the end of a vertical limb across the lower pole, then along the breast border to the end of the fold."""
    control = np.array([end[0] + 0.25 * (start[0] - end[0]), start[1] + 8.0])
    curve = bezier(start, control, end)
    curve[:, 1] = np.minimum(curve[:, 1], st.fold_s(curve[:, 0]) - 0.5)
    return curve


def inverted_t(st: Standing, keyhole: bool):
    """Inverted T patterns. With keyhole: Wise (areola opening round A). Without: Pitanguy (A, B, C, D, E)."""
    rk = AREOLA_D / 2
    a = np.array([0.0, 0.0])
    medial, lateral = st.march(a, -T_ANGLE / 2, rk + LIMB), st.march(a, T_ANGLE / 2, rk + LIMB)
    b, c = medial[-1], lateral[-1]
    d, e = fold_ends(st)
    bd, ce = horizontal_limb(st, b, d), horizontal_limb(st, c, e)
    fold_x = np.linspace(e[0], d[0], 120)
    fold = np.c_[fold_x, st.fold_s(fold_x)]
    root = int(round(rk)) if keyhole else 0
    lines = {"ramo medial": medial[root:], "ramo lateral": lateral[root:], "horizontal medial": bd, "horizontal lateral": ce, "sulco": fold}
    points = {"A": a, "B": b, "C": c, "D": d, "E": e}
    if keyhole:
        arc = np.array([st.march(a, angle, rk)[-1] for angle in np.linspace(-T_ANGLE / 2, -(360 - T_ANGLE / 2), 64)])
        lines = {"fechadura": arc, **lines}
        top = arc
    else:
        top = a[None]
    # outline seen from the front: the fold itself is hidden behind the hanging breast
    visible = [top, lateral[root:], ce, bd[::-1], medial[root:][::-1]]
    return points, lines, visible


def vertical(st: Standing):
    """Vertical pattern with a dome over the new areola; the limbs meet above the fold."""
    a = np.array([0.0, 0.0])
    s_end = float(st.fold_s(0.0)) - VERTICAL_STOP
    s_base = DOME_BASE
    t = np.linspace(0, np.pi, 40)
    dome = np.c_[-DOME_HALF * np.cos(t), s_base - (DOME_RISE + s_base) * np.sin(t)]  # medial base, over the top, lateral base

    def limb(sign: float) -> np.ndarray:
        p0 = np.array([sign * DOME_HALF, s_base])
        p1 = np.array([sign * VERTICAL_HALF * 1.2, s_base + 0.30 * (s_end - s_base)])
        p2 = np.array([sign * VERTICAL_HALF * 0.9, s_base + 0.85 * (s_end - s_base)])
        p3 = np.array([0.0, s_end])
        u = np.linspace(0, 1, 80)[:, None]
        return (1 - u) ** 3 * p0 + 3 * u * (1 - u) ** 2 * p1 + 3 * u**2 * (1 - u) * p2 + u**3 * p3

    medial, lateral = limb(-1.0), limb(1.0)
    points = {"A": a, "T": dome[len(dome) // 2], "M": dome[0], "L": dome[-1], "F": np.array([0.0, s_end])}
    lines = {"cúpula": dome, "ramo medial": medial, "ramo lateral": lateral}
    visible = [dome, lateral, medial[::-1]]
    return points, lines, visible


# --------------------------------------------------------------------------------------------------
# pieces
# --------------------------------------------------------------------------------------------------
def hull(*point_sets) -> Polygon:
    return MultiPoint(np.vstack(point_sets)).convex_hull


def prism(region: Polygon, top, bottom, spacing: float = 3.5, wall_layers: int = 4, fade=None):
    """Closed mesh of the tissue behind a frontal region, between two depth surfaces. Vertices are standing
    chart points (u, v, r): the two faces and, along the border, intermediate rings."""
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
    a, b, c = pts[tri[:, 0]], pts[tri[:, 1]], pts[tri[:, 2]]
    area = (b - a)[:, 0] * (c - a)[:, 1] - (b - a)[:, 1] * (c - a)[:, 0]
    # border points in a straight line give flat triangles, whose orientation is anybody's guess: leave them out
    tri, area = tri[np.abs(area) > 0.05], area[np.abs(area) > 0.05]
    tri[area < 0] = tri[area < 0][:, ::-1]
    used = np.unique(tri)
    remap = -np.ones(len(pts), int)
    remap[used] = np.arange(len(used))
    pts, tri = pts[used], remap[tri]
    n = len(pts)
    r_top = top(pts)
    r_bottom = np.minimum(bottom(pts), r_top - 0.8)
    if fade is not None:
        r_bottom = r_top - np.maximum((r_top - r_bottom) * fade(pts), 0.3)
    edges = np.vstack([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]])
    _, inverse, counts = np.unique(np.sort(edges, 1), axis=0, return_inverse=True, return_counts=True)
    boundary = edges[counts[inverse.ravel()] == 1]
    rim = np.unique(boundary)
    verts = [np.c_[pts, r_top], np.c_[pts, r_bottom]]
    # ids[layer][vertex]: layer 0 = front face, wall_layers = back face
    ids = np.zeros((wall_layers + 1, n), int)
    ids[0], ids[wall_layers] = np.arange(n), np.arange(n) + n
    offset = 2 * n
    for layer in range(1, wall_layers):
        f = layer / wall_layers
        verts.append(np.c_[pts[rim], r_top[rim] + (r_bottom[rim] - r_top[rim]) * f])
        ids[layer, rim] = offset + np.arange(len(rim))
        offset += len(rim)
    faces = [tri, tri[:, ::-1] + n]
    for layer in range(wall_layers):
        p, q = boundary[:, 0], boundary[:, 1]
        faces += [np.c_[ids[layer, q], ids[layer, p], ids[layer + 1, p]], np.c_[ids[layer, q], ids[layer + 1, p], ids[layer + 1, q]]]
    return np.vstack(verts), np.vstack(faces)


class Piece:
    """Tissue behind one or more frontal regions; each part has its own depth range."""

    def __init__(self, front: Front, inverse: Inverse, parts: list[tuple[Polygon, object, object]]) -> None:
        self.front = front
        self.parts = []
        verts, faces, offset = [], [], 0
        for region, top, bottom in parts:
            region = region.intersection(front.domain).buffer(0)
            for polygon in region.geoms if region.geom_type == "MultiPolygon" else [region]:
                if polygon.area < 80:
                    continue
                self.parts.append((polygon, top, bottom))
                v, f = prism(polygon, top, bottom, fade=front.fade)
                verts.append(v)
                faces.append(f + offset)
                offset += len(v)
        self.standing = np.vstack(verts)
        self.faces = np.vstack(faces)
        ch = front.st.b.ch
        model = trimesh.Trimesh(ch.to_model(self.standing), self.faces, process=False)
        _, uses = np.unique(np.sort(model.edges, axis=1), axis=0, return_counts=True)
        self.closed = bool((uses % 2 == 0).all())
        self.volume = abs(float(model.volume)) / 1000
        self.rest, residual = inverse(self.standing)
        self.residual = float(residual.max())

    def contains(self, standing_points: np.ndarray) -> np.ndarray:
        inside = np.zeros(len(standing_points), bool)
        for region, top, bottom in self.parts:
            inside |= self.front.contains(region, top, bottom, standing_points)
        return inside


# --------------------------------------------------------------------------------------------------
# techniques
# --------------------------------------------------------------------------------------------------
def frontal_pattern(front: Front, top: np.ndarray, lateral: np.ndarray, medial: np.ndarray) -> Polygon:
    """Skin pattern seen from the front: top line (medial to lateral) and the two limbs down to their lowest
    visible point, closed below the breast (what lies further along the limbs is on the hidden underside)."""
    top_uv = front.project(np.atleast_2d(top))
    sides = []
    for limb in (lateral, medial):
        uv = front.project(limb)
        uv = uv[: int(np.argmin(uv[:, 1])) + 1]
        sides.append(uv)
    lat, med = sides
    closing = np.array([[lat[-1, 0], front.v0], [med[-1, 0], front.v0]])
    return Polygon(np.vstack([top_uv, lat, closing, med[::-1]])).buffer(0)


def techniques(st: Standing, front: Front, inverse: Inverse) -> dict:
    nipple = st.chart_of_rest(st.um, 0.0)  # the nipple today, on the unrolled skin
    rim = Polygon(front.project(st.ring(nipple, AREOLA_D / 2 + RIM)))
    areola_now = front.project(st.ring(nipple, AREOLA_D / 2))
    new_areola = Polygon(front.project(st.ring(np.array([0.0, 0.0]), AREOLA_D / 2)))
    nipple_uv = front.project(nipple[None])[0]
    a_uv = front.project(np.array([[0.0, 0.0]]))[0]
    out = {}

    def wedges(points: dict, centre: Polygon) -> Polygon:
        """Lower pole under the medial and lateral skin flaps of the inverted T, between the fold ends."""
        b_uv, c_uv, d_uv, e_uv = (front.project(points[key][None])[0] for key in "BCDE")
        medial = box(d_uv[0], front.v0, b_uv[0], 200.0)
        lateral = box(c_uv[0], front.v0, e_uv[0], 200.0)
        return unary_union([medial, lateral]).intersection(front.hanging).difference(centre).buffer(0)

    # ---- Pitanguy: inverted T, superior pedicle, keel resection ---------------------------------------
    # The pedicle is a dermoglandular flap based above the areola; the upper ends of the limbs, inside its
    # footprint, are only de-epithelialised. The keel goes on under the flap, tapering upwards.
    points, lines, _ = inverted_t(st, keyhole=False)
    pattern = frontal_pattern(front, points["A"][None], lines["ramo lateral"], lines["ramo medial"])
    superior = hull(np.array(rim.exterior.coords), np.array(new_areola.exterior.coords)).buffer(0)
    apex = np.array([nipple_uv[0], nipple_uv[1] + AREOLA_D / 2 + 30.0])
    b_uv, c_uv = front.project(points["B"][None])[0], front.project(points["C"][None])[0]
    keel = Polygon([apex, [c_uv[0], front.v0], [b_uv[0], front.v0]]).buffer(0)
    out["pitanguy"] = {
        "points": points, "lines": lines, "pattern": pattern, "footprint": superior, "baseOnOutline": True,
        "pedicle": Piece(front, inverse, [(superior, front.top, front.flap(SUPERIOR_THICKNESS))]),
        "resection": Piece(front, inverse, [
            (pattern.difference(superior), front.top, front.bottom_spare),
            (superior.intersection(keel), front.flap(SUPERIOR_THICKNESS), front.bottom_spare),
            (wedges(points, pattern.union(superior)), front.flap(FLAP_THICKNESS), front.bottom_spare),
        ]),
    }

    # ---- Wise pattern with inferior pedicle ---------------------------------------------------------------
    # The pedicle is the middle of the lower pole, from the areola to its base on the fold, with its root on
    # the wall under an oblique plane (the plane of the horizontal septum, which carries its vessels). What lies
    # above that plane inside the pattern, the medial and lateral parts and the wedges under the flaps come out.
    points, lines, _ = inverted_t(st, keyhole=True)
    pattern = frontal_pattern(front, lines["fechadura"], lines["ramo lateral"], lines["ramo medial"])
    heights = np.arange(nipple_uv[1], front.v0, -4.0)
    span = max(nipple_uv[1] - (st.fold_height - 62.0), 1.0)
    half_mm = (AREOLA_D / 2 + RIM) + (INFERIOR_BASE / 2 - AREOLA_D / 2 - RIM) * np.clip((nipple_uv[1] - heights) / span, 0, 1)
    radius = front.sample(front.front_filled, np.c_[np.full(len(heights), nipple_uv[0]), heights])
    half_u = half_mm * RREF / radius
    band = Polygon(np.vstack([np.c_[nipple_uv[0] - half_u, heights], np.c_[nipple_uv[0] + half_u, heights][::-1]]))
    hanging_part = unary_union([rim, band]).intersection(pattern).buffer(0)
    rim_top = float(hanging_part.bounds[3])
    root_top = st.fold_height + ROOT_HEIGHT
    wall_radius = float(front.sample(front.wall, np.array([[nipple_uv[0], st.fold_height]]))[0])
    to_u = RREF / wall_radius
    root = Polygon([
        [nipple_uv[0] - INFERIOR_BASE / 2 * to_u, rim_top - 12.0], [nipple_uv[0] + INFERIOR_BASE / 2 * to_u, rim_top - 12.0],
        [nipple_uv[0] + ROOT_TOP_WIDTH / 2 * to_u, root_top], [nipple_uv[0] - ROOT_TOP_WIDTH / 2 * to_u, root_top],
    ]).buffer(8.0).buffer(-8.0).difference(hanging_part).buffer(0)
    septum_plane = front.ramp(float(nipple_uv[1]), root_top)  # from the nipple back and up to the wall
    out["wise"] = {
        "points": points, "lines": lines, "pattern": pattern, "footprint": hanging_part, "baseOnOutline": False,
        "pedicle": Piece(front, inverse, [(hanging_part, front.top, front.bottom_full), (root, septum_plane, front.bottom_full)]),
        "resection": Piece(front, inverse, [
            (pattern.difference(hanging_part).difference(root), front.top, front.bottom_spare),
            (root.intersection(pattern), front.top, septum_plane),
            (wedges(points, pattern.union(hanging_part)), front.flap(FLAP_THICKNESS), front.bottom_spare),
        ]),
    }

    # ---- vertical pattern with superomedial pedicle -------------------------------------------------------
    # Full-thickness pedicle based on the medial half of the dome and the start of the medial limb; the lower
    # and lateral part of the pattern comes out, the pillars stay.
    points, lines, _ = vertical(st)
    pattern = frontal_pattern(front, lines["cúpula"], lines["ramo lateral"], lines["ramo medial"])
    medial_border = np.vstack([lines["cúpula"][: len(lines["cúpula"]) // 2 + 1][::-1], lines["ramo medial"]])
    model_border = st.model(st.skin(medial_border))
    travelled = np.r_[0, np.cumsum(np.linalg.norm(np.diff(model_border, axis=0), axis=1))]
    base = front.project(medial_border[travelled <= SUPEROMEDIAL_BASE])
    superomedial = hull(base, np.array(rim.exterior.coords)).intersection(pattern).buffer(0)
    dome_base = front.project(np.array([points["M"], points["L"]]))
    below_dome = pattern.intersection(box(pattern.bounds[0], front.v0, pattern.bounds[2], float(dome_base[:, 1].min())))
    lo, hi = st.b.fold_range
    lateral_side = front.hanging.difference(pattern).intersection(box(nipple_uv[0], front.v0, hi - FOLD_MARGIN, 200.0)).buffer(0)
    out["vertical"] = {
        "points": points, "lines": lines, "pattern": pattern, "footprint": superomedial, "baseOnOutline": True,
        "pedicle": Piece(front, inverse, [(superomedial, front.top, front.bottom_full)]),
        "resection": Piece(front, inverse, [
            (below_dome.difference(superomedial), front.top, front.bottom_spare),
            (lateral_side, front.flap(FLAP_THICKNESS + 5.0), front.bottom_spare),  # under the lateral pillar
        ]),
    }
    for item in out.values():
        item["nipple"], item["areolaNow"], item["a"] = nipple, areola_now, a_uv
    return out


# --------------------------------------------------------------------------------------------------
# what each technique keeps and cuts
# --------------------------------------------------------------------------------------------------
def neurovascular(st: Standing, front: Front, plan: dict) -> dict:
    """Follows every schematic vessel and nerve to the nipple. A branch is cut by a technique when it runs inside
    the resection, or when it crosses the outline of the skin pattern while superficial (within FLAP_THICKNESS of
    the skin: the incision and the plane under the skin flaps), unless it crosses where the pedicle is attached
    (its base, only de-epithelialised). Deeper tissue is only cut where it belongs to the resection.
    Returns, per branch and technique, the mm of course inside the resection and the number of incisions crossed."""
    if not ANATOMY_JSON.exists():
        return {}
    anatomy = json.loads(ANATOMY_JSON.read_text())
    ch = st.b.ch
    result = {}
    for name, geometry in anatomy["geometry"].items():
        if geometry["kind"] != "tube":
            continue
        rest = np.array(geometry["points"]).reshape(-1, 3) / MM
        standing = st.to_state(ch.to_chart(rest))
        step = np.r_[np.linalg.norm(np.diff(ch.to_model(standing), axis=0), axis=1), 0.0]
        result[name] = {}
        for key, item in plan.items():
            inside_mm = float(step[item["resection"].contains(standing)].sum())
            in_pattern = np.array([item["pattern"].contains(Point(p)) for p in standing[:, :2]])
            crossings = 0
            for i in np.nonzero(in_pattern[1:] != in_pattern[:-1])[0]:
                mid = (standing[i] + standing[i + 1]) / 2
                skin = front.top(mid[None, :2])[0]
                superficial = skin - FLAP_THICKNESS <= mid[2] <= skin + 1.0
                at_base = item["baseOnOutline"] and item["footprint"].buffer(1.5).contains(Point(mid[:2]))
                crossings += int(superficial and not at_base)
            result[name][key] = {"insideMm": round(inside_mm, 1), "incisions": crossings}
    return result


# --------------------------------------------------------------------------------------------------
# output
# --------------------------------------------------------------------------------------------------
TECHNIQUES = {
    "pitanguy": {"label": "Pitanguy", "pattern": "T invertido, marcação pelos pontos A–B–C–D–E", "pedicle": "superior", "resection": "em quilha", "marking": "Marcação de Pitanguy (T invertido)"},
    "wise": {"label": "Wise com pedículo inferior", "pattern": "padrão de Wise (fechadura)", "pedicle": "inferior", "resection": "em ferradura", "marking": "Marcação de Wise (fechadura)"},
    "vertical": {"label": "Vertical com pedículo superomedial", "pattern": "padrão vertical com cúpula", "pedicle": "superomedial", "resection": "inferior e lateral", "marking": "Marcação vertical (cúpula)"},
}
POINT_NOTES = {
    "A": "novo mamilo: projeção do sulco no meridiano",
    "B": "fim do ramo medial",
    "C": "fim do ramo lateral",
    "D": "extremo medial da incisão no sulco",
    "E": "extremo lateral da incisão no sulco",
    "T": "topo da cúpula",
    "M": "base medial da cúpula",
    "L": "base lateral da cúpula",
    "F": "encontro dos ramos, acima do sulco",
}


def main() -> None:
    state = [s["id"] for s in bb.STATES].index(STATE)
    breast = bb.Breast("op", bb.trunk_axis())
    ch = breast.ch
    st = Standing(breast, state)
    front = Front(st)
    inverse = Inverse(breast, state)
    plan = techniques(st, front, inverse)
    cut = neurovascular(st, front, plan)
    r4 = lambda values: [round(float(x), 4) for x in np.asarray(values).ravel()]  # noqa: E731
    model_of = lambda xs, lift=0.0: st.model(st.skin(np.atleast_2d(xs), lift))  # noqa: E731
    rest_of = lambda xs, lift=0.0: ch.to_model(st.skin(np.atleast_2d(xs), lift))  # noqa: E731
    length = lambda xs: bb.polyline_length(model_of(xs))  # noqa: E731

    structures, meshes, tubes, points_out, measures = {}, [], {}, {}, {}
    blobs, pieces_out, offset = [], {}, 0

    def structure(ident: str, label: str, anchor) -> dict:
        return structures.setdefault(ident, {"label": label, "group": "Mamoplastia", "visible": False, "labelAnchor": r4(np.asarray(anchor) * MM), "meshNames": []})

    def add_tube(ident: str, name: str, label: str, rest_points: np.ndarray, color: str, radius: float = MARK_RADIUS) -> None:
        tubes[name] = {"kind": "tube", "points": r4(rest_points * MM), "radiusMm": [radius, radius]}
        meshes.append({"name": name, "structure": ident, "tissue": "marking", "source": SOURCE, "sourceName": label, "license": LICENSE, "triangles": int((len(rest_points) - 1) * 16 + 16), "color": color, "opacity": 1})
        structures[ident]["meshNames"].append(name)

    def resample(xs: np.ndarray, spacing: float = 2.0) -> np.ndarray:
        """Chart polyline resampled every `spacing` mm of true length on the standing skin."""
        p = model_of(xs)
        arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
        count = max(2, int(round(arc[-1] / spacing)) + 1)
        t = np.linspace(0, arc[-1], count)
        return np.c_[np.interp(t, arc, xs[:, 0]), np.interp(t, arc, xs[:, 1])]

    def add_piece(ident: str, name: str, label: str, piece: Piece, color: str, opacity: float) -> None:
        nonlocal offset
        rest_model = ch.to_model(piece.rest) * MM
        lo, hi = rest_model.min(0), rest_model.max(0)
        quantised = np.round((rest_model - lo) / (hi - lo) * 65535).astype("<u2")
        assert len(rest_model) < 65536
        index = piece.faces.astype("<u2")
        data = quantised.tobytes() + index.tobytes()
        pieces_out[name] = {"kind": "solid", "byteOffset": offset, "vertices": int(len(rest_model)), "triangles": int(len(index)), "min": r4(lo), "max": r4(hi)}
        blobs.append(data)
        offset += len(data)
        meshes.append({"name": name, "structure": ident, "tissue": "piece", "source": SOURCE, "sourceName": label, "license": LICENSE, "triangles": int(len(index)), "color": color, "opacity": opacity})
        structures[ident]["meshNames"].append(name)

    # ---- reference lines: midline, breast meridian, inframammary fold ----------------------------------
    notch = bb.layer_landmark("esterno.incisura-jugular")
    skin_field = lambda u, v: map_coordinates(breast.RS, [(u - bb.U_RANGE[0]) / CELL, (v - bb.V_RANGE[0]) / CELL], order=1, mode="nearest")  # noqa: E731
    structure("mamo-reference-lines", "Linhas de referência (linha média, meridiano, sulco)", ch.to_model(ch.nipple[None])[0])
    v_line = np.arange(float(ch.to_chart(notch[None])[0, 1]) - 4, st.fold_height - 70, -2.5)
    midline = ch.to_model(np.c_[np.zeros(len(v_line)), v_line, skin_field(np.zeros(len(v_line)), v_line) + MARK_LIFT])
    add_tube("mamo-reference-lines", "mamo_ref_midline", "Linha média", midline, COLORS["reference"], 0.6)
    meridian_s = np.c_[np.zeros(200), np.linspace(-160.0, float(st.fold_s(0.0)), 200)]
    add_tube("mamo-reference-lines", "mamo_ref_meridian", "Meridiano da mama", rest_of(resample(meridian_s, 2.5), MARK_LIFT), COLORS["reference"], 0.6)
    lo, hi = breast.fold_range
    fold_x = np.linspace((lo + 6 - st.um) * st.rho, (hi - 6 - st.um) * st.rho, 160)
    fold_line = np.c_[fold_x, st.fold_s(fold_x)]
    add_tube("mamo-reference-lines", "mamo_ref_fold", "Sulco inframamário", rest_of(resample(fold_line, 2.5), MARK_LIFT), "#b91c1c", 0.6)

    # ---- techniques ---------------------------------------------------------------------------------------
    mound_ml = bb.mound_volumes(breast)[state + 1]
    notch_skin = np.array(json.loads(bb.OUT_JSON.read_text())["measurements"]["op"][STATE]["nipple"])  # only to check the state is built
    assert notch_skin.shape == (3,)
    notch_chart = ch.to_chart(notch[None])[0]
    for key, item in plan.items():
        info = TECHNIQUES[key]
        pts = item["points"]
        marking = f"mamo-marking-{key}"
        structure(marking, info["marking"], rest_of(pts["A"])[0])
        for line_name, xs in item["lines"].items():
            if line_name == "sulco":
                xs = xs[::-1]
            add_tube(marking, f"mamo_{key}_{line_name.replace(' ', '_').replace('ú', 'u')}", f"{info['label']}: {line_name}", rest_of(resample(xs), MARK_LIFT), COLORS["marking"])
        # a small cross on every named point
        for point_name, xs in pts.items():
            for n, (dx, ds) in enumerate(((1, 1), (1, -1))):
                arm = np.array([xs + np.array([dx, ds]) * t for t in np.linspace(-3.5, 3.5, 5)])
                add_tube(marking, f"mamo_{key}_ponto_{point_name}_{n}", f"{info['label']}: ponto {point_name}", rest_of(arm, MARK_LIFT + 0.2), COLORS["marking"], 0.6)
            points_out[f"mamo:{key}:{point_name}"] = {"rest": r4(rest_of(xs, MARK_LIFT)[0] * MM), "label": point_name, "note": POINT_NOTES[point_name]}
        pedicle, resection = item["pedicle"], item["resection"]
        structure(f"mamo-pedicle-{key}", f"Pedículo {info['pedicle']}", ch.to_model(pedicle.rest.mean(0)[None])[0])
        add_piece(f"mamo-pedicle-{key}", f"mamo_{key}_pediculo", f"Pedículo {info['pedicle']}", pedicle, COLORS["pedicle"], 0.88)
        structure(f"mamo-resection-{key}", f"Ressecção {info['resection']} (pedículo {info['pedicle']})", ch.to_model(resection.rest.mean(0)[None])[0])
        add_piece(f"mamo-resection-{key}", f"mamo_{key}_resseccao", f"Ressecção {info['resection']}", resection, COLORS["resection"], 0.82)
        # measurements, as a tape on the standing skin
        t = np.linspace(0, 1, 160)[:, None]
        a_chart = st.skin(pts["A"][None])[0]
        notch_line = np.c_[notch_chart[0] + (a_chart[0] - notch_chart[0]) * t[:, 0], notch_chart[1] + (a_chart[1] - notch_chart[1]) * t[:, 0]]
        notch_line = np.c_[notch_line, skin_field(notch_line[:, 0], notch_line[:, 1])]
        m = {
            "notchToAMm": round(bb.polyline_length(ch.to_model(st.to_state(notch_line))), 0),
            "nippleRiseMm": round(length(np.c_[np.zeros(60), np.linspace(0, item["nipple"][1], 60)]), 0),
            "linesMm": {name: round(length(xs), 0) for name, xs in item["lines"].items()},
            "pedicleMl": round(pedicle.volume), "pedicleG": round(pedicle.volume * DENSITY),
            "resectionMl": round(resection.volume), "resectionG": round(resection.volume * DENSITY),
            "resectionPct": round(resection.volume / mound_ml * 100),
            "cut": sorted(name for name, value in cut.items() if value[key]["insideMm"] >= 4.0 or value[key]["incisions"] > 0),
            "kept": sorted(name for name, value in cut.items() if not (value[key]["insideMm"] >= 4.0 or value[key]["incisions"] > 0)),
        }
        if "B" in pts:
            m["limbEndsApartMm"] = round(float(np.linalg.norm(model_of(pts["B"])[0] - model_of(pts["C"])[0])), 0)
            m["horizontalMinusFoldMm"] = round(m["linesMm"]["horizontal medial"] + m["linesMm"]["horizontal lateral"] - m["linesMm"]["sulco"], 0)
        if "F" in pts:
            m["openingMm"] = m["linesMm"]["cúpula"]
        measures[key] = m
        print(f"{info['label']}: fúrcula–A {m['notchToAMm']:.0f} mm · subida do CAP {m['nippleRiseMm']:.0f} mm · linhas {m['linesMm']}")
        print(f"   pedículo {info['pedicle']}: {pedicle.volume:.0f} mL ≈ {m['pedicleG']} g ({'fechada' if pedicle.closed else 'ABERTA'}, {len(pedicle.rest)} vértices, inverso {pedicle.residual:.3f} mm)")
        print(f"   ressecção {info['resection']}: {resection.volume:.0f} mL ≈ {m['resectionG']} g = {m['resectionPct']}% do monte ({'fechada' if resection.closed else 'ABERTA'}, {len(resection.rest)} vértices, inverso {resection.residual:.3f} mm)")
        print(f"   secciona: {', '.join(m['cut']) or '—'}")

    OUT_BIN.write_bytes(b"".join(blobs))
    out = {
        "version": 1, "source": SOURCE, "state": STATE, "side": "op",
        "bin": "models/hybrid/mammaplasty.bin", "byteLength": offset,
        "dimensions": {"areolaMm": AREOLA_D, "limbMm": LIMB, "limbAngleDeg": T_ANGLE, "rimMm": RIM, "inferiorBaseMm": INFERIOR_BASE, "superiorThicknessMm": SUPERIOR_THICKNESS, "superomedialBaseMm": SUPEROMEDIAL_BASE, "leftOnFasciaMm": LEFT_ON_FASCIA, "densityGPerMl": DENSITY, "moundMl": round(mound_ml)},
        "techniques": {key: {**TECHNIQUES[key], "measurements": measures[key]} for key in plan},
        "points": points_out,
        "structures": structures,
        "meshes": meshes,
        "geometry": {**tubes, **pieces_out},
    }
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"wrote {OUT_JSON.relative_to(bb.ROOT)} ({OUT_JSON.stat().st_size / 1e3:.0f} kB) and {OUT_BIN.relative_to(bb.ROOT)} ({offset / 1e3:.0f} kB)")
    if "--figures" in sys.argv:
        figures(st, front, plan, Path(sys.argv[sys.argv.index("--figures") + 1]))


def figures(st: Standing, front: Front, plan: dict, out: Path) -> None:
    """Review renders: marking on the standing skin; pedicle and resection inside the see-through breast."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    from pilot_mammaplasty import splat, tube

    out.mkdir(parents=True, exist_ok=True)
    ch = st.b.ch
    other = bb.Breast("contra", (ch.xc, ch.zc))
    skin_pos, skin_idx = bb.mesh(bb.SKIN)
    skin_pos = ch.to_model(st.to_state(ch.to_chart(skin_pos)))
    skin_pos = other.ch.to_model(bb.deform(other, other.ch.to_chart(skin_pos))[st.k])
    nac = [(ch.to_model(st.to_state(ch.to_chart(pos))), idx) for pos, idx in (bb.mesh(n) for n in bb.SIDE_MESHES[ch.side] if "nipple" in n or "areola" in n)]
    skin_color, nac_color = (0.92, 0.74, 0.64), (0.55, 0.30, 0.24)
    centre = tuple(ch.to_model(st.to_state(ch.nipple[None]))[0] + np.array([8.0, 30.0, -30.0]))
    views = [(0, 0), (40, 0), (88, 0), (25, -45)]
    for key, item in plan.items():
        marks = [(*tube(st.model(st.skin(xs, lift=0.8)), radius=0.9), (0.1, 0.15, 0.7), 1.0) for name, xs in item["lines"].items()]
        surface = [(skin_pos, skin_idx, skin_color, 1.0)] + [(p, i, nac_color, 1.0) for p, i in nac]
        plt.imsave(out / f"mamoplastia-{key}-marcacao.png", np.hstack([splat(surface + marks, yaw, pitch, centre) for yaw, pitch in views]))
        pieces = [(ch.to_model(item["pedicle"].standing), item["pedicle"].faces, (0.25, 0.68, 0.42), 1.0), (ch.to_model(item["resection"].standing), item["resection"].faces, (0.88, 0.54, 0.18), 1.0)]
        layers = pieces + [(p, i, nac_color, 1.0) for p, i in nac] + marks + [(skin_pos, skin_idx, skin_color, 0.2)]
        plt.imsave(out / f"mamoplastia-{key}-pecas.png", np.hstack([splat(layers, yaw, pitch, centre) for yaw, pitch in views]))
        # the same pieces carried back by the app's map: rest positions pushed forward must land on the design
        again = ch.to_model(st.to_state(item["resection"].rest))
        print(f"   {key}: ida e volta da ressecção, erro máximo {np.abs(again - ch.to_model(item['resection'].standing)).max():.3f} mm")
    print(f"figures in {out}")


if __name__ == "__main__":
    main()
