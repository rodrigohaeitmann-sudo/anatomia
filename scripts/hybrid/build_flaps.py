#!/usr/bin/env python3
"""Mastectomy and breast reconstruction with pedicled myocutaneous flaps, step by step
(docs/plano-retalhos-miocutaneos.md).

Three sequences, written in the format of the mammaplasty steps (build_mammaplasty_steps.Writer: positions of every
mesh at its key frames, uint16 over one box, and indices):

  mastectomia     total mastectomy through a transverse ellipse that takes the nipple-areola complex: marking,
                  incision, skin flaps raised in the subcutaneous plane, the breast taken off the pectoralis major with
                  its fascia, the bed (the flaps on the wall) and the closure without reconstruction
  grande-dorsal   immediate reconstruction with the pedicled latissimus dorsi myocutaneous flap and an implant: the
                  skin island designed on the back, the muscle freed and reflected on its thoracodorsal pedicle, passed
                  through the axillary tunnel, the back closed, the implant under the muscle, the inset
  tram            immediate reconstruction with the ipsilateral pedicled TRAM flap: the lower abdominal island and its
                  zones, the rectus raised on the superior epigastric vessels, the 180 degree turn through the
                  epigastric tunnel, the inset of zones I to III and the abdominal closure

How (flap_geometry.py): everything is placed and moved in the chart of the trunk (the chart of the breast widened to
the back and the abdomen) and its unrolled plane over the wall. The skin is meshed in that plane with the lines of
each step among its edges. A flap moves in the plane (rotation about its pivot, the pull through a tunnel, a page
roll to show its deep surface) and comes back to the model over the wall; its pedicle is a curve of fixed length from
its origin to the hilum. The reconstructed breast is the envelope of the breast at rest (the immediate
reconstruction refills the skin it keeps), and the tissue of the flap is shaped into it with the chart of the
breast: the outline of the flap goes to the outline of the pocket and every point of the flap keeps its share of
the thickness between the wall and that envelope.

Outputs:
  src/data/reconstructionSteps.json                  structures, meshes, frames, measures of the three sequences
  public/models/hybrid/reconstruction-<key>.bin      positions at the key frames and indices, per sequence

Usage: python3 scripts/hybrid/build_flaps.py [--only mastectomia] [--figures DIR]
       (after decode_model.mjs and build_flap_sources.py)
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import shapely
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).parent))
import build_breast as bb  # noqa: E402
import build_mammaplasty_steps as bms  # noqa: E402
import flap_geometry as fg  # noqa: E402
import mammaplasty_result as mr  # noqa: E402

OUT_JSON = bb.ROOT / "src/data/reconstructionSteps.json"
OUT_BIN = bb.ROOT / "public/models/hybrid/reconstruction-{key}.bin"
MM = bb.MM
SOURCE = "Reconstrução mamária (este projeto)"
LICENSE = "Gerado neste projeto sobre as malhas do modelo (CC BY-SA 4.0, como a obra derivada)"
LIFT = 0.15  # mm: a skin patch lies this far over the skin of the trunk it replaces

# ---- mastectomy ------------------------------------------------------------------------------------
FLAP_MM = 6.0  # thickness of the skin flaps (skin and the subcutaneous layer kept on them)
ELLIPSE = {"a": 58.0, "b": 27.0, "tilt": 14.0, "shift": 10.0}  # semi-axes in the unrolled plane (mm), tilt up towards the axilla
# (degrees) and shift of the centre from the nipple towards the axilla along the axis (mm)
LIMITS = {"top": 112.0, "sternalU": 24.0, "belowFold": 15.0, "ldMargin": 4.0, "round": 10.0, "lateralU": 246.0}
# lateralU: the skin patch stops at this u (84 degrees from the front): behind it the side of the breast overhangs the
# chest wall, and a skin made as a height over the chart cannot follow an overhang (the latissimus border is ~1 cm further)
SKIRT = 14.0  # mm of skin round the dissection that stays as it is (the trunk skin overlaps it)
SPACING = 3.0
FLAP_RAISE = 38.0  # degrees: the flaps raised as by retractors
SCAR_EXTENSION = 12.0  # mm the scar of the closure runs past each tip of the ellipse (the dog-ears are taken up)
REMOVAL_FADE = 25.0  # mm inside the limits over which the skin comes down to the wall
SPECIMEN_OUT = np.array([75.0, -125.0, 95.0])  # mm: where the specimen is laid (medial, down, forward)

COLORS = {
    "skin": "#e7b8a0", "excised": "#e9a27f", "dermis": "#d97a82", "fat": "#f2cf5b", "gland": "#f0a8b5", "duct": "#e88fa0",
    "ligament": "#f7e3c8", "fascia": "#c9d6e8", "nac": "#9b5a47", "muscle": "#b5483f", "muscle-cut": "#8e2f2a",
    "implant": "#cfe3f3", "artery": "#d32f2f", "vein": "#2a5bb8", "nerve": "#f5d547", "artery-cut": "#8d3b3b",
    "marking": "#2536a8", "limit": "#0f766e", "incision": "#b91c1c", "scar": "#7d2f32", "suture": "#f472b6",
    "zone-1": "#16a34a", "zone-2": "#84cc16", "zone-3": "#f59e0b", "zone-4": "#dc2626", "sheath": "#d9dde3",
}


def smooth01(t):
    return fg.smootherstep(t)


# --------------------------------------------------------------------------------------------------
# set-up: chart of the trunk, breast chart, model meshes
# --------------------------------------------------------------------------------------------------
WALL_STRUCTURES = {"chest-wall", "costal-cartilages", "intercostal-muscles", "serratus-anterior", "pectoralis-major", "pectoralis-minor",
                   "teres-major", "infraspinatus", "rhomboids", "serratus-posterior", "thoracolumbar-fascia", "subscapularis"}
FLAP_WALL = ["za_Rectus_abdominis_musclel", "za_Rectus_abdominis_muscler", "za_Linea_alba", "za_Internal_abdominal_oblique_musclel",
             "za_External_abdominal_oblique_muscler", "bp43_FJ1452M"]


class Setup:
    def __init__(self) -> None:
        names = [m["name"] for m in bb.MANIFEST["meshes"] if m["structure"] in WALL_STRUCTURES]
        wall = [bb.mesh(n) for n in names] + [bb.mesh("bp43_FJ3279")] + [fg.flap_mesh(n) for n in FLAP_WALL]
        self.skin_mesh = bb.mesh(bb.SKIN)
        self.lower_skin = fg.flap_mesh("hra_lower_trunk_skin")
        self.trunk = fg.Trunk([self.skin_mesh, self.lower_skin], wall)
        self.breast = bb.Breast("op", bb.trunk_axis())
        self.notch = bb.layer_landmark("esterno.incisura-jugular")


def landmark(name: str, index: int | None = None) -> np.ndarray:
    value = np.array(bb.MANIFEST["landmarks"][name], float)
    return (value[index] if index is not None else value) / MM


def layer_point(ident: str) -> np.ndarray:
    return bb.layer_landmark(ident)


# --------------------------------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------------------------------
def ellipse_points(centre, a: float, b: float, tilt_deg: float, n: int = 160) -> np.ndarray:
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    c, s = np.cos(np.radians(tilt_deg)), np.sin(np.radians(tilt_deg))
    x, y = a * np.cos(t), b * np.sin(t)
    return np.c_[centre[0] + c * x - s * y, centre[1] + s * x + c * y]


def tube_frames(lines: list[list[np.ndarray]], radius: float, sides: int = 6) -> tuple[list[np.ndarray], np.ndarray]:
    """Tubes along polylines given at every frame (lines[k] = the polylines at frame k, same point counts)."""
    frames, faces = [], None
    for polylines in lines:
        parts = [bms.tube_mesh(p, radius, sides, normal0=[0.0, 0.0, 1.0]) for p in polylines]
        verts, f = bms.merge(parts)
        frames.append(verts)
        faces = f
    return frames, faces


def surface_line(trunk: fg.Trunk, plane_xy: np.ndarray, radius_of, step: float = 1.5, lift: float = 0.6) -> np.ndarray:
    """A polyline of the plane laid on a surface (radius_of(u, v) -> r), slightly over it, in model space."""
    line = LineString(plane_xy)
    d = np.r_[np.arange(0, line.length, step), line.length]
    xy = np.array([line.interpolate(x).coords[0] for x in d])
    uv = trunk.uv(xy[:, 0], xy[:, 1])
    return trunk.ch.to_model(np.c_[uv, radius_of(uv[:, 0], uv[:, 1]) + lift])


def untangle(xy: np.ndarray, tri: np.ndarray, fixed: np.ndarray, rest: np.ndarray, rounds: int = 300) -> np.ndarray:
    """Free vertices of triangles that a map turned over (or squashed below a tenth of their rest area) are moved to
    the mean of their neighbours, round after round, until none is left (the tips of a closed ellipse)."""
    out = xy.copy()
    edges = np.vstack([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]])
    n = len(xy)
    a0 = mr.signed_areas(rest, tri)
    for _ in range(rounds):
        a1 = mr.signed_areas(out, tri)
        bad = (a1 * np.sign(a0) < 0.1 * np.abs(a0))
        if not bad.any():
            break
        verts = np.unique(tri[bad])
        verts = verts[~fixed[verts]]
        if not len(verts):
            break
        # one ring about every vertex to move, a little wider each round
        move = np.zeros(n, bool)
        move[verts] = True
        sum_ = np.zeros((n, 2))
        cnt = np.zeros(n)
        for a, b in ((0, 1), (1, 0)):
            np.add.at(sum_, edges[:, a], out[edges[:, b]])
            np.add.at(cnt, edges[:, a], 1)
        mean = sum_ / np.maximum(cnt, 1)[:, None]
        out[move] = 0.5 * out[move] + 0.5 * mean[move]
    return out


def signed_area_flips(xy: np.ndarray, tri: np.ndarray, rest: np.ndarray) -> int:
    a0 = mr.signed_areas(rest, tri)
    a1 = mr.signed_areas(xy, tri)
    return int(((a0 > 0) != (a1 > 0)).sum())


# --------------------------------------------------------------------------------------------------
# 1. mastectomy
# --------------------------------------------------------------------------------------------------
class Mastectomy:
    """Design, skin and specimen of the total mastectomy; its bed is where both reconstructions start."""

    FRAMES = [
        ("marcacao", "Marcação"),
        ("incisao", "Incisão"),
        ("retalhos", "Retalhos cutâneos levantados"),
        ("resseccao:1", "Exérese da mama"),
        ("resseccao", "Exérese da mama"),
        ("leito", "Leito da mastectomia"),
        ("fechamento", "Fechamento sem reconstrução"),
    ]

    def __init__(self, s: Setup) -> None:
        self.s = s
        tr = self.trunk = s.trunk
        br = s.breast
        nipple_uv = br.ch.nipple[:2]
        self.centre = np.array([float(tr.sigma_of(nipple_uv[0], nipple_uv[1])[0]), float(nipple_uv[1])])
        e = ELLIPSE
        self.axis = np.array([np.cos(np.radians(e["tilt"])), np.sin(np.radians(e["tilt"]))])
        self.nipple = self.centre.copy()
        self.centre = self.centre + e["shift"] * self.axis
        self.ellipse = Polygon(ellipse_points(self.centre, e["a"], e["b"], e["tilt"]))
        self.ends = np.array([self.centre - e["a"] * self.axis, self.centre + e["a"] * self.axis])  # medial, lateral
        self.limits = self.dissection_limits()
        # the skirt round the limits, narrower on the lateral side (see LIMITS.lateralU)
        taus = np.arange(-250.0, 260.0, 4.0)
        lateral = np.c_[tr.sigma_of(np.full(len(taus), LIMITS["lateralU"] + 5.0), taus), taus]
        keep = Polygon(np.r_[lateral, [[-400.0, taus[-1]], [-400.0, taus[0]]]])
        self.domain = self.limits.buffer(SKIRT).intersection(keep).simplify(0.2)
        # the line that parts the upper and lower flaps: the axis of the ellipse, from its ends to the limits
        far = 400.0
        self.split = [LineString([self.ends[0], self.ends[0] - far * self.axis]).intersection(self.limits),
                      LineString([self.ends[1], self.ends[1] + far * self.axis]).intersection(self.limits)]
        self.split = [g if g.geom_type == "LineString" else max(g.geoms, key=lambda x: x.length) for g in self.split]
        upper_half = Polygon(np.r_[[self.ends[0] - far * self.axis, self.ends[1] + far * self.axis],
                                   [self.ends[1] + far * self.axis + far * np.array([-self.axis[1], self.axis[0]])],
                                   [self.ends[0] - far * self.axis + far * np.array([-self.axis[1], self.axis[0]])]])
        self.upper_region = self.limits.difference(self.ellipse).intersection(upper_half)
        self.lower_region = self.limits.difference(self.ellipse).difference(upper_half)
        self.mesh_skin()
        self.post_mastectomy_field()

    # ---- design ---------------------------------------------------------------------------------
    def dissection_limits(self) -> Polygon:
        """Limits of the flaps in the plane: 2 cm below the clavicle, the border of the sternum, 15 mm below the
        fold, the anterior border of the latissimus dorsi."""
        tr, br = self.trunk, self.s.breast
        ld, ldi = bb.mesh("bp30_FMA13359")
        f = tr.flat(ld)
        taus = np.arange(-120.0, LIMITS["top"] + 0.1, 2.0)
        # anterior border of the latissimus: the least sigma of the muscle at each height (over the lateral chest)
        border = []
        for t in taus:
            sel = np.abs(f[:, 1] - t) < 3.0
            border.append(f[sel, 0].min() if sel.any() else np.nan)
        border = np.array(border)
        ok = ~np.isnan(border)
        border = np.interp(taus, taus[ok], border[ok]) - LIMITS["ldMargin"]
        border = gaussian_filter(border, 4.0, mode="nearest")
        border = np.minimum(border, tr.sigma_of(np.full(len(taus), LIMITS["lateralU"]), taus))
        self.ld_border = np.c_[border, taus]
        medial = np.c_[tr.sigma_of(np.full(len(taus), LIMITS["sternalU"]), taus), taus]
        # bottom: 15 mm below the fold, along sigma from the sternal border to the latissimus
        sig = np.linspace(medial[:, 0].min(), border.max(), 120)
        u = tr.u_of(sig, np.zeros_like(sig))
        lo, hi = br.fold_range
        fold = br.curve("fold", np.clip(u, lo, hi)) - LIMITS["belowFold"]
        bottom = np.c_[sig, fold]
        bottom = bottom[(bottom[:, 0] > np.interp(bottom[:, 1], taus, medial[:, 0])) & (bottom[:, 0] < np.interp(bottom[:, 1], taus, border))]
        tau_bottom_medial, tau_bottom_lateral = bottom[0, 1], bottom[-1, 1]
        left = medial[medial[:, 1] >= tau_bottom_medial]
        right = self.ld_border[self.ld_border[:, 1] >= tau_bottom_lateral]
        ring = np.r_[bottom, right, [[right[-1, 0], LIMITS["top"]], [left[-1, 0], LIMITS["top"]]], left[::-1]]
        poly = Polygon(ring).buffer(0).intersection(tr.skin_region(SKIRT + 6.0))  # not into the opening of the arm
        poly = max(getattr(poly, "geoms", [poly]), key=lambda g: g.area)
        r = LIMITS["round"]
        return poly.buffer(-r).buffer(r).simplify(0.2)

    def mesh_skin(self) -> None:
        tr = self.trunk
        pts, tri = fg.chart_mesh(self.domain, [self.ellipse.exterior, self.limits.exterior, *self.split], SPACING)
        labels = fg.label_faces(pts, tri, [("specimen", self.ellipse), ("upper", self.upper_region), ("lower", self.lower_region), ("skirt", None)])
        self.pts, self.tri, self.labels = pts, tri, labels
        uv = tr.uv(pts[:, 0], pts[:, 1])
        guess = tr.sample(tr.skin, uv[:, 0], uv[:, 1])
        r = fg.ray_skin(tr, *self.s.skin_mesh, uv, guess=guess)
        self.rest_r = r + LIFT
        self.rest_h = self.rest_r - tr.sample(tr.wall, uv[:, 0], uv[:, 1])
        self.uv = uv

    def post_mastectomy_field(self) -> None:
        """Radius of the skin on the bed: the wall plus the flap where the breast was taken, the skin as it was
        outside the limits, a smooth way between (REMOVAL_FADE)."""
        tr = self.trunk
        sig, tau = tr.sigma, np.broadcast_to(tr.vs[None, :], tr.sigma.shape)
        inside = shapely.contains_xy(self.limits, sig.ravel(), tau.ravel()).reshape(sig.shape)
        dist = shapely.distance(self.limits.exterior, shapely.points(sig.ravel(), tau.ravel())).reshape(sig.shape)
        self.removal = np.where(inside, smooth01(dist / REMOVAL_FADE), 0.0)

    def bed_radius(self, uv: np.ndarray, rest_r: np.ndarray) -> np.ndarray:
        """Radius of skin points (given at rest) on the bed of the mastectomy."""
        tr = self.trunk
        wall = tr.sample(tr.wall, uv[:, 0], uv[:, 1])
        m = tr.sample(self.removal, uv[:, 0], uv[:, 1])
        return rest_r - m * np.maximum(rest_r - (wall + FLAP_MM), 0.0)

    # ---- poses of the skin ------------------------------------------------------------------------
    def hinge(self, sigma: np.ndarray, upper: bool) -> np.ndarray:
        """Height (tau) of the limit above (upper flap) or below (lower flap) points of the plane."""
        out = np.empty(len(sigma))
        for i, x in enumerate(sigma):
            cut = self.limits.intersection(LineString([(x, -500.0), (x, 500.0)]))
            ys = np.array(cut.coords)[:, 1] if cut.geom_type == "LineString" else np.concatenate([np.array(g.coords)[:, 1] for g in getattr(cut, "geoms", [])] or [[0.0]])
            out[i] = ys.max() if upper else ys.min()
        return out

    def raised(self, flat: np.ndarray, region: np.ndarray) -> np.ndarray:
        """Flaps raised as by retractors: each column of a flap turns about its limit (the hinge) away from the wall,
        fully over the middle of the ellipse and not at all beyond its ends."""
        out = flat.copy()
        lo, hi = self.ends[:, 0].min(), self.ends[:, 0].max()
        weight = smooth01((flat[:, 0] - lo) / 40.0) * smooth01((hi - flat[:, 0]) / 40.0)
        # the skin is whole along the axis beyond the tips: no turn there
        split = unary_union(self.split)
        weight *= smooth01(shapely.distance(split, shapely.points(flat[:, 0], flat[:, 1])) / 25.0)
        tr = self.trunk
        for upper, name in ((True, "upper"), (False, "lower")):
            sel = (region == name) & (weight > 0)
            if not sel.any():
                continue
            x = flat[sel]
            tau_h = self.hinge(x[:, 0], upper)
            h_h = tr.skin_height(x[:, 0], tau_h) + LIFT
            delta = (tau_h - x[:, 1]) if upper else (x[:, 1] - tau_h)
            dh = x[:, 2] - h_h
            a = np.radians(FLAP_RAISE) * weight[sel]
            d2 = delta * np.cos(a) - dh * np.sin(a)
            h2 = delta * np.sin(a) + dh * np.cos(a)
            out[sel, 1] = (tau_h - d2) if upper else (tau_h + d2)
            out[sel, 2] = h_h + h2
        return out

    def closure(self) -> np.ndarray:
        """Plane positions of the skin that stays when the ellipse is closed: its upper and lower edges meet on its
        axis, the outline of the patch stays (mean value map)."""
        keep = self.labels != "specimen"
        tri = self.tri[keep]
        used = np.unique(tri)
        pts = self.pts
        on_ellipse = np.array([self.ellipse.exterior.distance(Point(p)) < 0.01 for p in pts])
        on_outline = np.array([self.domain.exterior.distance(Point(p)) < 0.01 for p in pts])
        target = pts.copy()
        # an edge point at x = a cos t along the axis goes to (a + SCAR_EXTENSION) cos t: the upper and lower edges meet
        # and the tips move out along the axis, so the skin beyond them stretches instead of folding (no dog-ears)
        rel = pts[on_ellipse] - self.centre
        x = np.clip((rel @ self.axis) / ELLIPSE["a"], -1, 1)
        target[on_ellipse] = self.centre + ((ELLIPSE["a"] + SCAR_EXTENSION) * x)[:, None] * self.axis
        fixed = np.zeros(len(pts), bool)
        fixed[on_ellipse | on_outline] = True
        geom = np.c_[pts, np.zeros(len(pts))]
        sub = np.zeros(len(pts), bool)
        sub[used] = True
        out = pts.copy()
        index = -np.ones(len(pts), int)
        index[used] = np.arange(len(used))
        solved = mr.mean_value_solve(geom[used], index[tri], fixed[used], target[used])
        out[used] = untangle(solved, index[tri], fixed[used], pts[used])
        self.closure_flips = signed_area_flips(out, tri, pts)
        return out


    # ---- the sequence -------------------------------------------------------------------------------
    def vertex_regions(self) -> np.ndarray:
        """Region of every vertex of the skin mesh: that of most of its faces."""
        out = np.full(len(self.pts), "skirt", dtype=object)
        for name in ("upper", "lower", "specimen"):
            v = np.unique(self.tri[self.labels == name])
            out[v] = name
        return out

    def skin_frames(self) -> dict:
        """Plane positions (sigma, tau, h) of the skin vertices at the poses of the sequence."""
        tr = self.trunk
        rest = np.c_[self.pts, self.rest_h]
        region = self.vertex_regions()
        raised = self.raised(rest, region)
        bed_r = self.bed_radius(self.uv, self.rest_r)
        bed = np.c_[self.pts, bed_r - tr.sample(tr.wall, self.uv[:, 0], self.uv[:, 1])]
        closed_xy = self.closure()
        uv2 = tr.uv(closed_xy[:, 0], closed_xy[:, 1])
        r2 = self.bed_radius(uv2, tr.sample(tr.skin, uv2[:, 0], uv2[:, 1]) + LIFT)
        keep_skirt = region == "skirt"
        r2[keep_skirt] = bed_r[keep_skirt]
        closed = np.c_[closed_xy, r2 - tr.sample(tr.wall, uv2[:, 0], uv2[:, 1])]
        return {"rest": rest, "raised": raised, "bed": bed, "closed": closed, "region": region}

    def build(self) -> tuple[bms.Writer, dict]:
        tr = self.trunk
        frames = self.FRAMES
        n = len(frames)
        k_of = {fid: k for k, (fid, _) in enumerate(frames)}
        sk = self.skin_frames()
        model = {name: tr.model(sk[name]) for name in ("rest", "raised", "bed", "closed")}
        writer = bms.Writer(n)
        key = "mastectomia"
        sid = lambda part: f"recon-{part}-{key}"  # noqa: E731
        pose = ["rest", "rest", "raised", "raised", "raised", "bed", "closed"]
        # skin of the flaps and round them
        keep = self.labels != "specimen"
        writer.add("recon_mast_skin", sid("skin"), "Pele (retalhos da mastectomia)", COLORS["skin"], 1.0, "skin", self.tri[keep], [model[p] for p in pose])
        # the subcutaneous layer kept on the flaps (seen when they are raised)
        flap_faces = self.labels == "upper"
        flap_faces |= self.labels == "lower"
        fpts, ftri, used = fg.compact(self.pts, self.tri, flap_faces)
        spts, frac, sfaces = fg.slab(fpts, ftri)
        depth = FLAP_MM * (1 - frac) + 0.35 * frac
        src = np.r_[used, used]
        fat_frames = []
        for p in pose:
            flat = sk[p][src].copy()
            if p == "raised":
                rest = sk["rest"][src].copy()
                rest[:, 2] -= depth
                flat = self.raised(rest, sk["region"][src])
            else:
                flat[:, 2] = np.maximum(flat[:, 2] - depth, 0.3 * (1 - frac) + (flat[:, 2] - 0.35) * frac)
            fat_frames.append(tr.model(flat))
        writer.add("recon_mast_flap_fat", sid("flap-fat"), "Subcutâneo dos retalhos", COLORS["fat"], 1.0, "fat", sfaces, fat_frames)
        # the specimen: skin of the ellipse with the nipple-areola complex, the breast and its fascia, taken en bloc
        spec_faces = self.labels == "specimen"
        motion = self.specimen_motion()
        rest_skin = model["rest"]
        spec_tri = self.tri[spec_faces]
        writer.add("recon_mast_specimen_skin", sid("specimen-skin"), "Pele da elipse (sai com a peça)", COLORS["excised"], 1.0, "skin", spec_tri, [motion[k](rest_skin) for k in range(n)])
        for name, label, color, tissue, triangles in SPECIMEN_MESHES:
            pos, idx = bb.mesh(name)
            pos, idx = fg.decimate(pos, idx, triangles)
            writer.add(f"recon_mast_{name}", sid("specimen"), label, color, 1.0, tissue, idx, [motion[k](pos) for k in range(n)])
        fascia, fidx = bb.mesh("za_Pectoral_fascial")
        centre = tr.flat(fascia[fidx].mean(1))
        inside = shapely.contains_xy(self.limits.buffer(-2.0), centre[:, 0], centre[:, 1])
        writer.add("recon_mast_fascia_specimen", sid("specimen"), "Fáscia do peitoral maior (sai com a peça)", COLORS["fascia"], 1.0, "fascia", fidx[inside], [motion[k](fascia) for k in range(n)])
        writer.add("recon_mast_fascia_rest", sid("fascia"), "Fáscia peitoral fora da dissecção", COLORS["fascia"], 1.0, "fascia", fidx[~inside], [fascia] * n)
        # marking: the ellipse and the limits of the dissection, drawn on the skin at rest
        rest_radius = lambda u, v: tr.sample(tr.skin, u, v)  # noqa: E731
        ellipse = np.array(self.ellipse.exterior.coords)
        lines = [surface_line(tr, ellipse, rest_radius)]
        frames_, faces = tube_frames([lines] * n, 0.75)
        writer.add("recon_mast_ellipse", sid("marking"), "Elipse da mastectomia", COLORS["marking"], 1.0, "marking", faces, frames_)
        limit = np.array(self.limits.exterior.coords)
        pieces = bms.dashes(surface_line(tr, limit, rest_radius, step=1.0), on=6.0, off=4.0)
        frames_, faces = tube_frames([pieces] * n, 0.6)
        writer.add("recon_mast_limits", sid("limits"), "Limites da dissecção", COLORS["limit"], 1.0, "marking", faces, frames_)
        # the incision (on the skin that stays) and the scar of the closure
        frames_, faces = tube_frames([lines] * n, 0.55)
        writer.add("recon_mast_incision", sid("incision"), "Incisão", COLORS["incision"], 1.0, "marking", faces, frames_)
        ends = self.centre + np.outer([-(ELLIPSE["a"] + SCAR_EXTENSION), ELLIPSE["a"] + SCAR_EXTENSION], self.axis)
        scar_xy = np.linspace(ends[0], ends[1], 120)
        bed_line = lambda u, v: self.bed_radius(np.c_[u, v], tr.sample(tr.skin, u, v) + LIFT)  # noqa: E731
        scar = surface_line(tr, scar_xy, bed_line, step=1.5, lift=0.5)
        frames_, faces = tube_frames([[scar]] * n, 0.9)
        writer.add("recon_mast_scar", sid("scar"), "Cicatriz transversa", COLORS["scar"], 1.0, "marking", faces, frames_)
        points = self.anchors(model, motion, scar)
        values = self.measures(model)
        start = np.array(points["specimen"]) / MM
        arrows = [{"frame": k_of["resseccao:1"], "from": r3(start * MM), "to": r3(motion[k_of["resseccao"]](start[None])[0] * MM), "color": "#e08a2e"}]
        info = {"frames": [{"id": f, "label": label} for f, label in frames], "points": points, "measures": values, "arrows": arrows}
        return writer, info

    def specimen_motion(self):
        """Rigid motion of the specimen at every frame: in place until it is taken, then laid medially, down and
        forwards, by a way that first lifts it off the wall."""
        pos, idx = bb.mesh("hra_VH_F_fat_L")
        centre = pos.mean(0)
        def make(fraction: float, lift: float, angle: float):
            c, s = np.cos(np.radians(angle)), np.sin(np.radians(angle))
            rot = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
            shift = SPECIMEN_OUT * fraction + np.array([0.0, 0.0, lift])
            return lambda p: (np.asarray(p) - centre) @ rot.T + centre + shift
        ident = lambda p: np.asarray(p)  # noqa: E731
        return [ident, ident, ident, make(0.45, 45.0, -12.0), make(1.0, 0.0, -25.0), make(1.0, 0.0, -25.0), make(1.0, 0.0, -25.0)]

    def anchors(self, model: dict, motion, scar: np.ndarray) -> dict:
        """Label anchors (model units): points of the skin and of the specimen."""
        tr = self.trunk
        def on(xy, pose="rest"):
            i = int(np.argmin(np.linalg.norm(self.pts - np.asarray(xy), axis=1)))
            return model[pose][i]
        lim = self.limits
        minx, miny, maxx, maxy = lim.bounds
        cx = (minx + maxx) / 2
        out = {
            "centre": on(self.nipple),
            "ellipse": on(self.centre + np.array([0.0, ELLIPSE["b"]])),
            "nac": on(self.nipple),
            "limit-top": on((cx, maxy - 1)),
            "limit-medial": on((minx + 2, 40.0)),
            "limit-bottom": on((cx, np.array(lim.exterior.coords)[:, 1].min() + 2)),
            "limit-lateral": on((maxx - 3, 40.0)),
            "flap-upper": on(self.centre + np.array([0.0, 45.0]), "raised"),
            "flap-lower": on(self.centre + np.array([10.0, -40.0]), "raised"),
            "pectoralis": on(self.centre + np.array([0.0, 30.0]), "bed"),
            "bed": on(self.centre, "bed"),
            "scar": scar[len(scar) // 2],
        }
        fat, _ = bb.mesh("hra_VH_F_fat_L")
        out["specimen"] = fat[np.argmax(fat[:, 2])]
        out["specimen-out"] = motion[-1](out["specimen"][None])[0]
        return {k: r3(np.asarray(v) * MM) for k, v in out.items()}

    def measures(self, model: dict) -> dict:
        """Ellipse on the skin, area of skin taken, specimen volume, thickness of the flaps."""
        tr = self.trunk
        def skin_length(a, b):
            xy = np.linspace(a, b, 200)
            uv = tr.uv(xy[:, 0], xy[:, 1])
            p = tr.ch.to_model(np.c_[uv, tr.sample(tr.skin, uv[:, 0], uv[:, 1])])
            return float(np.linalg.norm(np.diff(p, axis=0), axis=1).sum())
        nrm = np.array([-self.axis[1], self.axis[0]])
        e = ELLIPSE
        spec = self.labels == "specimen"
        tri = self.tri[spec]
        p = model["rest"]
        area = 0.5 * np.linalg.norm(np.cross(p[tri[:, 1]] - p[tri[:, 0]], p[tri[:, 2]] - p[tri[:, 0]]), axis=1).sum()
        volume = bb.mound_volumes(self.s.breast)[0]
        notch = self.s.notch
        return {
            "ellipseLengthMm": round(skin_length(self.centre - e["a"] * self.axis, self.centre + e["a"] * self.axis)),
            "ellipseHeightMm": round(skin_length(self.centre - e["b"] * nrm, self.centre + e["b"] * nrm)),
            "ellipseTiltDeg": e["tilt"], "skinAreaCm2": round(area / 100), "flapMm": FLAP_MM,
            "breastMl": round(volume), "scarMm": round(2 * (e["a"] + SCAR_EXTENSION) * 1.0),
        }


SPECIMEN_MESHES = [
    ("hra_VH_F_fat_L", "Corpo adiposo da mama (peça)", COLORS["fat"], "fat", 7000),
    ("hra_VH_F_mammary_lobes_L", "Lobos mamários (peça)", COLORS["gland"], "gland", 7000),
    ("hra_VH_F_main_lactiferous_ducts_L", "Ductos lactíferos (peça)", COLORS["duct"], "duct", 3000),
    ("hra_VH_F_main_lactiferous_sinuses_L", "Seios lactíferos (peça)", COLORS["duct"], "duct", 1200),
    ("hra_VH_F_suspensory_ligaments_L", "Ligamentos de Cooper (peça)", COLORS["ligament"], "ligament", 4000),
    ("hra_VH_F_areola_L", "Aréola (peça)", COLORS["nac"], "areola", 2500),
    ("hra_VH_F_nipple_L", "Mamilo (peça)", COLORS["nac"], "nipple", 1500),
    ("hra_VH_F_areolar_tubercles_L", "Tubérculos areolares (peça)", COLORS["nac"], "areola", 800),
]


def r3(p) -> list[float]:
    return [round(float(x), 4) for x in np.asarray(p).ravel()[:3]]


# --------------------------------------------------------------------------------------------------
# review renders
# --------------------------------------------------------------------------------------------------
def review(writer: bms.Writer, key: str, out: Path, views: list[tuple[float, float]], centre, half: float = 170.0, skin_alpha: float = 0.35) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    from pilot_mammaplasty import splat

    out.mkdir(parents=True, exist_ok=True)
    trunk_pos, trunk_idx = bb.mesh(bb.SKIN)
    rgb = lambda h: tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))  # noqa: E731
    rows = []
    for k in range(writer.count):
        layers = [(trunk_pos, trunk_idx, rgb(COLORS["skin"]), skin_alpha)]
        for m in writer.meshes:
            alpha = skin_alpha if m["tissue"] == "skin" else 1.0
            layers.append((m["full"][k], m["faces"], rgb(m["color"]), alpha))
        rows.append(np.hstack([splat(layers, yaw, pitch, centre, half=half, size=300, spacing=0.9) for yaw, pitch in views]))
    plt.imsave(out / f"recon-{key}.png", np.vstack(rows))


# --------------------------------------------------------------------------------------------------
# output
# --------------------------------------------------------------------------------------------------
GROUP = "Reconstrução mamária"
# label of every structure of the sequences, by part (structure ids are recon-<part>-<key>)
PART_LABELS = {
    "skin": "Pele da mama (retalhos da mastectomia)", "flap-fat": "Subcutâneo dos retalhos da mastectomia", "specimen-skin": "Pele da elipse com o complexo areolopapilar",
    "specimen": "Peça da mastectomia (mama e fáscia peitoral)", "fascia": "Fáscia peitoral (fora da dissecção)", "marking": "Marcação",
    "limits": "Limites da dissecção", "incision": "Incisão", "scar": "Cicatrizes",
}


def hole_outline(trunk: fg.Trunk, polygon: Polygon, inset: float = 1.5) -> list:
    """Outline (u, v) of a skin patch, `inset` mm inside it: the skin of the trunk gives way there."""
    ring = np.array(polygon.buffer(-inset).simplify(0.3).exterior.coords)
    uv = trunk.uv(ring[:, 0], ring[:, 1])
    return [[round(float(u), 2), round(float(v), 2)] for u, v in uv]


def write_sequences(results: list[dict]) -> None:
    """Writes the binaries of the sequences built and merges them into src/data/reconstructionSteps.json (the
    sequences not built this time are kept as they were)."""
    old = json.loads(OUT_JSON.read_text()) if OUT_JSON.exists() else {"techniques": {}, "structures": {}, "meshes": []}
    techniques, structures, meshes = dict(old["techniques"]), dict(old["structures"]), list(old["meshes"])
    for res in results:
        key, writer, info = res["key"], res["writer"], res["info"]
        out_bin = Path(str(OUT_BIN).format(key=key))
        records, box = writer.write(out_bin)
        digest = hashlib.sha1(out_bin.read_bytes()).hexdigest()[:10]
        techniques[key] = {
            "technique": key, "case": "repouso", "bin": f"models/hybrid/{out_bin.name}?v={digest}", **box,
            "frames": info["frames"], "points": info["points"], "measures": info["measures"], "arrows": info["arrows"],
            "holes": res["holes"], "replaces": res["replaces"], "meshes": records,
        }
        structures = {k: v for k, v in structures.items() if not k.endswith(f"-{key}")}
        meshes = [m for m in meshes if not m["structure"].endswith(f"-{key}")]
        labels = res.get("labels", {})
        for mesh in writer.meshes:
            part = mesh["structure"][len("recon-"): -len(key) - 1]
            structures.setdefault(mesh["structure"], {"label": labels.get(part, PART_LABELS.get(part, mesh["label"])), "group": GROUP, "visible": False,
                                                      "labelAnchor": r3(mesh["full"][0].mean(0) * MM), "meshNames": []})["meshNames"].append(mesh["name"])
            meshes.append({"name": mesh["name"], "structure": mesh["structure"], "tissue": mesh["tissue"], "source": SOURCE, "sourceName": mesh["label"],
                           "license": LICENSE, "triangles": int(len(mesh["faces"])), "color": mesh["color"], "opacity": mesh["opacity"]})
        print(f"   {key}: {box['byteLength'] / 1e3:.0f} kB, {len(writer.meshes)} meshes")
    order = [k for k in ("mastectomia", "grande-dorsal", "tram") if k in techniques]
    first_hole = techniques[order[0]]["holes"][0]["outline"]
    out = {"version": 1, "source": SOURCE, "hole": first_hole, "techniques": {k: techniques[k] for k in order}, "structures": structures, "meshes": meshes}
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"wrote {OUT_JSON.relative_to(bb.ROOT)} ({OUT_JSON.stat().st_size / 1e3:.0f} kB)")


def main() -> None:
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    figures = Path(sys.argv[sys.argv.index("--figures") + 1]) if "--figures" in sys.argv else None
    s = Setup()
    results = []
    mast = Mastectomy(s)
    if only in (None, "mastectomia"):
        writer, info = mast.build()
        print(f"mastectomy: skin {len(mast.pts)} vertices, closure flips {mast.closure_flips}; {info['measures']}")
        if figures is not None:
            review(writer, "mastectomia", figures, [(0, 0), (40, -10)], tuple(s.trunk.ch.to_model(np.array([[110.0, 10.0, 150.0]]))[0]))
        results.append({"key": "mastectomia", "writer": writer, "info": info,
                        "holes": [{"outline": hole_outline(s.trunk, mast.domain), "depth": True}],
                        "replaces": {"structures": ["pectoral-fascia"], "meshes": []}})
    write_sequences(results)


if __name__ == "__main__":
    main()
