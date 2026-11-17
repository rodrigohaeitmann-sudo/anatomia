#!/usr/bin/env python3
"""Tissue rearrangement of a reduction mammaplasty, step by step (docs/plano-mamoplastia.md, fase 4;
docs/plano-mamoplastia-tecnicas.md).

For each technique of build_mammaplasty.py and each case (bm.CASES: ptosis I to III, hypertrophies G3 and G4) this
script works out where every part of the operated breast goes, the patient standing, at the key frames of its schedule
(SCHEDULES):

  marcacao         the breast of the case with its marking, its measurements and the areolotome on its areola
  incisao          the same, the skin cut along the marking, the pedicle and the areola beyond the areolotome
                   de-epithelialised (free graft: the graft taken off)
  resseccao        the resection (and the skin over it) taken out
  transposicao     the pedicle carries the nipple-areola complex (and the vessels and nerves it keeps) to its new place,
                   turning on its base: in-between frames (transposicao:1, :2) put the way on an arc, not a chord
  closure stages   pillars, key stitch of the T, vertical suture, fold, areola - the order of each technique (the first
                   with a frame halfway into it); in Pitanguy's the skin closes over the areola, which is marked and let
                   out at the end. The last stage is the expected result. What is sutured to what is drawn: matched
                   edges in one colour, stitches

How (mammaplasty_result.py):
  * the skin of the breast is a mesh made in the rest chart, the lines of the marking among its edges;
  * the closure: where every point of the skin that stays goes when the pattern is sutured (areola edge round the
    areola, vertical limbs together under it, horizontal limbs onto the fold), solved in the rest chart;
  * the result: a breast state of build_breast.py (a small descent and a growth) whose mound has the volume left
    after the resection, whose nipple sits 1.5 cm above the fold and whose lower pole is round (its height
    ROUNDNESS times its projection, as at rest: a shorter one only flattens into a shelf at the fold), applied to the
    closed skin and to the tissue under it, which follows its skin; the pedicle is buried under the flaps except
    under the areola;
  * the areola rides on its pedicle with a collar (COLLAR, more for a long way), the pedicle and the pillars turn on
    their bases, and in every frame the pedicle, its dermis, the pillars and the vessels are kept behind the areola
    (keep_behind for the vertices, clear_front for the long triangles that still cross in front of it);
  * the base of the pedicle is held on the chest wall (Technique.anchor_of: its stalk, the root of an inferior
    pedicle, its deep layer away from the areola): the closure does not slide it and the transposition does not swing
    it, it only follows the breast as the result reshapes it (the map never moves the wall).

Outputs (per case; ptosis II without suffix, the others with -p1, -p3, -g3, -g4):
  src/data/mammaplastySteps<-case>.json                structures, meshes, frames, measurements before and after
  public/models/hybrid/mammaplasty-<tecnica><-case>.bin per technique: positions of every mesh at its key frames
                                                        (uint16, quantised over the technique's box) and indices

Usage: python3 scripts/hybrid/build_mammaplasty_steps.py [--case g3] [--figures DIR]   (after build_mammaplasty.py)
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import fast_simplification
import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).parent))
import build_breast as bb  # noqa: E402
import build_habitus as bh  # noqa: E402
import build_mammaplasty as bm  # noqa: E402
import mammaplasty_result as mr  # noqa: E402

OUT_JSON = bb.ROOT / "src/data/mammaplastySteps{suffix}.json"
OUT_BIN = bb.ROOT / "public/models/hybrid/mammaplasty-{key}.bin"
MM = bb.MM
# How far every group of the closure has gone at each key frame (0 open, 1 sutured). "global": all the skin that stays
# and the pedicle as it is covered; "deep": pillars or flaps; "T": B and C on the middle of the fold (key stitch);
# "vertical", "fold", "areola": the suture lines. Before the closure nothing has moved; ONE is the result.
ZERO = {"global": 0.0, "deep": 0.0, "T": 0.0, "vertical": 0.0, "fold": 0.0, "areola": 0.0}
ONE = {key: 1.0 for key in ZERO}
# In-between frames ("<id>:<k>", no view of their own): the transposition turns the pedicle on its base along an arc,
# which the viewer, interpolating key frames linearly, would otherwise cut short as a chord (the pedicle shrinking on the
# way); a free graft comes back to its bed from in front of it.
SUB = 2
TRANSPOSITION = [(f"transposicao:{k}", "Transposição do complexo areolopapilar", ZERO) for k in range(1, SUB + 1)] + [("transposicao", "Transposição do complexo areolopapilar", ZERO)]
OPENING = [
    ("marcacao", "Marcação", ZERO),
    ("incisao", "Incisão e desepitelização", ZERO),
    ("resseccao", "Ressecção", ZERO),
    *TRANSPOSITION,
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
    # periareolar: the ring is only de-epithelialised, the wedge leaves through its lower half, the gland is closed and
    # the purse-string suture brings the ring to the areola
    "periareolar": [
        ("marcacao", "Marcação", ZERO),
        ("incisao", "Desepitelização do anel", ZERO),
        ("resseccao", "Ressecção em cunha", ZERO),
        *[(fid, "Montagem da glândula", f) for fid, _, f in TRANSPOSITION],
        ("round-block", "Cerclagem (round block)", {"global": 0.55, "deep": 1.0, "T": 0.0, "vertical": 0.0, "fold": 0.0, "areola": 0.55}),
        ("areola", "Sutura da aréola", ONE),
    ],
    # free nipple graft: the graft is taken at the incision, the lower pole is amputated, the flaps are closed as an
    # inverted T and the graft is laid on a de-epithelialised bed at the apex of the cone (no transposition)
    "thorek": [
        ("marcacao", "Marcação", ZERO),
        ("incisao", "Incisão e coleta do enxerto", ZERO),
        ("resseccao", "Amputação do polo inferior", ZERO),
        ("ponto-t", "Ponto em T", {"global": 0.3, "deep": 0.6, "T": 1.0, "vertical": 0.45, "fold": 0.45, "areola": 0.3}),
        ("vertical", "Sutura vertical", {"global": 0.55, "deep": 0.9, "T": 1.0, "vertical": 1.0, "fold": 0.65, "areola": 0.55}),
        ("sulco", "Sutura no sulco: pele fechada", ONE),
        ("leito", "Leito do enxerto", ONE),
        ("enxerto:1", "Enxertia do complexo areolopapilar", ONE),
        ("enxerto", "Enxertia do complexo areolopapilar", ONE),
    ],
}
SCHEDULES["lejour"] = SCHEDULES["vertical"]  # same skin pattern and closure, another pedicle
SCHEDULES["orlando"] = SCHEDULES["wise"]


def halfway_into_closure(schedule: list) -> list:
    """The schedule with an in-between frame halfway into the first stage of the closure (the stage that moves the
    pillars and the skin the furthest: in one linear step they would swell and cut corners)."""
    ids = [fid for fid, _, _ in schedule]
    first = max(i for i, fid in enumerate(ids) if fid in ("resseccao", "transposicao")) + 1
    fid, label, f = schedule[first]
    half = {key: 0.5 * value for key, value in f.items()}
    return schedule[:first] + [(f"{fid}:1", label, half)] + schedule[first:]


SCHEDULES = {kind: halfway_into_closure(schedule) for kind, schedule in SCHEDULES.items()}
# lines of the marking that border the skin that stays, by suture group, for each skin pattern (bm.TECHNIQUES[...]["skin"])
LINE_GROUPS = {
    "t": {"edge": "areola", "med": "vertical", "lat": "vertical", "bd": "fold", "ce": "fold"},
    "keyhole": {"arc": "areola", "med": "vertical", "lat": "vertical", "bd": "fold", "ce": "fold"},
    "dome": {"dome": "areola", "med": "vertical", "lat": "vertical"},
    "ring": {"ring": "areola"},
}
OPENING_LINE = {"t": "edge", "keyhole": "arc", "dome": "dome", "ring": "ring"}  # the line sutured round the areola
FLAP_TECHNIQUES = ("wise", "orlando", "thorek")  # what stays beside the pattern is a skin flap, not a pillar
# the areola of each case on the standing skin, stretched by the hypertrophy: bm.CASES[case]["areolaNowMm"]
AREOLA_NEW = bm.AREOLA_D  # mm, the areolotome: diameter of the new areola
INSET = 9.0  # mm: in Pitanguy's technique the nipple-areola complex (its nipple stands 7.5 mm proud) and the pedicle
# under it wait this deep under the closed skin until the areola is opened
STITCH_STEP = 8.0  # mm between two stitches of a suture line
T_RADIUS = 10.0  # mm of the lines round B and C that the key stitch closes
# The lower pole of the result is shaped, not cut to a length: its height (nipple down to the lowest point of the breast,
# on the meridian) is ROUNDNESS times its projection (nipple to the wall at the fold), as in a breast at rest, whose lower
# pole curves round to the fold. Shortening it further only flattens it into a shelf at the fold: the skin from the
# nipple to the fold cannot be much shorter than the projection. The vertical pillar is then what that lower pole gives.
ROUNDNESS = 0.72
LOWER_POLE = (0.5, 1.4)  # range of the length of the lower pole in the map (1: as long as in the breast at rest)
# mm of pedicle round the areola that the transposition carries with it, rigidly (the dermal collar): at least COLLAR,
# and COLLAR_SHARE of the way the nipple goes (a long way leaves a wider ring of tissue behind, which would bunch up)
COLLAR = 12.0
COLLAR_SHARE = 0.22
BEHIND = 0.6  # mm: pedicle, dermis and vessels under the areola stay at least this far behind it
ANCHOR_FADE = 25.0  # mm over which the hold of the chest wall on a pedicle fades (anchor_of)
PEDICLE_OPACITY = 0.62  # the pedicle is drawn see-through (its vessels inside), the other pieces opaque
GRAFT_HOVER = 40.0  # mm in front of its bed that a free graft passes on its way back
NIPPLE_ABOVE_FOLD = 15.0  # mm, the new nipple in the standing result: a little above point A, the projection of the fold
# mm of trunk skin round the breast outline over which the result fades into the skin that stays (the large breasts
# change their outline more: a wider skirt)
SKIRTS = {"ptose-1": 15.0, "ptose-2": 15.0, "ptose-3": 20.0, "g3": 25.0, "g4": 25.0}
AREOLA_R = 13.2  # mm, the areola of the model in the rest chart (its radius on the skin)
BURY = bm.FLAP_THICKNESS  # the pedicle goes this deep under the flaps, except under the areola
SCAR_RADIUS = 0.55
SCAR_LIFT = 0.45
# mm: the excised skin and the resection leave the breast together (one specimen): a little forwards, then medially and
# down, to lie below the breast and in front of the epigastrium, where the frontal views of the steps see it whole
OUT_OFFSET = {"radial": 30.0, "medial": 65.0, "down": 95.0}  # for the specimen of ptosis II; larger ones go further
OUT_REFERENCE_ML = 180.0  # the specimen those offsets were made for (they grow with its cube root)
# mm: a free graft waits here (forwards, laterally and up from the breast) between its harvest and the grafting
GRAFT_ASIDE = {"radial": 60.0, "lateral": 75.0, "up": 55.0}
COLORS = {
    "skin": "#e7b8a0", "excised": "#e9a27f", "dermis": "#d97a82", "nac": "#9b5a47", "areola-ring": "#b07a64",
    "pedicle": "#3fae6b", "resection": "#e08a2e", "pillar-medial": "#4f7fd6", "pillar-lateral": "#9a6fd6", "scar": "#7d2f32",
    "marking": "#2536a8", "measure": "#f59e0b", "artery": "#d32f2f", "nerve": "#f5d547", "artery-cut": "#8d3b3b", "nerve-cut": "#a8944a",
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
    def __init__(self, kind: str, case: str, item: dict, st, front: bm.Front, inverse: bm.Inverse, rest: mr.Rest, mound_ml: float) -> None:
        # kind: the technique (bm.TECHNIQUES); skin: its skin pattern; key: its name in this case (the names of meshes and
        # structures); graft: the nipple-areola complex travels as a free graft (no pedicle)
        self.kind, self.case, self.key = kind, case, bm.case_key(kind, case)
        self.skin, self.graft = bm.TECHNIQUES[kind]["skin"], bool(item.get("graft"))
        self.seam_top = None
        self.item, self.st, self.front, self.inverse, self.rest = item, st, front, inverse, rest
        self.breast = st.b
        self.ch = st.b.ch
        self.removed_ml = item["resection"].volume
        self.result, self.nipple_above_fold = self.solve_result(mound_ml - self.removed_ml)
        # the new areola: the circle of the rest chart that the result shapes into an areola of the areolotome's size;
        # the opening of the pattern is sutured round it
        self.areola_r = self.areola_radius(AREOLA_NEW)
        lines = {name: rest.carry(xs) for name, xs in item["lines"].items()}
        self.regions_and_lines(lines)
        self.skirt = SKIRTS[case]
        self.patch = mr.SkinPatch(rest, [("nac", Point(0, 0).buffer(self.areola_r + 0.6, 64)), ("dermis", self.dermis), ("excised", self.pattern), ("stay", None)], self.named, skirt=self.skirt)
        self.closure = mr.Closure(self.patch, ("stay",), self.targets, self.areola_r, seam="seam" if "seam" in self.named else None, seam_top=self.seam_top)
        # the core of the pedicle (its stalk, held on the wall, does not swing)
        pedicle_rest = item["pedicle"].rest[: item["pedicle"].core_vertices]
        self.anchor_region = item["pedicle"].anchor
        rho = np.hypot(*rest.iso(pedicle_rest[:, :2]).T) if len(pedicle_rest) else np.zeros(1)
        # how far the nipple goes in the operation (standing breast to result), and the collar it takes along
        nipple_now = self.ch.to_model(bb.deform(self.breast, self.ch.nipple[None])[st.k])[0]
        nipple_then = self.ch.to_model(mr.state_map(self.breast, self.ch.nipple[None], self.result))[0]
        self.collar = max(COLLAR, COLLAR_SHARE * float(np.linalg.norm(nipple_then - nipple_now)))
        self.reach = max(float(np.percentile(rho, 98)), self.areola_r + self.collar + 10)  # how far the pedicle reaches from the nipple
        # the pivot of the transposition: the base of the pedicle (its points the swing leaves where they are); a free
        # graft, or a pedicle that all moves, turns about the chest wall behind the nipple
        self.pivot = self.ch.to_model(np.array([[st.um, 0.0, float(st.b.base(np.array([st.um]), np.array([0.0]))[0])]]))[0]
        if len(pedicle_rest):
            iso_p = rest.iso(pedicle_rest[:, :2])
            rho_p = np.hypot(iso_p[:, 0], iso_p[:, 1])
            base_p = st.b.base(pedicle_rest[:, 0], pedicle_rest[:, 1])
            t_p = np.clip((pedicle_rest[:, 2] - base_p) / np.maximum(st.skin_r(pedicle_rest[:, 0], pedicle_rest[:, 1]) - base_p, 0.5), 0, 1)
            inner = self.areola_r + self.collar
            w_p = smooth01(1 - (rho_p - inner) / max(self.reach - inner, 8.0)) * smooth01(t_p / 0.6)
            still = w_p < 0.15
            if still.sum() >= 12:
                self.pivot = self.ch.to_model(bb.deform(self.breast, pedicle_rest[still])[st.k]).mean(0)
        self.field = self.displacement_field()

    def nipple_to_fold(self, result: dict) -> float:
        """Skin length from the nipple down the meridian to the fold in a state of the breast (mm)."""
        st = self.st
        fold_v = float(np.interp(st.um, st.us, st.V[:, -1]))
        v = np.linspace(0, fold_v, 80)
        u = np.full(80, st.um)
        return float(bb.polyline_length(self.ch.to_model(mr.state_map(self.breast, np.c_[u, v, st.skin_r(u, v)], result))))

    def lower_pole(self, result: dict) -> tuple[float, float]:
        """Height of the lower pole of a state (nipple down to the lowest point of the breast skin on the meridian) and
        its projection (nipple to the wall at the fold), mm."""
        st = self.st
        fold_v = float(np.interp(st.um, st.us, st.V[:, -1]))
        v = np.linspace(0.0, fold_v, 240)
        u = np.full_like(v, st.um)
        model = self.ch.to_model(mr.state_map(self.breast, np.c_[u, v, st.skin_r(u, v)], result))
        nipple = self.ch.to_model(mr.state_map(self.breast, self.ch.nipple[None], result))[0]
        fold = self.ch.to_model(np.array([[st.um, fold_v, float(st.skin_r(np.array([st.um]), np.array([fold_v]))[0])]]))[0]
        return float(nipple[1] - model[:, 1].min()), float(nipple[2] - fold[2])

    def solve_result(self, volume_ml: float) -> tuple[dict, float]:
        """The result state with the remaining volume, the nipple NIPPLE_ABOVE_FOLD above the fold and a round lower pole:
        the length of the lower pole is solved (bisection) for a height of ROUNDNESS times the projection."""

        def ratio(length: float) -> tuple[float, dict]:
            result = mr.result_state(self.breast, volume_ml, NIPPLE_ABOVE_FOLD, length)
            height, projection = self.lower_pole(result)
            return height / max(projection, 1.0), result

        lo, hi = LOWER_POLE
        r_lo, result = ratio(lo)
        if r_lo < ROUNDNESS:
            r_hi, result = ratio(hi)
            if r_hi > ROUNDNESS:
                for _ in range(6):
                    mid = (lo + hi) / 2
                    r_mid, _ = ratio(mid)
                    lo, hi = (mid, hi) if r_mid < ROUNDNESS else (lo, mid)
                _, result = ratio((lo + hi) / 2)
        self.lower_pole_mm = self.lower_pole(result)
        return result, NIPPLE_ABOVE_FOLD

    def inset(self, q: np.ndarray) -> np.ndarray:
        """Pitanguy: rest chart points pushed in under the new areola, where the closed skin covers the nipple-areola
        complex until the areola is opened (identity elsewhere and in the other techniques)."""
        if self.kind != "pitanguy":
            return q
        rho = np.hypot(*self.rest.iso(q[:, :2]).T)
        out = q.copy()
        # what is held on the wall (anchor_of) stays where it is
        out[:, 2] -= INSET * (1 - smooth01((rho - self.areola_r) / 22.0)) * (1 - self.anchor_of(q))
        return out

    def anchor_of(self, q: np.ndarray) -> np.ndarray:
        """How firmly each point of the pedicle (rest chart q) is held where it is, from 0 (it goes with its skin and the
        areola) to 1 (on the chest wall: the closure does not slide it and the transposition does not swing it). Held:
        the stalk and the root of an inferior pedicle, where it is attached to the wall, fading over ANCHOR_FADE mm into
        the pedicle, which is free beyond (dissected, it turns on its base); a central pedicle, which is not lifted off
        the wall, also keeps all its deep layer. Never held: the skin and the dermis on the pedicle, which close with the
        skin round them, and the collar of tissue round the areola, which goes with it."""
        u, v, r = q[:, 0], q[:, 1], q[:, 2]
        base = self.breast.base(u, v)
        t = np.clip((r - base) / np.maximum(self.st.skin_r(u, v) - base, 0.5), 0, 1)
        rho = np.hypot(*self.rest.iso(q[:, :2]).T)
        collar = 1 - smooth01((rho - self.areola_r - self.collar) / 10.0)
        held = np.zeros(len(q))
        if not self.anchor_region.is_empty:
            uv = bb.deform(self.breast, q)[self.st.k][:, :2]
            beyond = shapely.distance(self.anchor_region, shapely.points(uv))
            held = np.where(beyond <= 0.0, 1.0, (1 - smooth01(beyond / ANCHOR_FADE)) * (1 - collar))
        if self.kind == "periareolar":
            held = np.maximum(held, 1 - smooth01(t / 0.45))
        return held * (1 - smooth01((t - 0.88) / 0.1))

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
        key = self.skin
        if key == "ring":
            # periareolar: the whole ring is de-epithelialised and closes round the areola; below it the skin that stays
            # is cut along the meridian only for the solution (a seam, as below the vertical pattern)
            ring = lines["anel"]
            ring[-1] = ring[0]
            self.pattern = Polygon(ring).buffer(0)
            self.dermis = self.pattern
            bottom = np.array([0.0, float(np.interp(self.st.um, self.st.us, self.st.V[:, -1]))])
            seam = np.array([[0.0, float(ring[0, 1])], bottom + [0, 0.5]])
            self.seam_top = float(abs(ring[0, 1]))
            self.named = {"ring": ring, "seam": seam}
            self.targets = {"ring": lambda f: (-np.pi + 2 * np.pi * f, 0.0)}
            self.fold_ends = None
        elif key == "keyhole":
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
        elif key == "t":
            med, lat, bd, ce = (lines[k] for k in ("ramo medial", "ramo lateral", "horizontal medial", "horizontal lateral"))
            bd[-1], ce[-1] = rest.snap(bd[-1]), rest.snap(ce[-1])
            fold = rest.outline_between(ce[-1], bd[-1], below=True)
            self.pattern = Polygon(np.vstack([lat, ce, fold[1:-1], bd[::-1], med[::-1]])).buffer(0)
            # the superior pedicle: from the areola up to the new areola site round A, de-epithelialised (free graft: only
            # the site round A, outside the pattern: the bed of the graft)
            self.dermis = front_to_iso(self.front, self.inverse, rest, biggest(item["footprint"]))
            if self.graft:
                self.dermis = biggest(self.dermis.difference(self.pattern).buffer(0))
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
        """Model positions (mm) in the result of rest chart points: skin that stays, pillar, pedicle. A pedicle goes with
        the closure of its skin only as far as it is free (anchor_of): what is held keeps its place on the chest wall and
        only follows the breast as it changes shape (the map of the result, which never moves the wall)."""
        st, breast, rest = self.st, self.breast, self.rest
        u, v, r = rest_chart[:, 0], rest_chart[:, 1], rest_chart[:, 2]
        base = breast.base(u, v)
        depth_rest = np.maximum(st.skin_r(u, v) - base, 0.5)
        t = np.clip((r - base) / depth_rest, 0, 1.2)
        iso = rest.iso(np.c_[u, v])
        free = 1 - self.anchor_of(rest_chart) if role == "pedicle" else np.ones(len(iso))
        moved = iso + free[:, None] * self.field(iso)
        uv2 = rest.uv(moved)
        base2 = breast.base(uv2[:, 0], uv2[:, 1])
        depth2 = np.maximum(st.skin_r(uv2[:, 0], uv2[:, 1]) - base2, 0.5)
        if role == "pedicle" and buried:
            rho = np.hypot(moved[:, 0], moved[:, 1])
            cover = BURY * smooth01((rho - self.areola_r) / 8.0) * free
            depth2 = np.maximum(depth2 - cover, 0.5)
        chart = np.c_[uv2, base2 + t * depth2]
        out = self.ch.to_model(mr.state_map(breast, chart, self.result))
        if role == "pedicle":
            # what is held on the wall does not slide over the fascia either (the map of the breast lets its deep tissue
            # slide, as a ptotic breast does): it keeps its place, and the tissue over it follows the breast less the
            # deeper it lies
            hold = (1 - free) * (1 - smooth01(np.minimum(t, 1.0) / 0.6))
            here = self.standing(rest_chart)
            out = here + (1 - hold)[:, None] * (out - here)
        return out

    def skin_final(self, rest_chart: np.ndarray) -> np.ndarray:
        return self.ch.to_model(mr.state_map(self.breast, rest_chart, self.result))

    def swing(self, rest_chart: np.ndarray, start: np.ndarray, end: np.ndarray) -> np.ndarray:
        """Transposition: the pedicle reaches its place, the areola with a collar (self.collar mm) round it, turning on its
        base (arcs about the pivot, not chords); the base, what anchor_of holds on the chest wall, does not move, and
        the tissue next to it goes only as far as it is free."""
        # all of the pedicle that is free gets to its place: what is only part of the way folds into sheets
        return self.arc(start, end, 1 - self.anchor_of(rest_chart))

    def arc(self, start: np.ndarray, end: np.ndarray, w, pivot: np.ndarray | None = None) -> np.ndarray:
        """Points from start to end by the fraction w (per point or one for all) along arcs about a pivot (default: that
        of the pedicle), their distance to it blended linearly: tissue turning on its base keeps its bulk on the way."""
        pivot = self.pivot if pivot is None else pivot
        w = np.broadcast_to(np.asarray(w, float), (len(start),))
        a, b = start - pivot, end - pivot
        la, lb = np.linalg.norm(a, axis=1), np.linalg.norm(b, axis=1)
        ua, ub = a / np.maximum(la, 1e-9)[:, None], b / np.maximum(lb, 1e-9)[:, None]
        angle = np.arccos(np.clip(np.einsum("ij,ij->i", ua, ub), -1.0, 1.0))
        sin = np.sin(angle)
        straight = sin < 1e-4
        k1 = np.where(straight, 1 - w, np.sin((1 - w) * angle) / np.where(straight, 1.0, sin))
        k2 = np.where(straight, w, np.sin(w * angle) / np.where(straight, 1.0, sin))
        direction = k1[:, None] * ua + k2[:, None] * ub
        arc = pivot + direction * (la + w * (lb - la))[:, None]
        # close to the pivot, or turning almost about, the direction is unstable: there the way is straight
        steady = smooth01((np.minimum(la, lb) - 10.0) / 25.0) * smooth01((2.6 - angle) / 0.6)
        return start + w[:, None] * (end - start) + steady[:, None] * (arc - start - w[:, None] * (end - start))


# --------------------------------------------------------------------------------------------------
# pillars: the tissue that stays under the skin of the lower pole, medial and lateral of the pattern
# --------------------------------------------------------------------------------------------------
def pillars(flaps: bool, item: dict, front: bm.Front, inverse: bm.Inverse, st) -> dict:
    a_uv = item["a"]
    nipple_u = float(front.project(st.chart_of_rest(st.um, 0.0)[None])[0, 0])
    lower = front.domain.intersection(box(front.u0 - 50, front.v0 - 50, front.u0 + 500, float(a_uv[1])))
    taken = unary_union([item["pattern"], biggest(item["footprint"])]).buffer(0.5)
    resection = item["resection"]

    def bottom(uv):
        floor = front.bottom_full(uv)
        if flaps:
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
        # body habitus of the case (docs/plano-pele-habito-vasos.md): skin patch at the first frame and the offset of
        # each of its vertices (computed at rest); every mesh takes the offset of the patch vertex nearest to it
        self.habitus: tuple | None = None

    def habitus_offsets(self, points: np.ndarray) -> np.ndarray:
        if self.habitus is None:
            return np.zeros_like(points)
        tree, offsets = self.habitus
        return offsets[tree.query(points)[1]]

    def apply_habitus(self) -> None:
        """Adds the offset of the habitus to every frame of every mesh (the trunk round the patch moves with it)."""
        if self.habitus is None:
            return
        for m in self.meshes:
            offset = self.habitus_offsets(m["full"][0])
            m["full"] = [f + offset for f in m["full"]]
            m["frames"] = {k: f + offset for k, f in m["frames"].items()}

    def add(self, name: str, structure: str, label: str, color: str, opacity: float, tissue: str, faces: np.ndarray, frames: list) -> None:
        assert len(frames) == self.count, name
        faces = np.asarray(faces)
        if not len(faces):
            return  # a part this technique does not have (no excised skin in a periareolar pattern, say)
        used = np.unique(faces)
        remap = -np.ones(max(int(faces.max()) + 1, 1), int)
        remap[used] = np.arange(len(used))
        frames = [np.asarray(f, float)[used] for f in frames]
        stored, previous = {0: frames[0]}, frames[0]
        for k in range(1, self.count):
            if np.abs(frames[k] - previous).max() > 0.005:
                stored[k] = previous = frames[k]
        self.meshes.append({"name": name, "structure": structure, "label": label, "color": color, "opacity": opacity, "tissue": tissue, "faces": remap[faces], "frames": stored, "full": frames})

    def settle(self, disc_name: str, structures: set[str], hint) -> None:
        """Every mesh of `structures` kept behind the disc of the areola in every frame (keep_behind, then clear_front for
        the triangles that still cross in front of it; `hint(centre)`: the direction away from the chest there); the
        frames where each mesh moves are then stored again."""
        disc = next((m for m in self.meshes if m["name"] == disc_name), None)
        if disc is None:
            return
        for m in self.meshes:
            if m["structure"] not in structures:
                continue
            full = []
            for k, frame in enumerate(m["full"]):
                ring, away = disc["full"][k], hint(disc["full"][k].mean(0))
                full.append(clear_front(keep_behind(frame, ring, disc["faces"], away), m["faces"], ring, disc["faces"], away))
            stored, previous = {0: full[0]}, full[0]
            for k in range(1, self.count):
                if np.abs(full[k] - previous).max() > 0.005:
                    stored[k] = previous = full[k]
            m["full"], m["frames"] = full, stored

    def write(self, path: Path) -> tuple[list[dict], dict]:
        self.apply_habitus()
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
    """A polyline resampled every `step` mm (the first three columns are the position; any further columns, values
    carried along it, are interpolated the same way)."""
    p = np.asarray(points, float)
    s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(p[:, :3], axis=0), axis=1))]
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


def sector_faces(rings: int, rays: int) -> np.ndarray:
    """Triangles of a polar sector: centre vertex (index 0), then `rings` rings of `rays` vertices from one border ray
    to the other (not joined: the two border rays meet only when the sector is closed into a cone)."""
    faces = [[0, 1 + j, 2 + j] for j in range(rays - 1)]
    for r in range(rings - 1):
        a, b = 1 + r * rays, 1 + (r + 1) * rays
        for j in range(rays - 1):
            faces += [[a + j, a + j + 1, b + j], [a + j + 1, b + j + 1, b + j]]
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
    for name, g in LINE_GROUPS[tech.skin].items():
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


def transposed(ids: list[str], i: int) -> float:
    """How far the transposition has gone at key frame i: 0 before it, k / (SUB + 1) at its in-between frames, 1 from the
    transposition on."""
    if ids[i].startswith("transposicao:"):
        return int(ids[i].split(":")[1]) / (SUB + 1)
    return 1.0 if "transposicao" in ids and i >= ids.index("transposicao") else 0.0


def keep_behind(points: np.ndarray, disc: np.ndarray, disc_faces: np.ndarray, hint: np.ndarray, depth: float = BEHIND, reach: float = 10.0) -> np.ndarray:
    """Tissue under the areola kept behind it: a point in front of the disc of the areola, or less than `depth` behind it,
    goes back along the disc's normal (oriented along `hint`, away from the chest); fully over the disc, fading to
    nothing `reach` mm beyond its rim."""
    import trimesh

    centre = disc.mean(0)
    radius = float(np.linalg.norm(disc - centre, axis=1).max())
    near = np.nonzero(np.linalg.norm(points - centre, axis=1) < radius + reach + 25.0)[0]
    if not len(near):
        return points
    mesh = trimesh.Trimesh(disc, disc_faces, process=False)
    closest, _, face = trimesh.proximity.closest_point(mesh, points[near])
    normal = mesh.face_normals[face]
    normal = normal * np.where(normal @ hint < 0, -1.0, 1.0)[:, None]
    offset = points[near] - closest
    height = np.einsum("ij,ij->i", offset, normal)
    lateral = np.linalg.norm(offset - height[:, None] * normal, axis=1)
    push = np.maximum(height + depth, 0.0) * (1.0 - smooth01(lateral / reach))
    out = points.copy()
    out[near] -= normal * push[:, None]
    return out


def clear_front(points: np.ndarray, faces: np.ndarray, disc: np.ndarray, disc_faces: np.ndarray, hint: np.ndarray, depth: float = BEHIND, reach: float = 25.0, rounds: int = 4) -> np.ndarray:
    """What keep_behind leaves in front of the areola. It moves vertices, and fades beside the disc: a long triangle
    (the pillars of the large breasts have edges of several centimetres) with corners beside the disc can still cross
    the column in front of it. Rays from the disc (its vertices and face centres, along the normal of its plane and of
    each face) find such triangles up to `reach` mm in front, and their corners go back along the ray until the
    triangle is `depth` behind the disc; repeated while a ray hits something."""
    import trimesh

    disc_mesh = trimesh.Trimesh(disc, disc_faces, process=False)
    centre = disc.mean(0)
    axis = np.linalg.svd(disc - centre)[2][2]
    axis = axis if axis @ hint >= 0 else -axis
    face_normal = disc_mesh.face_normals * np.where(disc_mesh.face_normals @ hint < 0, -1.0, 1.0)[:, None]
    centres = disc_mesh.triangles_center
    dirs = np.vstack([np.repeat(axis[None], len(disc) + len(centres), 0), face_normal])
    starts = np.vstack([disc, centres, centres]) - dirs * depth
    radius = float(np.linalg.norm(disc - centre, axis=1).max())
    out = points.copy()
    for _ in range(rounds):
        corners = out[faces]
        middle = corners.mean(1)
        size = np.linalg.norm(corners - middle[:, None], axis=2).max(1)
        near = np.nonzero(np.linalg.norm(middle - centre, axis=1) < radius + reach + size)[0]
        if not len(near):
            break
        loc, ray, hit = trimesh.Trimesh(out, faces[near], process=False).ray.intersects_location(starts, dirs, multiple_hits=True)
        if not len(loc):
            break
        dist = np.einsum("ij,ij->i", loc - starts[ray], dirs[ray])
        keep = dist < reach + depth
        if not keep.any():
            break
        push, way = np.zeros(len(out)), np.zeros_like(out)
        for r, t, d in zip(ray[keep], hit[keep], dist[keep]):
            for v in faces[near[t]]:
                if d > push[v]:
                    push[v], way[v] = d, dirs[r]
        out -= way * (push + 0.05 * (push > 0))[:, None]
    return out


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
    tracks = {name: line_track(patch, name) for name in LINE_GROUPS[tech.skin]}

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

    # vertical: the two limbs meet along the meridian, fraction to fraction (a periareolar ring has none)
    if "med" in tracks:
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
    opening = OPENING_LINE[tech.skin]
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
def neurovascular_tracks(tech: Technique, item: dict, pillar_pieces: dict, anatomy: dict, report: dict, schedule: list, out_dir: np.ndarray, pedicle_frames) -> list[dict]:
    """Every schematic branch (src/data/breastAnatomy.json) through the key frames, as the tissue it runs in goes. The parts
    in the resection, or under the excised skin and superficial, leave with the specimen and are gone once it is put aside;
    the part in the pedicle goes where the pedicle goes (folded in the transposition, buried in the closure); the parts in
    the pillars, and in the rest of the breast, follow them; the origin on the chest wall stays put. A branch is cut where
    it passes from removed tissue into tissue that stays. Returns one record per piece of branch."""
    st, ch, breast, front = tech.st, tech.ch, tech.breast, tech.front
    key = tech.kind
    ids = [fid for fid, _, _ in schedule]
    fr = [f for _, _, f in schedule]
    t2 = ids.index("resseccao")
    t3 = ids.index("transposicao") if "transposicao" in ids else t2  # free graft: nothing is transposed
    tissue_of = {m["name"]: m["tissue"] for m in anatomy["meshes"]}

    def smooth(x: np.ndarray, width: int = 7) -> np.ndarray:
        pad = width // 2
        return np.convolve(np.pad(x, pad, mode="edge"), np.ones(width) / width, mode="valid")

    out = []
    for name, geometry in anatomy["geometry"].items():
        if geometry["kind"] != "tube":
            continue
        kept = not (report[name][key]["insideMm"] >= 4.0 or report[name][key]["incisions"] > 0)
        rest_pts = np.array(geometry["points"]).reshape(-1, 3) / MM
        # the push that keeps the course under the skin in this state, carried along by the resampling
        push = np.zeros_like(rest_pts)
        for index, *shift in geometry.get("clearance", {}).get(bb.STATES[st.k]["id"], []):
            push[index] = np.array(shift) / MM
        dense = resample(np.c_[rest_pts, push], 1.5)
        pts, push = dense[:, :3], dense[:, 3:]
        q = ch.to_chart(pts)
        k0 = ch.to_model(bb.deform(breast, q)[st.k]) + push
        standing = ch.to_chart(k0)
        uv = standing[:, :2]
        in_pattern = shapely.contains_xy(item["pattern"], uv[:, 0], uv[:, 1])
        on_pedicle = shapely.contains_xy(item["footprint"].buffer(1.0), uv[:, 0], uv[:, 1])
        superficial = standing[:, 2] >= front.top(uv) - bm.FLAP_THICKNESS
        removed = item["resection"].contains(standing) | (in_pattern & superficial & ~on_pedicle)
        m_ped = smooth(item["pedicle"].contains(standing).astype(float))
        m_pil = {side: smooth(piece.contains(standing).astype(float)) for side, piece in pillar_pieces.items()}
        total = m_ped + sum(m_pil.values())
        scale = np.where(total > 1, 1 / np.maximum(total, 1e-9), 1.0)
        m_ped = m_ped * scale
        m_pil = {side: value * scale for side, value in m_pil.items()}
        m_stay = np.clip(1 - m_ped - sum(m_pil.values()), 0, 1)
        anchor = smooth01((q[:, 2] - breast.base(q[:, 0], q[:, 1])) / 8.0)
        # where each tissue takes the point (Pitanguy: the pedicle under the areola waits deeper until it is opened)
        q_in = tech.inset(q)
        swing = tech.swing(q, k0, tech.final(q, "pedicle", buried=False))
        swing_in = tech.swing(q, k0, tech.final(q_in, "pedicle", buried=False))
        buried = tech.final(q, "pedicle", buried=True)
        buried_in = tech.final(q_in, "pedicle", buried=True)
        later = tech.final(q, "stay")
        frames = []
        for i, f in enumerate(fr):
            if i < t3:
                # before the transposition nothing moves; on its way, the pedicle's share goes along the arc
                s_ = transposed(ids, i)
                frames.append(k0 if s_ == 0 else k0 + anchor[:, None] * (m_ped[:, None] * (tech.arc(k0, swing, s_) - k0)))
                continue
            waiting = key == "pitanguy" and t3 < i and ids[i] != "abertura"
            sw, bu = (swing_in, buried_in) if waiting else (swing, buried)
            ped = sw if i == t3 else sw + f["global"] * (bu - sw)
            move = m_ped[:, None] * (ped - k0)
            if i > t3:
                move += sum(m_pil[side][:, None] * (tech.arc(k0, later, f["deep"], tech.pillar_pivot[side]) - k0) for side in m_pil if f["deep"] > 0)
                move += m_stay[:, None] * f["global"] * (later - k0)
            frames.append(k0 + anchor[:, None] * move)
        radii = np.linspace(geometry["radiusMm"][0], geometry["radiusMm"][1], len(pts)) * 0.8
        # pieces of the branch: runs of removed or remaining tissue (the cut is the gap between two runs)
        bounds = np.r_[0, np.nonzero(removed[1:] != removed[:-1])[0] + 1, len(pts)]
        for run, (a, b) in enumerate(zip(bounds[:-1], bounds[1:])):
            if b - a < 2:
                continue
            gone = bool(removed[a])
            if gone:
                # with the specimen: out at the resection, then gathered to a point once the specimen is put aside
                centre = (k0[a:b] + out_dir).mean(0)
                piece_frames = [k0[a:b] if i < t2 else (k0[a:b] + out_dir if i <= t3 else np.repeat(centre[None], b - a, 0)) for i in range(len(fr))]
            else:
                piece_frames = [frame[a:b] for frame in frames]
            first = tube_mesh(piece_frames[0], radii[a:b], 6)
            normal0 = first[0][0] - piece_frames[0][0]
            out.append({
                "name": f"{name}_{run}", "branch": name, "tissue": tissue_of[name], "kept": kept, "removed": gone,
                "frames": [tube_mesh(frame, radii[a:b], 6, normal0=normal0)[0] for frame in piece_frames], "faces": first[1],
            })
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
    "arteries": "Artérias que chegam ao mamilo ({label})",
    "arteries-cut": "Artérias cortadas ({label})",
    "nerves": "Nervos que chegam ao mamilo ({label})",
    "nerves-cut": "Nervos cortados ({label})",
    "sutures": "Suturas ({label})",
    "sutures-areola": "Sutura da aréola ({label})",
    "disc": "Pele sobre a aréola ({label})",
    "disc-ring": "Marcação da nova aréola ({label})",
    "scars": "Cicatrizes ({label})",
}
# the parts that mean something else with a free graft or in a periareolar pattern
GRAFT_KINDS = {
    "dermis": "Leito do enxerto ({label})",
    "nac": "Enxerto do complexo areolopapilar ({label})",
    "disc-ring": "Marcação do leito do enxerto ({label})",
    "sutures-areola": "Sutura do enxerto ({label})",
}
RING_KINDS = {
    "dermis": "Anel desepitelizado ({label})",
    "sutures-areola": "Cerclagem e sutura da aréola ({label})",
}


def build(kind: str, case: str, item: dict, st, front, inverse, rest, mound_ml: float, nacs: list, anatomy: dict, report: dict, before: dict, notch: np.ndarray):
    info = bm.TECHNIQUES[kind]
    tech = Technique(kind, case, item, st, front, inverse, rest, mound_ml)
    key = tech.key
    areola_now = bm.CASES[case]["areolaNowMm"]
    patch, closure, ch, breast = tech.patch, tech.closure, tech.ch, tech.breast
    schedule = SCHEDULES[kind]
    ids = [fid for fid, _, _ in schedule]
    fr = [f for _, _, f in schedule]
    nf = len(schedule)
    t2 = ids.index("resseccao")
    t3 = ids.index("transposicao") if "transposicao" in ids else t2  # free graft: nothing is transposed
    t_harvest = ids.index("incisao")
    graft = tech.graft
    pillar_word = "Retalho" if kind in FLAP_TECHNIQUES else "Pilar"
    print(f"{info['label']}: pele {len(patch.iso)} vértices; aréola nova {2 * tech.areola_r:.1f} na carta; fechamento: {closure.unassigned} sem condição, {closure.flipped} triângulos invertidos (degenerados no sulco)")
    print(f"   resultado: descida {tech.result['descent']} mm, crescimento {tech.result['growth']}")
    w = Writer(nf)
    sid = lambda kind: f"mamo-step-{kind}-{key}"  # noqa: E731

    def waiting(i: int) -> bool:
        """Pitanguy: once the flaps start to close over them, the areola and the pedicle under it wait deeper, under the
        skin, until the opening."""
        return kind == "pitanguy" and i > t3 and ids[i] != "abertura"

    def pedicle_like(q, k0):
        """Pedicle tissue (rest chart q, first frame k0): swung in the transposition, buried as the closure goes."""
        flat, buried = tech.final(q, "pedicle", buried=False), tech.final(q, "pedicle", buried=True)
        q_in = tech.inset(q)
        flat_in, buried_in = tech.final(q_in, "pedicle", buried=False), tech.final(q_in, "pedicle", buried=True)
        swing, swing_in = tech.swing(q, k0, flat), tech.swing(q, k0, flat_in)
        out = []
        for i in range(nf):
            sw, bu = (swing_in, buried_in) if waiting(i) else (swing, buried)
            if i < t3:
                s_ = transposed(ids, i)
                out.append(k0 if s_ == 0 else tech.arc(k0, sw, s_))
            else:
                out.append(sw if i == t3 else sw + fr[i]["global"] * (bu - sw))
        return out

    def nac_like(q, k0, final):
        """Skin of the areola (rest chart q): carried by the pedicle along its arc, at its place from the transposition
        on (Pitanguy: deeper until opened)."""
        inside = tech.skin_final(tech.inset(q))
        out = []
        for i in range(nf):
            if i < t3:
                s_ = transposed(ids, i)
                out.append(k0 if s_ == 0 else tech.arc(k0, final, s_))
            else:
                out.append(inside if waiting(i) else final)
        return out

    def removed(k0, shift):
        return [k0 if i < t2 else k0 + shift for i in range(nf)]

    def static(points):
        return [points] * nf

    # where a free graft waits between its harvest and the grafting: forwards, laterally and up from the breast
    nipple_now = ch.to_model(bb.deform(breast, ch.nipple[None])[st.k])[0]
    graft_dir = radial_of(ch, nipple_now) * GRAFT_ASIDE["radial"] + np.array([-ch.s, 0.0, 0.0]) * GRAFT_ASIDE["lateral"] + np.array([0.0, GRAFT_ASIDE["up"], 0.0])

    def graft_like(k0, final):
        """Free graft: lifted off at the incision, kept aside while the breast is amputated and closed, brought in front
        of its bed and laid on it in the last frame."""
        hover = radial_of(ch, final.mean(0)) * GRAFT_HOVER
        out = []
        for i in range(nf):
            if i < t_harvest:
                out.append(k0)
            elif i == nf - 1:
                out.append(final)
            elif ids[i].startswith("enxerto:"):
                out.append(final + hover)
            else:
                out.append(k0 + graft_dir)
        return out

    # ---- skin -------------------------------------------------------------------------------------------------
    k0 = tech.standing(patch.rest_chart)
    from scipy.spatial import cKDTree

    if bh.OUT_JSON.exists():
        w.habitus = (cKDTree(k0), bh.displacements(ch.to_model(patch.rest_chart), skin=True)[st.k])
    uv_final = patch.rest_uv.copy()
    uv_final[closure.vertices] = closure.target_uv
    stay_final = tech.skin_final(np.c_[uv_final, st.skin_r(uv_final[:, 0], uv_final[:, 1]) + patch.lift])
    # the skirt: trunk skin round the outline, where the result fades into the skin that stays as it is
    from scipy.spatial import cKDTree

    skirt = np.unique(patch.faces("skirt"))
    rim_ids = np.nonzero(patch.on_outline)[0]
    distance, nearest = cKDTree(patch.iso[rim_ids]).query(patch.iso[skirt])
    fade = (1 - smooth01(distance / tech.skirt))[:, None]
    stay_final[skirt] = k0[skirt] + fade * (stay_final[rim_ids[nearest]] - k0[rim_ids[nearest]])
    print(f"   contorno: o resultado se afasta até {float(np.linalg.norm(stay_final[rim_ids] - k0[rim_ids], axis=1).max()):.1f} mm da pele em pé; a saia de {tech.skirt:.0f} mm absorve")
    skin = staged_skin(tech, k0, stay_final, schedule)
    w.add(f"mamo_{key}_step_skin", sid("skin"), "Pele que fica", COLORS["skin"], 1.0, "skin", patch.faces("stay", "skirt"), skin)
    nac_final = tech.skin_final(patch.rest_chart)
    excised_ids = np.unique(patch.faces("excised"))
    res_k0 = ch.to_model(item["resection"].standing)
    # where the specimen is put aside (a periareolar pattern excises no skin: the wedge alone shows the way)
    out_dir = out_direction(ch, (k0[excised_ids] if len(excised_ids) else res_k0).mean(0), st, item["resection"].volume)
    if graft:
        # free graft: the skin the graft was taken from leaves with the specimen
        w.add(f"mamo_{key}_step_nac_skin", sid("excised"), "Área doadora do enxerto", COLORS["skin"], 1.0, "skin", patch.faces("nac"), removed(k0, out_dir))
    else:
        w.add(f"mamo_{key}_step_nac_skin", sid("skin"), "Pele sob a aréola", COLORS["skin"], 1.0, "skin", patch.faces("nac"), nac_like(patch.rest_chart, k0, nac_final))
    # skin coloured: the views of the incision onwards tint them (excised skin, de-epithelialised dermis)
    w.add(f"mamo_{key}_step_excised", sid("excised"), "Pele ressecada", COLORS["skin"], 1.0, "skin", patch.faces("excised"), removed(k0, out_dir))
    # the dermis lies on the pedicle: a little off its surface, or the two would flicker into each other (the bed of a
    # free graft is drawn further on, as a sector that closes into a cone)
    dermis_faces = patch.faces("dermis")
    if not graft:
        w.add(f"mamo_{key}_step_dermis", sid("dermis"), "Derme desepitelizada do pedículo", COLORS["skin"], 1.0, "skin", dermis_faces, [outward(f, dermis_faces, 0.8) for f in pedicle_like(patch.rest_chart, k0)])

    # ---- the areola: the areolotome marks the new one on the larger areola of the case ----------------------------
    nipple = st.chart_of_rest(st.um, 0.0)
    n = 48
    disc_radii = [AREOLA_NEW / 2 * k / 6 for k in range(1, 7)]
    ring_radii = list(np.linspace(AREOLA_NEW / 2, areola_now / 2, 4))
    grid = nipple_grid(st, nipple, disc_radii + ring_radii[1:], n)
    lift_areola = 0.4
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
    disc = graft_like(disc_k0, disc_final) if graft else nac_like(disc_chart, disc_k0, disc_final)
    disc_faces = polar_faces(6, n, centre=True)
    w.add(f"mamo_{key}_step_areola", sid("nac"), "Nova aréola", COLORS["nac"], 1.0, "areola", disc_faces, disc)
    rim = 1 + 5 * n + np.arange(n)
    rim_theta = theta[rim]
    ring_xs = grid[5:].reshape(-1, 2)
    q_ring = st.skin(ring_xs, lift_areola)
    ring_k0 = st.model(q_ring)
    ring_faces = polar_faces(4, n, centre=False)
    # the areola beyond the areolotome is de-epithelialised with the pedicle (free graft: it leaves with the specimen)
    w.add(f"mamo_{key}_step_areola_ring", sid("areola-ring"), "Aréola além do areolótomo", COLORS["areola-ring"], 1.0, "areola", ring_faces,
          [outward(f, ring_faces, 0.8) for f in (removed(ring_k0, out_dir) if graft else pedicle_like(q_ring, ring_k0))])
    tome = st.model(st.skin(grid[5], 0.6))
    v_, f_ = tube_mesh(np.vstack([tome, tome[:1]]), 0.5, 6)
    w.add(f"mamo_{key}_step_areolotome", sid("areolotome"), "Areolótomo", COLORS["marking"], 1.0, "marking", f_, static(v_))
    for name, pos, idx in nacs:
        q = ch.to_chart(pos)
        a = ch.to_model(bb.deform(breast, q)[st.k])
        w.add(f"mamo_{key}_step_{name.split('_')[-2]}", sid("nac"), "Complexo areolopapilar", COLORS["nac"], 1.0, "areola", idx, graft_like(a, tech.skin_final(q)) if graft else nac_like(q, a, tech.skin_final(q)))

    # ---- pieces -------------------------------------------------------------------------------------------------
    ped, res = item["pedicle"], item["resection"]
    pedicle_frames = None
    if ped.volume > 0:
        ped_k0 = ch.to_model(ped.standing)
        pedicle_frames = pedicle_like(ped.rest, ped_k0)
        held = tech.anchor_of(ped.rest) >= 0.95
        if held.any():
            q = ped.rest
            on_wall = held & ((q[:, 2] - breast.base(q[:, 0], q[:, 1])) < 3.0)
            moves = np.linalg.norm(np.stack(pedicle_frames) - ped_k0, axis=2).max(0)
            print(f"   pedículo: {held.sum()} de {len(held)} vértices presos (haste {ped.volume - ped.core_volume:.0f} mL): mediana {np.median(moves[held]):.1f} mm, só com a mudança de forma da mama; os {on_wall.sum()} sobre a parede, até {moves[on_wall].max() if on_wall.any() else 0:.1f} mm")
        # see-through, so that the vessels it keeps show inside it; the other pieces are opaque
        w.add(f"mamo_{key}_step_pedicle", sid("pedicle"), f"Pedículo {info['pedicle']}", COLORS["pedicle"], PEDICLE_OPACITY, "piece", ped.faces, pedicle_frames)
    w.add(f"mamo_{key}_step_resection", sid("resection"), f"Ressecção {info['resection']}", COLORS["resection"], 1.0, "piece", res.faces, removed(res_k0, out_dir))
    volumes, pillar_frames = {}, {}
    pillar_pieces = pillars(kind in FLAP_TECHNIQUES, item, front, inverse, st)
    tech.pillar_pivot = {}
    for side, piece in pillar_pieces.items():
        k0p = ch.to_model(piece.standing)
        finalp = tech.final(piece.rest, "pillar")
        # a pillar (or flap) turns towards the middle on its base: the part of it that moves least
        moved = np.linalg.norm(finalp - k0p, axis=1)
        tech.pillar_pivot[side] = k0p[moved <= np.percentile(moved, 15)].mean(0)
        pillar_frames[side] = [k0p if f["deep"] == 0 else tech.arc(k0p, finalp, f["deep"], tech.pillar_pivot[side]) for f in fr]
        w.add(f"mamo_{key}_step_pillar_{side}", sid(f"pillar-{side}"), f"{pillar_word} {side}", COLORS[f"pillar-{side}"], 1.0, "piece", piece.faces, pillar_frames[side])
        volumes[side] = round(piece.volume)

    # ---- vessels and nerves of the breast, as the tissue they run in goes ---------------------------------------------
    branches = {"artery": [], "nerve": []}
    for record in neurovascular_tracks(tech, item, pillar_pieces, anatomy, report, schedule, out_dir, pedicle_frames):
        tissue = record["tissue"]
        if record["kept"] and record["branch"] not in branches[tissue]:
            branches[tissue].append(record["branch"])
        # the branches the pedicle keeps are bright; the others, cut on the way to the nipple, darker
        # (two structures each: the views after the resection show only what reaches the nipple)
        color = COLORS[tissue] if record["kept"] else COLORS[f"{tissue}-cut"]
        part = ("arteries" if tissue == "artery" else "nerves") + ("" if record["kept"] else "-cut")
        w.add(f"mamo_{key}_step_{record['name']}", sid(part), record["branch"], color, 1.0, tissue, record["faces"], record["frames"])

    # ---- Pitanguy: the skin closes over the areola, which is marked and opened at the end ------------------------
    extra_points = {}
    if kind == "pitanguy":
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

    # ---- free graft: its bed, the skin round point A outside the pattern, closes into the apex of the cone --------------
    if graft:
        e_ids, e_frac = line_track(patch, "edge")
        rays, rings_ = n + 1, 6
        t_ray = np.linspace(0, 1, rays)
        headings = -bm.T_ANGLE / 2 - (360 - bm.T_ANGLE) * t_ray  # from the medial limb, over the top, to the lateral one
        site_r = AREOLA_NEW / 2
        ray_points = [st.march(np.array([0.0, 0.0]), heading, site_r) for heading in headings]
        bed_xs = [np.array([0.0, 0.0])]
        for k in range(1, rings_ + 1):
            bed_xs += [ray[min(int(round(site_r * k / rings_)), len(ray) - 1)] for ray in ray_points]
        bed_k0 = st.model(st.skin(np.array(bed_xs), 0.25))
        rho_b = np.r_[0.0, np.repeat(np.arange(1, rings_ + 1) / rings_, rays)]
        th_b = np.r_[0.0, np.tile(-np.pi + 2 * np.pi * t_ray, rings_)]
        b_uv = rest.uv(np.c_[rho_b * tech.areola_r * np.sin(th_b), rho_b * tech.areola_r * np.cos(th_b)])
        bed_final = tech.skin_final(np.c_[b_uv, st.skin_r(b_uv[:, 0], b_uv[:, 1]) + 0.25])
        rim_b = 1 + (rings_ - 1) * rays + np.arange(rays)
        ray_of = np.r_[0, np.tile(np.arange(rays), rings_)]
        frames = []
        for i, f in enumerate(fr):
            blend = bed_k0 + f["areola"] * (bed_final - bed_k0)
            edge_now = skin[i][e_ids]
            edge_at = np.stack([np.interp(t_ray, e_frac, edge_now[:, c]) for c in range(3)], 1)
            # the border of the bed is the edge of the skin that stays: it follows that edge in every frame
            frames.append(blend + rho_b[:, None] * (edge_at[ray_of] - blend[rim_b][ray_of]))
        w.add(f"mamo_{key}_step_bed", sid("dermis"), "Leito do enxerto", COLORS["skin"], 1.0, "skin", sector_faces(rings_, rays), frames)
        ring_theta = np.linspace(0, 2 * np.pi, 97)
        ring_uv = rest.uv(np.c_[0.97 * tech.areola_r * np.sin(ring_theta), 0.97 * tech.areola_r * np.cos(ring_theta)])
        v_, f_ = tube_mesh(tech.skin_final(np.c_[ring_uv, st.skin_r(ring_uv[:, 0], ring_uv[:, 1]) + 0.7]), 0.5, 6)
        w.add(f"mamo_{key}_step_bed_ring", sid("disc-ring"), "Marcação do leito do enxerto", COLORS["marking"], 1.0, "marking", f_, static(v_))
        extra_points["bed"] = [round(float(x) * MM, 5) for x in frames[0][1 + 2 * rays + rays // 2]]
        extra_points["cover-ring"] = [round(float(x) * MM, 5) for x in v_[len(v_) // 4]]

    # ---- sutures --------------------------------------------------------------------------------------------------
    seams = sutures(tech, skin, disc, rim, rim_theta, pillar_frames)
    for group, (stitches, edges) in seams.items():
        frames, faces = suture_mesh(stitches, edges, nf)
        # the areola has its own structure: in Pitanguy's technique it is only sutured once the skin over it is opened
        w.add(f"mamo_{key}_step_suture_{group.replace('-', '_')}", sid("sutures-areola" if group == "areola" else "sutures"), {"T": "Ponto em T", "vertical": "Sutura vertical", "fold-medial": "Sutura no sulco, medial", "fold-lateral": "Sutura no sulco, lateral", "areola": "Sutura da aréola", "deep": "Pontos profundos"}[group], SEAM_COLORS[group], 1.0, "marking", faces, frames)
        a, b = stitches[len(stitches) // 2]
        extra_points[f"seam-{group}"] = [round(float(x) * MM, 5) for x in (a[0] + b[0]) / 2]

    # ---- arrows: where things go in every step, drawn while it plays ---------------------------------------------------
    arrows = []

    def arrow(frame: int, a, b, color: str) -> None:
        a, b = np.asarray(a, float), np.asarray(b, float)
        if np.linalg.norm(b - a) >= 4.0:
            arrows.append({"frame": frame, "from": [round(float(x) * MM, 5) for x in a], "to": [round(float(x) * MM, 5) for x in b], "color": color})

    arrow(t2, res_k0.mean(0), res_k0.mean(0) + out_dir, COLORS["resection"])
    if graft:
        # the graft is lifted off at the incision and laid on its bed in the last frame
        arrow(t_harvest, disc_k0[0], disc[t_harvest][0], COLORS["nac"])
        arrow(nf - 1, disc[ids.index("leito")][0], disc[nf - 1][0], COLORS["nac"])
    else:
        arrow(t3, disc[t2][0], disc[t3][0], COLORS["nac"])
    for i in range(t3 + 1, nf):
        if ":" in ids[i]:
            continue
        prev = max(j for j in range(i) if ":" not in ids[j])
        for side, frames_ in pillar_frames.items():
            arrow(i, frames_[prev].mean(0), frames_[i].mean(0), COLORS[f"pillar-{side}"])
        for group, (stitches, _) in seams.items():
            if group == "deep":
                continue
            # the two edges of the middle stitch of a suture that closes in this stage, going to meet
            a, b = stitches[len(stitches) // 2]
            if np.linalg.norm(a[prev] - b[prev]) - np.linalg.norm(a[i] - b[i]) > 4.0:
                arrow(i, a[prev], a[i], SEAM_COLORS[group])
                arrow(i, b[prev], b[i], SEAM_COLORS[group])
        if ids[i] == "abertura":
            arrow(i, disc[prev][0], disc[i][0], COLORS["nac"])

    # ---- measurements of the marking ---------------------------------------------------------------------------------
    measures, values = [], {"areolaNowMm": areola_now, "areolaNewMm": AREOLA_NEW}
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
    # the pedicle, its dermis, the areola beyond the areolotome, the vessels and nerves (and a graft's bed) lie behind the
    # areola in every frame: the transposition and the closure may not bring any of them over it
    w.settle(f"mamo_{key}_step_areola", {sid("pedicle"), sid("dermis"), sid("areola-ring"), sid("pillar-medial"), sid("pillar-lateral"), sid("arteries"), sid("nerves"), sid("arteries-cut"), sid("nerves-cut")}, lambda centre: radial_of(ch, centre))
    # points of labels and measures go with the habitus too
    for name, point in extra_points.items():
        at = np.array(point) / MM
        extra_points[name] = [round(float(x) * MM, 5) for x in at + w.habitus_offsets(at[None])[0]]
    return tech, w, volumes, branches, extra_points, values, arrows


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

    # a technique may lack a part (no pedicle with a free graft, no excised skin in a periareolar pattern)
    out = {name: nearest(f"mamo_{key}_step_{name}") for name in ("pedicle", "resection", "excised", "dermis") if f"mamo_{key}_step_{name}" in by_name}
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
        # the label of the vessels sits on one that reaches the nipple, or on a cut one if none does
        meshes = [m for m in writer.meshes if m["structure"] == f"mamo-step-{kind}-{key}"] or [m for m in writer.meshes if m["structure"] == f"mamo-step-{kind}-cut-{key}"]
        if meshes:
            p = meshes[0]["full"][0]
            out[kind] = [round(float(x) * MM, 5) for x in p[int(len(p) * 0.8)]]
    # where the camera of the sequence looks: between the nipple before and after, 30 mm deep to the skin
    out["centre"] = [round(float(x) * MM, 5) for x in (disc[0][0] + disc[-1][0]) / 2 - np.array([0.0, 0.0, 30.0])]
    return out


def main() -> None:
    cases = [c for c in bm.CASES if "--case" not in sys.argv or c == sys.argv[sys.argv.index("--case") + 1]]
    for case in cases:
        write_case(case)


def write_case(case: str) -> None:
    suffix = bm.CASES[case]["suffix"]
    breast, st, front, inverse, state = bm.case_setup(case)
    rest = mr.Rest(st)
    # the very pieces of build_mammaplasty.py: same design (pedicle thinning, undermining) for this case
    plan = bm.techniques(st, front, inverse, bm.load_design(case), bm.CASES[case]["techniques"])
    mound_ml = bb.mound_volumes(breast)[state + 1]
    model = json.loads(bb.OUT_JSON.read_text())
    before = model["measurements"]["op"][case]
    notch = bb.layer_landmark("esterno.incisura-jugular")
    nacs = nac_meshes(breast)
    anatomy = json.loads(bm.ANATOMY_JSON.read_text())
    report = bm.neurovascular(st, front, plan)
    structures, manifest, techniques = {}, [], {}
    figures_dir = Path(sys.argv[sys.argv.index("--figures") + 1]) if "--figures" in sys.argv else None
    for kind, item in plan.items():
        info = bm.TECHNIQUES[kind]
        tech, writer, volumes, branches, extra_points, values, arrows = build(kind, case, item, st, front, inverse, rest, mound_ml, nacs, anatomy, report, before, notch)
        key = tech.key
        out_bin = Path(str(OUT_BIN).format(key=key))
        records, box_ = writer.write(out_bin)
        m = measure(tech, before, notch)
        print(f"   mamilo {tech.nipple_above_fold} mm acima do sulco; polo inferior x{tech.result['growth']['length']}: altura {tech.lower_pole_mm[0]:.0f} mm para {tech.lower_pole_mm[1]:.0f} mm de projeção")
        print(f"   antes {m['before']}\n   depois {m['after']}\n   medidas {values}")
        print(f"   vasos e nervos do pedículo: {branches}")
        # the content hash keeps the service worker (cache first) from serving an older binary with newer data
        digest = hashlib.sha1(out_bin.read_bytes()).hexdigest()[:10]
        techniques[key] = {
            "technique": kind, "case": case,
            "bin": f"models/hybrid/{out_bin.name}?v={digest}", **box_,
            "frames": [{"id": fid, "label": label} for fid, label, _ in SCHEDULES[kind]],
            "result": tech.result, "nippleAboveFoldMm": tech.nipple_above_fold, "measurements": m, "measures": values, "pillarsMl": volumes, "branches": branches, "arrows": arrows,
            "points": {**anchors(tech, writer), **extra_points},
            "meshes": records,
        }
        words = {"label": info["label"], "pedicle": info["pedicle"], "resection": info["resection"], "pillar": "Retalho" if kind in FLAP_TECHNIQUES else "Pilar"}
        labels = {**KINDS, **(GRAFT_KINDS if tech.graft else {}), **(RING_KINDS if tech.skin == "ring" else {})}
        for mesh in writer.meshes:
            part = mesh["structure"][len("mamo-step-"): -len(key) - 1]
            structures.setdefault(mesh["structure"], {"label": labels[part].format(**words), "group": "Mamoplastia", "visible": False, "labelAnchor": [round(float(x) * MM, 4) for x in mesh["full"][0].mean(0)], "meshNames": []})["meshNames"].append(mesh["name"])
            manifest.append({"name": mesh["name"], "structure": mesh["structure"], "tissue": mesh["tissue"], "source": bm.SOURCE, "sourceName": mesh["label"], "license": bm.LICENSE, "triangles": int(len(mesh["faces"])), "color": mesh["color"], "opacity": mesh["opacity"]})
        if figures_dir is not None:
            review(tech, writer, figures_dir)
    # where the skin of the trunk gives way to the patch of each technique (rest chart u, v of the operated side)
    hole = rest.uv(np.array(tech.patch.mesh_domain.buffer(-1.5).simplify(0.3).exterior.coords))
    out = {
        "version": 5, "source": bm.SOURCE, "case": case, "state": case, "roundness": ROUNDNESS,
        "hole": [[round(float(u), 2), round(float(v), 2)] for u, v in hole],
        "techniques": techniques, "structures": structures, "meshes": manifest,
    }
    out_json = Path(str(OUT_JSON).format(suffix=suffix))
    out_json.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    sizes = ", ".join(f"{k} {v['byteLength'] / 1e3:.0f} kB" for k, v in techniques.items())
    print(f"wrote {out_json.relative_to(bb.ROOT)} ({out_json.stat().st_size / 1e3:.0f} kB) and binaries: {sizes}")


def out_direction(ch, centre: np.ndarray, st, specimen_ml: float = OUT_REFERENCE_ML) -> np.ndarray:
    """Where the specimen is put aside: forwards, medially and down, further for a larger specimen (cube root of its
    volume), so that it lies below the breast and in front of the epigastrium, seen whole from the front."""
    scale = float(np.clip((specimen_ml / OUT_REFERENCE_ML) ** (1 / 3), 1.0, 2.2))
    radial = radial_of(ch, centre)
    medial = np.array([ch.s, 0.0, 0.0])  # the operated side lies towards -x
    return scale * (radial * OUT_OFFSET["radial"] + medial * OUT_OFFSET["medial"] + np.array([0.0, -OUT_OFFSET["down"], 0.0]))


def scar_lines(tech: Technique) -> list[tuple[str, np.ndarray]]:
    """Suture lines of the result in the isotropic rest chart (the skin the result state then shapes)."""
    rest, r = tech.rest, tech.areola_r
    circle = np.c_[r * np.sin(np.linspace(0, 2 * np.pi, 120)), r * np.cos(np.linspace(0, 2 * np.pi, 120))]
    fold_bottom = np.array([0.0, float(np.interp(tech.st.um, tech.st.us, tech.st.V[:, -1]))])
    out = [("Cicatriz periareolar", circle)]
    if tech.skin == "ring":
        return out  # the only scar of a periareolar pattern
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
