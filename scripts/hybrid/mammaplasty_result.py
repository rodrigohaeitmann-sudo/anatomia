#!/usr/bin/env python3
"""Tissue rearrangement and expected result of a mammaplasty (docs/plano-mamoplastia.md, fase 4).

Library of build_mammaplasty_steps.py. Three pieces of machinery:

1. Result state. The breast that is left, after the resection, is given the shape of a breast state of
   build_breast.py (a small descent plus a growth) whose mound has the volume that remains and whose nipple
   sits at a chosen height above the fold (`result_state`). In the coordinates of the rest breast the
   nipple-areola complex is back home: it is the tissue round it that was taken away.
2. Skin patch. The skin of the operated breast is meshed in the rest chart, in isotropic coordinates about the
   nipple (`Rest`), by a conforming Delaunay triangulation of the whole patch whose edges include the lines of
   the marking (`SkinPatch`): what is excised, the de-epithelialised skin of the pedicle, the areola and the
   skin that stays are separate, labelled regions, with a skirt of trunk skin round the outline.
3. Closure. The skin that stays is mapped so that the pattern closes (`Closure`): the opening of the areola
   goes round the areola, the vertical limbs meet under it, the horizontal limbs go to the fold and the outline
   stays where it is. Near the sutures the map is harmonic (mean value weights); about the nipple it is solved
   in polar coordinates; the two are blended by the distance to the nipple, which keeps every triangle the
   right way round. Deeper tissue follows its skin.
"""
from __future__ import annotations

import numpy as np
import shapely
from scipy import sparse
from scipy.ndimage import map_coordinates
from scipy.sparse.linalg import spsolve
from scipy.spatial import Delaunay, cKDTree
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import polygonize, unary_union

import build_breast as bb

RREF, CELL = bb.RREF, bb.CELL


# --------------------------------------------------------------------------------------------------
# 1. result state
# --------------------------------------------------------------------------------------------------
def state_map(breast: bb.Breast, q: np.ndarray, state: dict) -> np.ndarray:
    """Chart points (u, v, r) carried from rest by one breast state (as bb.deform does for the shipped states)."""
    u, v, r = q[:, 0], q[:, 1], q[:, 2]
    d = r - breast.base(u, v)
    amp = breast.taper(u)
    sel = (d > 0) & (amp > 1e-4)
    hinge = breast.curve("hinge", u[sel])
    top = breast.curve("top", u[sel]) - hinge
    a, dd = bb.flow_advance(v[sel] - hinge, d[sel], amp[sel], top, 0.0, state["descent"])
    a, dd = bb.tilt_advance(a, dd, amp[sel], state.get("tilt", 0.0))
    um = round(float(breast.ch.nipple[0]), 2)
    u2, a2, d2 = bb.grow(breast, u[sel], a, dd, um, state["growth"])
    moved = q.copy()
    moved[sel, 0] = u2
    moved[sel, 1] = hinge + a2
    moved[sel, 2] = breast.base(u2, moved[sel, 1]) + d2
    return moved


def mound_volume(breast: bb.Breast, mapper) -> float:
    """Volume (mL) of the mound carried by `mapper` (chart -> chart): rest volume elements times the Jacobian."""
    ch = breast.ch
    lo, hi = breast.fold_range
    step, layers, h = 3.0, 8, 0.4
    U, V = np.meshgrid(np.arange(lo, hi + step, step), np.arange(breast.fold.min() - 6, breast.top.max() + 6, step), indexing="ij")
    U, V = U.ravel(), V.ravel()
    skin = map_coordinates(breast.RS, [(U - bb.U_RANGE[0]) / CELL, (V - bb.V_RANGE[0]) / CELL], order=1, mode="nearest")
    wall = breast.base(U, V)
    keep = (skin - wall > 0.5) & (breast.taper(U) > 1e-4)
    U, V, skin, wall = U[keep], V[keep], skin[keep], wall[keep]
    t = (np.arange(layers) + 0.5) / layers
    r = wall[:, None] + (skin - wall)[:, None] * t[None, :]
    q = np.stack([np.repeat(U, layers), np.repeat(V, layers), r.ravel()], 1)
    dv = step * step * np.repeat((skin - wall) / layers, layers) * q[:, 2] / RREF
    p = ch.to_model(q)
    moved = [ch.to_model(mapper(ch.to_chart(p + o))) for o in (np.zeros(3), np.array([h, 0, 0]), np.array([0, h, 0]), np.array([0, 0, h]))]
    jac = np.stack([(moved[i] - moved[0]) / h for i in (1, 2, 3)], -1)
    return float((dv * np.abs(np.linalg.det(jac))).sum()) / 1000


def result_state(breast: bb.Breast, volume_ml: float, nipple_above_fold: float, length: float = 1.0) -> dict:
    """State (descent, growth) whose mound has `volume_ml` and whose nipple is `nipple_above_fold` mm above the fold;
    `length` scales the tissue below the fold (below 1: a shorter lower pole)."""
    ch = breast.ch
    fold_v = float(np.interp(ch.nipple[0], ch.us, breast.fold))

    def make(descent: float, k: float) -> dict:
        # a reduced, lifted breast: fuller (depth, width), with the lower pole of the length asked for
        return {"descent": round(descent, 2), "tilt": 0.0, "growth": {"depth": round(1 + k, 4), "width": round(1 + 0.8 * k, 4), "length": round(length, 4), "hang": 0.0}}

    def bisect(f, lo: float, hi: float, target: float, rising: bool) -> float:
        for _ in range(16):
            mid = (lo + hi) / 2
            if (f(mid) < target) == rising:
                lo = mid
            else:
                hi = mid
        return (lo + hi) / 2

    descent, k = 10.0, 0.1
    for _ in range(3):
        k = bisect(lambda x: mound_volume(breast, lambda q: state_map(breast, q, make(descent, x))), -0.3, 1.8, volume_ml, True)
        descent = bisect(lambda x: float(state_map(breast, ch.nipple[None], make(x, k))[0, 1] - fold_v), 0.0, 45.0, nipple_above_fold, False)
    return make(descent, k)


# --------------------------------------------------------------------------------------------------
# 2. skin patch
# --------------------------------------------------------------------------------------------------
class Rest:
    """The rest chart of the operated breast in isotropic coordinates about the nipple: ((u - um) kappa, v), where
    kappa is the skin radius at the nipple over RREF (so that 1 unit is about 1 mm of skin there). The outline of the
    breast skin (fold, sides, top of every column) is star-shaped about the nipple."""

    def __init__(self, st) -> None:
        self.st = st
        self.kappa = float(st.skin_r(np.array([st.um]), np.array([0.0]))[0]) / RREF
        outline = np.vstack([np.c_[st.us, st.V[:, -1]], np.c_[st.us[::-1], st.V[::-1, 0]]])
        self.domain = Polygon(self.iso(outline)).buffer(0).simplify(0.05)
        self.ring = LineString(np.array(self.domain.exterior.coords))

    def iso(self, uv) -> np.ndarray:
        uv = np.atleast_2d(np.asarray(uv, float))
        return np.c_[(uv[:, 0] - self.st.um) * self.kappa, uv[:, 1]]

    def uv(self, iso) -> np.ndarray:
        iso = np.atleast_2d(np.asarray(iso, float))
        return np.c_[self.st.um + iso[:, 0] / self.kappa, iso[:, 1]]

    def carry(self, chart_xs, step: float = 1.0) -> np.ndarray:
        """A polyline of the standing chart (X, s) in isotropic rest coordinates: densified to follow the map, then
        simplified (0.05 mm) so that the mesh made on it is not a fan of slivers."""
        line = LineString(np.asarray(chart_xs, float))
        dense = np.array([line.interpolate(d).coords[0] for d in np.arange(0, line.length, step)] + [line.coords[-1]])
        return np.array(LineString(self.iso(self.st.skin(dense)[:, :2])).simplify(0.05).coords)

    def standing(self, iso, lift: float = 0.0) -> np.ndarray:
        """Model-space points (mm) of the standing breast for isotropic rest points on the skin."""
        uv = self.uv(iso)
        return self.st.model(np.c_[uv, self.st.skin_r(uv[:, 0], uv[:, 1]) + lift])

    def true_length(self, iso) -> np.ndarray:
        """Cumulative length of a polyline measured on the standing skin."""
        model = self.standing(iso)
        return np.r_[0, np.cumsum(np.linalg.norm(np.diff(model, axis=0), axis=1))]

    def snap(self, point) -> np.ndarray:
        return np.array(self.ring.interpolate(self.ring.project(Point(point))).coords[0])

    def outline_between(self, start, end, below: bool = True) -> np.ndarray:
        """The outline from `start` to `end` (both snapped onto it), along the bottom (the fold) or the top."""
        length = self.ring.length
        a, b = self.ring.project(Point(start)), self.ring.project(Point(end))
        coords = np.array(self.ring.coords)
        flat = np.r_[0, np.cumsum(np.linalg.norm(np.diff(coords, axis=0), axis=1))]

        def path(p, q):  # forward along the ring from p to q
            if q < p:
                q += length
            d = np.r_[p, flat[(flat > p) & (flat < q)], flat[(flat + length > p) & (flat + length < q)] + length, q]
            d = np.unique(d)
            return np.array([self.ring.interpolate(t % length).coords[0] for t in d])

        one, other = path(a, b), path(b, a)[::-1]
        pick = one if (one[:, 1].mean() < other[:, 1].mean()) == below else other
        return pick


class SkinPatch:
    """Skin of the operated breast, triangulated in the isotropic rest chart so that every border of a region is made
    of mesh edges (conforming Delaunay: a constraint segment missing from the triangulation is split until it shows
    up). The standing chart, where the marking is drawn, squeezes the skin near the ends of the fold; triangles made
    in the rest chart are well shaped and stay so in every state of the breast map.

    regions: [(label, isotropic polygon or None)] tried in order on the centroid of every triangle; None matches all.
    lines: {name: isotropic polyline}; their vertices know their fraction of the line's length on the standing skin."""

    def __init__(self, rest: Rest, regions: list, lines: dict, spacing: float = 3.5, lift: float = 0.15, segment: float = 2.5, measure: str = "standing", skirt: float = 0.0) -> None:
        self.rest = rest
        self.st = rest.st
        self.domain = rest.domain
        # a skirt of trunk skin round the breast outline joins the patch to the skin that stays as it is
        self.mesh_domain = self.domain.buffer(skirt).simplify(0.05) if skirt > 0 else self.domain
        self.regions = [(label, None if shape is None else shape.intersection(self.domain).buffer(0)) for label, shape in regions]
        self.lines = {}
        for name, iso in lines.items():
            iso = np.asarray(iso, float)
            # fractions along a line: of its length on the standing skin, or in the rest chart, where the closure is solved
            length = rest.true_length(iso) if measure == "standing" else np.r_[0, np.cumsum(np.linalg.norm(np.diff(iso, axis=0), axis=1))]
            self.lines[name] = {"iso": iso, "true": length, "geom": LineString(iso)}
        rings = []
        for _, shape in self.regions:
            if shape is None or shape.is_empty:
                continue
            for g in getattr(shape, "geoms", [shape]):
                rings += [g.exterior, *g.interiors]
        rings += [line["geom"] for line in self.lines.values()]
        frames = [self.domain.exterior] + ([self.mesh_domain.exterior] if skirt > 0 else [])
        linework = unary_union([shapely.set_precision(g, 0.005) for g in [*frames, *rings]]).intersection(self.mesh_domain.buffer(1e-6))
        linework = shapely.segmentize(linework, segment)
        index: dict[tuple[int, int], list[int]] = {}
        points: list[tuple[float, float]] = []
        merge = 0.005

        def vertex(p) -> int:
            key = (int(np.floor(p[0] / merge)), int(np.floor(p[1] / merge)))
            for du in (-1, 0, 1):
                for dv in (-1, 0, 1):
                    for q in index.get((key[0] + du, key[1] + dv), ()):
                        if abs(points[q][0] - p[0]) < merge and abs(points[q][1] - p[1]) < merge:
                            return q
            index.setdefault(key, []).append(len(points))
            points.append((float(p[0]), float(p[1])))
            return len(points) - 1

        segments = set()
        for line in getattr(linework, "geoms", [linework]):
            if line.geom_type != "LineString":
                continue
            coords = np.array(line.coords)
            for p0, p1 in zip(coords[:-1], coords[1:]):
                i, j = vertex(p0), vertex(p1)
                if i != j:
                    segments.add((min(i, j), max(i, j)))
        minx, miny, maxx, maxy = self.mesh_domain.bounds
        gx, gy = np.meshgrid(np.arange(minx, maxx + spacing, spacing), np.arange(miny, maxy + spacing, spacing))
        grid = np.c_[gx.ravel(), gy.ravel()]
        clear = self.mesh_domain.buffer(-0.55 * spacing).difference(linework.buffer(0.55 * spacing))
        first_grid = len(points)
        for q in grid[shapely.contains_xy(clear, grid[:, 0], grid[:, 1])]:
            vertex(q)
        last_grid = len(points)
        for _ in range(40):
            pts = np.array(points)
            tri = Delaunay(pts).simplices
            edges = set(map(tuple, np.sort(np.vstack([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]]), 1).tolist()))
            missing = [seg for seg in segments if seg not in edges]
            if not missing:
                break
            for i, j in missing:
                segments.discard((i, j))
                m = vertex((pts[i] + pts[j]) / 2)
                segments.add((min(i, m), max(i, m)))
                segments.add((min(j, m), max(j, m)))
        else:
            raise RuntimeError(f"skin patch: {len(missing)} segments still missing")
        pts = np.array(points)
        a, b, c = pts[tri[:, 0]], pts[tri[:, 1]], pts[tri[:, 2]]
        area = (b - a)[:, 0] * (c - a)[:, 1] - (b - a)[:, 1] * (c - a)[:, 0]
        longest = np.max(np.stack([np.hypot(*(b - a).T), np.hypot(*(c - b).T), np.hypot(*(a - c).T)]), 0)
        centre = pts[tri].mean(1)
        keep = (np.abs(area) > 1e-4 * longest**2) & shapely.contains_xy(self.mesh_domain, centre[:, 0], centre[:, 1])
        tri, centre, area = tri[keep], centre[keep], area[keep]
        tri[area < 0] = tri[area < 0][:, ::-1]
        # a triangle with its three corners on lines would be flat in any map that straightens those lines: split it
        on_line = np.ones(len(pts), bool)
        on_line[first_grid:last_grid] = False
        ears = on_line[tri].all(1)
        if ears.any():
            extra = centre[ears]
            base = len(pts)
            new = np.arange(base, base + len(extra))
            a_, b_, c_ = tri[ears, 0], tri[ears, 1], tri[ears, 2]
            tri = np.vstack([tri[~ears], np.c_[a_, b_, new], np.c_[b_, c_, new], np.c_[c_, a_, new]])
            pts = np.vstack([pts, extra])
            centre = pts[tri].mean(1)
        within = shapely.contains_xy(self.domain, centre[:, 0], centre[:, 1])
        labels = np.array([next((label for label, shape in self.regions if shape is None or shape.contains(Point(q))), "") if ok else "skirt" for q, ok in zip(centre, within)])
        keep = labels != ""
        used = np.unique(tri[keep])
        remap = -np.ones(len(pts), int)
        remap[used] = np.arange(len(used))
        self.iso = pts[used]
        self.tri = remap[tri[keep]]
        self.label = labels[keep]
        self.lift = lift
        self.rest_uv = rest.uv(self.iso)
        self.rest_chart = np.c_[self.rest_uv, self.st.skin_r(self.rest_uv[:, 0], self.rest_uv[:, 1]) + lift]
        self.standing = self.st.model(self.rest_chart)  # model space, mm
        self.on_outline = np.array([self.domain.exterior.distance(Point(q)) < 0.01 for q in self.iso])

    def faces(self, *labels: str) -> np.ndarray:
        return self.tri[np.isin(self.label, labels)]

    def on_line(self, name: str, tol: float = 0.01) -> tuple[np.ndarray, np.ndarray]:
        """Vertices on a named line and their fraction of its length on the standing skin."""
        line = self.lines[name]
        geom = line["geom"]
        flat = np.r_[0, np.cumsum(np.linalg.norm(np.diff(line["iso"], axis=0), axis=1))]
        hit = np.array([geom.distance(Point(q)) < tol for q in self.iso])
        fraction = np.array([np.interp(geom.project(Point(q)), flat, line["true"]) / line["true"][-1] for q in self.iso[hit]])
        return np.nonzero(hit)[0], fraction


# --------------------------------------------------------------------------------------------------
# 3. closure
# --------------------------------------------------------------------------------------------------
def mean_value_solve(points: np.ndarray, tri: np.ndarray, fixed: np.ndarray, values: np.ndarray) -> np.ndarray:
    """Harmonic-like map with mean value weights (always positive: no folds when the fixed boundary is convex).
    points: (n, 3) geometry; fixed: boolean per vertex; values: (n, k) with the prescribed values on fixed vertices."""
    n = len(points)
    rows, cols, vals = [], [], []
    for a, b, c in ((0, 1, 2), (1, 2, 0), (2, 0, 1)):
        i, j, k = tri[:, a], tri[:, b], tri[:, c]
        e1, e2 = points[j] - points[i], points[k] - points[i]
        l1, l2 = np.linalg.norm(e1, axis=1), np.linalg.norm(e2, axis=1)
        cos = np.clip((e1 * e2).sum(1) / np.maximum(l1 * l2, 1e-12), -1, 1)
        half_tan = np.sqrt((1 - cos) / np.maximum(1 + cos, 1e-9))
        rows += [i, i]
        cols += [j, k]
        vals += [half_tan / np.maximum(l1, 1e-9), half_tan / np.maximum(l2, 1e-9)]
    w = sparse.coo_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(n, n)).tocsr()
    lap = sparse.diags(np.asarray(w.sum(1)).ravel()) - w
    free = ~fixed
    out = values.astype(float).copy()
    rhs = -lap[free][:, fixed] @ values[fixed]
    out[free] = spsolve(lap[free][:, free].tocsc(), rhs).reshape(-1, values.shape[1])
    return out


def signed_areas(points: np.ndarray, tri: np.ndarray) -> np.ndarray:
    a, b, c = (points[tri[:, k]] for k in range(3))
    return (b - a)[:, 0] * (c - a)[:, 1] - (b - a)[:, 1] * (c - a)[:, 0]


def relax(rest: np.ndarray, tri: np.ndarray, fixed: np.ndarray, slide: np.ndarray, curve_of: np.ndarray, curves: list, target: np.ndarray, rounds: int = 600, threshold: float = 0.2):
    """Local Laplacian relaxation round triangles that the closure turned over or squashed (below a fifth of their
    rest area): free vertices move to the mean of their neighbours, vertices of the marking (`slide`) do the same and
    are put back on their suture line. Returns the positions, how many triangles needed it and how far (at most) a
    vertex of the marking slid along its line."""
    target = target.copy()
    start = target.copy()
    reference = signed_areas(rest, tri)
    neighbours: list[set[int]] = [set() for _ in range(len(rest))]
    for a, b, c in tri:
        neighbours[a] |= {b, c}
        neighbours[b] |= {a, c}
        neighbours[c] |= {a, b}
    first = None
    for _ in range(rounds):
        area = signed_areas(target, tri)
        bad = np.nonzero(area * np.sign(reference) < threshold * np.abs(reference))[0]
        if first is None:
            first = len(bad)
        if not len(bad):
            break
        ring = set(tri[bad].ravel())
        ring |= {n for v in list(ring) for n in neighbours[v]}
        for v in ring:
            if fixed[v] and not slide[v]:
                continue
            mean = np.mean(target[list(neighbours[v])], axis=0)
            if slide[v]:
                line = curves[curve_of[v]]
                mean = np.array(line.interpolate(line.project(Point(mean))).coords[0])
            target[v] = mean
    moved = np.linalg.norm(target - start, axis=1)
    return target, int(first or 0), float(moved[slide].max()) if slide.any() else 0.0


class Closure:
    """Where the skin that stays goes when the pattern is closed, in the isotropic rest chart.

    targets: {line name: function(fraction) -> (theta, tau)} for the lines of the marking that border the skin that
    stays; theta is the angle about the nipple (0 up, + lateral, +-pi down) and tau runs from 0 on the areola border to
    1 on the outline of the breast. The outline stays where it is; the displacement of every other vertex is
    interpolated harmonically (mean value weights). Where a corner of the marking is closed (the reflex corner where a
    vertical limb leaves the areola edge becomes a right angle), a harmonic displacement cannot help folding a few
    triangles: there the vertices are relaxed, those of the marking sliding along their own suture line."""

    def __init__(self, patch: SkinPatch, labels: tuple[str, ...], targets: dict, areola_radius: float, method: str = "blend", blend: tuple[float, float] = (30.0, 55.0), seam: str | None = None) -> None:
        self.patch = patch
        self.rest = patch.rest
        tri = patch.faces(*labels)
        used = np.unique(tri)
        remap = -np.ones(len(patch.iso), int)
        remap[used] = np.arange(len(used))
        self.vertices, self.tri = used, remap[tri]
        self.iso = patch.iso[used]
        self.rest_uv = patch.rest_chart[used][:, :2]
        edges = np.vstack([self.tri[:, [0, 1]], self.tri[:, [1, 2]], self.tri[:, [2, 0]]])
        _, inverse, counts = np.unique(np.sort(edges, 1), axis=0, return_inverse=True, return_counts=True)
        border = np.zeros(len(used), bool)
        border[np.unique(edges[counts[inverse.ravel()] == 1])] = True
        ring = np.array(patch.domain.exterior.coords)
        ang = np.arctan2(ring[:, 0], ring[:, 1])
        rad = np.hypot(ring[:, 0], ring[:, 1])
        order = np.argsort(ang)
        self._ang = np.r_[ang[order][-1] - 2 * np.pi, ang[order], ang[order][0] + 2 * np.pi]
        self._rad = np.r_[rad[order][-1], rad[order], rad[order][0]]
        self.areola_radius = areola_radius
        goal = np.full((len(used), 2), np.nan)
        on_outline = patch.on_outline[used] & border
        goal[on_outline] = self.iso[on_outline]
        curve_of = np.full(len(used), -1)
        curves = []
        polar_theta = np.full(len(used), np.nan)
        for name, target in targets.items():
            ids, fraction = patch.on_line(name)
            local = remap[ids]
            ok = (local >= 0)
            local, fraction = local[ok], fraction[ok]
            ok = border[local] & ~on_outline[local]
            if not ok.any():
                continue
            curves.append(LineString([self.polar_to_iso(*target(f)) for f in np.linspace(0, 1, 400)]))
            for i, f in zip(local[ok], fraction[ok]):
                theta, tau = target(float(f))
                goal[i] = self.polar_to_iso(theta, tau)
                polar_theta[i] = theta
                curve_of[i] = len(curves) - 1
        fixed = ~np.isnan(goal[:, 0])
        self.unassigned = int((border & ~fixed).sum())
        self.unassigned_iso = self.iso[border & ~fixed]
        flat = np.c_[self.iso, np.zeros(len(used))]
        # (1) harmonic displacement: right near the outline, folds where a reflex corner of the marking is closed
        shift = np.zeros((len(used), 2))
        shift[fixed] = goal[fixed] - self.iso[fixed]
        by_shift = self.iso + mean_value_solve(flat, self.tri, fixed, shift)
        # (2) polar coordinates about the nipple: the border of the skin that stays is a rectangle in (theta, tau), the
        # corners close without folding; but the polar grid is distorted where the outline runs along a ray (the fold
        # at the sides)
        polar = np.zeros((len(used), 2))
        theta_goal = np.arctan2(goal[:, 0], goal[:, 1])
        rho_goal = np.hypot(goal[:, 0], goal[:, 1])
        polar[fixed, 0] = theta_goal[fixed]
        polar[fixed, 1] = (rho_goal[fixed] - areola_radius) / (self.outer(theta_goal[fixed]) - areola_radius)
        down = fixed & ~np.isnan(polar_theta)
        polar[down, 0] = polar_theta[down]
        if seam is None:
            solved = mean_value_solve(flat, self.tri, fixed, polar)
        else:
            # cut along the seam (the meridian below the pattern) so that the skin that stays is a disk in (theta, tau):
            # the lateral copy of every seam vertex sits at +pi, the medial one at -pi, both at their own tau
            ids, _ = patch.on_line(seam)
            on_seam = np.zeros(len(used), bool)
            on_seam[remap[ids][remap[ids] >= 0]] = True
            cut_tri = self.tri.copy()
            lateral = self.iso[self.tri].mean(1)[:, 0] > 0
            copies = {}
            for f in np.nonzero(lateral)[0]:
                for k in range(3):
                    v = cut_tri[f, k]
                    if on_seam[v]:
                        copies.setdefault(v, len(used) + len(copies))
                        cut_tri[f, k] = copies[v]
            order = sorted(copies, key=copies.get)
            cut_flat = np.vstack([flat, flat[order]])
            cut_fixed = np.r_[fixed | on_seam, np.ones(len(order), bool)]
            rho_r = np.hypot(self.iso[:, 0], self.iso[:, 1])
            tau_r = (rho_r - areola_radius) / (self.outer(np.full(len(used), np.pi)) - areola_radius)
            cut_polar = np.vstack([polar, np.zeros((len(order), 2))])
            cut_polar[np.nonzero(on_seam)[0]] = np.c_[np.full(int(on_seam.sum()), -np.pi), tau_r[on_seam]]
            cut_polar[len(used):] = np.c_[np.full(len(order), np.pi), tau_r[order]]
            solved = mean_value_solve(cut_flat, cut_tri, cut_fixed, cut_polar)[: len(used)]
        self.polar_solved = solved
        by_polar = np.array([self.polar_to_iso(t, r) for t, r in solved])
        by_polar[fixed] = goal[fixed]
        # both satisfy every constraint: polar near the areola, displacement towards the outline
        rho = np.hypot(self.iso[:, 0], self.iso[:, 1])
        near, far = blend
        x = np.clip((rho - near) / (far - near), 0, 1)
        weight = (x * x * (3 - 2 * x))[:, None] if method == "blend" else (np.zeros((len(used), 1)) if method == "polar" else np.ones((len(used), 1)))
        target = by_polar * (1 - weight) + by_shift * weight
        reference = np.sign(signed_areas(self.iso, self.tri))
        self.flipped_before = int((signed_areas(target, self.tri) * reference <= 0).sum())
        target, self.relaxed, _ = relax(self.iso, self.tri, fixed, np.zeros(len(used), bool), curve_of, curves, target, threshold=0.05)
        self.flipped = int((signed_areas(target, self.tri) * reference <= 0).sum())
        self.target_iso = target
        self.target_uv = patch.rest.uv(target)
        self.goal = goal
        self.fixed = fixed
    def outer(self, theta):
        return np.interp(theta, self._ang, self._rad)

    def polar_to_iso(self, theta: float, tau: float) -> np.ndarray:
        rho = self.areola_radius + float(np.clip(tau, 0, 1)) * (float(self.outer(theta)) - self.areola_radius)
        return np.array([rho * np.sin(theta), rho * np.cos(theta)])

    def at(self, uv: np.ndarray) -> np.ndarray:
        """Result (u, v) of any rest (u, v) of the skin that stays: barycentric in the triangle that holds the point
        (looked for round the nearest vertices), the nearest vertex when the point is off the mesh."""
        uv = np.atleast_2d(np.asarray(uv, float))
        _, near = self._tree.query(uv, k=4)
        out = self.target_uv[near[:, 0]].copy()
        for n, point in enumerate(uv):
            best = None
            for vertex in near[n]:
                for f in self._incident[vertex]:
                    t = self.tri[f]
                    a, b, c = self.rest_uv[t]
                    m = np.array([b - a, c - a]).T
                    det = m[0, 0] * m[1, 1] - m[0, 1] * m[1, 0]
                    if abs(det) < 1e-12:
                        continue
                    w1, w2 = np.linalg.solve(m, point - a)
                    w = np.array([1 - w1 - w2, w1, w2])
                    if w.min() >= -1e-6:
                        best = w @ self.target_uv[t]
                        break
                if best is not None:
                    break
            if best is not None:
                out[n] = best
        return out


def fold_path(rest: Rest, end_iso) -> tuple[np.ndarray, np.ndarray]:
    """The fold (bottom of the outline) from the meridian to `end_iso`, and its cumulative length on the standing skin."""
    start = np.array([0.0, float(np.interp(rest.st.um, rest.st.us, rest.st.V[:, -1]))])
    path = rest.outline_between(start, end_iso, below=True)
    return path, rest.true_length(path)


def horizontal_target(rest: Rest, side: int, line_iso: np.ndarray, end_iso, blend: tuple[float, float] = (0.25, 0.8)):
    """Where a horizontal limb of an inverted T goes when it is sutured to the fold: function fraction -> (theta, 1).

    Its start (the end of the vertical limb) goes to the meridian, the T junction; towards its end the limb runs close
    to the fold and drops straight onto the nearest fold point; in between the two rules are blended. The excess length
    of the limb over the fold is gathered in the first part, as in the operation."""
    path, true = fold_path(rest, end_iso)
    fold = LineString(path)
    flat = np.r_[0, np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))]
    line_true = rest.true_length(line_iso)
    f = line_true / line_true[-1]
    g = np.array([np.interp(fold.project(Point(q)), flat, true) / true[-1] for q in line_iso])
    g = np.maximum.accumulate(np.clip(g, 0, 1))
    lo, hi = blend
    x = np.clip((f - lo) / (hi - lo), 0, 1)
    w = x * x * (3 - 2 * x)
    fraction = np.maximum.accumulate(w * g + (1 - w) * f)
    fraction[0], fraction[-1] = 0.0, 1.0
    theta = np.arctan2(path[:, 0], path[:, 1])
    if side < 0:
        theta = np.where(theta > 0, theta - 2 * np.pi, theta)
    theta[0] = side * np.pi
    return lambda q: (float(np.interp(np.interp(q, f, fraction) * true[-1], true, theta)), 1.0)


def line_fraction(st, curve: np.ndarray):
    """Function: chart point on a chart polyline -> fraction of its true length (measured on the standing skin)."""
    line = LineString(curve)
    model = st.model(st.skin(curve))
    true = np.r_[0, np.cumsum(np.linalg.norm(np.diff(model, axis=0), axis=1))]
    flat = np.r_[0, np.cumsum(np.linalg.norm(np.diff(curve, axis=0), axis=1))]

    def fraction(p) -> float:
        return float(np.interp(line.project(Point(p)), flat, true) / true[-1])

    fraction.line = line
    fraction.length = float(true[-1])
    return fraction
