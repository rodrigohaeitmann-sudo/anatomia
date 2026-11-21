"""Geometry of the flap reconstructions (docs/plano-retalhos-miocutaneos.md, section 3). Library of build_flaps.py.

  * Trunk: the chart of the trunk (bb.Chart: u = RREF * angle about the vertical axis of the trunk, lateral +;
    v = height above the nipple; r = radius) widened to the back of the operated side and to the abdomen of both
    sides, with two radius fields on a 2 mm grid: the skin and the wall (the deep structures a flap lies on).
  * The unrolled plane (sigma, tau, h): sigma is the arc length along the wall at each height, tau = v and h the
    height over the wall. A rotation in that plane is close to an isometry of the surface: flaps move there and come
    back to the model through the wall.
  * chart_mesh: a conforming Delaunay triangulation of a domain of the plane whose edges include given lines (the way
    mammaplasty_result.SkinPatch meshes the skin of the breast).
  * slab: a closed solid over a polygon of the plane, between a bottom and a top surface (a flap of skin and fat).
  * curl: a sheet rolled over a cylinder like the page of a book (a muscle reflected to show its deep surface).
  * centerline and pedicle_curve: the axis of a vessel mesh, and a curve of fixed length from a fixed origin to a
    point that moves with a flap.
"""
from __future__ import annotations

import json

import numpy as np
import shapely
from scipy.ndimage import gaussian_filter, map_coordinates
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import Delaunay, cKDTree
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

import build_breast as bb

MM = bb.MM
FLAP_DIR = bb.ROOT / "assets/build/flap-meshes"
CELL = 2.0
METRIC_SIGMA = 16.0  # mm, smoothing of the wall for the arc length of the unrolled plane


def flap_mesh(name: str) -> tuple[np.ndarray, np.ndarray]:
    """A mesh of build_flap_sources.py in model space (mm)."""
    pos = np.fromfile(FLAP_DIR / f"{name}.pos.bin", dtype=np.float32).reshape(-1, 3).astype(np.float64) / MM
    idx = np.fromfile(FLAP_DIR / f"{name}.idx.bin", dtype=np.uint32).reshape(-1, 3).astype(np.int64)
    return pos, idx


def flap_index() -> dict:
    return json.loads((FLAP_DIR / "index.json").read_text())["meshes"]


def smootherstep(t):
    return bb.smootherstep(np.clip(t, 0.0, 1.0))


def decimate(pos: np.ndarray, idx: np.ndarray, triangles: int) -> tuple[np.ndarray, np.ndarray]:
    import fast_simplification

    if len(idx) <= triangles:
        return pos, idx
    p, f = fast_simplification.simplify(pos.astype(np.float32), idx.astype(np.int32), target_reduction=1 - triangles / len(idx))
    return np.asarray(p, float), np.asarray(f, int)


def compact(pos: np.ndarray, idx: np.ndarray, keep_faces: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """The faces kept and the vertices they use (and the indices of those vertices in the input)."""
    faces = idx[keep_faces]
    used = np.unique(faces)
    remap = -np.ones(len(pos), int)
    remap[used] = np.arange(len(used))
    return pos[used], remap[faces], used


# --------------------------------------------------------------------------------------------------
# chart of the trunk
# --------------------------------------------------------------------------------------------------
class Trunk:
    """Chart of the trunk with the skin and wall fields and the unrolled plane of the wall."""

    # the chart is cut on the back of the other side (u = WRAP_U): the back of the operated side runs past the posterior
    # midline (u = pi RREF) without a seam
    WRAP_U = -360.0

    def __init__(self, skin: list, wall: list, u_range=(-300.0, 620.0), v_range=(-440.0, 262.0), wall_sigma: float = 3.0) -> None:
        self.ch = bb.Chart("op", bb.trunk_axis())
        self.us = np.arange(u_range[0], u_range[1] + 1e-6, CELL)
        self.vs = np.arange(v_range[0], v_range[1] + 1e-6, CELL)
        raw = self.field(skin)
        # where there is skin (the trunk is cut at the arms and the neck): closed over the gaps of the sampling only
        # (the openings of the arms are holes of this region and must stay so)
        from scipy.ndimage import binary_closing

        self.covered = binary_closing(~np.isnan(raw), iterations=1)
        self.skin = bb.fill_nan(raw)
        self.wall = gaussian_filter(bb.fill_nan(self.field(wall)), wall_sigma)
        self.wall = np.minimum(self.wall, self.skin - 1.0)
        # unrolled plane: arc length along the wall at each height, from the front midline (u = 0). The wall is smoothed
        # for this metric only (METRIC_SIGMA): where it changes abruptly from one height to the next (the scapula, the
        # axilla) a row-by-row arc length would shift the columns of a mesh made in the plane back and forth (pleats)
        theta = self.us / bb.RREF
        metric = gaussian_filter(self.wall, METRIC_SIGMA / CELL)
        dr = np.gradient(metric, theta, axis=0)
        speed = np.sqrt(metric**2 + dr**2)
        s = np.concatenate([np.zeros((1, len(self.vs))), np.cumsum(0.5 * (speed[1:] + speed[:-1]) * np.diff(theta)[:, None], axis=0)])
        zero = np.interp(0.0, self.us, np.arange(len(self.us)))
        i0 = int(np.floor(zero))
        s0 = s[i0] + (zero - i0) * (s[i0 + 1] - s[i0])
        self.sigma = s - s0[None, :]

    def chart(self, p: np.ndarray) -> np.ndarray:
        """Chart coordinates (u, v, r) of model points, u unwrapped past the posterior midline of the operated side."""
        q = self.ch.to_chart(np.asarray(p, float))
        q[:, 0] = np.where(q[:, 0] < self.WRAP_U, q[:, 0] + 2 * np.pi * bb.RREF, q[:, 0])
        return q

    def field(self, meshes: list, outer: bool = True, spacing: float = 0.8) -> np.ndarray:
        grid = np.full((len(self.us), len(self.vs)), -np.inf if outer else np.inf)
        for pos, idx in meshes:
            q = self.chart(bb.sample_surface(pos, idx, spacing))
            iu = np.round((q[:, 0] - self.us[0]) / CELL).astype(int)
            iv = np.round((q[:, 1] - self.vs[0]) / CELL).astype(int)
            ok = (iu >= 0) & (iu < len(self.us)) & (iv >= 0) & (iv < len(self.vs))
            (np.maximum if outer else np.minimum).at(grid, (iu[ok], iv[ok]), q[ok, 2])
        grid[~np.isfinite(grid)] = np.nan
        return grid

    def sample(self, grid: np.ndarray, u, v, order: int = 1) -> np.ndarray:
        u, v = np.atleast_1d(np.asarray(u, float)), np.atleast_1d(np.asarray(v, float))
        u, v = np.broadcast_arrays(u, v)
        return map_coordinates(grid, [(u - self.us[0]) / CELL, (v - self.vs[0]) / CELL], order=order, mode="nearest")

    # ---- unrolled plane --------------------------------------------------------------------------
    def flat(self, p: np.ndarray) -> np.ndarray:
        """(sigma, tau, h) of model points (mm)."""
        q = self.chart(p)
        return np.c_[self.sample(self.sigma, q[:, 0], q[:, 1]), q[:, 1], q[:, 2] - self.sample(self.wall, q[:, 0], q[:, 1])]

    def u_of(self, sigma: np.ndarray, tau: np.ndarray) -> np.ndarray:
        """Inverse of the arc length along each row of the grid (linear between rows)."""
        sigma, tau = np.asarray(sigma, float), np.asarray(tau, float)
        f = np.clip((tau - self.vs[0]) / CELL, 0, len(self.vs) - 1.000001)
        j = np.floor(f).astype(int)
        w = f - j
        out = np.empty_like(sigma)
        for row in np.unique(j):
            sel = j == row
            lo = np.interp(sigma[sel], self.sigma[:, row], self.us)
            hi = np.interp(sigma[sel], self.sigma[:, row + 1], self.us)
            out[sel] = lo + w[sel] * (hi - lo)
        return out

    def model(self, flat: np.ndarray) -> np.ndarray:
        """Model points (mm) of (sigma, tau, h)."""
        flat = np.asarray(flat, float)
        u = self.u_of(flat[:, 0], flat[:, 1])
        r = self.sample(self.wall, u, flat[:, 1]) + flat[:, 2]
        return self.ch.to_model(np.c_[u, flat[:, 1], r])

    def skin_height(self, sigma, tau) -> np.ndarray:
        """Height of the skin over the wall at points of the plane."""
        sigma, tau = np.broadcast_arrays(np.atleast_1d(np.asarray(sigma, float)), np.atleast_1d(np.asarray(tau, float)))
        u = self.u_of(sigma, tau)
        return self.sample(self.skin, u, tau) - self.sample(self.wall, u, tau)

    def uv(self, sigma, tau) -> np.ndarray:
        sigma, tau = np.broadcast_arrays(np.atleast_1d(np.asarray(sigma, float)), np.atleast_1d(np.asarray(tau, float)))
        return np.c_[self.u_of(sigma, tau), tau]

    def sigma_of(self, u, v) -> np.ndarray:
        return self.sample(self.sigma, u, v)

    def skin_region(self, margin: float = 8.0) -> Polygon:
        """The part of the plane covered by skin (the largest piece), `margin` mm inside its border."""
        import contourpy

        sig = self.sigma
        tau = np.broadcast_to(self.vs[None, :], sig.shape)
        lines = contourpy.contour_generator(sig, tau, self.covered.astype(float)).lines(0.5)
        # outer rings and holes (the openings of the arms) together, by the even-odd rule
        whole = Polygon()
        for line in lines:
            if len(line) > 3:
                whole = whole.symmetric_difference(Polygon(line).buffer(0))
        shrunk = whole.buffer(-margin)
        return max(getattr(shrunk, "geoms", [shrunk]), key=lambda g: g.area)

    def flat_of(self, uv: np.ndarray, r: np.ndarray) -> np.ndarray:
        """(sigma, tau, h) of chart points (u, v) at radii r."""
        return np.c_[self.sigma_of(uv[:, 0], uv[:, 1]), uv[:, 1], r - self.sample(self.wall, uv[:, 0], uv[:, 1])]


def ray_skin(trunk: Trunk, pos: np.ndarray, idx: np.ndarray, uv: np.ndarray, guess: np.ndarray | None = None) -> np.ndarray:
    """Radius of a skin mesh along the radial lines of chart points (u, v): its outermost crossing (nearest to the
    guessed radius when given). Points the mesh does not cross keep the radius field of the trunk."""
    import trimesh

    mesh = trimesh.Trimesh(pos, idx, process=False)
    theta = uv[:, 0] / bb.RREF
    ch = trunk.ch
    direction = np.c_[-ch.s * np.sin(theta), np.zeros(len(uv)), np.cos(theta)]
    origin = np.c_[np.full(len(uv), ch.xc), uv[:, 1] + ch.y0, np.full(len(uv), ch.zc)]
    hit_pos, ray, _ = mesh.ray.intersects_location(origin, direction, multiple_hits=True)
    radius = trunk.sample(trunk.skin, uv[:, 0], uv[:, 1])
    found = np.zeros(len(uv), bool)
    dist = np.linalg.norm(hit_pos - origin[ray], axis=1)
    order = np.argsort(dist)
    for k in order:
        i = ray[k]
        if guess is None:
            radius[i] = dist[k]  # ascending: the last one wins (outermost)
            found[i] = True
        elif not found[i] or abs(dist[k] - guess[i]) < abs(radius[i] - guess[i]):
            radius[i] = dist[k]
            found[i] = True
    if guess is not None:
        # a ray that slips through an edge of the mesh finds only an inner sheet: keep the field there
        missed = np.abs(radius - guess) > 3.0
        radius[missed] = guess[missed]
    return radius


# --------------------------------------------------------------------------------------------------
# meshes made in the plane
# --------------------------------------------------------------------------------------------------
def chart_mesh(domain: Polygon, lines: list, spacing: float, segment: float | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Conforming Delaunay triangulation of `domain` whose edges include its outline and the given lines (shapely
    geometries): a constraint segment missing from the triangulation is split until it shows up. Grid points fill the
    rest. Triangles with three corners on lines get a centre vertex (they would be flat in a map that straightens
    those lines)."""
    segment = segment or spacing * 0.75
    linework = unary_union([shapely.set_precision(g, 0.005) for g in [domain.exterior, *domain.interiors, *lines]]).intersection(domain.buffer(1e-6))
    linework = shapely.segmentize(linework, segment)
    index: dict = {}
    points: list = []
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
    minx, miny, maxx, maxy = domain.bounds
    gx, gy = np.meshgrid(np.arange(minx, maxx + spacing, spacing), np.arange(miny, maxy + spacing * 0.866, spacing * 0.866))
    gx = gx + (np.arange(gx.shape[0])[:, None] % 2) * spacing * 0.5  # staggered rows: equilateral triangles
    grid = np.c_[gx.ravel(), gy.ravel()]
    clear = domain.buffer(-0.55 * spacing).difference(linework.buffer(0.55 * spacing))
    first_grid = len(points)
    for q in grid[shapely.contains_xy(clear, grid[:, 0], grid[:, 1])]:
        vertex(q)
    last_grid = len(points)
    for _ in range(60):
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
        raise RuntimeError(f"chart mesh: {len(missing)} segments still missing")
    pts = np.array(points)
    a, b, c = pts[tri[:, 0]], pts[tri[:, 1]], pts[tri[:, 2]]
    area = (b - a)[:, 0] * (c - a)[:, 1] - (b - a)[:, 1] * (c - a)[:, 0]
    longest = np.max(np.stack([np.hypot(*(b - a).T), np.hypot(*(c - b).T), np.hypot(*(a - c).T)]), 0)
    centre = pts[tri].mean(1)
    keep = (np.abs(area) > 1e-4 * longest**2) & shapely.contains_xy(domain, centre[:, 0], centre[:, 1])
    tri, area = tri[keep], area[keep]
    tri[area < 0] = tri[area < 0][:, ::-1]
    on_line = np.ones(len(pts), bool)
    on_line[first_grid:last_grid] = False
    ears = on_line[tri].all(1)
    if ears.any():
        extra = pts[tri[ears]].mean(1)
        new = np.arange(len(pts), len(pts) + len(extra))
        a_, b_, c_ = tri[ears, 0], tri[ears, 1], tri[ears, 2]
        tri = np.vstack([tri[~ears], np.c_[a_, b_, new], np.c_[b_, c_, new], np.c_[c_, a_, new]])
        pts = np.vstack([pts, extra])
    used = np.unique(tri)
    remap = -np.ones(len(pts), int)
    remap[used] = np.arange(len(used))
    return pts[used], remap[tri]


def label_faces(pts: np.ndarray, tri: np.ndarray, regions: list) -> np.ndarray:
    """Label of every triangle: the first region (label, polygon or None for all) containing its centroid."""
    centre = pts[tri].mean(1)
    labels = np.full(len(tri), "", dtype=object)
    todo = np.ones(len(tri), bool)
    for label, shape in regions:
        inside = todo.copy() if shape is None else todo & shapely.contains_xy(shape, centre[:, 0], centre[:, 1])
        labels[inside] = label
        todo &= ~inside
    return labels


def boundary_loops(tri: np.ndarray) -> list[np.ndarray]:
    """Closed loops of the edges used by one triangle only, in the winding of the triangles."""
    edges = np.vstack([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]])
    key = np.sort(edges, 1)
    _, inverse, counts = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    border = edges[counts[inverse.ravel()] == 1]
    nxt = {int(a): int(b) for a, b in border}
    loops, seen = [], set()
    for start in nxt:
        if start in seen:
            continue
        loop, v = [], start
        while v not in seen:
            seen.add(v)
            loop.append(v)
            v = nxt[v]
        loops.append(np.array(loop))
    return loops


def slab(pts: np.ndarray, tri: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """A closed solid from a triangulated polygon: bottom (fraction 0) and top (fraction 1) copies of its vertices,
    side walls along its border. Returns the 2D point of every vertex, its fraction and the faces (outward winding when
    the bottom lies on the wall and the triangles are counter-clockwise seen from outside)."""
    n = len(pts)
    faces = [tri[:, ::-1], tri + n]
    for loop in boundary_loops(tri):
        a, b = loop, np.roll(loop, -1)
        faces.append(np.c_[a, b, b + n])
        faces.append(np.c_[a, b + n, a + n])
    return np.vstack([pts, pts]), np.r_[np.zeros(n), np.ones(n)], np.vstack(faces)


# --------------------------------------------------------------------------------------------------
# motions in the plane
# --------------------------------------------------------------------------------------------------
def rotate(xy: np.ndarray, centre, angle: float) -> np.ndarray:
    c, s = np.cos(angle), np.sin(angle)
    d = np.asarray(xy, float) - np.asarray(centre, float)
    return np.asarray(centre, float) + np.c_[c * d[:, 0] - s * d[:, 1], s * d[:, 0] + c * d[:, 1]]


def curl(delta: np.ndarray, h: np.ndarray, alpha: float, rho: float) -> tuple[np.ndarray, np.ndarray]:
    """A sheet lying along +delta from a hinge (delta = 0), h over its base, rolled up over a cylinder of radius rho
    by `alpha` radians, like the page of a book: (delta', h'). Past the roll the sheet goes on straight."""
    delta, h = np.asarray(delta, float), np.asarray(h, float)
    if alpha <= 1e-6:
        return delta.copy(), h.copy()
    arc = alpha * rho
    phi = np.clip(delta / rho, 0.0, alpha)
    on_roll = delta < arc
    x = np.where(on_roll, rho * np.sin(phi), rho * np.sin(alpha) + (delta - arc) * np.cos(alpha))
    z = np.where(on_roll, rho * (1 - np.cos(phi)), rho * (1 - np.cos(alpha)) + (delta - arc) * np.sin(alpha))
    x = x - h * np.sin(phi)
    z = z + h * np.cos(phi)
    before = delta <= 0
    return np.where(before, delta, x), np.where(before, h, z)


def harmonic_offsets(points: np.ndarray, fixed: np.ndarray, offsets: np.ndarray, smoothing: float = 0.0) -> np.ndarray:
    """Smooth 2D offsets of `points` that take the values `offsets` at the points `fixed` (thin plate spline)."""
    from scipy.interpolate import RBFInterpolator

    return RBFInterpolator(fixed, offsets, kernel="thin_plate_spline", smoothing=smoothing)(points)


# --------------------------------------------------------------------------------------------------
# vessels
# --------------------------------------------------------------------------------------------------
def centerline(pos: np.ndarray, idx: np.ndarray, step: float = 2.0, start: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Axis of a tubular mesh: vertices binned by their geodesic distance from one end (the end nearest to `start`,
    or one end of the longest geodesic), the mean of every bin; and the mean radius about it."""
    edges = np.vstack([idx[:, [0, 1]], idx[:, [1, 2]], idx[:, [2, 0]]])
    w = np.linalg.norm(pos[edges[:, 0]] - pos[edges[:, 1]], axis=1)
    graph = coo_matrix((np.r_[w, w], (np.r_[edges[:, 0], edges[:, 1]], np.r_[edges[:, 1], edges[:, 0]])), shape=(len(pos), len(pos))).tocsr()
    if start is None:
        d0 = dijkstra(graph, indices=0)
        a = int(np.nanargmax(np.where(np.isfinite(d0), d0, -1)))
    else:
        a = int(np.argmin(np.linalg.norm(pos - start, axis=1)))
    d = dijkstra(graph, indices=a)
    ok = np.isfinite(d)
    bins = np.floor(d[ok] / step).astype(int)
    p = pos[ok]
    count = np.bincount(bins)
    centre = np.stack([np.bincount(bins, p[:, c]) for c in range(3)], 1)
    has = count > 0
    centre = centre[has] / count[has, None]
    radius = np.array([np.linalg.norm(p[bins == b] - centre[k], axis=1).mean() for k, b in enumerate(np.nonzero(has)[0])])
    return centre, radius


def smooth_polyline(points: np.ndarray, sigma: float = 2.0) -> np.ndarray:
    from scipy.ndimage import gaussian_filter1d

    p = np.asarray(points, float)
    out = gaussian_filter1d(p, sigma, axis=0, mode="nearest")
    out[0], out[-1] = p[0], p[-1]
    return out


def polyline_length(points: np.ndarray) -> float:
    return float(np.linalg.norm(np.diff(points, axis=0), axis=1).sum())


def pedicle_curve(p0: np.ndarray, d0: np.ndarray, p1: np.ndarray, d1: np.ndarray, length: float, n: int = 40) -> tuple[np.ndarray, float]:
    """Cubic Hermite curve from p0 (leaving along d0) to p1 (arriving along d1) whose length is `length` when the
    chord allows (the tangents are scaled until it is), taut otherwise. Returns the curve and the stretch (length of the
    curve over `length`: > 1 when the chord is longer than the pedicle)."""
    t = np.linspace(0, 1, n)[:, None]
    h00, h10, h01, h11 = 2 * t**3 - 3 * t**2 + 1, t**3 - 2 * t**2 + t, -2 * t**3 + 3 * t**2, t**3 - t**2
    d0 = np.asarray(d0, float) / max(np.linalg.norm(d0), 1e-9)
    d1 = np.asarray(d1, float) / max(np.linalg.norm(d1), 1e-9)

    def curve(k):
        return h00 * p0 + h10 * (k * d0) + h01 * p1 + h11 * (k * d1)

    chord = float(np.linalg.norm(np.asarray(p1) - np.asarray(p0)))
    lo, hi = 0.0, 4.0 * max(length, chord)
    if polyline_length(curve(lo)) >= length:
        c = curve(lo)
        return c, polyline_length(c) / length
    for _ in range(50):
        mid = (lo + hi) / 2
        if polyline_length(curve(mid)) < length:
            lo = mid
        else:
            hi = mid
    c = curve(lo)
    return c, polyline_length(c) / length


def tangent_at(points: np.ndarray, end: int, span: float = 8.0) -> np.ndarray:
    """Unit direction of a polyline at its first (end = 0) or last (end = -1) point, over `span` mm, pointing along it."""
    p = np.asarray(points, float)
    if end != 0:
        p = p[::-1]
    s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
    k = min(int(np.searchsorted(s, span)), len(p) - 1)
    d = p[k] - p[0]
    d = d / max(np.linalg.norm(d), 1e-9)
    return d if end == 0 else -d


def nearest_on_mesh(points: np.ndarray, pos: np.ndarray) -> np.ndarray:
    return cKDTree(pos).query(points)[1]


__all__ = [
    "MM", "FLAP_DIR", "CELL", "flap_mesh", "flap_index", "smootherstep", "decimate", "compact", "Trunk", "ray_skin",
    "chart_mesh", "label_faces", "boundary_loops", "slab", "rotate", "curl", "harmonic_offsets", "centerline",
    "smooth_polyline", "polyline_length", "pedicle_curve", "tangent_at", "nearest_on_mesh", "LineString", "Point", "Polygon",
]
