#!/usr/bin/env python3
"""Tissue rearrangement of a reduction mammaplasty, step by step (docs/plano-mamoplastia.md, fase 4).

For each technique of build_mammaplasty.py (Pitanguy, Wise with inferior pedicle, vertical with superomedial
pedicle) this script works out where every part of the operated breast goes, the patient standing, at the key frames
of its schedule (SCHEDULES):

  marcacao         the ptotic breast (ptosis grade II with moderate hypertrophy) with its marking, its measurements and
                   the areolotome on the enlarged areola of the case
  incisao          the same, the skin cut along the marking, the pedicle and the areola beyond the areolotome
                   de-epithelialised
  resseccao        the resection (and the skin over it) taken out
  transposicao     the pedicle carries the nipple-areola complex (and the vessels and nerves it keeps) to its new place
  closure stages   pillars, key stitch of the T, vertical suture, fold, areola - the order of each technique; in
                   Pitanguy's the skin closes over the areola, which is marked and let out at the end. The last stage
                   is the expected result. What is sutured to what is drawn: matched edges in one colour, stitches

How (mammaplasty_result.py):
  * the skin of the breast is a mesh made in the rest chart, the lines of the marking among its edges;
  * the closure: where every point of the skin that stays goes when the pattern is sutured (areola edge round the
    areola, vertical limbs together under it, horizontal limbs onto the fold), solved in the rest chart;
  * the result: a breast state of build_breast.py (a small descent and a growth) whose mound has the volume left
    after the resection and whose nipple sits 2 cm above the fold, applied to the closed skin and to the tissue
    under it, which follows its skin; the pedicle is buried under the flaps except under the areola.

Outputs:
  src/data/mammaplastySteps.json                 structures, meshes, frames, measurements before and after
  public/models/hybrid/mammaplasty-<tecnica>.bin  per technique: positions of every mesh at its key frames
                                                   (uint16, quantised over the technique's box) and indices

Usage: python3 scripts/hybrid/build_mammaplasty_steps.py [--figures DIR]   (after build_mammaplasty.py)
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import fast_simplification
import numpy as np
import shapely
from scipy.ndimage import map_coordinates
from shapely.geometry import LineString, MultiPoint, Point, Polygon, box
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).parent))
import build_breast as bb  # noqa: E402
import build_mammaplasty as bm  # noqa: E402
import mammaplasty_result as mr  # noqa: E402
from pilot_mammaplasty import tube  # noqa: E402

OUT_JSON = bb.ROOT / "src/data/mammaplastySteps.json"
OUT_BIN = bb.ROOT / "public/models/hybrid/mammaplasty-{key}.bin"
MM = bb.MM
# How far every group of the closure has gone at each key frame (0 open, 1 sutured). "global": all the skin that stays
# and the pedicle as it is covered; "deep": pillars or flaps; "T": B and C on the middle of the fold (key stitch);
# "vertical", "fold", "areola": the suture lines. Before the closure nothing has moved; ONE is the result.
ZERO = {"global": 0.0, "deep": 0.0, "T": 0.0, "vertical": 0.0, "fold": 0.0, "areola": 0.0}
ONE = {key: 1.0 for key in ZERO}
OPENING = [
    ("marcacao", "Marcação", ZERO),
    ("incisao", "Incisão e desepitelização", ZERO),
    ("resseccao", "Ressecção", ZERO),
    ("transposicao", "Transposição do complexo areolopapilar", ZERO),
]
SCHEDULES = {
    "pitanguy": OPENING + [
        ("pilares", "Pilares", {"global": 0.3, "deep": 1.0, "T": 0.45, "vertical": 0.4, "fold": 0.35, "areola": 0.4}),
        ("vertical", "Ponto em T e sutura vertical", {"global": 0.6, "deep": 1.0, "T": 1.0, "vertical": 1.0, "fold": 0.65, "areola": 0.7}),
        ("sulco", "Sutura no sulco: pele fechada", ONE),
        ("marca-areola", "Marcação da nova aréola", ONE),
        ("abertura", "Abertura da aréola e exteriorização", ONE),
    ],
    "wise": OPENING + [
        ("ponto-t", "Ponto em T", {"global": 0.3, "deep": 0.6, "T": 1.0, "vertical": 0.45, "fold": 0.45, "areola": 0.3}),
        ("vertical", "Sutura vertical", {"global": 0.55, "deep": 0.9, "T": 1.0, "vertical": 1.0, "fold": 0.65, "areola": 0.55}),
        ("sulco", "Sutura no sulco", {"global": 0.75, "deep": 1.0, "T": 1.0, "vertical": 1.0, "fold": 1.0, "areola": 0.75}),
        ("areola", "Sutura da aréola", ONE),
    ],
    "vertical": OPENING + [
        ("pilares", "Pilares", {"global": 0.3, "deep": 1.0, "T": 0.0, "vertical": 0.4, "fold": 0.0, "areola": 0.35}),
        ("vertical", "Sutura vertical", {"global": 0.65, "deep": 1.0, "T": 0.0, "vertical": 1.0, "fold": 0.0, "areola": 0.7}),
        ("areola", "Sutura da aréola", ONE),
    ],
}
# lines of the marking that border the skin that stays, by suture group
LINE_GROUPS = {
    "pitanguy": {"edge": "areola", "med": "vertical", "lat": "vertical", "bd": "fold", "ce": "fold"},
    "wise": {"arc": "areola", "med": "vertical", "lat": "vertical", "bd": "fold", "ce": "fold"},
    "vertical": {"dome": "areola", "med": "vertical", "lat": "vertical"},
}
AREOLA_NOW = 56.0  # mm, the areola of this case on the standing skin, stretched by the hypertrophy
AREOLA_NEW = bm.AREOLA_D  # mm, the areolotome: diameter of the new areola
INSET = 4.0  # mm: in Pitanguy's technique the nipple-areola complex waits under the closed skin until it is let out
STITCH_STEP = 8.0  # mm between two stitches of a suture line
T_RADIUS = 10.0  # mm of the lines round B and C that the key stitch closes
NIPPLE_ABOVE_FOLD = 20.0  # mm, the new nipple in the standing result
SKIRT = 15.0  # mm of trunk skin round the breast outline over which the result fades into the skin that stays
AREOLA_R = 13.2  # mm, the areola of the model in the rest chart (its radius on the skin)
BURY = bm.FLAP_THICKNESS  # the pedicle goes this deep under the flaps, except under the areola
SCAR_RADIUS = 0.55
SCAR_LIFT = 0.45
# mm: the excised skin and the resection leave the breast together (one specimen): a little forwards, then medially and
# down, to lie below the breast and in front of the epigastrium, where the frontal views of the steps see it whole
OUT_OFFSET = {"radial": 30.0, "medial": 65.0, "down": 95.0}
COLORS = {
    "skin": "#e7b8a0", "excised": "#e9a27f", "dermis": "#d97a82", "nac": "#9b5a47", "areola-ring": "#b07a64",
    "pedicle": "#3fae6b", "resection": "#e08a2e", "pillar-medial": "#4f7fd6", "pillar-lateral": "#9a6fd6", "scar": "#7d2f32",
    "marking": "#2536a8", "measure": "#f59e0b", "artery": "#d32f2f", "nerve": "#f5d547",
}
# one colour per suture: the two edges that meet and the stitches between them
SEAM_COLORS = {"T": "#f97316", "vertical": "#facc15", "fold-medial": "#22d3ee", "fold-lateral": "#a3e635", "areola": "#f472b6", "deep": "#818cf8"}


# --------------------------------------------------------------------------------------------------
# geometry helpers
# --------------------------------------------------------------------------------------------------
def front_to_iso(front: bm.Front, inverse: bm.Inverse, rest: mr.Rest, region: Polygon, step: float = 1.5) -> Polygon:
    """A region of the standing breast seen from the front, on its skin, in the isotropic rest chart."""
    ring = shapely.segmentize(region.exterior, step)
    uv = np.array(ring.coords)
    standing = np.c_[uv, front.top(uv) + 0.6]
    rest_chart, _ = inverse(standing)
    return Polygon(rest.iso(rest_chart[:, :2])).buffer(0).simplify(0.05)


def inside(region, pattern, tolerance: float = 1.5):
    """A region carried by another route than the pattern, clipped to it: where its border runs along the pattern
    (within `tolerance`) it is snapped onto it first, or the two nearly coincident borders would fill the mesh with
    slivers."""
    return shapely.snap(region, pattern, tolerance).buffer(0).intersection(pattern).buffer(0)


def biggest(shape):
    return max(shape.geoms, key=lambda g: g.area) if hasattr(shape, "geoms") else shape


def part_outside(line: LineString, region) -> np.ndarray:
    """The longest piece of a polyline outside a region, oriented as the line."""
    rest = line.difference(region)
    piece = max(getattr(rest, "geoms", [rest]), key=lambda g: g.length)
    coords = np.array(piece.coords)
    start = np.array(line.coords[0])
    if np.linalg.norm(coords[-1] - start) < np.linalg.norm(coords[0] - start):
        coords = coords[::-1]
    return coords


def smooth01(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


# --------------------------------------------------------------------------------------------------
# one technique
# --------------------------------------------------------------------------------------------------
class Technique:
    def __init__(self, key: str, item: dict, st, front: bm.Front, inverse: bm.Inverse, rest: mr.Rest, mound_ml: float) -> None:
        self.key, self.item, self.st, self.front, self.inverse, self.rest = key, item, st, front, inverse, rest
        self.breast = st.b
        self.ch = st.b.ch
        self.removed_ml = item["resection"].volume
        self.result = mr.result_state(self.breast, mound_ml - self.removed_ml, NIPPLE_ABOVE_FOLD)
        # the new areola: the circle of the rest chart that the result shapes into an areola of the areolotome's size;
        # the opening of the pattern is sutured round it
        self.areola_r = self.areola_radius(AREOLA_NEW)
        lines = {name: rest.carry(xs) for name, xs in item["lines"].items()}
        self.regions_and_lines(lines)
        self.patch = mr.SkinPatch(rest, [("nac", Point(0, 0).buffer(self.areola_r + 0.6, 64)), ("dermis", self.dermis), ("excised", self.pattern), ("stay", None)], self.named, skirt=SKIRT)
        self.closure = mr.Closure(self.patch, ("stay",), self.targets, self.areola_r, seam="seam" if "seam" in self.named else None)
        rho = np.hypot(*rest.iso(item["pedicle"].rest[:, :2]).T)
        self.reach = max(float(np.percentile(rho, 98)), self.areola_r + 10)  # how far the pedicle reaches from the nipple
        self.field = self.displacement_field()

    def areola_radius(self, diameter: float) -> float:
        """Radius (isotropic rest chart) of the circle round the nipple that the result shows `diameter` mm across."""
        radius = AREOLA_R
        theta = np.linspace(0, 2 * np.pi, 72, endpoint=False)
        for _ in range(3):
            uv = self.rest.uv(np.c_[radius * np.sin(theta), radius * np.cos(theta)])
            ring = self.skin_final(np.c_[uv, self.st.skin_r(uv[:, 0], uv[:, 1])])
            radius *= diameter / float(np.linalg.norm(ring[:36] - ring[36:], axis=1).mean())
        return radius

    # ---- regions of the skin, in the isotropic rest chart -------------------------------------------------------
    def regions_and_lines(self, lines: dict) -> None:
        rest, item = self.rest, self.item
        key = self.key
        if key == "wise":
            arc, med, lat, bd, ce = (lines[k] for k in ("fechadura", "ramo medial", "ramo lateral", "horizontal medial", "horizontal lateral"))
            bd[-1], ce[-1] = rest.snap(bd[-1]), rest.snap(ce[-1])
            fold = rest.outline_between(ce[-1], bd[-1], below=True)
            self.pattern = Polygon(np.vstack([arc, lat, ce, fold[1:-1], bd[::-1], med[::-1]])).buffer(0)
            self.dermis = inside(front_to_iso(self.front, self.inverse, rest, biggest(item["footprint"])), self.pattern)
            self.named = {"arc": arc, "med": med, "lat": lat, "bd": bd, "ce": ce}
            self.targets = {
                "arc": lambda f: (-np.pi + 2 * np.pi * f, 0.0),
                "med": lambda f: (-np.pi, f),
                "lat": lambda f: (np.pi, f),
                "bd": mr.horizontal_target(rest, -1, bd, bd[-1], blend=(0.5, 1.5)),
                "ce": mr.horizontal_target(rest, 1, ce, ce[-1], blend=(0.5, 1.5)),
            }
            self.fold_ends = (bd[-1], ce[-1])
        elif key == "pitanguy":
            med, lat, bd, ce = (lines[k] for k in ("ramo medial", "ramo lateral", "horizontal medial", "horizontal lateral"))
            bd[-1], ce[-1] = rest.snap(bd[-1]), rest.snap(ce[-1])
            fold = rest.outline_between(ce[-1], bd[-1], below=True)
            self.pattern = Polygon(np.vstack([lat, ce, fold[1:-1], bd[::-1], med[::-1]])).buffer(0)
            # the superior pedicle: from the areola up to the new areola site round A, de-epithelialised
            self.dermis = front_to_iso(self.front, self.inverse, rest, biggest(item["footprint"]))
            edge = biggest(self.dermis.exterior.difference(self.pattern.buffer(1e-3)))
            edge = np.array(edge.coords)
            if edge[0, 0] > edge[-1, 0]:
                edge = edge[::-1]
            med_out = part_outside(LineString(med), self.dermis.buffer(1e-3))
            lat_out = part_outside(LineString(lat), self.dermis.buffer(1e-3))
            self.named = {"edge": edge, "med": med_out, "lat": lat_out, "bd": bd, "ce": ce}
            self.targets = {
                "edge": lambda f: (-np.pi + 2 * np.pi * f, 0.0),
                "med": lambda f: (-np.pi, f),
                "lat": lambda f: (np.pi, f),
                "bd": mr.horizontal_target(rest, -1, bd, bd[-1], blend=(0.5, 1.5)),
                "ce": mr.horizontal_target(rest, 1, ce, ce[-1], blend=(0.5, 1.5)),
            }
            self.fold_ends = (bd[-1], ce[-1])
        else:  # vertical
            dome, med, lat = (lines[k] for k in ("cúpula", "ramo medial", "ramo lateral"))
            self.pattern = Polygon(np.vstack([dome, lat, med[::-1]])).buffer(0)
            self.dermis = inside(front_to_iso(self.front, self.inverse, rest, biggest(item["footprint"])), self.pattern)
            f_point = (med[-1] + lat[-1]) / 2
            bottom = np.array([0.0, float(np.interp(self.st.um, self.st.us, self.st.V[:, -1]))])
            seam = np.array([[0.0, f_point[1]], bottom + [0, 0.5]])
            tau_f = (abs(f_point[1]) - self.areola_r) / (abs(bottom[1]) - self.areola_r)
            self.named = {"dome": dome, "med": med, "lat": lat, "seam": seam}
            self.targets = {
                "dome": lambda f: (-np.pi + 2 * np.pi * f, 0.0),
                "med": lambda f: (-np.pi, f * tau_f),
                "lat": lambda f: (np.pi, f * tau_f),
            }
            self.fold_ends = None
        self.pattern = self.pattern.intersection(rest.domain).buffer(0)
        self.dermis = self.dermis.intersection(rest.domain).buffer(0)

    # ---- displacement of the rest chart under the closure, everywhere on the breast ---------------------------
    def displacement_field(self):
        """Closure displacement of the skin that stays; zero on the areola; harmonic over the pattern and the pedicle
        (which follow the skin round them: a pedicle based on the upper pole folds as that pole comes down)."""
        patch, closure = self.patch, self.closure
        n = len(patch.iso)
        values = np.zeros((n, 2))
        fixed = np.zeros(n, bool)
        values[closure.vertices] = closure.target_iso - closure.iso
        fixed[closure.vertices] = True
        nac = np.unique(patch.faces("nac"))
        values[nac] = 0.0
        fixed[nac] = True
        flat = np.c_[patch.iso, np.zeros(n)]
        self.field_values = mr.mean_value_solve(flat, patch.tri, fixed, values)
        from scipy.spatial import cKDTree
        tri = patch.tri
        tree = cKDTree(patch.iso)
        incident = [[] for _ in range(n)]
        for f, corners in enumerate(tri):
            for c in corners:
                incident[c].append(f)

        def field(iso: np.ndarray) -> np.ndarray:
            iso = np.atleast_2d(iso)
            out = np.zeros((len(iso), 2))
            _, near = tree.query(iso, k=6)
            for k, q in enumerate(iso):
                best = None
                for v in near[k]:
                    for f in incident[v]:
                        a, b, c = patch.iso[tri[f]]
                        m = np.array([b - a, c - a]).T
                        if abs(np.linalg.det(m)) < 1e-12:
                            continue
                        w1, w2 = np.linalg.solve(m, q - a)
                        w = np.array([1 - w1 - w2, w1, w2])
                        if w.min() >= -1e-6:
                            best = w @ self.field_values[tri[f]]
                            break
                    if best is not None:
                        break
                out[k] = best if best is not None else self.field_values[near[k][0]]
            return out

        return field

    # ---- maps -------------------------------------------------------------------------------------------------
    def standing(self, rest_chart: np.ndarray) -> np.ndarray:
        return self.ch.to_model(bb.deform(self.breast, rest_chart)[self.st.k])

    def final(self, rest_chart: np.ndarray, role: str, buried: bool = True) -> np.ndarray:
        """Model positions (mm) in the result of rest chart points: skin that stays, pillar, pedicle."""
        st, breast, rest = self.st, self.breast, self.rest
        u, v, r = rest_chart[:, 0], rest_chart[:, 1], rest_chart[:, 2]
        base = breast.base(u, v)
        depth_rest = np.maximum(st.skin_r(u, v) - base, 0.5)
        t = np.clip((r - base) / depth_rest, 0, 1.2)
        iso = rest.iso(np.c_[u, v])
        moved = iso + self.field(iso)
        uv2 = rest.uv(moved)
        base2 = breast.base(uv2[:, 0], uv2[:, 1])
        depth2 = np.maximum(st.skin_r(uv2[:, 0], uv2[:, 1]) - base2, 0.5)
        if role == "pedicle" and buried:
            rho = np.hypot(moved[:, 0], moved[:, 1])
            cover = BURY * smooth01((rho - self.areola_r) / 8.0)
            depth2 = np.maximum(depth2 - cover, 0.5)
        chart = np.c_[uv2, base2 + t * depth2]
        return self.ch.to_model(mr.state_map(breast, chart, self.result))

    def skin_final(self, rest_chart: np.ndarray) -> np.ndarray:
        return self.ch.to_model(mr.state_map(self.breast, rest_chart, self.result))

    def swing(self, rest_chart: np.ndarray, start: np.ndarray, end: np.ndarray) -> np.ndarray:
        """Transposition: the end of the pedicle that carries the areola reaches its place, the base stays."""
        iso = self.rest.iso(rest_chart[:, :2])
        rho = np.hypot(iso[:, 0], iso[:, 1])
        u, v, r = rest_chart[:, 0], rest_chart[:, 1], rest_chart[:, 2]
        base = self.breast.base(u, v)
        t = np.clip((r - base) / np.maximum(self.st.skin_r(u, v) - base, 0.5), 0, 1)
        w = smooth01(1 - (rho - self.areola_r) / (self.reach - self.areola_r)) * smooth01(t / 0.6)
        return start + w[:, None] * (end - start)


# --------------------------------------------------------------------------------------------------
# pillars: the tissue that stays under the skin of the lower pole, medial and lateral of the pattern
# --------------------------------------------------------------------------------------------------
def pillars(key: str, item: dict, front: bm.Front, inverse: bm.Inverse, st) -> dict:
    a_uv = item["a"]
    nipple_u = float(front.project(st.chart_of_rest(st.um, 0.0)[None])[0, 0])
    lower = front.domain.intersection(box(front.u0 - 50, front.v0 - 50, front.u0 + 500, float(a_uv[1])))
    taken = unary_union([item["pattern"], biggest(item["footprint"])]).buffer(0.5)
    resection = item["resection"]

    def bottom(uv):
        floor = front.bottom_full(uv)
        if key == "wise":
            return np.maximum(floor, front.top(uv) - bm.FLAP_THICKNESS)
        cover = np.full(len(uv), -np.inf)
        for region, top, _ in resection.parts:
            inside = shapely.contains_xy(region, uv[:, 0], uv[:, 1])
            if inside.any():
                cover[inside] = np.maximum(cover[inside], top(uv[inside]))
        return np.maximum(floor, np.where(np.isfinite(cover) & (cover < front.top(uv) - 2.0), cover, floor))

    out = {}
    for side, keep in (("medial", lambda u: u < nipple_u), ("lateral", lambda u: u >= nipple_u)):
        half = box(front.u0 - 50, front.v0 - 50, nipple_u, 500) if side == "medial" else box(nipple_u, front.v0 - 50, front.u0 + 500, 500)
        region = lower.intersection(half).difference(taken).buffer(-1.0).buffer(1.0)
        region = biggest(region) if not region.is_empty else region
        out[side] = bm.Piece(front, inverse, [(region, front.top, bottom)])
    return out


# --------------------------------------------------------------------------------------------------
# output
# --------------------------------------------------------------------------------------------------
class Writer:
    """Meshes of one technique: positions at every key frame (only the frames where a mesh moves are stored, quantised
    over one box) and indices."""

    def __init__(self, frame_count: int) -> None:
        self.meshes: list[dict] = []
        self.count = frame_count

    def add(self, name: str, structure: str, label: str, color: str, opacity: float, tissue: str, faces: np.ndarray, frames: list) -> None:
        assert len(frames) == self.count, name
        faces = np.asarray(faces)
        used = np.unique(faces)
        remap = -np.ones(max(int(faces.max()) + 1, 1), int)
        remap[used] = np.arange(len(used))
        frames = [np.asarray(f, float)[used] for f in frames]
        stored, previous = {0: frames[0]}, frames[0]
        for k in range(1, self.count):
            if np.abs(frames[k] - previous).max() > 0.005:
                stored[k] = previous = frames[k]
        self.meshes.append({"name": name, "structure": structure, "label": label, "color": color, "opacity": opacity, "tissue": tissue, "faces": remap[faces], "frames": stored, "full": frames})

    def write(self, path: Path) -> tuple[list[dict], dict]:
        allpos = np.vstack([p for m in self.meshes for p in m["frames"].values()]) * MM
        lo, hi = allpos.min(0) - 1e-4, allpos.max(0) + 1e-4
        blobs, offset, records = [], 0, []
        for m in self.meshes:
            n = len(m["full"][0])
            assert n < 65536, m["name"]
            record = {"name": m["name"], "vertices": int(n), "triangles": int(len(m["faces"])), "frames": [int(k) for k in m["frames"]], "byteOffset": offset}
            for positions in m["frames"].values():
                q = np.round((positions * MM - lo) / (hi - lo) * 65535).astype("<u2")
                blobs.append(q.tobytes())
                offset += q.nbytes
            idx = m["faces"].astype("<u2")
            blobs.append(idx.tobytes())
            offset += idx.nbytes
            if offset % 4:
                blobs.append(b"\0" * (4 - offset % 4))
                offset += 4 - offset % 4
            records.append(record)
        path.write_bytes(b"".join(blobs))
        return records, {"min": [round(float(x), 5) for x in lo], "max": [round(float(x), 5) for x in hi], "byteLength": offset}


# --------------------------------------------------------------------------------------------------
# small geometry
# --------------------------------------------------------------------------------------------------
def tube_mesh(points: np.ndarray, radii, sides: int = 6, normal0=None):
    """Tube round a polyline; the cross-sections are carried along by parallel transport (no flips where the line
    turns), starting from `normal0` when given, so that every key frame of a tube starts the same way."""
    p = np.asarray(points, float)
    n = len(p)
    radii = np.broadcast_to(np.asarray(radii, float), (n,))
    d = np.gradient(p, axis=0)
    d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
    ref = np.asarray(normal0, float) if normal0 is not None else (np.array([0.0, 0.0, 1.0]) if abs(d[0, 2]) < 0.9 else np.array([1.0, 0.0, 0.0]))
    a = np.zeros((n, 3))
    first = ref - (ref @ d[0]) * d[0]
    a[0] = first / max(float(np.linalg.norm(first)), 1e-9)
    for i in range(1, n):
        v = a[i - 1] - (a[i - 1] @ d[i]) * d[i]
        norm = float(np.linalg.norm(v))
        a[i] = v / norm if norm > 1e-9 else a[i - 1]
    b = np.cross(d, a)
    ang = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    verts = (p[:, None, :] + radii[:, None, None] * (np.cos(ang)[None, :, None] * a[:, None, :] + np.sin(ang)[None, :, None] * b[:, None, :])).reshape(-1, 3)
    i, k = np.meshgrid(np.arange(n - 1), np.arange(sides), indexing="ij")
    i, k = i.ravel(), k.ravel()
    k1 = (k + 1) % sides
    faces = np.r_[np.c_[i * sides + k, i * sides + k1, (i + 1) * sides + k], np.c_[i * sides + k1, (i + 1) * sides + k1, (i + 1) * sides + k]]
    return verts, faces


def outward(positions: np.ndarray, faces: np.ndarray, distance: float) -> np.ndarray:
    """A surface moved `distance` mm along its vertex normals, turned away from the chest (+z on average)."""
    p = np.asarray(positions, float)
    a, b, c = p[faces[:, 0]], p[faces[:, 1]], p[faces[:, 2]]
    face_n = np.cross(b - a, c - a)
    normals = np.zeros_like(p)
    for k in range(3):
        np.add.at(normals, faces[:, k], face_n)
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
    used = np.unique(faces)
    if normals[used, 2].mean() < 0:
        normals = -normals
    return p + distance * normals


def merge(parts: list[tuple[np.ndarray, np.ndarray]]) -> tuple[np.ndarray, np.ndarray]:
    verts, faces, offset = [], [], 0
    for v, f in parts:
        verts.append(v)
        faces.append(f + offset)
        offset += len(v)
    return np.vstack(verts), np.vstack(faces)


def dashes(points: np.ndarray, on: float = 3.0, off: float = 2.0) -> list[np.ndarray]:
    """The pieces of a dashed polyline."""
    p = np.asarray(points, float)
    s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
    out, start = [], 0.0
    while start < s[-1] - 0.3:
        end = min(start + on, s[-1])
        t = np.linspace(start, end, max(2, int((end - start) / 0.75) + 1))
        out.append(np.stack([np.interp(t, s, p[:, c]) for c in range(3)], 1))
        start = end + off
    return out


def resample(points: np.ndarray, step: float) -> np.ndarray:
    p = np.asarray(points, float)
    s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
    t = np.linspace(0, s[-1], max(4, int(np.ceil(s[-1] / step)) + 1))
    return np.stack([np.interp(t, s, p[:, c]) for c in range(p.shape[1])], 1)


def nipple_grid(st, centre: np.ndarray, radii: list[float], n: int = 48) -> np.ndarray:
    """Points of the standing skin at true distances `radii` (mm) from a chart point along n headings: (rings, n, 2)."""
    out = np.zeros((len(radii), n, 2))
    for j, heading in enumerate(np.linspace(0, 360, n, endpoint=False)):
        path = st.march(centre, heading, max(radii) + 0.5, step=0.5)
        s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(st.model(st.skin(path)), axis=0), axis=1))]
        for i, r in enumerate(radii):
            out[i, j] = [np.interp(r, s, path[:, 0]), np.interp(r, s, path[:, 1])]
    return out


def polar_faces(rings: int, n: int, centre: bool) -> np.ndarray:
    """Triangles of a polar grid: optional centre vertex (index 0) then `rings` rings of n vertices."""
    base = 1 if centre else 0
    faces = []
    if centre:
        faces += [[0, 1 + j, 1 + (j + 1) % n] for j in range(n)]
    for r in range(rings - 1):
        a, b = base + r * n, base + (r + 1) * n
        for j in range(n):
            j1 = (j + 1) % n
            faces += [[a + j, a + j1, b + j], [a + j1, b + j1, b + j]]
    return np.array(faces)


def nac_meshes(breast: bb.Breast, keep: float = 0.12):
    """The real nipple and tubercles of the operated side, simplified, in rest model space (mm). The areola itself is
    drawn by the sequence (it is larger in this case and the areolotome reduces it)."""
    out = []
    for name in bb.SIDE_MESHES["op"]:
        if not ("nipple" in name or "areola" in name) or name.split("_")[-2] == "areola":
            continue
        pos, idx = bb.mesh(name)
        p2, i2 = fast_simplification.simplify(pos.astype(np.float32), idx.astype(np.int32), target_reduction=1 - keep)
        out.append((name, np.asarray(p2, float), np.asarray(i2, int)))
    return out


def measure(tech: Technique, before: dict, notch: np.ndarray) -> dict:
    """Clinical measurements of the result, taken on the result skin as a tape would."""
    st, ch, breast = tech.st, tech.ch, tech.breast
    fold_v = float(np.interp(st.um, st.us, st.V[:, -1]))
    nipple = mr.state_map(breast, ch.nipple[None], tech.result)[0]
    skin = lambda u, v: np.c_[u, v, st.skin_r(u, v)]  # noqa: E731
    notch_chart = ch.to_chart(notch[None])[0]
    t = np.linspace(0, 1, 160)
    upper = skin(notch_chart[0] + (st.um - notch_chart[0]) * t, notch_chart[1] + (0 - notch_chart[1]) * t)
    lower_v = np.linspace(0, fold_v, 80)
    lower = skin(np.full(80, st.um), lower_v)
    sn = bb.polyline_length(tech.skin_final(upper))
    nimf = bb.polyline_length(tech.skin_final(lower))
    after = {
        "nippleToFoldMm": round(float(nipple[1] - fold_v), 1),
        "notchToNippleMm": round(sn),
        "nippleToFoldSkinMm": round(nimf),
        "projectionMm": round(float(nipple[2] - breast.base(nipple[:1], nipple[1:2])[0])),
        "volumeMl": round(mr.mound_volume(breast, lambda q: mr.state_map(breast, q, tech.result))),
    }
    keys = ("nippleToFoldMm", "notchToNippleMm", "nippleToFoldSkinMm", "projectionMm", "volumeMl")
    return {"before": {k: before[k] for k in keys}, "after": after}


# --------------------------------------------------------------------------------------------------
# the closure, stage by stage
# --------------------------------------------------------------------------------------------------
def staged_skin(tech: Technique, k0: np.ndarray, final: np.ndarray, schedule: list) -> list[np.ndarray]:
    """The skin patch at every key frame. Nothing moves before the closure; at a stage of the closure every group of
    suture lines has gone the fraction the schedule gives it, and the skin between follows: all of it goes the
    "global" fraction, plus the extra of the lines, spread harmonically (mean value weights) over the skin that stays.
    The outline (and the skirt round it) goes as far as the fold. The last stages are the result itself."""
    patch, closure = tech.patch, tech.closure
    n = len(patch.iso)
    disp = final - k0
    verts = closure.vertices
    group = np.full(n, "", object)
    for name, g in LINE_GROUPS[tech.key].items():
        if name in patch.lines:
            ids, _ = patch.on_line(name)
            group[ids] = g
    t_weight = np.zeros(n)
    if tech.fold_ends is not None:
        ends = np.array([tech.named["med"][-1], tech.named["lat"][-1]])
        dist = np.min(np.linalg.norm(patch.iso[:, None, :] - ends[None], axis=2), axis=1)
        t_weight = (1 - smooth01(dist / T_RADIUS)) * (group != "")
    flat = np.c_[closure.iso, np.zeros(len(verts))]
    frames = []
    for _, _, f in schedule:
        if f is ZERO:
            frames.append(k0.copy())
            continue
        if f is ONE:
            frames.append(final.copy())
            continue
        p = f["global"]
        q = max(p, f["fold"]) if tech.fold_ends is not None else p
        pos = k0 + q * disp
        c = np.full(n, np.nan)
        for g in ("vertical", "fold", "areola"):
            c[group == g] = f[g]
        c = np.where(t_weight > 0, np.fmax(c, f["T"] * t_weight), c)
        c[patch.on_outline] = q
        local = c[verts]
        fixed = ~np.isnan(local)
        extra = np.zeros((len(verts), 3))
        extra[fixed] = (local[fixed] - p)[:, None] * disp[verts][fixed]
        pos[verts] = k0[verts] + p * disp[verts] + mr.mean_value_solve(flat, closure.tri, fixed, extra)
        frames.append(pos)
    return frames


def line_track(patch, name: str) -> tuple[np.ndarray, np.ndarray]:
    """Vertices of a line of the marking in order, with their fraction of its length."""
    ids, fraction = patch.on_line(name)
    order = np.argsort(fraction)
    return ids[order], fraction[order]


def at_fraction(ids: np.ndarray, fraction: np.ndarray, f: float) -> tuple[np.ndarray, np.ndarray]:
    """The two vertices of a line round fraction f and their weights."""
    j = int(np.clip(np.searchsorted(fraction, f), 1, len(fraction) - 1))
    a = float(np.clip((f - fraction[j - 1]) / max(fraction[j] - fraction[j - 1], 1e-9), 0, 1))
    return np.array([ids[j - 1], ids[j]]), np.array([1 - a, a])


def follow(frames: list[np.ndarray], idx: np.ndarray, weights: np.ndarray) -> list[np.ndarray]:
    return [(np.asarray(weights)[:, None] * frame[np.asarray(idx)]).sum(0) for frame in frames]


def sutures(tech: Technique, skin: list[np.ndarray], disc: list[np.ndarray], rim: np.ndarray, rim_theta: np.ndarray, pillar_frames: dict) -> dict:
    """What is sutured to what. Per group: the stitches (pairs of points that meet, followed through every key
    frame) and the two edges that come together. Returns {group: (stitches, edges)}; points as frame lists."""
    patch, closure = tech.patch, tech.closure
    outline_ids = np.nonzero(patch.on_outline)[0]
    out = {}
    tracks = {name: line_track(patch, name) for name in LINE_GROUPS[tech.key]}

    def outline_point(theta: float) -> int:
        goal = closure.polar_to_iso(theta, 1.0)
        return int(outline_ids[np.argmin(np.linalg.norm(patch.iso[outline_ids] - goal, axis=1))])

    def spaced(name: str) -> np.ndarray:
        length = float(patch.lines[name]["true"][-1])
        return np.arange(STITCH_STEP / 2, length, STITCH_STEP) / length

    def on_line(name: str, f: float):
        ids, fraction = tracks[name]
        return follow(skin, *at_fraction(ids, fraction, f))

    def line_frames(name: str):
        ids, _ = tracks[name]
        return [frame[ids] for frame in skin]

    # vertical: the two limbs meet along the meridian, fraction to fraction
    stitches = [(on_line("med", f), on_line("lat", f)) for f in spaced("med")]
    out["vertical"] = (stitches, [line_frames("med"), line_frames("lat")])
    if tech.fold_ends is not None:
        bottom = outline_point(np.pi)
        b_end, c_end = on_line("med", 1.0), on_line("lat", 1.0)
        t_point = follow(skin, np.array([bottom]), np.array([1.0]))
        out["T"] = ([(b_end, t_point), (c_end, t_point)], [])
        for side, name in (("fold-medial", "bd"), ("fold-lateral", "ce")):
            target = tech.targets[name]
            stitches = [(on_line(name, f), follow(skin, np.array([outline_point(target(f)[0])]), np.array([1.0]))) for f in spaced(name)]
            lip = []
            for f in np.linspace(0, 1, 80):
                v = outline_point(target(f)[0])
                if not lip or lip[-1] != v:
                    lip.append(v)
            out[side] = (stitches, [line_frames(name), [frame[np.array(lip)] for frame in skin]])
    # areola: the opening of the pattern round the border of the new areola
    opening = {"pitanguy": "edge", "wise": "arc", "vertical": "dome"}[tech.key]
    stitches = []
    for f in np.arange(0, 1, 1 / 16):
        theta = -np.pi + 2 * np.pi * f
        j = int(np.argmin(np.abs(np.angle(np.exp(1j * (rim_theta - theta))))))
        stitches.append((on_line(opening, f), [frame[rim[j]] for frame in disc]))
    out["areola"] = (stitches, [line_frames(opening), [frame[np.r_[rim, rim[:1]]] for frame in disc]])
    # deep: the pillars (or flaps) that meet in the middle, where they touch in the result
    medial, lateral = pillar_frames["medial"], pillar_frames["lateral"]
    from scipy.spatial import cKDTree

    distance, nearest = cKDTree(lateral[-1]).query(medial[-1])
    close = np.nonzero(distance < 3.0)[0]
    if len(close):
        close = close[np.argsort(medial[-1][close, 1])]
        pick = close[np.linspace(0, len(close) - 1, min(8, len(close))).round().astype(int)]
        stitches = [([frame[i] for frame in medial], [frame[nearest[i]] for frame in lateral]) for i in pick]
        out["deep"] = (stitches, [])
    return out


def suture_mesh(stitches: list, edges: list, frame_count: int) -> tuple[list[np.ndarray], np.ndarray]:
    """One mesh per group: thin tubes for the stitches and slightly thicker ones along the edges, at every frame."""
    frames, faces = [], None
    for k in range(frame_count):
        parts = []
        for a, b in stitches:
            parts.append(tube_mesh(np.array([a[k], b[k]]), 0.5, 4, normal0=[0.0, 0.0, 1.0]))
        for edge in edges:
            parts.append(tube_mesh(edge[k], 0.6, 5, normal0=[0.0, 0.0, 1.0]))
        verts, f = merge(parts)
        frames.append(verts)
        faces = f
    return frames, faces


# --------------------------------------------------------------------------------------------------
# vessels and nerves of the pedicle
# --------------------------------------------------------------------------------------------------
def neurovascular_tracks(tech: Technique, item: dict, names: list[str], anatomy: dict, schedule: list) -> list[tuple[str, str, list, np.ndarray]]:
    """The branches a pedicle keeps, followed through the key frames: the part inside the pedicle goes where the pedicle
    goes (folded in the transposition, buried in the closure), the rest goes with the tissue round it, and the origin
    on the chest wall stays put."""
    st, ch, breast = tech.st, tech.ch, tech.breast
    ids = [fid for fid, _, _ in schedule]
    t3 = ids.index("transposicao")
    tissue_of = {m["name"]: m["tissue"] for m in anatomy["meshes"]}
    out = []
    for name in names:
        geometry = anatomy["geometry"][name]
        pts = resample(np.array(geometry["points"]).reshape(-1, 3) / MM, 1.5)
        q = ch.to_chart(pts)
        inside = item["pedicle"].contains(st.to_state(q)).astype(float)
        m = smooth01(np.convolve(np.pad(inside, 4, mode="edge"), np.ones(9) / 9, mode="valid") * 1.6)
        anchor = smooth01((q[:, 2] - breast.base(q[:, 0], q[:, 1])) / 8.0)
        k0 = ch.to_model(bb.deform(breast, q)[st.k])
        flat = tech.final(q, "pedicle", buried=False)
        buried = tech.final(q, "pedicle", buried=True)
        swing = tech.swing(q, k0, flat)
        stay = tech.final(q, "stay")
        centre = []
        for i, (_, _, f) in enumerate(schedule):
            if i < t3:
                centre.append(k0)
            elif i == t3:
                centre.append(k0 + (anchor * m)[:, None] * (swing - k0))
            else:
                g = f["global"]
                ped = swing + g * (buried - swing)
                sty = k0 + g * (stay - k0)
                centre.append(k0 + anchor[:, None] * (m[:, None] * (ped - k0) + (1 - m)[:, None] * (sty - k0)))
        radii = np.linspace(geometry["radiusMm"][0], geometry["radiusMm"][1], len(pts)) * 0.8
        first = tube_mesh(centre[0], radii, 6)
        normal0 = first[0][0] - centre[0][0]
        frames = [tube_mesh(c, radii, 6, normal0=normal0)[0] for c in centre]
        out.append((name, tissue_of[name], frames, first[1]))
    return out


# --------------------------------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------------------------------
KINDS = {
    "skin": "Pele, passo a passo ({label})",
    "excised": "Pele ressecada ({label})",
    "dermis": "Derme do pedículo {pedicle}",
    "pedicle": "Pedículo {pedicle}, passo a passo",
    "resection": "Ressecção {resection}, passo a passo",
    "pillar-medial": "{pillar} medial ({label})",
    "pillar-lateral": "{pillar} lateral ({label})",
    "nac": "Complexo areolopapilar ({label})",
    "areola-ring": "Aréola excedente ({label})",
    "areolotome": "Areolótomo: nova aréola ({label})",
    "measures": "Medidas da marcação ({label})",
    "arteries": "Artérias do pedículo {pedicle}",
    "nerves": "Nervos do pedículo {pedicle}",
    "sutures": "Suturas ({label})",
    "sutures-areola": "Sutura da aréola ({label})",
    "disc": "Pele sobre a aréola ({label})",
    "disc-ring": "Marcação da nova aréola ({label})",
    "scars": "Cicatrizes ({label})",
}


def build(key: str, item: dict, st, front, inverse, rest, mound_ml: float, nacs: list, anatomy: dict, report: dict, before: dict, notch: np.ndarray):
    info = bm.TECHNIQUES[key]
    tech = Technique(key, item, st, front, inverse, rest, mound_ml)
    patch, closure, ch, breast = tech.patch, tech.closure, tech.ch, tech.breast
    schedule = SCHEDULES[key]
    ids = [fid for fid, _, _ in schedule]
    fr = [f for _, _, f in schedule]
    nf = len(schedule)
    t2, t3 = ids.index("resseccao"), ids.index("transposicao")
    pillar_word = "Retalho" if key == "wise" else "Pilar"
    print(f"{info['label']}: pele {len(patch.iso)} vértices; aréola nova {2 * tech.areola_r:.1f} na carta; fechamento: {closure.unassigned} sem condição, {closure.flipped} triângulos invertidos (degenerados no sulco)")
    print(f"   resultado: descida {tech.result['descent']} mm, crescimento {tech.result['growth']}")
    w = Writer(nf)
    sid = lambda kind: f"mamo-step-{kind}-{key}"  # noqa: E731

    def pedicle_like(k0, swing, buried):
        return [k0 if i < t3 else swing if i == t3 else swing + fr[i]["global"] * (buried - swing) for i in range(nf)]

    def nac_like(k0, final, inset):
        return [k0 if i < t3 else (inset if inset is not None and ids[i] != "abertura" else final) for i in range(nf)]

    def removed(k0, shift):
        return [k0 if i < t2 else k0 + shift for i in range(nf)]

    def static(points):
        return [points] * nf

    # ---- skin -------------------------------------------------------------------------------------------------
    k0 = tech.standing(patch.rest_chart)
    uv_final = patch.rest_uv.copy()
    uv_final[closure.vertices] = closure.target_uv
    stay_final = tech.skin_final(np.c_[uv_final, st.skin_r(uv_final[:, 0], uv_final[:, 1]) + patch.lift])
    # the skirt: trunk skin round the outline, where the result fades into the skin that stays as it is
    from scipy.spatial import cKDTree

    skirt = np.unique(patch.faces("skirt"))
    rim_ids = np.nonzero(patch.on_outline)[0]
    distance, nearest = cKDTree(patch.iso[rim_ids]).query(patch.iso[skirt])
    fade = (1 - smooth01(distance / SKIRT))[:, None]
    stay_final[skirt] = k0[skirt] + fade * (stay_final[rim_ids[nearest]] - k0[rim_ids[nearest]])
    print(f"   contorno: o resultado se afasta até {float(np.linalg.norm(stay_final[rim_ids] - k0[rim_ids], axis=1).max()):.1f} mm da pele em pé; a saia de {SKIRT:.0f} mm absorve")
    skin = staged_skin(tech, k0, stay_final, schedule)
    w.add(f"mamo_{key}_step_skin", sid("skin"), "Pele que fica", COLORS["skin"], 1.0, "skin", patch.faces("stay", "skirt"), skin)
    inset = (lambda q: tech.skin_final(q - np.array([0.0, 0.0, INSET]))) if key == "pitanguy" else None
    nac_final = tech.skin_final(patch.rest_chart)
    w.add(f"mamo_{key}_step_nac_skin", sid("skin"), "Pele sob a aréola", COLORS["skin"], 1.0, "skin", patch.faces("nac"), nac_like(k0, nac_final, inset(patch.rest_chart) if inset else None))
    out_dir = out_direction(ch, k0[np.unique(patch.faces("excised"))].mean(0), st)
    # skin coloured: the views of the incision onwards tint them (excised skin, de-epithelialised dermis)
    w.add(f"mamo_{key}_step_excised", sid("excised"), "Pele ressecada", COLORS["skin"], 1.0, "skin", patch.faces("excised"), removed(k0, out_dir))
    dermis_flat = tech.final(patch.rest_chart, "pedicle", buried=False)
    dermis_buried = tech.final(patch.rest_chart, "pedicle", buried=True)
    # the dermis lies on the pedicle: a little off its surface, or the two would flicker into each other
    dermis_faces = patch.faces("dermis")
    w.add(f"mamo_{key}_step_dermis", sid("dermis"), "Derme desepitelizada do pedículo", COLORS["skin"], 1.0, "skin", dermis_faces, [outward(f, dermis_faces, 0.8) for f in pedicle_like(k0, tech.swing(patch.rest_chart, k0, dermis_flat), dermis_buried)])

    # ---- the areola: the areolotome marks the new one on the larger areola of the case ----------------------------
    nipple = st.chart_of_rest(st.um, 0.0)
    n = 48
    disc_radii = [AREOLA_NEW / 2 * k / 6 for k in range(1, 7)]
    ring_radii = list(np.linspace(AREOLA_NEW / 2, AREOLA_NOW / 2, 4))
    grid = nipple_grid(st, nipple, disc_radii + ring_radii[1:], n)
    lift_areola = 0.3
    disc_xs = np.vstack([nipple[None], grid[:6].reshape(-1, 2)])
    q_disc = st.skin(disc_xs, lift_areola)
    disc_k0 = st.model(q_disc)
    iso = rest.iso(q_disc[:, :2])
    theta = np.arctan2(iso[:, 0], iso[:, 1])
    theta[0] = 0.0
    rho = np.r_[0.0, np.repeat(np.arange(1, 7) / 6, n)]
    final_iso = np.c_[rho * tech.areola_r * np.sin(theta), rho * tech.areola_r * np.cos(theta)]
    uv = rest.uv(final_iso)
    disc_chart = np.c_[uv, st.skin_r(uv[:, 0], uv[:, 1]) + lift_areola]
    disc_final = tech.skin_final(disc_chart)
    disc = nac_like(disc_k0, disc_final, inset(disc_chart) if inset else None)
    disc_faces = polar_faces(6, n, centre=True)
    w.add(f"mamo_{key}_step_areola", sid("nac"), "Nova aréola", COLORS["nac"], 1.0, "areola", disc_faces, disc)
    rim = 1 + 5 * n + np.arange(n)
    rim_theta = theta[rim]
    ring_xs = grid[5:].reshape(-1, 2)
    q_ring = st.skin(ring_xs, lift_areola)
    ring_k0 = st.model(q_ring)
    ring_flat = tech.final(q_ring, "pedicle", buried=False)
    ring_faces = polar_faces(4, n, centre=False)
    w.add(f"mamo_{key}_step_areola_ring", sid("areola-ring"), "Aréola além do areolótomo", COLORS["areola-ring"], 1.0, "areola", ring_faces,
          [outward(f, ring_faces, 0.8) for f in pedicle_like(ring_k0, tech.swing(q_ring, ring_k0, ring_flat), tech.final(q_ring, "pedicle", buried=True))])
    tome = st.model(st.skin(grid[5], 0.6))
    v_, f_ = tube_mesh(np.vstack([tome, tome[:1]]), 0.5, 6)
    w.add(f"mamo_{key}_step_areolotome", sid("areolotome"), "Areolótomo", COLORS["marking"], 1.0, "marking", f_, static(v_))
    for name, pos, idx in nacs:
        q = ch.to_chart(pos)
        a = ch.to_model(bb.deform(breast, q)[st.k])
        w.add(f"mamo_{key}_step_{name.split('_')[-2]}", sid("nac"), "Complexo areolopapilar", COLORS["nac"], 1.0, "areola", idx, nac_like(a, tech.skin_final(q), inset(q) if inset else None))

    # ---- pieces -------------------------------------------------------------------------------------------------
    ped, res = item["pedicle"], item["resection"]
    ped_k0 = ch.to_model(ped.standing)
    ped_flat = tech.final(ped.rest, "pedicle", buried=False)
    w.add(f"mamo_{key}_step_pedicle", sid("pedicle"), f"Pedículo {info['pedicle']}", COLORS["pedicle"], 0.9, "piece", ped.faces, pedicle_like(ped_k0, tech.swing(ped.rest, ped_k0, ped_flat), tech.final(ped.rest, "pedicle", buried=True)))
    res_k0 = ch.to_model(res.standing)
    w.add(f"mamo_{key}_step_resection", sid("resection"), f"Ressecção {info['resection']}", COLORS["resection"], 0.9, "piece", res.faces, removed(res_k0, out_dir))
    volumes, pillar_frames = {}, {}
    for side, piece in pillars(key, item, front, inverse, st).items():
        k0p = ch.to_model(piece.standing)
        finalp = tech.final(piece.rest, "pillar")
        pillar_frames[side] = [k0p + f["deep"] * (finalp - k0p) for f in fr]
        w.add(f"mamo_{key}_step_pillar_{side}", sid(f"pillar-{side}"), f"{pillar_word} {side}", COLORS[f"pillar-{side}"], 0.9, "piece", piece.faces, pillar_frames[side])
        volumes[side] = round(piece.volume)

    # ---- vessels and nerves the pedicle keeps ---------------------------------------------------------------------
    kept = sorted(name for name, value in report.items() if not (value[key]["insideMm"] >= 4.0 or value[key]["incisions"] > 0))
    branches = {"artery": [], "nerve": []}
    for name, tissue, frames, faces in neurovascular_tracks(tech, item, kept, anatomy, schedule):
        kind = "arteries" if tissue == "artery" else "nerves"
        branches[tissue].append(name)
        w.add(f"mamo_{key}_step_{name}", sid(kind), name, COLORS[tissue], 1.0, tissue, faces, frames)

    # ---- Pitanguy: the skin closes over the areola, which is marked and opened at the end ------------------------
    extra_points = {}
    if key == "pitanguy":
        e_ids, e_frac = line_track(patch, "edge")
        cover_theta = np.linspace(-np.pi, np.pi, n, endpoint=False)
        cover_rho = np.r_[0.0, np.repeat(np.arange(1, 7) / 6, n)]
        cover_th = np.r_[0.0, np.tile(cover_theta, 6)]
        c_iso = np.c_[cover_rho * tech.areola_r * np.sin(cover_th), cover_rho * tech.areola_r * np.cos(cover_th)]
        c_uv = rest.uv(c_iso)
        cover_final = tech.skin_final(np.c_[c_uv, st.skin_r(c_uv[:, 0], c_uv[:, 1]) + 0.25])
        # the skin of the flaps closes over the areola like a curtain hung on the edge of the pedicle's dermis: every
        # point of the disc starts on the point of that edge that the closure brings to its angle
        rim_at = cover_final[1 + 5 * n: 1 + 6 * n]
        angle_index = np.r_[n // 2, np.tile(np.arange(n), 6)]
        fraction = (cover_theta[angle_index] + np.pi) / (2 * np.pi)
        frames = []
        for i, f in enumerate(fr):
            edge_now = skin[i][e_ids]
            edge_at = np.stack([np.interp(fraction, e_frac, edge_now[:, c]) for c in range(3)], 1)
            if ids[i] == "abertura":
                # the disc of skin is cut out and lifted off: the areola comes out through the opening
                frames.append(cover_final + 28.0 * radial_of(ch, cover_final.mean(0)) + np.array([0.0, 12.0, 0.0]))
            else:
                frames.append(edge_at + f["areola"] * (cover_final - rim_at[angle_index]))
        w.add(f"mamo_{key}_step_cover", sid("disc"), "Pele sobre a nova aréola", COLORS["skin"], 1.0, "skin", polar_faces(6, n, centre=True), frames)
        ring_theta = np.linspace(0, 2 * np.pi, 97)
        ring_uv = rest.uv(np.c_[0.97 * tech.areola_r * np.sin(ring_theta), 0.97 * tech.areola_r * np.cos(ring_theta)])
        v_, f_ = tube_mesh(tech.skin_final(np.c_[ring_uv, st.skin_r(ring_uv[:, 0], ring_uv[:, 1]) + 0.7]), 0.5, 6)
        w.add(f"mamo_{key}_step_cover_ring", sid("disc-ring"), "Marcação da nova aréola", COLORS["marking"], 1.0, "marking", f_, static(v_))
        extra_points["cover"] = [round(float(x) * MM, 5) for x in frames[0][1 + 2 * n + n // 4]]
        extra_points["cover-ring"] = [round(float(x) * MM, 5) for x in v_[len(v_) // 4]]

    # ---- sutures --------------------------------------------------------------------------------------------------
    seams = sutures(tech, skin, disc, rim, rim_theta, pillar_frames)
    for group, (stitches, edges) in seams.items():
        frames, faces = suture_mesh(stitches, edges, nf)
        # the areola has its own structure: in Pitanguy's technique it is only sutured once the skin over it is opened
        w.add(f"mamo_{key}_step_suture_{group.replace('-', '_')}", sid("sutures-areola" if group == "areola" else "sutures"), {"T": "Ponto em T", "vertical": "Sutura vertical", "fold-medial": "Sutura no sulco, medial", "fold-lateral": "Sutura no sulco, lateral", "areola": "Sutura da aréola", "deep": "Pontos profundos"}[group], SEAM_COLORS[group], 1.0, "marking", faces, frames)
        a, b = stitches[len(stitches) // 2]
        extra_points[f"seam-{group}"] = [round(float(x) * MM, 5) for x in (a[0] + b[0]) / 2]

    # ---- measurements of the marking ---------------------------------------------------------------------------------
    measures, values = [], {"areolaNowMm": AREOLA_NOW, "areolaNewMm": AREOLA_NEW}
    climb = np.c_[np.zeros(80), np.linspace(nipple[1], 0.0, 80)]
    values["ascensionMm"] = round(float(bb.polyline_length(st.model(st.skin(climb)))), 1)
    climb_k0 = st.model(st.skin(climb, 0.6))
    measures += [tube_mesh(piece, 0.45, 5) for piece in dashes(climb_k0)]
    extra_points["measure-ascension"] = [round(float(x) * MM, 5) for x in climb_k0[len(climb_k0) // 2]]
    points_xs = {name: np.asarray(xs, float) for name, xs in item["points"].items()}
    if "B" in points_xs and "C" in points_xs:
        across = points_xs["B"] + np.linspace(0, 1, 80)[:, None] * (points_xs["C"] - points_xs["B"])
        across_k0 = st.model(st.skin(across, 0.6))
        values["bcMm"] = round(float(np.linalg.norm(across_k0[0] - across_k0[-1])), 1)
        measures += [tube_mesh(piece, 0.45, 5) for piece in dashes(across_k0)]
        extra_points["measure-bc"] = [round(float(x) * MM, 5) for x in across_k0[len(across_k0) // 2]]
    v_, f_ = merge(measures)
    w.add(f"mamo_{key}_step_measures", sid("measures"), "Medidas", COLORS["measure"], 1.0, "marking", f_, static(v_))
    for name, xs in item["lines"].items():
        xs = np.asarray(xs, float)
        s_ = np.r_[0, np.cumsum(np.linalg.norm(np.diff(xs, axis=0), axis=1))]
        mid = np.array([np.interp(s_[-1] / 2, s_, xs[:, 0]), np.interp(s_[-1] / 2, s_, xs[:, 1])])
        # the marking of the plans is a rest-pose structure: its anchors are rest points
        extra_points[f"line:{name}"] = [round(float(x) * MM, 5) for x in ch.to_model(st.skin(mid[None]))[0]]

    # ---- scars of the result ---------------------------------------------------------------------------------------
    scars = scar_lines(tech)
    for n_, (label, iso_line) in enumerate(scars):
        uv_ = rest.uv(iso_line)
        pts = tech.skin_final(np.c_[uv_, st.skin_r(uv_[:, 0], uv_[:, 1]) + SCAR_LIFT])
        v_, f_ = tube_mesh(pts, SCAR_RADIUS, 6)
        w.add(f"mamo_{key}_step_scar_{n_}", sid("scars"), label, COLORS["scar"], 1.0, "marking", f_, static(v_))
        extra_points[f"scar-{n_}"] = [round(float(x) * MM, 5) for x in v_[(len(v_) // 12) * 6]]
        if label == "Cicatriz vertical":
            values["verticalScarMm"] = round(float(bb.polyline_length(pts)), 1)
    values["areolaResultMm"] = round(float(np.linalg.norm(disc_final[rim[: n // 2]] - disc_final[rim[n // 2:]], axis=1).mean()), 1)
    return tech, w, volumes, branches, extra_points, values


def radial_of(ch, point: np.ndarray) -> np.ndarray:
    theta = ch.to_chart(point[None])[0][0] / bb.RREF
    return np.array([-ch.s * np.sin(theta), 0.0, np.cos(theta)])


def anchors(tech: Technique, writer: Writer) -> dict:
    """Label anchors of the step views: a vertex of every piece near its middle, where its first frame puts it
    (model units). The viewer snaps a label to that vertex and then follows it through the key frames."""
    key = tech.key
    by_name = {m["name"]: m for m in writer.meshes}

    def nearest(name: str, target=None) -> list[float]:
        p = by_name[name]["full"][0]
        t = p.mean(0) if target is None else target
        return [round(float(x) * MM, 5) for x in p[np.argmin(np.linalg.norm(p - t, axis=1))]]

    out = {name: nearest(f"mamo_{key}_step_{name}") for name in ("pedicle", "resection", "excised", "dermis")}
    disc = by_name[f"mamo_{key}_step_areola"]["full"]
    out["nac"] = [round(float(x) * MM, 5) for x in disc[0][1 + 48 * 3]]
    ring = by_name[f"mamo_{key}_step_areola_ring"]["full"][0]
    out["areola-ring"] = [round(float(x) * MM, 5) for x in ring[48 * 2 + 12]]
    out["areola-now"] = [round(float(x) * MM, 5) for x in ring[48 * 3 + 36]]
    tome = by_name[f"mamo_{key}_step_areolotome"]["full"][0]
    out["areolotome"] = [round(float(x) * MM, 5) for x in tome[len(tome) // 4]]
    for side in ("medial", "lateral"):
        out[f"pillar-{side}"] = nearest(f"mamo_{key}_step_pillar_{side}")
    for kind in ("arteries", "nerves"):
        meshes = [m for m in writer.meshes if m["structure"] == f"mamo-step-{kind}-{key}"]
        if meshes:
            p = meshes[0]["full"][0]
            out[kind] = [round(float(x) * MM, 5) for x in p[int(len(p) * 0.7)]]
    # where the camera of the sequence looks: between the nipple before and after, 30 mm deep to the skin
    out["centre"] = [round(float(x) * MM, 5) for x in (disc[0][0] + disc[-1][0]) / 2 - np.array([0.0, 0.0, 30.0])]
    return out


def main() -> None:
    state = [s["id"] for s in bb.STATES].index(bm.STATE)
    breast = bb.Breast("op", bb.trunk_axis())
    st = bm.Standing(breast, state)
    front = bm.Front(st)
    inverse = bm.Inverse(breast, state)
    rest = mr.Rest(st)
    plan = bm.techniques(st, front, inverse)
    mound_ml = bb.mound_volumes(breast)[state + 1]
    model = json.loads(bb.OUT_JSON.read_text())
    before = model["measurements"]["op"][bm.STATE]
    notch = bb.layer_landmark("esterno.incisura-jugular")
    nacs = nac_meshes(breast)
    anatomy = json.loads(bm.ANATOMY_JSON.read_text())
    report = bm.neurovascular(st, front, plan)
    structures, manifest, techniques = {}, [], {}
    figures_dir = Path(sys.argv[sys.argv.index("--figures") + 1]) if "--figures" in sys.argv else None
    for key, item in plan.items():
        info = bm.TECHNIQUES[key]
        tech, writer, volumes, branches, extra_points, values = build(key, item, st, front, inverse, rest, mound_ml, nacs, anatomy, report, before, notch)
        records, box_ = writer.write(Path(str(OUT_BIN).format(key=key)))
        m = measure(tech, before, notch)
        print(f"   antes {m['before']}\n   depois {m['after']}\n   medidas {values}")
        print(f"   vasos e nervos do pedículo: {branches}")
        # the content hash keeps the service worker (cache first) from serving an older binary with newer data
        digest = hashlib.sha1(Path(str(OUT_BIN).format(key=key)).read_bytes()).hexdigest()[:10]
        techniques[key] = {
            "bin": f"models/hybrid/mammaplasty-{key}.bin?v={digest}", **box_,
            "frames": [{"id": fid, "label": label} for fid, label, _ in SCHEDULES[key]],
            "result": tech.result, "measurements": m, "measures": values, "pillarsMl": volumes, "branches": branches,
            "points": {**anchors(tech, writer), **extra_points},
            "meshes": records,
        }
        words = {"label": info["label"], "pedicle": info["pedicle"], "resection": info["resection"], "pillar": "Retalho" if key == "wise" else "Pilar"}
        for mesh in writer.meshes:
            kind = mesh["structure"][len("mamo-step-"): -len(key) - 1]
            structures.setdefault(mesh["structure"], {"label": KINDS[kind].format(**words), "group": "Mamoplastia", "visible": False, "labelAnchor": [round(float(x) * MM, 4) for x in mesh["full"][0].mean(0)], "meshNames": []})["meshNames"].append(mesh["name"])
            manifest.append({"name": mesh["name"], "structure": mesh["structure"], "tissue": mesh["tissue"], "source": bm.SOURCE, "sourceName": mesh["label"], "license": bm.LICENSE, "triangles": int(len(mesh["faces"])), "color": mesh["color"], "opacity": mesh["opacity"]})
        if figures_dir is not None:
            review(tech, writer, figures_dir)
    # where the skin of the trunk gives way to the patch of each technique (rest chart u, v of the operated side)
    hole = rest.uv(np.array(tech.patch.mesh_domain.buffer(-1.5).simplify(0.3).exterior.coords))
    out = {
        "version": 2, "source": bm.SOURCE, "state": bm.STATE, "nippleAboveFoldMm": NIPPLE_ABOVE_FOLD,
        "hole": [[round(float(u), 2), round(float(v), 2)] for u, v in hole],
        "techniques": techniques, "structures": structures, "meshes": manifest,
    }
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    sizes = ", ".join(f"{k} {v['byteLength'] / 1e3:.0f} kB" for k, v in techniques.items())
    print(f"wrote {OUT_JSON.relative_to(bb.ROOT)} ({OUT_JSON.stat().st_size / 1e3:.0f} kB) and binaries: {sizes}")


def out_direction(ch, centre: np.ndarray, st) -> np.ndarray:
    radial = radial_of(ch, centre)
    medial = np.array([ch.s, 0.0, 0.0])  # the operated side lies towards -x
    return radial * OUT_OFFSET["radial"] + medial * OUT_OFFSET["medial"] + np.array([0.0, -OUT_OFFSET["down"], 0.0])


def scar_lines(tech: Technique) -> list[tuple[str, np.ndarray]]:
    """Suture lines of the result in the isotropic rest chart (the skin the result state then shapes)."""
    rest, r = tech.rest, tech.areola_r
    circle = np.c_[r * np.sin(np.linspace(0, 2 * np.pi, 120)), r * np.cos(np.linspace(0, 2 * np.pi, 120))]
    fold_bottom = np.array([0.0, float(np.interp(tech.st.um, tech.st.us, tech.st.V[:, -1]))])
    out = [("Cicatriz periareolar", circle)]
    if tech.fold_ends is not None:
        out.append(("Cicatriz vertical", np.c_[np.zeros(60), np.linspace(-r, fold_bottom[1] + 0.5, 60)]))
        d, e = tech.fold_ends
        out.append(("Cicatriz no sulco", rest.outline_between(e, d, below=True)))
    else:
        f_y = float(tech.named["seam"][0, 1])
        out.append(("Cicatriz vertical", np.c_[np.zeros(40), np.linspace(-r, f_y, 40)]))
    return out


def review(tech: Technique, writer: Writer, out: Path) -> None:
    """Renders of every key frame (pieces inside the see-through skin) and of the result (opaque skin, scars)."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    from pilot_mammaplasty import splat

    out.mkdir(parents=True, exist_ok=True)
    ch, st, breast = tech.ch, tech.st, tech.breast
    other = bb.Breast("contra", (ch.xc, ch.zc))
    skin_pos, skin_idx = bb.mesh(bb.SKIN)
    q = ch.to_chart(skin_pos)
    iso = tech.rest.iso(q[:, :2])
    inside = shapely.contains_xy(tech.patch.mesh_domain.buffer(-1.5), iso[:, 0], iso[:, 1])
    trunk = ch.to_model(bb.deform(breast, q)[st.k])
    trunk = other.ch.to_model(bb.deform(other, other.ch.to_chart(trunk))[st.k])
    trunk_idx = skin_idx[~inside[skin_idx].all(1)]
    rgb = lambda h: tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))  # noqa: E731
    centre = tuple(ch.to_model(bb.deform(breast, ch.nipple[None])[st.k])[0] + np.array([10.0, 10.0, -40.0]))
    hidden = ("measures", "areolotome", "disc-ring", "scars")

    def frame(k: int, solid: bool):
        layers = [(trunk, trunk_idx, rgb(COLORS["skin"]), 1.0)]
        for m in writer.meshes:
            kind = m["structure"][len("mamo-step-"): -len(tech.key) - 1]
            if (kind in hidden and not (solid and kind == "scars")) or (solid and m["tissue"] in ("piece", "artery", "nerve")):
                continue
            alpha = 1.0 if (solid or m["tissue"] != "skin") else 0.3
            layers.append((m["full"][k], m["faces"], rgb(m["color"]), alpha))
        return np.hstack([splat(layers, yaw, pitch, centre, half=150, size=360, spacing=0.75) for yaw, pitch in ((0, 0), (45, 0), (88, 0))])

    rows = [frame(k, False) for k in range(3, writer.count)] + [frame(writer.count - 1, True)]
    plt.imsave(out / f"passos-{tech.key}.png", np.vstack(rows))


if __name__ == "__main__":
    main()
