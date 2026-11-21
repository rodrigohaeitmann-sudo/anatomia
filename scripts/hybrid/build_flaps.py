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

    def skin_axes(self) -> tuple[float, float]:
        """Half length and half height of the ellipse measured on the skin (mm)."""
        tr = self.trunk

        def skin_length(a, b):
            xy = np.linspace(a, b, 200)
            uv = tr.uv(xy[:, 0], xy[:, 1])
            p = tr.ch.to_model(np.c_[uv, tr.sample(tr.skin, uv[:, 0], uv[:, 1])])
            return float(np.linalg.norm(np.diff(p, axis=0), axis=1).sum())

        nrm = np.array([-self.axis[1], self.axis[0]])
        e = ELLIPSE
        return skin_length(self.centre - e["a"] * self.axis, self.centre + e["a"] * self.axis) / 2, skin_length(self.centre - e["b"] * nrm, self.centre + e["b"] * nrm) / 2

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


# --------------------------------------------------------------------------------------------------
# helpers of the flaps
# --------------------------------------------------------------------------------------------------
def rot2(angle: float) -> np.ndarray:
    c, s = np.cos(angle), np.sin(angle)
    return np.array([[c, -s], [s, c]])


class Placement:
    """Rigid motion of the plane that takes `src` to `dst` turning by `angle` (radians). `at(x, k, gather)` goes a share
    k of the way by turning about the fixed point of the motion (a flap turning on its pedicle), drawn towards that
    point by `gather` (< 1: the flap gathered as it is pulled through a tunnel)."""

    def __init__(self, angle: float, src: np.ndarray, dst: np.ndarray) -> None:
        self.angle = float(angle)
        self.R = rot2(angle)
        self.src, self.dst = np.asarray(src, float), np.asarray(dst, float)
        self.centre = np.linalg.solve(np.eye(2) - self.R, self.dst - self.R @ self.src)

    def __call__(self, xy) -> np.ndarray:
        return self.dst + (np.atleast_2d(xy) - self.src) @ self.R.T

    def inverse(self, xy) -> np.ndarray:
        return self.src + (np.atleast_2d(xy) - self.dst) @ self.R

    def at(self, xy, k: float, gather: float = 1.0) -> np.ndarray:
        return self.centre + gather * (np.atleast_2d(xy) - self.centre) @ rot2(self.angle * k).T


def occupancy(xy: np.ndarray, cell: float = 3.0, close: int = 2) -> Polygon:
    """Region of the plane covered by points (cells of a grid, closed over small gaps), as one polygon."""
    import contourpy
    from scipy.ndimage import binary_closing, binary_fill_holes

    lo = xy.min(0) - 4 * cell
    n = np.ceil((xy.max(0) + 4 * cell - lo) / cell).astype(int) + 1
    grid = np.zeros(tuple(n), bool)
    ij = np.floor((xy - lo) / cell).astype(int)
    grid[ij[:, 0], ij[:, 1]] = True
    grid = binary_fill_holes(binary_closing(grid, iterations=close))
    xs, ys = lo[0] + cell * (np.arange(n[0]) + 0.5), lo[1] + cell * (np.arange(n[1]) + 0.5)
    X, Y = np.meshgrid(xs, ys, indexing="ij")
    lines = contourpy.contour_generator(X, Y, grid.astype(float)).lines(0.5)
    polys = [Polygon(line).buffer(0) for line in lines if len(line) > 3]
    return max(polys, key=lambda g: g.area)


def largest(shape) -> Polygon:
    return max(getattr(shape, "geoms", [shape]), key=lambda g: g.area)


def raster_top(trunk: fg.Trunk, points: np.ndarray, dilate: int = 2) -> np.ndarray:
    """Outermost radius of model points in every cell of the trunk grid (-inf where none), widened by `dilate` cells."""
    from scipy.ndimage import maximum_filter

    q = trunk.chart(points)
    grid = np.full(trunk.skin.shape, -np.inf)
    iu = np.round((q[:, 0] - trunk.us[0]) / fg.CELL).astype(int)
    iv = np.round((q[:, 1] - trunk.vs[0]) / fg.CELL).astype(int)
    ok = (iu >= 0) & (iu < grid.shape[0]) & (iv >= 0) & (iv < grid.shape[1])
    np.maximum.at(grid, (iu[ok], iv[ok]), q[ok, 2])
    return maximum_filter(grid, size=2 * dilate + 1)


def drape(trunk: fg.Trunk, model: np.ndarray, top: np.ndarray, gap: float, movable: np.ndarray) -> np.ndarray:
    """Skin points (model, mm) raised radially over the tissue under them (`top`: raster_top) by `gap`."""
    q = trunk.chart(model)
    under = trunk.sample(np.where(np.isfinite(top), top, -1e6), q[:, 0], q[:, 1], order=0)
    q[:, 2] = np.where(movable, np.maximum(q[:, 2], under + gap), q[:, 2])
    return trunk.ch.to_model(q)


def plane_line_model(trunk: fg.Trunk, xy: np.ndarray, h: np.ndarray | float) -> np.ndarray:
    xy = np.asarray(xy, float)
    return trunk.model(np.c_[xy, np.broadcast_to(np.asarray(h, float), (len(xy),))])


def chart_polygon(trunk: fg.Trunk, mask: np.ndarray) -> Polygon:
    """A mask of the trunk grid as a polygon of the plane."""
    import contourpy

    sig = trunk.sigma
    tau = np.broadcast_to(trunk.vs[None, :], sig.shape)
    lines = contourpy.contour_generator(sig, tau, mask.astype(float)).lines(0.5)
    return largest(unary_union([Polygon(line).buffer(0) for line in lines if len(line) > 3]))


def slab_volume(points: np.ndarray, faces: np.ndarray) -> float:
    """Volume (mL) of a closed mesh (divergence theorem), positive."""
    a, b, c = points[faces[:, 0]], points[faces[:, 1]], points[faces[:, 2]]
    return abs(float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum()) / 6.0) / 1000.0


# --------------------------------------------------------------------------------------------------
# 2. latissimus dorsi myocutaneous flap
# --------------------------------------------------------------------------------------------------
LD = {
    "triangles": 7000,
    # the island: its centre this far from the hilum along this direction of the plane (down the anterior border, over
    # the descending branch); the island is the defect at its true size on the skin, turned back by the placement
    "paddleFromHilum": 97.0, "paddleDirection": (0.45, -0.89),
    "flapMargin": 18.0, "pivotKeep": 95.0,  # the muscle taken: what the placement brings into the pocket, or near the pivot
    "curl": {"alpha": 150.0, "rho": 22.0, "beyondHilum": 28.0},
    "gather": 0.5, "transitLift": 6.0, "liftFree": 5.0,
    "implantMargin": 10.0, "implantSigma": 6.0, "implantOut": 130.0,
    "backLift": 16.0, "spacing": 4.0, "muscleThin": 0.9,
    "tendon": (35.0, 60.0),  # mm from the insertion: the flap does not move nearer, turns fully this much farther
    "underSkin": 4.0,  # mm: the muscle is kept at least this far under the skin
}


class Latissimus:
    KEY = "grande-dorsal"
    FRAMES = [
        ("marcacao", "Marcação"), ("incisao", "Incisão e descolamento"), ("liberacao", "Liberação do músculo"), ("pediculo", "Pedículo toracodorsal"),
        ("tunel:1", "Passagem pelo túnel axilar"), ("tunel:2", "Passagem pelo túnel axilar"), ("tunel", "Passagem pelo túnel axilar"),
        ("doadora", "Fechamento do dorso"), ("implante", "Implante"), ("insercao", "Inserção e modelagem"), ("resultado", "Resultado"),
    ]

    def __init__(self, s: Setup, mast: Mastectomy) -> None:
        self.s, self.mast = s, mast
        tr = self.trunk = s.trunk
        self.k_of = {fid: k for k, (fid, _) in enumerate(self.FRAMES)}
        # the muscle, its plane coordinates and the height of its deep surface under every point
        pos, idx = fg.decimate(*bb.mesh("bp30_FMA13359"), LD["triangles"])
        # the muscle of the male body crosses the female skin in the loin (by up to 8 mm, docs/plano-retalhos-miocutaneos.md):
        # there it is drawn back under the skin
        q = tr.chart(pos)
        excess = np.maximum(q[:, 2] - (tr.sample(tr.skin, q[:, 0], q[:, 1]) - LD["underSkin"]), 0.0)
        near = cKDTree(pos).query_ball_point(pos, 12.0)
        excess = np.array([excess[n].max() for n in near])
        q[:, 2] -= excess
        pos = tr.ch.to_model(q)
        self.pulled_in = float(excess.max())
        self.pos, self.idx = pos, idx
        self.flat = tr.flat(pos)
        # deep and superficial faces of the muscle: by the normal against the radial direction of the chart
        import trimesh

        normals = np.asarray(trimesh.Trimesh(pos, idx, process=False).vertex_normals)
        q = tr.chart(pos)
        theta = q[:, 0] / bb.RREF
        radial = np.c_[-tr.ch.s * np.sin(theta), np.zeros(len(pos)), np.cos(theta)]
        self.superficial = (normals * radial).sum(1) > 0
        deep = ~self.superficial
        self.deep_tree = cKDTree(self.flat[deep, :2])
        self.h_deep = self.flat[deep, 2]
        # pivot: origin of the thoracodorsal artery; hilum of the muscle
        self.O = landmark("thoracodorsalArteryOrigin")
        self.P = tr.flat(self.O[None])[0, :2]
        self.H = tr.flat(bb.layer_landmark("hilo.grande-dorsal")[None])[0, :2]
        # insertion: the end of the tendon at the intertubercular groove of the humerus
        groove = bb.layer_landmark("umero.sulco-intertubercular")
        self.insertion = self.flat[int(np.argmin(np.linalg.norm(pos - groove, axis=1))), :2]
        # placement: the island centre goes to the centre of the defect, turned so that the hilum lands as near the pivot
        # as it can (towards it, on the line from the defect)
        E, ax = mast.centre, mast.axis
        d = np.array(LD["paddleDirection"], float)
        d /= np.linalg.norm(d)
        self.Ic = self.H + LD["paddleFromHilum"] * d
        psi = np.arctan2(*(self.P - E)[::-1]) - np.arctan2(*(self.H - self.Ic)[::-1])
        self.psi = float((psi + np.pi) % (2 * np.pi) - np.pi)
        self.place = Placement(self.psi, self.Ic, E)
        a_s, b_s = mast.skin_axes()
        self.island_axes = (a_s, b_s)
        self.island_angle = np.arctan2(ax[1], ax[0]) - self.psi
        self.island = Polygon(ellipse_points(self.Ic, a_s, b_s, np.degrees(self.island_angle)))
        # the muscle taken: the faces the placement brings into the pocket (or that stay by the pivot)
        target = mast.limits.buffer(LD["flapMargin"]).union(Point(self.place(self.P)[0]).buffer(LD["pivotKeep"]))
        centres = self.flat[idx].mean(1)[:, :2]
        mapped = self.place(centres)
        self.flap_face = shapely.contains_xy(target, mapped[:, 0], mapped[:, 1])
        self.footprint = occupancy(self.flat[:, :2], 3.0)
        back_target = Polygon(self.place.inverse(np.array(target.exterior.coords)))
        self.cut_line = back_target.exterior.intersection(self.footprint.buffer(-1.0))
        # the muscle taken: plane points and their heights over its deep surface
        fpos, fidx, used = fg.compact(pos, idx, self.flap_face)
        self.flap_pos, self.flap_idx, self.flap_used = fpos, fidx, used
        rpos, ridx, _ = fg.compact(pos, idx, ~self.flap_face)
        self.remnant = (rpos, ridx)
        self.muscle_top = self.top_field(self.flat[used])
        self.mesh_back()
        self.mesh_island()
        self.design_implant()

    # ---- fields --------------------------------------------------------------------------------------
    def deep_at(self, xy: np.ndarray) -> np.ndarray:
        """Height of the deep surface of the muscle (in the bed, before it moves) at points of the plane."""
        d, i = self.deep_tree.query(np.atleast_2d(xy), k=6)
        w = 1.0 / np.maximum(d, 0.5) ** 2
        return (self.h_deep[i] * w).sum(1) / w.sum(1)

    def top_field(self, flat: np.ndarray):
        """Height of the outer surface of the muscle over the plane (its superficial vertices)."""
        sup = self.superficial[self.flap_used] if len(flat) == len(self.flap_used) else np.ones(len(flat), bool)
        return cKDTree(flat[sup, :2]), flat[sup, 2]

    def muscle_top_at(self, xy: np.ndarray) -> np.ndarray:
        tree, top = self.muscle_top
        d, i = tree.query(np.atleast_2d(xy), k=6)
        w = 1.0 / np.maximum(d, 0.5) ** 2
        return (top[i] * w).sum(1) / w.sum(1)

    # ---- skin of the back ------------------------------------------------------------------------------
    def mesh_back(self) -> None:
        tr = self.trunk
        skin_region = tr.skin_region(SKIRT + 4.0)
        undermined = largest(self.footprint.buffer(6.0).union(self.island.buffer(4.0)).intersection(skin_region))
        self.undermined = undermined.buffer(-4).buffer(4).simplify(0.3)
        self.back_domain = largest(self.undermined.buffer(SKIRT).intersection(tr.skin_region(2.0))).simplify(0.3)
        pts, tri = fg.chart_mesh(self.back_domain, [self.island.exterior, self.undermined.exterior], LD["spacing"])
        labels = fg.label_faces(pts, tri, [("island", self.island), ("back", self.undermined), ("skirt", None)])
        uv = tr.uv(pts[:, 0], pts[:, 1])
        guess = tr.sample(tr.skin, uv[:, 0], uv[:, 1])
        r = fg.ray_skin(tr, *self.s.skin_mesh, uv, guess=guess) + LIFT
        self.back = {"pts": pts, "tri": tri, "labels": labels, "uv": uv, "r": r, "h": r - tr.sample(tr.wall, uv[:, 0], uv[:, 1])}

    def mesh_island(self) -> None:
        """Skin of the island (the island faces of the back skin) and the fat under it, down to the muscle."""
        b = self.back
        faces = b["labels"] == "island"
        ipts, itri, used = fg.compact(b["pts"], b["tri"], faces)
        top = b["h"][used]
        self.island_skin = {"pts": ipts, "tri": itri, "h": top}
        spts, frac, sfaces = fg.slab(ipts, itri)
        muscle = self.muscle_top_at(spts)
        h = np.where(frac > 0, np.r_[top, top][: len(spts)] - 0.4, np.minimum(muscle + 0.3, np.r_[top, top][: len(spts)] - 3.0))
        self.island_fat = {"pts": spts, "tri": sfaces, "h": h, "frac": frac}

    # ---- implant ----------------------------------------------------------------------------------------
    def design_implant(self) -> None:
        """The implant fills what the envelope of the breast leaves under its cover: the muscle and the flaps (or the
        island) over it. Base: the footprint of the breast, LD.implantMargin inside."""
        tr, mast = self.trunk, self.mast
        br = self.s.breast
        mask = np.zeros(tr.skin.shape, bool)
        iu = np.round((br.ch.us - tr.us[0]) / fg.CELL).astype(int)
        iv = np.round((br.ch.vs - tr.vs[0]) / fg.CELL).astype(int)
        ok_u, ok_v = (iu >= 0) & (iu < mask.shape[0]), (iv >= 0) & (iv < mask.shape[1])
        sub = br.footprint[np.ix_(ok_u, ok_v)]
        mask[np.ix_(iu[ok_u], iv[ok_v])] = sub
        base = chart_polygon(tr, mask).buffer(-LD["implantMargin"]).simplify(0.5)
        self.implant_base = base
        sup = self.flat[self.flap_used][self.superficial[self.flap_used]]
        thick = float(np.median(np.clip(sup[:, 2] - self.deep_at(sup[:, :2]), 0.0, 20.0)))
        self.muscle_mm = float(np.clip(thick, 4.0, 12.0))
        island_mm = float(np.median(self.island_fat["h"][self.island_fat["frac"] > 0] - self.island_fat["h"][self.island_fat["frac"] == 0]))
        self.island_mm = island_mm
        pts, tri = fg.chart_mesh(base, [], 4.0)
        uv = tr.uv(pts[:, 0], pts[:, 1])
        room = tr.sample(tr.skin, uv[:, 0], uv[:, 1]) - tr.sample(tr.wall, uv[:, 0], uv[:, 1])
        in_defect = shapely.contains_xy(mast.ellipse, pts[:, 0], pts[:, 1])
        cover = self.muscle_mm + np.where(in_defect, island_mm, FLAP_MM)
        edge = shapely.distance(base.exterior, shapely.points(pts[:, 0], pts[:, 1]))
        top = np.maximum(room - cover, 0.0) * smooth01(edge / 18.0)
        # a smooth dome: the thickness smoothed over the triangulation (a few rounds of neighbour averaging)
        nb = [[] for _ in range(len(pts))]
        for a_, b_, c_ in tri:
            nb[a_] += [b_, c_]
            nb[b_] += [a_, c_]
            nb[c_] += [a_, b_]
        for _ in range(int(LD["implantSigma"])):
            top = np.array([0.5 * top[i] + 0.5 * np.mean(top[n]) for i, n in enumerate(nb)]) * (edge > 0.5)
        spts, frac, sfaces = fg.slab(pts, tri)
        h = np.where(frac > 0, 0.6 + np.r_[top, top], 0.6)
        self.implant = {"pts": spts, "tri": sfaces, "h": h, "top": top, "basePts": pts}

    def implant_height(self, xy: np.ndarray) -> np.ndarray:
        """Thickness of the implant under points of the plane (0 outside its base)."""
        imp = self.implant
        tree = cKDTree(imp["basePts"])
        d, i = tree.query(np.atleast_2d(xy), k=4)
        w = 1.0 / np.maximum(d, 0.5)
        t = (imp["top"][i] * w).sum(1) / w.sum(1)
        inside = shapely.contains_xy(self.implant_base, xy[:, 0], xy[:, 1])
        return np.where(inside, t, 0.0)

    # ---- poses of the flap (muscle, island, vessels on it) --------------------------------------------------
    def curl_frame(self):
        a = np.asarray(self.flat[self.flap_used][:, :2].mean(0) - self.P, float)
        a /= np.linalg.norm(a)
        hinge = self.H + LD["curl"]["beyondHilum"] * a
        return hinge, a, np.array([-a[1], a[0]])

    def pose(self, flat: np.ndarray, frame: str, kind: str = "muscle", frac: np.ndarray | None = None) -> np.ndarray:
        """Plane coordinates (sigma, tau, h) of flap points at a frame (see _pose). The tendon stays at the humerus: near
        the insertion the flap keeps its place, and the muscle turns about it farther away (LD.tendon)."""
        out = self._pose(flat, frame, kind, frac)
        if self.k_of[frame] <= self.k_of["incisao"]:
            return out
        a, b = LD["tendon"]
        w = smooth01((np.linalg.norm(flat[:, :2] - self.insertion, axis=1) - a) / b)[:, None]
        return flat + w * (out - flat)

    def _pose(self, flat: np.ndarray, frame: str, kind: str = "muscle", frac: np.ndarray | None = None) -> np.ndarray:
        """Plane coordinates (sigma, tau, h) of flap points at a frame. kind: "muscle" (with the vessels on it: they
        keep their height over the deep surface of the muscle) or "island" (its skin and fat: their thickness over the
        muscle, smoothed, so that the bumps of the wall of the back do not come with them) - the final frames shape them
        into the breast."""
        tr = self.trunk
        xy, h = flat[:, :2].copy(), flat[:, 2].copy()
        base = self.deep_at(xy)
        rel = np.clip(h - base, 0.0, None if kind == "island" else 16.0)
        if kind == "island":
            near = cKDTree(xy).query_ball_point(xy, 14.0)
            rel = np.array([rel[n].mean() for n in near])
        k = self.k_of[frame]
        dist_p = np.linalg.norm(xy - self.P, axis=1)
        free = smooth01((dist_p - 40.0) / 80.0)
        if k <= self.k_of["incisao"]:
            return flat.copy()
        if frame == "liberacao":
            return np.c_[xy, base + rel + LD["liftFree"] * free]
        # the roll (pedicle): about a line across the muscle beyond the hilum, the far part turned over towards the pivot
        hinge, a, t = self.curl_frame()
        delta = (xy - hinge) @ a
        along = (xy - hinge) @ t
        transit = {"pediculo": 0.0, "tunel:1": 1 / 3, "tunel:2": 2 / 3}
        if frame in transit or frame == "tunel":
            kk = transit.get(frame, 1.0)
            alpha = np.radians(LD["curl"]["alpha"]) * (1 - kk) ** 1.5
            base_h = self.deep_at(hinge[None] + along[:, None] * t[None])
            d2, r2 = fg.curl(delta, rel + LD["liftFree"] * free, alpha, LD["curl"]["rho"])
            rolled = delta > 0
            xc = np.where(rolled[:, None], hinge + d2[:, None] * a + along[:, None] * t, xy)
            hc = np.where(rolled, base_h + r2, base + rel + LD["liftFree"] * free)
            if frame == "pediculo":
                return np.c_[xc, hc]
            gather = 1 - (1 - LD["gather"]) * np.sin(np.pi * kk)
            xk = self.place.at(xc, kk, gather)
            hk = hc - kk * self.deep_at(xc) + LD["transitLift"] * np.sin(np.pi * kk)
            # under the skin outside the pocket (the tunnel); in the pocket the skin flaps go over it
            outside = ~shapely.contains_xy(self.mast.limits.buffer(6.0), xk[:, 0], xk[:, 1])
            if kk < 1:
                limit = tr.skin_height(xk[:, 0], xk[:, 1]) - 2.0
                hk = np.where(outside, np.minimum(hk, limit), hk)
            return np.c_[xk, np.maximum(hk, 0.3)]
        front = self.place(xy)
        if frame == "doadora":
            return np.c_[front, np.maximum(rel, 0.3)]
        if frame == "implante":
            return np.c_[front, self.implant_height(front) + np.maximum(rel, 0.3)]
        # inset and result: the flap shaped into the pocket over the implant (molding), the island in the defect
        mxy = self.mold(front)
        lift = self.implant_height(mxy)
        muscle_top = lift + self.muscle_mm * LD["muscleThin"]
        if kind == "island":
            # the island: its skin on the envelope of the breast, its fat between that and the muscle
            u = tr.u_of(mxy[:, 0], mxy[:, 1])
            envelope = tr.sample(tr.skin, u, mxy[:, 1]) + LIFT - tr.sample(tr.wall, u, mxy[:, 1])
            f = np.ones(len(xy)) if frac is None else frac
            top = envelope - (0.0 if frac is None else 0.4)
            return np.c_[mxy, muscle_top + 0.3 + f * np.maximum(top - muscle_top - 0.3, 0.0)]
        return np.c_[mxy, lift + np.maximum(rel, 0.3) * LD["muscleThin"]]

    def prepare_mold(self) -> None:
        """Thin plate offsets that shape the placed flap: the island onto the defect (it is larger in the plane, being
        the size of the defect on the curved skin), the outline of the flap into the pocket."""
        mast = self.mast
        ring = np.array(self.island.exterior.coords)[:-1]
        placed = self.place(ring)
        ax = mast.axis
        nrm = np.array([-ax[1], ax[0]])
        local = np.c_[(placed - mast.centre) @ ax, (placed - mast.centre) @ nrm]
        a_s, b_s = self.island_axes
        scaled = local * np.array([ELLIPSE["a"] / a_s, ELLIPSE["b"] / b_s])
        target_island = mast.centre + scaled[:, :1] * ax + scaled[:, 1:] * nrm
        flap_xy = self.place(self.flat[self.flap_used][:, :2])
        outline = occupancy(flap_xy, 3.0)
        border = np.array(shapely.segmentize(outline.exterior, 8.0).coords)[:-1]
        pocket = mast.limits.buffer(-4.0)
        keep_p = np.linalg.norm(border - self.place(self.P)[0], axis=1) < LD["pivotKeep"]
        inside = shapely.contains_xy(pocket, border[:, 0], border[:, 1])
        target_border = border.copy()
        for i in np.nonzero(~inside & ~keep_p)[0]:
            q = pocket.exterior.interpolate(pocket.exterior.project(Point(border[i])))
            target_border[i] = [q.x, q.y]
        fixed = np.r_[placed, border]
        offsets = np.r_[target_island - placed, target_border - border]
        self.mold_fixed, self.mold_offsets = fixed, offsets

    def mold(self, xy: np.ndarray) -> np.ndarray:
        return xy + fg.harmonic_offsets(np.atleast_2d(xy), self.mold_fixed, self.mold_offsets, smoothing=2.0)

    # ---- back skin poses --------------------------------------------------------------------------------
    def back_frames(self) -> dict:
        tr, b = self.trunk, self.back
        pts, region = b["pts"], np.full(len(b["pts"]), "skirt", dtype=object)
        for name in ("back", "island"):
            region[np.unique(b["tri"][b["labels"] == name])] = name
        rest = np.c_[pts, b["h"]]
        # raised: the undermined skin held off the muscle, most near the island
        edge = shapely.distance(self.undermined.exterior, shapely.points(pts[:, 0], pts[:, 1]))
        to_island = shapely.distance(self.island.exterior, shapely.points(pts[:, 0], pts[:, 1]))
        bump = smooth01(edge / 40.0) * (0.35 + 0.65 * smooth01(1 - to_island / 110.0))
        raised = rest.copy()
        raised[:, 2] += np.where(region == "back", LD["backLift"] * bump, 0.0)
        # closed: the edges of the island meet on its axis; the skin comes down where the muscle was taken
        keep = b["labels"] != "island"
        tri = b["tri"][keep]
        used = np.unique(tri)
        on_island = np.array([self.island.exterior.distance(Point(q)) < 0.01 for q in pts])
        on_outline = np.array([self.back_domain.exterior.distance(Point(q)) < 0.01 for q in pts])
        ax = np.array([np.cos(self.island_angle), np.sin(self.island_angle)])
        a_s = self.island_axes[0]
        target = pts.copy()
        x = np.clip(((pts[on_island] - self.Ic) @ ax) / a_s, -1, 1)
        target[on_island] = self.Ic + ((a_s + SCAR_EXTENSION) * x)[:, None] * ax
        fixed = on_island | on_outline
        index = -np.ones(len(pts), int)
        index[used] = np.arange(len(used))
        geom = np.c_[pts, np.zeros(len(pts))]
        closed_xy = pts.copy()
        solved = mr.mean_value_solve(geom[used], index[tri], fixed[used], target[used])
        closed_xy[used] = untangle(solved, index[tri], fixed[used], pts[used])
        self.back_flips = signed_area_flips(closed_xy, tri, pts)
        # where the muscle was taken the skin lies on the serratus and the ribs: lower by its mean thickness, with a
        # smooth way in from the edge of the part taken
        flap_region = occupancy(self.flat[self.flap_used][:, :2], 3.0).buffer(-4.0).simplify(1.0)
        inside = shapely.contains_xy(flap_region, closed_xy[:, 0], closed_xy[:, 1])
        depth_in = shapely.distance(flap_region.exterior, shapely.points(closed_xy[:, 0], closed_xy[:, 1]))
        taken = np.where(inside & (region != "skirt"), 0.6 * self.muscle_mm * smooth01(depth_in / 25.0), 0.0)
        uv2 = tr.uv(closed_xy[:, 0], closed_xy[:, 1])
        r2 = tr.sample(tr.skin, uv2[:, 0], uv2[:, 1]) + LIFT - taken
        closed = np.c_[closed_xy, r2 - tr.sample(tr.wall, uv2[:, 0], uv2[:, 1])]
        closed[region == "skirt"] = rest[region == "skirt"]
        return {"rest": rest, "raised": raised, "closed": closed, "region": region}

    # ---- vessels and nerve of the pedicle ------------------------------------------------------------------
    def branch_paths(self) -> dict:
        """Intramuscular branches (schematic, Tobin 1981): the descending branch about 2 cm inside the anterior border,
        the transverse branch along the upper border; plane polylines from the hilum, kept on the muscle taken."""
        H = self.H
        border = self.mast_border_at
        taus = np.linspace(self.H[1], self.H[1] - 175.0, 60)
        desc = np.c_[border(taus) + 22.0, taus]
        desc[0] = H
        desc = fg.smooth_polyline(np.r_[[H], desc[3:]], 3.0)
        tip = np.array([H[0] + 75.0, H[1] - 12.0])
        trans = np.c_[np.linspace(H[0], tip[0], 30), np.linspace(H[1], tip[1], 30) - 6.0 * np.sin(np.linspace(0, np.pi, 30))]
        region = occupancy(self.flat[self.flap_used][:, :2], 3.0).buffer(-4.0)

        def clip(path):
            inside = shapely.contains_xy(region, path[:, 0], path[:, 1])
            stop = np.argmin(inside[1:]) + 1 if not inside[1:].all() else len(path)
            return path[:max(stop, 2)]

        return {"descending": clip(desc), "transverse": clip(trans)}

    def mast_border_at(self, taus) -> np.ndarray:
        """Anterior border of the latissimus (sigma) at heights of the plane."""
        if not hasattr(self, "_border"):
            grid = np.arange(-300.0, 130.0, 2.0)
            vals = []
            for t in grid:
                sel = np.abs(self.flat[:, 1] - t) < 4.0
                vals.append(self.flat[sel, 0].min() if sel.any() else np.nan)
            vals = np.array(vals)
            ok = ~np.isnan(vals)
            self._border = (grid[ok], gaussian_filter(vals[ok], 2.0))
        g, v = self._border
        return np.interp(np.atleast_1d(np.asarray(taus, float)), g, v)

    def vessel_frames(self, frames: list[str]) -> dict:
        """Tubes of the thoracodorsal artery, vein and nerve, of the serratus branch and of the intramuscular branches at
        every frame; the free part of the pedicle is a curve of its own length from its origin (fixed) to the hilum."""
        tr = self.trunk
        art, aidx = bb.mesh("bp43_FJ2253")
        c_art, _ = fg.centerline(art, aidx, 2.0, start=self.O)
        c_art = fg.smooth_polyline(c_art, 2.0)
        L = fg.polyline_length(c_art)
        self.pedicle_mm = L
        paths = self.branch_paths()
        hilum3 = c_art[-1]
        hilum_flat = tr.flat(hilum3[None])
        d0 = fg.tangent_at(c_art, 0)
        # the nerve: from its origin to its own hilum, then with the descending branch
        nerve0 = np.array([-75.2, 90.6, -79.8])
        nh = bb.layer_landmark("hilo.nervo-toracodorsal")
        nh_flat = tr.flat(nh[None])
        nerve_rest = fg.smooth_polyline(np.r_[np.linspace(nerve0, nh, 20)], 1.0)
        Ln = fg.polyline_length(nerve_rest) * 1.15
        out = {key: [] for key in ("artery", "vein", "nerve", "nerve-cut", "serratus", "serratus-cut")}
        stretch = []
        serr_pos, serr_idx = bb.mesh("bp43_FJ1459M")
        branch_point = c_art[int(0.45 * len(c_art))]
        serratus_end = serr_pos[np.argmin(np.linalg.norm(serr_pos - (branch_point + np.array([8.0, -28.0, 22.0])), axis=1))]
        for frame in frames:
            def on_muscle(xy, offset=0.0):
                flat = np.c_[xy, self.deep_at(xy) + 0.8 + offset]
                return tr.model(self.pose(flat, frame))
            desc = on_muscle(paths["descending"])
            trans = on_muscle(paths["transverse"])
            h_pt = tr.model(self.pose(hilum_flat, frame))[0]
            d1 = fg.tangent_at(desc, 0)
            # the curve arrives at the hilum going along the descending branch (into the muscle)
            curve, st = fg.pedicle_curve(c_art[0], d0, h_pt, d1, L, 46)
            stretch.append(st)
            artery = [np.r_[curve, desc[1:]], np.r_[curve[-1:], trans[1:]]]
            off = np.array([0.0, 0.0, 3.2])
            vein = [p + off for p in artery]
            n_hilum = tr.model(self.pose(nh_flat, frame))[0]
            n_desc = on_muscle(paths["descending"] + np.array([-5.0, 0.0]), 0.3)
            n_curve, _ = fg.pedicle_curve(nerve0, fg.tangent_at(nerve_rest, 0), n_hilum, fg.tangent_at(n_desc, 0), Ln, 30)
            nerve = [np.r_[n_curve, n_desc[1:]]]
            cut = int(0.55 * len(n_curve))
            nerve_cut = [n_curve[: cut - 2], np.r_[n_curve[cut + 2:], n_desc[1:]]]
            k = int(0.45 * len(curve))
            serratus = [np.linspace(curve[k], serratus_end, 14)]
            serratus_cut = [np.linspace(curve[k], curve[k] + 0.3 * (serratus_end - curve[k]), 6), np.linspace(curve[k] + 0.7 * (serratus_end - curve[k]), serratus_end, 6)]
            out["artery"].append(artery)
            out["vein"].append(vein)
            out["nerve"].append(nerve)
            out["nerve-cut"].append(nerve_cut)
            out["serratus"].append(serratus)
            out["serratus-cut"].append(serratus_cut)
        self.stretch = stretch
        return out

    # ---- the sequence -------------------------------------------------------------------------------------------
    def build(self) -> tuple[bms.Writer, dict]:
        tr, mast = self.trunk, self.mast
        frames = [f for f, _ in self.FRAMES]
        n = len(frames)
        k_of = self.k_of
        key = self.KEY
        sid = lambda part: f"recon-{part}-{key}"  # noqa: E731
        self.prepare_mold()
        writer = bms.Writer(n)
        # muscle taken (the flap) and the part that stays on the back
        mflat = self.flat[self.flap_used]
        muscle = [tr.model(self.pose(mflat, f)) for f in frames]
        writer.add("recon_ld_muscle", sid("muscle"), "Grande dorsal (retalho)", COLORS["muscle"], 1.0, "muscle", self.flap_idx, muscle)
        rpos, ridx = self.remnant
        writer.add("recon_ld_remnant", sid("remnant"), "Grande dorsal (parte que fica no dorso)", COLORS["muscle-cut"], 1.0, "muscle", ridx, [rpos] * n)
        # the island: its skin and its fat, with the flap
        isk = self.island_skin
        iflat = np.c_[isk["pts"], isk["h"]]
        island = [tr.model(iflat if k <= k_of["incisao"] else self.pose(iflat, f, "island")) for k, f in enumerate(frames)]
        writer.add("recon_ld_island", sid("island"), "Ilha cutânea do dorso", COLORS["skin"], 1.0, "skin", isk["tri"], island)
        ifat = self.island_fat
        fflat = np.c_[ifat["pts"], ifat["h"]]
        island_fat = [tr.model(fflat if k <= k_of["incisao"] else self.pose(fflat, f, "island", ifat["frac"])) for k, f in enumerate(frames)]
        writer.add("recon_ld_island_fat", sid("island-fat"), "Gordura sob a ilha", COLORS["fat"], 1.0, "fat", ifat["tri"], island_fat)
        # skin of the back
        bk = self.back_frames()
        b = self.back
        keep = b["labels"] != "island"
        back_pose = ["rest", "raised", "raised", "raised", "raised", "raised", "raised", "closed", "closed", "closed", "closed"]
        back_model = {name: tr.model(bk[name]) for name in ("rest", "raised", "closed")}
        writer.add("recon_ld_back_skin", sid("back-skin"), "Pele do dorso", COLORS["skin"], 1.0, "skin", b["tri"][keep], [back_model[p] for p in back_pose])
        # implant: held in front of the chest until it goes in
        imp = self.implant
        iflat_imp = np.c_[imp["pts"], imp["h"]]
        outside = iflat_imp.copy()
        outside[:, 2] += LD["implantOut"]
        imp_frames = [tr.model(outside if k < k_of["implante"] else iflat_imp) for k in range(n)]
        writer.add("recon_ld_implant", sid("implant"), "Implante", COLORS["implant"], 1.0, "implant", imp["tri"], imp_frames)
        # skin of the breast (the flaps of the mastectomy): on the bed, then over the flap and the implant, then the envelope
        sk = mast.skin_frames()
        mkeep = mast.labels != "specimen"
        bed = tr.model(sk["bed"])
        envelope = tr.model(sk["rest"])
        movable = sk["region"] != "skirt"
        breast = []
        for k, f in enumerate(frames):
            if k <= k_of["pediculo"]:
                breast.append(bed)
            elif k <= k_of["implante"]:
                tissue = [muscle[k], island_fat[k]] + ([imp_frames[k]] if k >= k_of["implante"] else [])
                top = raster_top(tr, np.vstack(tissue))
                breast.append(drape(tr, bed, top, FLAP_MM, movable))
            else:
                breast.append(envelope)
        writer.add("recon_ld_breast_skin", sid("skin"), "Pele da mama (retalhos da mastectomia)", COLORS["skin"], 1.0, "skin", mast.tri[mkeep], breast)
        # vessels and nerve
        vf = self.vessel_frames(frames)
        for part, label, color, tissue, radius in (
            ("artery", "Artéria toracodorsal e ramos", COLORS["artery"], "artery", 1.5),
            ("vein", "Veias toracodorsais", COLORS["vein"], "vein", 1.9),
            ("nerve", "Nervo toracodorsal", COLORS["nerve"], "nerve", 1.2),
            ("nerve-cut", "Nervo toracodorsal seccionado", COLORS["nerve"], "nerve", 1.2),
            ("serratus", "Ramo do serrátil", COLORS["artery"], "artery", 1.0),
            ("serratus-cut", "Ramo do serrátil ligado", COLORS["artery-cut"], "artery", 1.0),
        ):
            tf, faces = tube_frames(vf[part], radius)
            writer.add(f"recon_ld_{part.replace('-', '_')}", sid(part), label, color, 1.0, tissue, faces, tf)
        # marking on the back: the island, the anterior border and the line where the muscle is divided; on the front, the defect
        back_r = lambda u, v: tr.sample(tr.skin, u, v)  # noqa: E731
        ring = np.array(self.island.exterior.coords)
        island_line = surface_line(tr, ring, back_r)
        tf, faces = tube_frames([[island_line]] * n, 0.75)
        writer.add("recon_ld_island_marking", sid("marking"), "Ilha cutânea (marcação)", COLORS["marking"], 1.0, "marking", faces, tf)
        tf, faces = tube_frames([[island_line]] * n, 0.55)
        writer.add("recon_ld_incision", sid("incision"), "Incisão da ilha", COLORS["incision"], 1.0, "marking", faces, tf)
        taus = np.linspace(self.H[1] + 60.0, -230.0, 80)
        border_xy = np.c_[self.mast_border_at(taus), taus]
        border_xy = border_xy[~np.isnan(border_xy[:, 0])]
        lines = [bms.dashes(surface_line(tr, border_xy, back_r, step=1.0), on=6.0, off=4.0)]
        cut = self.cut_line
        cut_lines = [np.array(g.coords) for g in getattr(cut, "geoms", [cut]) if g.geom_type == "LineString" and g.length > 20]
        dashed = sum(lines, []) + sum([bms.dashes(surface_line(tr, c, back_r, step=1.0), on=6.0, off=4.0) for c in cut_lines], [])
        tf, faces = tube_frames([dashed] * n, 0.6)
        writer.add("recon_ld_limits", sid("limits"), "Borda anterior e linha de secção do músculo", COLORS["limit"], 1.0, "marking", faces, tf)
        # the tunnel: from the top of the back wound, high through the axilla, to the lateral end of the defect
        top_island = self.Ic + self.island_axes[0] * np.array([np.cos(self.island_angle), np.sin(self.island_angle)])
        lateral_end = mast.ends[1]
        via = self.P + np.array([-6.0, -38.0])
        tunnel_xy = np.array([top_island, via, lateral_end])
        tunnel_xy = np.array(LineString(tunnel_xy).coords)
        dense = np.array([LineString(tunnel_xy).interpolate(t, normalized=True).coords[0] for t in np.linspace(0, 1, 60)])
        tunnel = bms.dashes(surface_line(tr, fg.smooth_polyline(dense, 4.0), back_r, step=1.0, lift=1.0), on=5.0, off=3.0)
        tf, faces = tube_frames([tunnel] * n, 0.7)
        writer.add("recon_ld_tunnel", sid("tunnel"), "Túnel subcutâneo axilar", "#7c3aed", 1.0, "marking", faces, tf)
        # scars: the back (closed along the axis of the island) and round the island on the breast
        ax = np.array([np.cos(self.island_angle), np.sin(self.island_angle)])
        a_s = self.island_axes[0]
        scar_xy = np.linspace(self.Ic - (a_s + SCAR_EXTENSION) * ax, self.Ic + (a_s + SCAR_EXTENSION) * ax, 120)
        closed_r = lambda u, v: tr.sample(tr.skin, u, v) + LIFT  # noqa: E731
        back_scar = surface_line(tr, scar_xy, closed_r, step=1.5, lift=0.4)
        tf, faces = tube_frames([[back_scar]] * n, 0.9)
        writer.add("recon_ld_back_scar", sid("scar"), "Cicatriz do dorso", COLORS["scar"], 1.0, "marking", faces, tf)
        defect = surface_line(tr, np.array(mast.ellipse.exterior.coords), closed_r, step=1.5, lift=0.5)
        tf, faces = tube_frames([[defect]] * n, 0.8)
        writer.add("recon_ld_island_scar", sid("island-scar"), "Cicatriz em volta da ilha", COLORS["scar"], 1.0, "marking", faces, tf)
        points = self.anchors(muscle, island, back_model, breast, vf, imp_frames, back_scar, defect, tunnel)
        values = self.measures(muscle, imp_frames)
        start, end = np.array(points["island-back"]) / MM, np.array(points["island-front"]) / MM
        arrows = [{"frame": k_of["tunel:1"], "from": r3(start * MM), "to": r3(end * MM), "color": "#7c3aed"}]
        info = {"frames": [{"id": f, "label": label} for f, label in self.FRAMES], "points": points, "measures": values, "arrows": arrows}
        return writer, info

    def anchors(self, muscle, island, back, breast, vf, implant, back_scar, defect, tunnel) -> dict:
        k = self.k_of
        tr = self.trunk
        flap = self.flat[self.flap_used]

        def nearest(points, target):
            return points[int(np.argmin(np.linalg.norm(points - target, axis=1)))]

        centre_back = tr.model(np.c_[[self.Ic], [0.0]])[0]
        island_c = island[0].mean(0)
        out = {
            "centre": island[0][int(np.argmin(np.linalg.norm(island[0] - island_c, axis=1)))],
            "front-centre": defect.mean(0),
            "island-back": nearest(island[0], island_c),
            "island-front": nearest(island[k["insercao"]], island[k["insercao"]].mean(0)),
            "hilum": nearest(muscle[0], bb.layer_landmark("hilo.grande-dorsal")),
            "hilum-pediculo": vf["artery"][k["pediculo"]][0][45],
            "origin": vf["artery"][0][0][0],
            "serratus-branch": vf["serratus"][0][0][7],
            "serratus-cut": vf["serratus-cut"][k["pediculo"]][0][-1],
            "nerve-cut": vf["nerve-cut"][k["pediculo"]][0][-1],
            "remnant": self.remnant[0][int(np.argmin(np.linalg.norm(self.remnant[0] - self.remnant[0].mean(0), axis=1)))],
            "flap-pediculo": muscle[k["pediculo"]][int(np.argmax(tr.chart(muscle[k["pediculo"]])[:, 2]))],
            "flap-front": nearest(muscle[k["tunel"]], muscle[k["tunel"]].mean(0)),
            "flap-inset": nearest(muscle[k["insercao"]], muscle[k["insercao"]].mean(0)),
            "implant": nearest(implant[k["implante"]], implant[k["implante"]].mean(0) + np.array([0.0, 0.0, 30.0])),
            "back-scar": back_scar[len(back_scar) // 2],
            "front-scar": defect[len(defect) // 3],
            "tunnel": tunnel[len(tunnel) // 2][len(tunnel[len(tunnel) // 2]) // 2],
            "border": nearest(back["rest"], tr.model(np.c_[[[self.mast_border_at(-60.0)[0], -60.0]], [0.0]])[0]),
            "pedicle-front": vf["artery"][k["insercao"]][0][23],
            "back-centre": centre_back,
        }
        return {name: r3(np.asarray(v) * MM) for name, v in out.items()}

    def measures(self, muscle, implant) -> dict:
        import trimesh

        k = self.k_of
        tr = self.trunk
        area = trimesh.Trimesh(self.flap_pos, self.flap_idx, process=False).area / 2 / 100
        imp = self.implant
        vol = slab_volume(tr.model(np.c_[imp["pts"], imp["h"]]), imp["tri"])
        a_s, b_s = self.island_axes
        return {
            "islandLengthMm": round(2 * a_s), "islandWidthMm": round(2 * b_s), "rotationDeg": round(abs(np.degrees(self.psi))),
            "pedicleMm": round(self.pedicle_mm), "maxStretch": round(float(max(self.stretch)), 3),
            "muscleAreaCm2": round(area), "muscleMl": round(area * self.muscle_mm / 10), "muscleMm": round(self.muscle_mm, 1),
            "implantMl": round(vol), "islandFatMm": round(self.island_mm), "backScarMm": round(2 * (a_s + SCAR_EXTENSION)),
            "takenPct": round(100 * float(self.flap_face.mean())),
        }


# --------------------------------------------------------------------------------------------------
# 3. pedicled TRAM flap (ipsilateral)
# --------------------------------------------------------------------------------------------------
TRAM = {
    "triangles": 6000,
    "aboveUmbilicus": 15.0,  # upper edge of the island of the abdomen above the umbilicus (mm)
    "height": 135.0,  # its height at the midline (mm), at most down to the suprapubic crease
    "tipAboveAsis": 12.0,  # the lateral tips this far above the anterior superior iliac spines
    "umbilicusR": 13.0,  # the skin round the umbilicus that stays on its stalk
    "pivotTau": -45.0,  # where the superior epigastric vessels go into the rectus (costal margin), height in the plane
    "cutBelow": 8.0,  # the rectus is divided this far below the lower edge of the island
    "zoneBorder": 112.0,  # the lateral borders of the recti (semilunar lines) in the plane (sigma, both sides)
    "keep": 35.0,  # zone III kept this far past the border of zone I: its tip is trimmed with zone IV
    "gather": 0.5, "upperRaise": 24.0, "upperTop": -95.0, "spacing": 5.0, "transitLift": 12.0,
    "discard": np.array([-170.0, -60.0]),  # where trimmed tissue is laid (plane offset) and how high (mm)
}
ZONE_COLORS = {"zone-1": COLORS["zone-1"], "zone-2": COLORS["zone-2"], "zone-3": COLORS["zone-3"], "zone-4": COLORS["zone-4"], "zone-3-tip": "#b45309"}


def hermite2(p0, d0, p1, d1, length: float, n: int = 60) -> np.ndarray:
    """Plane Hermite curve from p0 (heading d0) to p1 (heading d1) of the given length (tangents scaled; taut if the
    chord is longer)."""
    t = np.linspace(0, 1, n)[:, None]
    h00, h10, h01, h11 = 2 * t**3 - 3 * t**2 + 1, t**3 - 2 * t**2 + t, -2 * t**3 + 3 * t**2, t**3 - t**2
    p0, p1, d0, d1 = (np.asarray(x, float) for x in (p0, p1, d0, d1))

    def curve(k):
        return h00 * p0 + h10 * k * d0 + h01 * p1 + h11 * k * d1

    lo, hi = 0.0, 6.0 * max(length, 1.0)
    if fg.polyline_length(curve(lo)) >= length:
        return curve(lo)
    for _ in range(50):
        mid = (lo + hi) / 2
        if fg.polyline_length(curve(mid)) < length:
            lo = mid
        else:
            hi = mid
    return curve(lo)


class Tram:
    KEY = "tram"
    FRAMES = [
        ("marcacao", "Marcação"), ("incisao", "Incisões e descolamento"), ("ilha", "Elevação da ilha"), ("bainha", "Bainha e vasos inferiores"),
        ("musculo", "Elevação do reto"), ("tunel:1", "Túnel epigástrico"), ("tunel:2", "Túnel epigástrico"), ("tunel", "Rotação de 180°"),
        ("insercao", "Inserção e modelagem"), ("doadora", "Fechamento do abdome"), ("resultado", "Resultado"),
    ]

    def __init__(self, s: Setup, mast: Mastectomy) -> None:
        self.s, self.mast = s, mast
        tr = self.trunk = s.trunk
        self.k_of = {fid: k for k, (fid, _) in enumerate(self.FRAMES)}
        T = TRAM
        # landmarks of the abdomen in the plane
        us, vs = tr.us, tr.vs
        iu, iv = (us > -30) & (us < 30), (vs > -240) & (vs < -170)
        sub = tr.skin[np.ix_(iu, iv)]
        i, j = np.unravel_index(np.argmin(sub), sub.shape)
        nav_uv = np.array([us[iu][i], vs[iv][j]])
        self.navel = np.array([tr.sigma_of(*nav_uv)[0], nav_uv[1]])
        asis = tr.flat(bb.layer_landmark("quadril.eias")[None])[0, :2]
        pubis = tr.flat(bb.mesh("bp43_FJ3288")[0][[np.argmin(np.abs(tr.chart(bb.mesh("bp43_FJ3288")[0])[:, 0]))]])[0, :2]
        self.asis, self.pubis = asis, pubis
        top = self.navel[1] + T["aboveUmbilicus"]
        bottom = max(top - T["height"], pubis[1] + 22.0)
        tip = asis[1] + T["tipAboveAsis"]
        sa = abs(asis[0])
        sig = np.linspace(-sa, sa, 121)
        shape = (1 - (sig / sa) ** 2) ** 0.55
        upper = np.c_[sig, tip + (top - tip) * shape]
        lower = np.c_[sig[::-1], (tip - (tip - bottom) * shape)[::-1]]
        self.lens = Polygon(np.r_[upper, lower]).buffer(0).simplify(0.2)
        self.top, self.bottom, self.tip, self.half_width = top, bottom, tip, sa
        # zones (Hartrampf): I over the rectus of the pedicle (operated side, sigma > 0), II over the other rectus,
        # III and IV lateral to them; zone IV and the tips of II and III are trimmed
        zb = T["zoneBorder"]
        k3 = T["keep"]
        band = lambda a, b: Polygon([(a, -600), (b, -600), (b, 200), (a, 200)])  # noqa: E731
        self.zones = {
            "zone-1": largest(self.lens.intersection(band(0.0, zb))),
            "zone-2": largest(self.lens.intersection(band(-zb, 0.0))),
            "zone-3": largest(self.lens.intersection(band(zb, zb + k3))),
            "zone-3-tip": largest(self.lens.intersection(band(zb + k3, 900.0))),
            "zone-4": largest(self.lens.intersection(band(-900.0, -zb))),
        }
        self.kept = unary_union([self.zones[z] for z in ("zone-1", "zone-2", "zone-3")])
        # the rectus of the pedicle, its deep surface, and the superior epigastric pivot
        pos, idx = fg.decimate(*fg.flap_mesh("za_Rectus_abdominis_musclel"), T["triangles"])
        self.r_pos, self.r_idx = pos, idx
        self.r_flat = tr.flat(pos)
        import trimesh

        normals = np.asarray(trimesh.Trimesh(pos, idx, process=False).vertex_normals)
        q = tr.chart(pos)
        theta = q[:, 0] / bb.RREF
        radial = np.c_[-tr.ch.s * np.sin(theta), np.zeros(len(pos)), np.cos(theta)]
        deep = (normals * radial).sum(1) <= 0
        self.deep_tree = cKDTree(self.r_flat[deep, :2])
        self.h_deep = self.r_flat[deep, 2]
        rect_xy = self.r_flat[:, :2]
        self.rect_mid = float(np.median(rect_xy[np.abs(rect_xy[:, 1] - self.navel[1]) < 30, 0]))
        sea = tr.flat(fg.flap_mesh("bp43_FJ1971")[0])
        near = np.abs(sea[:, 1] - T["pivotTau"]) < 6
        self.pivot = np.array([float(sea[near, 0].mean()), T["pivotTau"]])
        self.tau_cut = bottom - T["cutBelow"]
        self.rect_region = occupancy(rect_xy, 3.0)
        # the inset island: the defect at its true size, in zone I, turned by the 180 degree transposition
        E, ax = mast.centre, mast.axis
        self.Ic = np.array([self.rect_mid - 10.0, (top + bottom) / 2 - 4.0])
        self.place = Placement(-np.pi, self.Ic, E)
        a_s, b_s = mast.skin_axes()
        self.island_axes = (a_s, b_s)
        self.island_angle = np.arctan2(ax[1], ax[0]) + np.pi
        self.island = Polygon(ellipse_points(self.Ic, a_s, b_s, np.degrees(self.island_angle))).intersection(self.lens.buffer(-3.0))
        self.carrier_len = self.pivot[1] - (top - 2.0)
        self.mesh_abdomen()
        self.mesh_flap()

    # ---- fields --------------------------------------------------------------------------------------------
    def rect_deep(self, xy: np.ndarray) -> np.ndarray:
        """Height of the deep surface of the rectus of the pedicle at points of the plane (0 out of the muscle)."""
        d, i = self.deep_tree.query(np.atleast_2d(xy), k=6)
        w = 1.0 / np.maximum(d, 0.5) ** 2
        h = (self.h_deep[i] * w).sum(1) / w.sum(1)
        inside = shapely.contains_xy(self.rect_region, xy[:, 0], xy[:, 1])
        return np.where(inside, np.minimum(h, 0.0), 0.0)

    # ---- skin of the abdomen ------------------------------------------------------------------------------------
    def mesh_abdomen(self) -> None:
        tr, T = self.trunk, TRAM
        sa = self.half_width
        bottom_line = np.array([[-sa - 34, self.tip - 8], [-sa, self.tip - 18], [0.0, self.pubis[1] - 12.0], [sa, self.tip - 18], [sa + 34, self.tip - 8]])
        outline = np.r_[[[-sa - 34, T["upperTop"]]], bottom_line, [[sa + 34, T["upperTop"]]]]
        region = Polygon(outline).buffer(0).intersection(tr.skin_region(4.0))
        self.abd_domain = largest(region).buffer(-6).buffer(6).simplify(0.3)
        # the upper flap: from the island up to the top of the patch (the costal margin)
        self.upper = Polygon(np.r_[[[-sa - 20, T["upperTop"] - 2]], np.array(self.lens.exterior.coords)[np.array(self.lens.exterior.coords)[:, 1] >= self.tip - 1], [[sa + 20, T["upperTop"] - 2]]]).buffer(0)
        self.upper = largest(self.upper.difference(self.lens).intersection(self.abd_domain.buffer(-SKIRT)))
        self.navel_disc = Point(self.navel).buffer(T["umbilicusR"])
        lines = [self.lens.exterior, self.navel_disc.exterior, self.island.exterior, self.upper.exterior]
        for z in ("zone-1", "zone-2", "zone-3"):
            lines.append(self.zones[z].exterior)
        pts, tri = fg.chart_mesh(self.abd_domain, lines, T["spacing"])
        regions = [("navel", self.navel_disc), ("island", self.island)] + [(z, self.zones[z]) for z in ("zone-1", "zone-2", "zone-3", "zone-3-tip", "zone-4")] + [("upper", self.upper), ("skin", None)]
        labels = fg.label_faces(pts, tri, regions)
        uv = tr.uv(pts[:, 0], pts[:, 1])
        guess = tr.sample(tr.skin, uv[:, 0], uv[:, 1])
        pos = np.vstack([self.s.skin_mesh[0], self.s.lower_skin[0]])
        idx = np.vstack([self.s.skin_mesh[1], self.s.lower_skin[1] + len(self.s.skin_mesh[0])])
        r = fg.ray_skin(tr, pos, idx, uv, guess=guess) + LIFT
        self.abd = {"pts": pts, "tri": tri, "labels": labels, "uv": uv, "r": r, "h": r - tr.sample(tr.wall, uv[:, 0], uv[:, 1])}

    def mesh_flap(self) -> None:
        """Fat of the flap by zones (closed slabs from the fascia to under the skin) and the base of every point."""
        a = self.abd
        self.slabs = {}
        for z in ("zone-1", "zone-2", "zone-3", "zone-3-tip", "zone-4"):
            faces = a["labels"] == z
            if z == "zone-1":
                faces |= a["labels"] == "island"
            if not faces.any():
                continue
            zp, zt, used = fg.compact(a["pts"], a["tri"], faces)
            spts, frac, sfaces = fg.slab(zp, zt)
            skin_h = np.r_[a["h"][used], a["h"][used]]
            h = np.where(frac > 0, skin_h - 0.5, 0.5)
            self.slabs[z] = {"pts": spts, "tri": sfaces, "h": h}

    # ---- poses ------------------------------------------------------------------------------------------------
    def flap_xy(self, xy: np.ndarray, frame: str) -> tuple[np.ndarray, float]:
        """Plane position of flap points at a frame and the turn of the flap (radians)."""
        k = self.k_of[frame]
        if k < self.k_of["tunel:1"]:
            return xy.copy(), 0.0
        kk = {"tunel:1": 1 / 3, "tunel:2": 2 / 3}.get(frame, 1.0)
        gather = 1 - (1 - TRAM["gather"]) * np.sin(np.pi * kk)
        return self.place.at(xy, kk, gather), -np.pi * kk

    def pose_flap(self, flat: np.ndarray, frame: str, base: np.ndarray | None = None, thick: np.ndarray | None = None) -> np.ndarray:
        """Flap points (fat, skin, the rectus under the island, the vessels in it): lifted off the wall as they are
        raised, turned through the tunnel, shaped into the breast."""
        tr = self.trunk
        xy, h = flat[:, :2], flat[:, 2]
        k = self.k_of[frame]
        base = self.rect_deep(xy) if base is None else base
        rel = h - base
        if k <= self.k_of["incisao"]:
            return flat.copy()
        lift = {"ilha": 4.0, "bainha": 6.0, "musculo": 14.0}.get(frame, 0.0)
        if k <= self.k_of["musculo"]:
            return np.c_[xy, h + lift]
        xk, turn = self.flap_xy(xy, frame)
        if frame in ("tunel:1", "tunel:2"):
            kk = 1 / 3 if frame == "tunel:1" else 2 / 3
            return np.c_[xk, rel + TRAM["transitLift"] * np.sin(np.pi * kk)]
        if frame == "tunel":
            return np.c_[xk, rel + 1.0]
        # inset, closure, result: shaped into the breast by fractions of the thickness
        mxy = self.mold(xk)
        u = tr.u_of(mxy[:, 0], mxy[:, 1])
        envelope = tr.sample(tr.skin, u, mxy[:, 1]) + LIFT - tr.sample(tr.wall, u, mxy[:, 1])
        in_defect = shapely.contains_xy(self.mast.ellipse.buffer(1.0), mxy[:, 0], mxy[:, 1])
        top = envelope - np.where(in_defect, 0.0, FLAP_MM)
        total = self.thickness_at(xy) if thick is None else thick
        f = np.clip(rel / np.maximum(total, 1.0), 0.0, 1.0)
        return np.c_[mxy, 0.4 + f * np.maximum(top - 0.4, 0.0)]

    def thickness_at(self, xy: np.ndarray) -> np.ndarray:
        """Thickness of the flap (skin to the deep surface of the muscle, or to the fascia) at points of the plane."""
        tr = self.trunk
        u = tr.u_of(xy[:, 0], xy[:, 1])
        return tr.sample(tr.skin, u, xy[:, 1]) - tr.sample(tr.wall, u, xy[:, 1]) - self.rect_deep(xy)

    def prepare_mold(self) -> None:
        mast = self.mast
        ring = np.array(self.island.exterior.coords)[:-1]
        placed = self.place(ring)
        ax = mast.axis
        nrm = np.array([-ax[1], ax[0]])
        local = np.c_[(placed - mast.centre) @ ax, (placed - mast.centre) @ nrm]
        a_s, b_s = self.island_axes
        scaled = local * np.array([ELLIPSE["a"] / a_s, ELLIPSE["b"] / b_s])
        target_island = mast.centre + scaled[:, :1] * ax + scaled[:, 1:] * nrm
        kept = largest(self.kept)
        border = np.array(shapely.segmentize(LineString(self.place(np.array(kept.exterior.coords))), 8.0).coords)[:-1]
        pocket = largest(mast.limits.buffer(-6.0).intersection(self.s.trunk.skin_region(0.0)))
        inside = shapely.contains_xy(pocket, border[:, 0], border[:, 1])
        target_border = border.copy()
        for i in np.nonzero(~inside)[0]:
            q = pocket.exterior.interpolate(pocket.exterior.project(Point(border[i])))
            target_border[i] = [q.x, q.y]
        self.mold_fixed = np.r_[placed, border]
        self.mold_offsets = np.r_[target_island - placed, target_border - border]

    def mold(self, xy: np.ndarray) -> np.ndarray:
        return xy + fg.harmonic_offsets(np.atleast_2d(xy), self.mold_fixed, self.mold_offsets, smoothing=2.0)

    def pose_rectus(self, flat: np.ndarray, frame: str) -> np.ndarray:
        """The rectus of the pedicle and the vessels on it: fixed above the pivot (the costal margin), a band of its own
        length from the pivot to the flap (the carrier, which folds on itself when the flap turns), with the flap below."""
        tr, T = self.trunk, TRAM
        xy, h = flat[:, :2], flat[:, 2]
        k = self.k_of[frame]
        out = flat.copy()
        if k <= self.k_of["bainha"]:
            return out
        p0, top = self.pivot, self.top - 2.0
        carrier = (xy[:, 1] <= p0[1]) & (xy[:, 1] > top)
        below = (xy[:, 1] <= top) & (xy[:, 1] > self.tau_cut)
        deep = self.rect_deep(xy)
        rel = h - deep
        if below.any():
            fb = flat[below]
            out[below] = self.pose_flap(fb, frame, base=deep[below], thick=self.thickness_at(fb[:, :2]))
        if carrier.any():
            # the carrier: its centre line from the pivot (heading down) to where it enters the flap
            entry_rest = np.array([[self.rect_mid, top]])
            if frame == "musculo":
                end, heading = entry_rest[0], np.array([0.0, -1.0])
            else:
                end, turn = self.flap_xy(entry_rest, frame)
                end = end[0]
                heading = rot2(turn) @ np.array([0.0, -1.0])
            start = np.array([self.rect_mid, p0[1]])
            curve = hermite2(start, [0.0, -1.0], end, heading, self.carrier_len, 80)
            seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(curve, axis=0), axis=1))]
            t = (p0[1] - xy[carrier, 1]) / (p0[1] - top)
            sarc = t * seg[-1]
            cpt = np.stack([np.interp(sarc, seg, curve[:, c]) for c in range(2)], 1)
            tang = np.stack([np.interp(sarc, seg, np.gradient(curve[:, c])) for c in range(2)], 1)
            tang /= np.maximum(np.linalg.norm(tang, axis=1, keepdims=True), 1e-9)
            normal = np.c_[-tang[:, 1], tang[:, 0]]
            across = xy[carrier, 0] - self.rect_mid
            pos = cpt + across[:, None] * normal
            lifted = smooth01(t / 0.15)
            hh = (1 - lifted) * h[carrier] + lifted * (rel[carrier] + 3.0)
            if frame == "musculo":
                pos = xy[carrier]
                hh = h[carrier] + 10.0 * smooth01(t / 0.3) - deep[carrier] * smooth01(t / 0.3)
            out[carrier] = np.c_[pos, hh]
        return out

    # ---- skin of the abdomen: raised upper flap and the closure ---------------------------------------------------
    def abdomen_frames(self) -> dict:
        tr, a = self.trunk, self.abd
        pts = a["pts"]
        region = np.full(len(pts), "skin", dtype=object)
        for name in ("upper", "navel"):
            region[np.unique(a["tri"][a["labels"] == name])] = name
        rest = np.c_[pts, a["h"]]
        # the upper flap held up as it is undermined: each column turns about the top of the patch
        raised = rest.copy()
        sel = region == "upper"
        x = rest[sel]
        tau_h = TRAM["upperTop"]
        h_h = tr.skin_height(x[:, 0], np.full(len(x), tau_h)) + LIFT
        delta, dh = tau_h - x[:, 1], x[:, 2] - h_h
        w = smooth01((self.half_width - np.abs(x[:, 0])) / 50.0)
        ang = np.radians(TRAM["upperRaise"]) * w
        d2 = delta * np.cos(ang) - dh * np.sin(ang)
        raised[sel, 1] = tau_h - d2
        raised[sel, 2] = h_h + delta * np.sin(ang) + dh * np.cos(ang)
        # the closure (abdominoplasty): every column of the upper flap is stretched down so that the upper edge of the
        # island meets its lower edge, the top of the flap staying (monotonic: no triangle turns over); beside the tips
        # nothing moves
        sa = self.half_width
        x = pts[:, 0]
        shape = (1 - np.clip(x / sa, -1, 1) ** 2) ** 0.55
        upper_edge = self.tip + (self.top - self.tip) * shape
        lower_edge = self.tip - (self.tip - self.bottom) * shape
        hinge = TRAM["upperTop"]
        ratio = (hinge - lower_edge) / np.maximum(hinge - upper_edge, 1.0)
        closed_xy = pts.copy()
        sel = (region == "upper") | ((region == "skin") & (pts[:, 1] > upper_edge - 0.5) & (np.abs(x) < sa))
        closed_xy[sel, 1] = hinge - (hinge - pts[sel, 1]) * ratio[sel]
        keep = np.isin(a["labels"], ["skin", "upper", "navel"])
        self.closure_flips = signed_area_flips(closed_xy, a["tri"][keep], pts)
        uv2 = tr.uv(closed_xy[:, 0], closed_xy[:, 1])
        r2 = tr.sample(tr.skin, uv2[:, 0], uv2[:, 1]) + LIFT
        closed = np.c_[closed_xy, r2 - tr.sample(tr.wall, uv2[:, 0], uv2[:, 1])]
        static = ~sel
        closed[static] = rest[static]
        return {"rest": rest, "raised": raised, "closed": closed, "region": region}

    # ---- the sequence -------------------------------------------------------------------------------------------
    def build(self) -> tuple[bms.Writer, dict]:
        tr, mast, T = self.trunk, self.mast, TRAM
        frames = [f for f, _ in self.FRAMES]
        n = len(frames)
        k_of = self.k_of
        key = self.KEY
        sid = lambda part: f"recon-{part}-{key}"  # noqa: E731
        self.prepare_mold()
        writer = bms.Writer(n)
        a = self.abd
        discard = lambda flat: np.c_[flat[:, :2] + T["discard"], flat[:, 2] + 70.0]  # noqa: E731

        def flap_frames(flat, discard_at=None):
            base = self.rect_deep(flat[:, :2])
            thick = self.thickness_at(flat[:, :2])
            out = []
            for k, f in enumerate(frames):
                if discard_at is not None and k >= k_of[discard_at]:
                    out.append(tr.model(discard(flat)))
                else:
                    out.append(tr.model(self.pose_flap(flat, f, base=base, thick=thick)))
            return out

        # skin of the abdomen round the island (the upper flap moves); the part of it that comes over the umbilicus
        ab = self.abdomen_frames()
        keep = np.isin(a["labels"], ["skin", "upper", "navel"])
        ab_model = {p: tr.model(ab[p]) for p in ("rest", "raised", "closed")}
        pose_ab = ["rest", "raised", "raised", "raised", "raised", "raised", "raised", "raised", "raised", "closed", "closed"]
        cx = ab["closed"][:, :2]
        centre = cx[a["tri"]].mean(1)
        window = keep & (a["labels"] == "upper") & shapely.contains_xy(self.navel_disc.buffer(1.0), centre[:, 0], centre[:, 1])
        writer.add("recon_tram_abdomen_skin", sid("abdomen-skin"), "Pele do abdome", COLORS["skin"], 1.0, "skin", a["tri"][keep & ~window], [ab_model[p] for p in pose_ab])
        writer.add("recon_tram_abdomen_window", sid("abdomen-window"), "Pele do abdome (sobre o umbigo)", COLORS["skin"], 1.0, "skin", a["tri"][window], [ab_model[p] for p in pose_ab])
        # skin of the island of the abdomen: the inset island, the rest of the kept zones (de-epithelialised), the trimmed
        flat_rest = np.c_[a["pts"], a["h"]]
        for name, labels, discard_at, label in (
            ("island", ["island"], None, "Ilha cutânea (fica como pele)"),
            ("flap-skin", ["zone-1", "zone-2", "zone-3"], None, "Pele do retalho (desepitelizada na inserção)"),
            ("discard-skin", ["zone-4"], "ilha", "Pele da zona IV (descartada)"),
            ("tip-skin", ["zone-3-tip"], "insercao", "Pele da ponta da zona III (descartada)"),
        ):
            faces = np.isin(a["labels"], labels)
            if not faces.any():
                continue
            fp, ft, used = fg.compact(np.arange(len(a["pts"]))[:, None].astype(float), a["tri"], faces)
            writer.add(f"recon_tram_{name.replace('-', '_')}", sid(name), label, COLORS["skin"], 1.0, "skin", ft, flap_frames(flat_rest[used], discard_at))
        # fat of the flap by zones
        for z, slab_ in self.slabs.items():
            discard_at = "ilha" if z == "zone-4" else "insercao" if z == "zone-3-tip" else None
            label = {"zone-1": "Zona I (sobre o reto do pedículo)", "zone-2": "Zona II (além da linha média)", "zone-3": "Zona III (lateral ao pedículo)",
                     "zone-3-tip": "Ponta da zona III (descartada)", "zone-4": "Zona IV (descartada)"}[z]
            writer.add(f"recon_tram_{z.replace('-', '_')}", sid(z), label, ZONE_COLORS[z], 1.0, "fat", slab_["tri"], flap_frames(np.c_[slab_["pts"], slab_["h"]], discard_at))
        # the rectus of the pedicle (and what stays of it below the cut), the vessels on it
        rc = self.r_flat[self.r_idx].mean(1)[:, 1]
        moving = rc > self.tau_cut
        mp, mi, mused = fg.compact(self.r_pos, self.r_idx, moving)
        mflat = self.r_flat[mused]
        writer.add("recon_tram_rectus", sid("rectus"), "Reto do abdome (pedículo)", COLORS["muscle"], 1.0, "muscle", mi, [tr.model(self.pose_rectus(mflat, f)) for f in frames])
        sp, si, _ = fg.compact(self.r_pos, self.r_idx, ~moving)
        writer.add("recon_tram_rectus_stays", sid("rectus-stays"), "Reto do abdome (abaixo da secção)", COLORS["muscle-cut"], 1.0, "muscle", si, [sp] * n)
        for name, label, color, tissue in (("bp43_FJ1971", "Artéria epigástrica superior", COLORS["artery"], "artery"), ("bp43_FJ3530", "Veia epigástrica superior", COLORS["vein"], "vein")):
            vp, vi = fg.flap_mesh(name)
            writer.add(f"recon_tram_{name}", sid("superior-epigastric"), label, color, 1.0, tissue, vi, [tr.model(self.pose_rectus(tr.flat(vp), f)) for f in frames])
        for name, label, color, tissue in (("bp43_FJ3511", "Artéria epigástrica inferior profunda", COLORS["artery"], "artery"), ("bp43_FJ3512", "Veia epigástrica inferior profunda", COLORS["vein"], "vein")):
            vp, vi = fg.flap_mesh(name)
            vf = tr.flat(vp)
            up = vf[vi].mean(1)[:, 1] > self.tau_cut
            up_p, up_i, up_used = fg.compact(vp, vi, up)
            writer.add(f"recon_tram_{name}_flap", sid("inferior-epigastric"), label + " (no retalho)", color, 1.0, tissue, up_i, [tr.model(self.pose_rectus(vf[up_used], f)) for f in frames])
            lo_p, lo_i, _ = fg.compact(vp, vi, ~up)
            writer.add(f"recon_tram_{name}_stays", sid("inferior-epigastric-stays"), label + " (ligada)", COLORS["artery-cut"] if tissue == "artery" else color, 1.0, tissue, lo_i, [lo_p] * n)
        # perforators of the periumbilical rows (schematic): from the deep surface of the rectus to under the skin
        perf_lines = []
        for sx in (self.rect_mid - 30.0, self.rect_mid + 12.0):
            for dy in (-14.0, -38.0, -62.0):
                xy = np.array([[sx, self.navel[1] + dy]])
                hb = self.rect_deep(xy)[0] + 2.0
                ht = tr.skin_height(xy[:, 0], xy[:, 1])[0] - 6.0
                perf_lines.append(np.c_[np.repeat(xy, 12, 0), np.linspace(hb, ht, 12)])
        perf = []
        for f in frames:
            perf.append([tr.model(self.pose_flap(line, f, base=np.full(12, self.rect_deep(line[:1, :2])[0]), thick=np.full(12, self.thickness_at(line[:1, :2])[0]))) for line in perf_lines])
        tf, faces = tube_frames(perf, 0.9)
        writer.add("recon_tram_perforators", sid("perforators"), "Perfurantes periumbilicais (esquema)", COLORS["artery"], 1.0, "artery", faces, tf)
        # anterior sheath of the rectus (schematic): the strip round the perforators goes with the flap; the rest stays,
        # is opened over the muscle and closed at the end
        self.add_sheath(writer, frames, sid)
        # static context of the abdominal wall
        for name, part, label, tissue in (
            ("za_Rectus_abdominis_muscler", "contra-rectus", "Reto do abdome do outro lado", "muscle"),
            ("za_Linea_alba", "linea-alba", "Linha alba", "fascia"),
            ("za_Pyramidalis_musclel", "pyramidalis", "Piramidais", "muscle"),
            ("za_Pyramidalis_muscler", "pyramidalis", "Piramidais", "muscle"),
            ("bp43_FJ1452M", "external-oblique", "Oblíquo externo", "muscle"),
            ("za_External_abdominal_oblique_muscler", "external-oblique", "Oblíquo externo do outro lado", "muscle"),
            ("bp43_FJ3152", "pelvis", "Osso do quadril do outro lado", "bone"),
            ("bp43_FJ7211", "inguinal", "Ligamento inguinal", "ligament"),
            ("bp43_FJ7307", "inguinal", "Ligamento inguinal", "ligament"),
            ("bp43_FJ3466", "iliac", "Artéria ilíaca externa", "artery"),
            ("bp43_FJ3484", "iliac", "Veia ilíaca externa", "vein"),
            ("bp43_FJ3604", "contra-epigastric", "Epigástricas do outro lado", "artery"),
            ("bp43_FJ3605", "contra-epigastric", "Epigástricas do outro lado", "vein"),
            ("bp43_FJ1936", "contra-epigastric", "Epigástricas do outro lado", "artery"),
            ("bp43_FJ3615", "contra-epigastric", "Epigástricas do outro lado", "vein"),
        ):
            vp, vi = fg.flap_mesh(name)
            if tissue in ("muscle", "bone") and len(vi) > 5000:
                vp, vi = fg.decimate(vp, vi, 5000)
            color = {"muscle": COLORS["muscle"], "fascia": "#e5e7eb", "bone": "#e8e2d0", "ligament": "#f1e6c8", "artery": COLORS["artery"], "vein": COLORS["vein"]}[tissue]
            writer.add(f"recon_tram_{name}", sid(part), label, color, 1.0, tissue, vi, [vp] * n)
        # skin of the breast (the flaps of the mastectomy): on the bed until the flap comes, over it, then the envelope
        sk = mast.skin_frames()
        mkeep = mast.labels != "specimen"
        bed, envelope = tr.model(sk["bed"]), tr.model(sk["rest"])
        movable = sk["region"] != "skirt"
        fat_meshes = [m for m in writer.meshes if m["structure"] in (sid("zone-1"), sid("zone-2"), sid("zone-3"))]
        breast = []
        for k, f in enumerate(frames):
            if k < k_of["tunel"]:
                breast.append(bed)
            elif k == k_of["tunel"]:
                top = raster_top(tr, np.vstack([m["full"][k] for m in fat_meshes]))
                breast.append(drape(tr, bed, top, FLAP_MM, movable))
            else:
                breast.append(envelope)
        writer.add("recon_tram_breast_skin", sid("skin"), "Pele da mama (retalhos da mastectomia)", COLORS["skin"], 1.0, "skin", mast.tri[mkeep], breast)
        self.add_markings(writer, n, sid, ab_model)
        points = self.anchors(writer, ab_model)
        values = self.measures(writer)
        start, end = np.array(points["zone-1"]) / MM, np.array(points["island-front"]) / MM
        arrows = [{"frame": k_of["tunel:1"], "from": r3(start * MM), "to": r3(end * MM), "color": "#7c3aed"}]
        info = {"frames": [{"id": f, "label": label} for f, label in self.FRAMES], "points": points, "measures": values, "arrows": arrows}
        return writer, info

    def add_sheath(self, writer, frames, sid) -> None:
        tr = self.trunk
        n = len(frames)
        k_of = self.k_of
        x0, x1 = 10.0, TRAM["zoneBorder"] + 4.0
        sheet = Polygon([(x0, self.pivot[1]), (x1, self.pivot[1]), (x1, self.tau_cut - 4.0), (x0, self.tau_cut - 4.0)])
        s0, s1 = self.rect_mid - 34.0, self.rect_mid + 30.0
        strip = Polygon([(s0, self.top - 6.0), (s1, self.top - 6.0), (s1, self.bottom + 6.0), (s0, self.bottom + 6.0)])
        cut = LineString([(self.rect_mid - 2.0, self.pivot[1] - 4.0), (self.rect_mid - 2.0, self.top - 6.0)])
        pts, tri = fg.chart_mesh(sheet, [strip.exterior, cut], 4.0)
        labels = fg.label_faces(pts, tri, [("strip", strip), ("sheet", None)])
        h = 0.8
        flat = np.c_[pts, np.full(len(pts), h)]
        # the strip with the flap
        sp, st, used = fg.compact(np.arange(len(pts))[:, None].astype(float), tri, labels == "strip")
        base = np.zeros(len(used))
        thick = self.thickness_at(pts[used])
        writer.add("recon_tram_sheath_strip", sid("sheath-strip"), "Faixa da bainha anterior (vai com o retalho)", COLORS["sheath"], 1.0, "fascia",
                   st, [tr.model(self.pose_flap(flat[used], f, base=base, thick=thick)) for f in frames])
        # the rest: opened over the muscle (each side drawn aside), closed at the end over the gap
        rp, rt, rused = fg.compact(np.arange(len(pts))[:, None].astype(float), tri, labels == "sheet")
        r = flat[rused]
        medial = r[:, 0] < self.rect_mid - 2.0
        mid = (s0 + s1) / 2
        opened = r.copy()
        above = r[:, 1] > self.top - 6.0
        opened[:, 0] += np.where(above, np.where(medial, -14.0, 14.0) * smooth01((self.pivot[1] - 6.0 - r[:, 1]) / 20.0), 0.0)
        closed = r.copy()
        gap_side = (r[:, 1] <= self.top - 6.0) & (r[:, 1] >= self.bottom + 6.0)
        closed[:, 0] = np.where(gap_side & medial, x0 + (r[:, 0] - x0) * (mid - x0) / max(s0 - x0, 1.0), closed[:, 0])
        closed[:, 0] = np.where(gap_side & ~medial, x1 - (x1 - r[:, 0]) * (x1 - mid) / max(x1 - s1, 1.0), closed[:, 0])
        poses = [r if k < k_of["bainha"] else opened if k < k_of["doadora"] else closed for k in range(n)]
        writer.add("recon_tram_sheath", sid("sheath"), "Bainha anterior do reto", COLORS["sheath"], 1.0, "fascia", rt, [tr.model(p) for p in poses])
        # the sheath sutured (or a mesh): a line where its edges meet
        line = np.c_[np.full(40, mid), np.linspace(self.top - 6.0, self.bottom + 6.0, 40), np.full(40, h + 0.6)]
        tf, faces = tube_frames([[tr.model(line)]] * n, 0.8)
        writer.add("recon_tram_sheath_suture", sid("sheath-suture"), "Sutura da bainha anterior", COLORS["suture"], 1.0, "marking", faces, tf)

    def add_markings(self, writer, n, sid, ab_model) -> None:
        tr, mast = self.trunk, self.mast
        rest_r = lambda u, v: tr.sample(tr.skin, u, v)  # noqa: E731
        lens = surface_line(tr, np.array(self.lens.exterior.coords), rest_r)
        navel = surface_line(tr, np.array(self.navel_disc.exterior.coords), rest_r)
        tf, faces = tube_frames([[lens, navel]] * n, 0.75)
        writer.add("recon_tram_marking", sid("marking"), "Ilha do abdome e umbigo (marcação)", COLORS["marking"], 1.0, "marking", faces, tf)
        tf, faces = tube_frames([[lens, navel]] * n, 0.55)
        writer.add("recon_tram_incision", sid("incision"), "Incisões", COLORS["incision"], 1.0, "marking", faces, tf)
        zone_lines = []
        for x in (0.0, -TRAM["zoneBorder"], TRAM["zoneBorder"]):
            cut = self.lens.intersection(LineString([(x, -600), (x, 200)]))
            if cut.length > 1:
                zone_lines += bms.dashes(surface_line(tr, np.array(cut.coords), rest_r, step=1.0), on=5.0, off=3.0)
        island = surface_line(tr, np.array(self.island.exterior.coords), rest_r, lift=0.8)
        tf, faces = tube_frames([zone_lines + bms.dashes(island, on=4.0, off=2.5)] * n, 0.6)
        writer.add("recon_tram_zones", sid("zones"), "Zonas de Hartrampf e ilha da inserção", COLORS["limit"], 1.0, "marking", faces, tf)
        # the epigastric tunnel: from the island up over the costal margin to the lower medial corner of the pocket
        lower_medial = np.array(mast.limits.exterior.coords)
        target = lower_medial[np.argmin(lower_medial[:, 1] + 0.3 * lower_medial[:, 0])]
        path = np.array([[self.rect_mid - 20.0, self.top + 4.0], [self.pivot[0] + 10.0, -70.0], target])
        dense = np.array([LineString(path).interpolate(t, normalized=True).coords[0] for t in np.linspace(0, 1, 50)])
        tunnel = bms.dashes(surface_line(tr, fg.smooth_polyline(dense, 3.0), rest_r, step=1.0, lift=1.0), on=5.0, off=3.0)
        tf, faces = tube_frames([tunnel] * n, 0.7)
        writer.add("recon_tram_tunnel", sid("tunnel"), "Túnel epigástrico", "#7c3aed", 1.0, "marking", faces, tf)
        self.tunnel_line = tunnel
        # scars: the lower abdomen and round the umbilicus, round the island on the breast
        closed_r = lambda u, v: tr.sample(tr.skin, u, v) + LIFT  # noqa: E731
        sa = self.half_width
        sig = np.linspace(-sa + 2, sa - 2, 140)
        low = np.c_[sig, self.tip - (self.tip - self.bottom) * (1 - (sig / sa) ** 2) ** 0.55]
        abd_scar = surface_line(tr, low, closed_r, step=1.5, lift=0.5)
        navel_scar = surface_line(tr, np.array(self.navel_disc.exterior.coords), closed_r, step=1.0, lift=0.5)
        defect = surface_line(tr, np.array(mast.ellipse.exterior.coords), closed_r, step=1.5, lift=0.5)
        tf, faces = tube_frames([[abd_scar, navel_scar]] * n, 0.9)
        writer.add("recon_tram_scar", sid("scar"), "Cicatrizes do abdome", COLORS["scar"], 1.0, "marking", faces, tf)
        tf, faces = tube_frames([[defect]] * n, 0.8)
        writer.add("recon_tram_island_scar", sid("island-scar"), "Cicatriz em volta da ilha", COLORS["scar"], 1.0, "marking", faces, tf)
        self.scar_lines = (abd_scar, navel_scar, defect)

    def anchors(self, writer, ab_model) -> dict:
        tr = self.trunk
        k = self.k_of
        mesh = {m["structure"].replace(f"-{self.KEY}", "").replace("recon-", ""): m for m in writer.meshes}

        def centre_of(part, frame):
            p = mesh[part]["full"][k[frame]]
            return p[int(np.argmin(np.linalg.norm(p - p.mean(0), axis=1)))]

        def on_skin(xy):
            return tr.model(np.c_[[xy], [tr.skin_height([xy[0]], [xy[1]])[0] + 0.5]])[0]

        abd_scar, navel_scar, defect = self.scar_lines
        out = {
            "centre": on_skin(np.array([0.0, (self.top + self.bottom) / 2])),
            "front-centre": defect.mean(0),
            "navel": on_skin(self.navel),
            "zone-1": on_skin(np.array([TRAM["zoneBorder"] / 2, (self.top + self.bottom) / 2])),
            "zone-2": on_skin(np.array([-TRAM["zoneBorder"] / 2, (self.top + self.bottom) / 2])),
            "zone-3": on_skin(np.array([TRAM["zoneBorder"] + 18.0, (self.top + self.bottom) / 2 + 6])),
            "zone-4": on_skin(np.array([-TRAM["zoneBorder"] - 25.0, (self.top + self.bottom) / 2 + 6])),
            "island-abdomen": on_skin(self.Ic),
            "island-front": centre_of("island", "insercao"),
            "discard": centre_of("zone-4", "ilha"),
            "pivot": tr.model(np.c_[[self.pivot], [0.0]])[0],
            "rectus": centre_of("rectus", "musculo"),
            "carrier": centre_of("rectus", "tunel"),
            "flap-front": centre_of("zone-1", "tunel"),
            "perforators": centre_of("perforators", "bainha"),
            "diea-cut": centre_of("inferior-epigastric-stays", "bainha"),
            "sheath": centre_of("sheath", "bainha"),
            "tunnel": self.tunnel_line[len(self.tunnel_line) // 2][0],
            "abdominal-scar": abd_scar[len(abd_scar) // 2],
            "navel-scar": navel_scar[0],
            "front-scar": defect[len(defect) // 3],
            "upper-flap": centre_of("abdomen-skin", "incisao"),
        }
        return {name: r3(np.asarray(v) * MM) for name, v in out.items()}

    def measures(self, writer) -> dict:
        tr = self.trunk
        vols = {}
        for z, slab_ in self.slabs.items():
            vols[z] = round(slab_volume(tr.model(np.c_[slab_["pts"], slab_["h"]]), slab_["tri"]))
        sa = self.half_width
        mid = np.c_[np.zeros(60), np.linspace(self.top, self.bottom, 60)]
        across = np.c_[np.linspace(-sa, sa, 200), np.full(200, self.tip)]
        def skin_len(xy):
            p = tr.model(np.c_[xy, tr.skin_height(xy[:, 0], xy[:, 1])])
            return float(np.linalg.norm(np.diff(p, axis=0), axis=1).sum())
        kept = sum(v for z, v in vols.items() if z in ("zone-1", "zone-2", "zone-3"))
        return {
            "lensWidthMm": round(skin_len(across)), "lensHeightMm": round(skin_len(mid)), "flapMl": int(sum(vols.values())), "keptMl": int(kept),
            "discardMl": int(sum(vols.values()) - kept), **{f"{z}Ml": v for z, v in vols.items()},
            "carrierMm": round(self.carrier_len), "rotationDeg": 180, "fatMm": round(float(tr.skin_height([self.navel[0]], [self.navel[1] - 30])[0])),
            "advancementMm": round(skin_len(mid)), "closureFlips": int(self.closure_flips),
            "islandLengthMm": round(2 * self.island_axes[0]), "islandWidthMm": round(2 * self.island_axes[1]),
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


LD_LABELS = {
    "skin": "Pele da mama (retalhos da mastectomia)", "back-skin": "Pele do dorso", "island": "Ilha cutânea do grande dorsal",
    "island-fat": "Gordura da ilha", "muscle": "Grande dorsal (retalho)", "remnant": "Grande dorsal (parte que fica)",
    "implant": "Implante", "artery": "Artéria toracodorsal e ramos", "vein": "Veias toracodorsais", "nerve": "Nervo toracodorsal",
    "nerve-cut": "Nervo toracodorsal seccionado", "serratus": "Ramo do serrátil", "serratus-cut": "Ramo do serrátil ligado",
    "marking": "Ilha cutânea (marcação)", "incision": "Incisão da ilha", "limits": "Borda anterior e secção do músculo",
    "tunnel": "Túnel axilar", "scar": "Cicatriz do dorso", "island-scar": "Cicatriz em volta da ilha",
}


TRAM_LABELS = {
    "skin": "Pele da mama (retalhos da mastectomia)", "abdomen-skin": "Pele do abdome", "abdomen-window": "Pele do abdome sobre o umbigo",
    "island": "Ilha cutânea do TRAM", "flap-skin": "Pele do retalho (desepitelizada)", "discard-skin": "Pele da zona IV (descartada)",
    "tip-skin": "Pele da ponta da zona III", "zone-1": "Zona I", "zone-2": "Zona II", "zone-3": "Zona III", "zone-3-tip": "Ponta da zona III",
    "zone-4": "Zona IV", "rectus": "Reto do abdome (pedículo)", "rectus-stays": "Reto do abdome abaixo da secção",
    "superior-epigastric": "Vasos epigástricos superiores", "inferior-epigastric": "Vasos epigástricos inferiores (no retalho)",
    "inferior-epigastric-stays": "Vasos epigástricos inferiores (ligados)", "perforators": "Perfurantes periumbilicais",
    "sheath": "Bainha anterior do reto", "sheath-strip": "Faixa da bainha (com o retalho)", "sheath-suture": "Sutura da bainha",
    "contra-rectus": "Reto do abdome do outro lado", "linea-alba": "Linha alba", "pyramidalis": "Piramidais", "external-oblique": "Oblíquos externos",
    "pelvis": "Osso do quadril do outro lado", "inguinal": "Ligamentos inguinais", "iliac": "Vasos ilíacos externos",
    "contra-epigastric": "Epigástricas do outro lado", "marking": "Marcação", "incision": "Incisões", "zones": "Zonas e ilha da inserção",
    "tunnel": "Túnel epigástrico", "scar": "Cicatrizes do abdome", "island-scar": "Cicatriz em volta da ilha",
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
    if only in (None, "grande-dorsal"):
        ld = Latissimus(s, mast)
        writer, info = ld.build()
        print(f"latissimus: back skin {len(ld.back['pts'])} vertices, closure flips {ld.back_flips}; {info['measures']}")
        if figures is not None:
            review(writer, "grande-dorsal", figures, [(0, 0), (150, 0), (95, 0)], tuple(s.trunk.ch.to_model(np.array([[200.0, -20.0, 150.0]]))[0]), half=230.0)
        results.append({"key": "grande-dorsal", "writer": writer, "info": info,
                        "holes": [{"outline": hole_outline(s.trunk, mast.domain), "depth": True}, {"outline": hole_outline(s.trunk, ld.back_domain), "depth": False}],
                        "replaces": {"structures": ["latissimus-dorsi", "thoracodorsal-vessels", "thoracodorsal-nerve", "pectoral-fascia"], "meshes": []},
                        "labels": LD_LABELS})
    if only in (None, "tram"):
        tram = Tram(s, mast)
        writer, info = tram.build()
        print(f"tram: abdomen skin {len(tram.abd['pts'])} vertices, closure flips {tram.closure_flips}; {info['measures']}")
        if figures is not None:
            review(writer, "tram", figures, [(0, 0), (60, 0), (90, 0)], tuple(s.trunk.ch.to_model(np.array([[60.0, -150.0, 150.0]]))[0]), half=260.0)
        results.append({"key": "tram", "writer": writer, "info": info,
                        "holes": [{"outline": hole_outline(s.trunk, mast.domain), "depth": True}, {"outline": hole_outline(s.trunk, tram.abd_domain), "depth": False}],
                        "replaces": {"structures": ["pectoral-fascia", "external-oblique"], "meshes": ["bp43_FJ1971", "bp43_FJ3530"]},
                        "labels": TRAM_LABELS})
    write_sequences(results)


if __name__ == "__main__":
    main()
