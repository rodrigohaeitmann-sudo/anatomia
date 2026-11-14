#!/usr/bin/env python3
"""Reduction mammaplasty on the model: marking, pedicle and resection of every technique on the breasts it is
meant for (docs/plano-mamoplastia.md, fases 2 e 3; docs/plano-mamoplastia-g3-g4.md;
docs/plano-mamoplastia-tecnicas.md).

Everything is designed on a standing ptotic breast, as in the consulting room, and shipped in rest
coordinates: the breast map of the app (src/lib/breastMap.ts) carries markings and pieces to the standing
breast together with skin, gland and vessels. Five cases (CASES), one per breast state: ptosis grades I, II
and III with the dimensions accepted in review, and the hypertrophies G3 and G4, where a reduction aims at
a smaller breast: the pedicle is thinned and the tissue under the skin flaps is taken (`design_for`, by
bisection on the measured volumes). A technique (TECHNIQUES) is a skin pattern, a pedicle and a resection;
each case lists the techniques that suit its degree of ptosis.

1. Marking. Lines are drawn on the unrolled standing skin (pilot_mammaplasty.Standing) with true lengths.
   Point A, the new position of the nipple, is the projection of the inframammary fold on the breast
   meridian, and never less than MIN_RISE above the nipple (ptosis grade I, where the nipple is already at
   the height of the fold). Patterns: inverted T without keyhole (Pitanguy, free nipple graft), keyhole
   (Wise), vertical with dome, periareolar ring.
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

Outputs (per case; ptosis II without suffix, the others with -g3, -g4):
  src/data/mammaplasty<-case>.json             structures, marking centre lines, points, measurements, design
  public/models/hybrid/mammaplasty<-case>.bin  piece meshes (rest positions int16, indices uint16)

Usage: node scripts/hybrid/decode_model.mjs && python3 scripts/hybrid/build_breast_anatomy.py && \\
       python3 scripts/hybrid/build_mammaplasty.py [--figures DIR]
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import shapely
import trimesh
from scipy.ndimage import gaussian_filter, map_coordinates
from scipy.spatial import Delaunay, cKDTree
from shapely.geometry import LineString, MultiPoint, Point, Polygon, box
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).parent))
import build_breast as bb  # noqa: E402
from pilot_mammaplasty import Standing, bezier  # noqa: E402

OUT_JSON = bb.ROOT / "src/data/mammaplasty{suffix}.json"
OUT_BIN = bb.ROOT / "public/models/hybrid/mammaplasty{suffix}.bin"
ANATOMY_JSON = bb.ROOT / "src/data/breastAnatomy.json"
SOURCE = "Plano cirúrgico (este projeto)"
LICENSE = "Gerado neste projeto sobre as malhas do modelo (CC BY-SA 4.0, como a obra derivada)"
MM = bb.MM
RREF, CELL = bb.RREF, bb.CELL

STATE = "ptose-2"  # the breast of the first case (the one the review accepted)
DENSITY = bb.DENSITY  # g/mL, fatty breast tissue

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
ROOT_KEEP = 25.0  # mm: a thinned inferior pedicle keeps this much under the plane of the septum where the breast hangs
DOME_RISE = 21.0  # top of the dome above the new nipple (upper edge of the new areola)
DOME_BASE = 21.0  # the dome ends this far below the new nipple (lower edge of the new areola)
DOME_HALF = 34.0  # half-width of the dome at its base
VERTICAL_HALF = 48.0  # widest half-width of the vertical pattern
VERTICAL_STOP = 30.0  # the vertical pattern ends this far above the fold (skin length)

MIN_RISE = 20.0  # mm of skin: point A (the new nipple) is never less than this above the nipple (ptosis grade I)
RING_BELOW = 10.0  # periareolar ring: mm of skin taken below the areolotome's circle
RING_SIDE = 12.0  # ... and on each side of it (its top is the upper border of the new areola, AREOLA_D / 2 above A)
CENTRAL_THICKNESS = 20.0  # dermoglandular layer that carries the areola over the wedge of a periareolar reduction
WEDGE_START = -25.0  # the wedge of the periareolar reduction starts this far below the nipple, seen from the front (negative: above it, behind the areola)
WEDGE_TOP_HALF = 20.0  # half-width of that wedge at its top
WEDGE_BASE_HALF = 50.0  # ... and at the lowest contour of the breast
KEEL_BASE = -160.0  # the sides of Pitanguy's keel run from its apex to B and C at this height (mm about the nipple at rest)

# The cases: the breast (state of build_breast.py) that is marked and operated. `resultMl`: the breast a reduction aims at
# (None: the dimensions above, as accepted); `areolaNowMm`: the areola of the case on the standing skin, stretched by the
# hypertrophy (the areolotome is AREOLA_D); `foldMarginMm`: how far from each end of the fold its incision stops;
# `techniques`: the techniques shown on this breast, those its degree of ptosis calls for (ptosis I: periareolar and
# vertical; II: vertical and inverted T; III and beyond: inverted T, and the free nipple graft for gigantomastia);
# `spacing`: mm between vertices of the pieces.
CASES = {
    "ptose-1": {"suffix": "-p1", "areolaNowMm": 50.0, "foldMarginMm": FOLD_MARGIN, "resultMl": None, "spacing": 5.0, "techniques": ["periareolar", "lejour"]},
    "ptose-2": {"suffix": "", "areolaNowMm": 56.0, "foldMarginMm": FOLD_MARGIN, "resultMl": None, "spacing": 3.5, "techniques": ["pitanguy", "wise", "vertical", "lejour"]},
    "ptose-3": {"suffix": "-p3", "areolaNowMm": 65.0, "foldMarginMm": FOLD_MARGIN, "resultMl": None, "spacing": 5.0, "techniques": ["pitanguy", "wise", "vertical", "orlando"]},
    "g3": {"suffix": "-g3", "areolaNowMm": 75.0, "foldMarginMm": 5.0, "resultMl": float(next(s["resultMl"] for s in bb.STATES if s["id"] == "g3")), "spacing": 5.5, "techniques": ["pitanguy", "wise", "vertical", "orlando"]},
    "g4": {"suffix": "-g4", "areolaNowMm": 90.0, "foldMarginMm": 5.0, "resultMl": float(next(s["resultMl"] for s in bb.STATES if s["id"] == "g4")), "spacing": 5.5, "techniques": ["pitanguy", "wise", "vertical", "orlando", "thorek"]},
}
# A technique: skin pattern (`skin`: t = inverted T without keyhole, keyhole = Wise, dome = vertical, ring = periareolar),
# pedicle and resection. The words go into labels: "Pedículo <pedicle>", "Ressecção <resection>".
TECHNIQUES = {
    "periareolar": {"label": "Periareolar de Benelli (round block)", "short": "Periareolar", "pattern": "anel periareolar excêntrico", "pedicle": "central", "resection": "em cunha central inferior", "marking": "Marcação periareolar (anel)", "skin": "ring"},
    "lejour": {"label": "Lejour (vertical com pedículo superior)", "short": "Lejour", "pattern": "padrão vertical com cúpula", "pedicle": "superior", "resection": "central inferior", "marking": "Marcação vertical (cúpula)", "skin": "dome"},
    "vertical": {"label": "Vertical com pedículo superomedial", "short": "Vertical", "pattern": "padrão vertical com cúpula", "pedicle": "superomedial", "resection": "inferior e lateral", "marking": "Marcação vertical (cúpula)", "skin": "dome"},
    "pitanguy": {"label": "Pitanguy", "short": "Pitanguy", "pattern": "T invertido, marcação pelos pontos A–B–C–D–E", "pedicle": "superior", "resection": "em quilha", "marking": "Marcação de Pitanguy (T invertido)", "skin": "t"},
    "wise": {"label": "Wise com pedículo inferior", "short": "Wise", "pattern": "padrão de Wise (fechadura)", "pedicle": "inferior", "resection": "em ferradura", "marking": "Marcação de Wise (fechadura)", "skin": "keyhole"},
    "orlando": {"label": "Wise com pedículo superomedial", "short": "Wise superomedial", "pattern": "padrão de Wise (fechadura)", "pedicle": "superomedial", "resection": "inferior e lateral", "marking": "Marcação de Wise (fechadura)", "skin": "keyhole"},
    "thorek": {"label": "Thorek (enxerto livre do complexo areolopapilar)", "short": "Thorek", "pattern": "T invertido, sem abertura para a aréola", "pedicle": "", "resection": "do polo inferior (amputação)", "marking": "Marcação em T invertido (enxerto livre)", "skin": "t"},
}
# the pedicle's share of the result in the case of ptosis II (what a thinned pedicle of the large cases aims at)
PEDICLE_SHARE = {"wise": 0.47, "vertical": 0.32, "orlando": 0.32}
MIN_PEDICLE_DEPTH = 20.0  # mm of tissue a thinned pedicle keeps under its skin (de-epithelialised dermis included)
SEPTUM_MARGIN = 12.0  # mm kept under the plane of the horizontal septum when the inferior pedicle is thinned (its vessels)
MIN_FLAP = FLAP_THICKNESS  # mm: the thinnest skin flap left over the tissue that is taken round the pattern
UPPER_FLAP_EXTRA = 10.0  # mm: above point A the flap is this much thicker (the upper pole keeps its fullness)
# The vessels and nerves each pedicle is built on (what it keeps in ptosis II): the tissue round their course is not
# taken when the flaps are thinned, as the base of a pedicle is not undermined in surgery
PEDICLE_SUPPLY = {
    "pitanguy": ["lit_ita_perforator_2", "lit_ita_perforator_3", "lit_acb_3"],
    "wise": ["lit_intercostal_perforator_4", "lit_intercostal_perforator_5", "lit_intercostal_perforator_6", "lit_thoracoacromial_branch", "lit_lcb4_deep"],
    "vertical": ["lit_ita_perforator_2", "lit_ita_perforator_3", "lit_ita_perforator_4", "lit_acb_3", "lit_acb_4"],
    "orlando": ["lit_ita_perforator_2", "lit_ita_perforator_3", "lit_ita_perforator_4", "lit_acb_3", "lit_acb_4"],
    "lejour": ["lit_ita_perforator_2", "lit_ita_perforator_3", "lit_acb_3"],
    "periareolar": [],
    "thorek": [],
}
SUPPLY_CORRIDOR = 12.0  # mm on each side of those courses, seen from the front
SUPPLY_DEPTH = 8.0  # mm of tissue kept behind those courses when a pedicle is thinned
VOLUME_TOLERANCE = 0.03  # of the result aimed at


def case_key(technique: str, case: str) -> str:
    """Name of a technique in a case: plain for ptosis II (the names the app has always used), suffixed otherwise."""
    return technique + CASES[case]["suffix"]


def default_design(case: str) -> dict:
    spec = CASES[case]
    return {"foldMarginMm": spec["foldMarginMm"], "resultMl": spec["resultMl"], "pieceSpacingMm": spec["spacing"], "pedicleDepthMm": {}, "flapMm": {}}


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
        # the skin of the breast (from the fold up), densely, carried to the standing breast
        us = np.arange(lo - 8, hi + 8.01, 0.5)
        fold, top = np.interp(us, ch.us, b.fold), np.interp(us, ch.us, b.top) + 30.0
        t = np.linspace(0, 1, 1000)
        v = fold[:, None] + (top - fold)[:, None] * t[None]
        u = np.repeat(us[:, None], len(t), 1)
        moved = st.to_state(np.stack([u, v, st.skin_r(u, v)], -1).reshape(-1, 3))
        # the grid reaches 20 mm below the lowest point of the standing breast (never above -160, as it always was)
        self.u0, self.v0, self.cell = lo - 40.0, min(-160.0, float(np.floor(moved[:, 1].min() / 2.0) * 2.0) - 20.0), 2.0
        nu, nv = int((hi + 40 - self.u0) / self.cell) + 1, int((170 - self.v0) / self.cell) + 1
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
        distance = shapely.distance(outline, shapely.points(np.asarray(uv)))
        t = np.clip(distance / width, 0, 1)
        return t * t * (3 - 2 * t)

    def project(self, chart_xs: np.ndarray) -> np.ndarray:
        """Points of the unrolled skin chart seen from the front: standing chart (u, v)."""
        return self.st.to_state(self.st.skin(chart_xs))[:, :2]

    def contains(self, region: Polygon, top, bottom, standing_points: np.ndarray) -> np.ndarray:
        """Which standing chart points (u, v, r) lie inside the piece `region` x [bottom, top]."""
        uv = standing_points[:, :2]
        inside = shapely.contains_xy(region, uv[:, 0], uv[:, 1])
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

    def newton(self, target: np.ndarray, q: np.ndarray, iterations: int) -> tuple[np.ndarray, np.ndarray]:
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

    def __call__(self, target: np.ndarray, iterations: int = 14) -> tuple[np.ndarray, np.ndarray]:
        _, near = self.tree.query(target)
        q, residual = self.newton(target, self.rest[near] + (target - self.moved[near]), iterations)
        # where the nearest seed led astray (strongly sheared tissue of the large breasts), start again from the others
        bad = np.nonzero(residual > 0.01)[0]
        if len(bad):
            _, seeds = self.tree.query(target[bad], k=12)
            for j in range(1, seeds.shape[1]):
                start = self.rest[seeds[:, j]] + (target[bad] - self.moved[seeds[:, j]])
                q2, r2 = self.newton(target[bad], start, iterations * 2)
                better = r2 < residual[bad]
                q[bad[better]], residual[bad[better]] = q2[better], r2[better]
        return q, residual


# --------------------------------------------------------------------------------------------------
# markings (unrolled standing skin: X across, s down the skin from point A)
# --------------------------------------------------------------------------------------------------
def fold_ends(st: Standing, margin: float = FOLD_MARGIN):
    lo, hi = st.b.fold_range
    xd, xe = (lo + margin - st.um) * st.rho, (hi - margin - st.um) * st.rho
    return np.array([xd, float(st.fold_s(xd))]), np.array([xe, float(st.fold_s(xe))])


def horizontal_limb(st: Standing, start, end) -> np.ndarray:
    """From the end of a vertical limb across the lower pole, then along the breast border to the end of the fold."""
    control = np.array([end[0] + 0.25 * (start[0] - end[0]), start[1] + 8.0])
    curve = bezier(start, control, end)
    curve[:, 1] = np.minimum(curve[:, 1], st.fold_s(curve[:, 0]) - 0.5)
    return curve


def inverted_t(st: Standing, keyhole: bool, fold_margin: float = FOLD_MARGIN):
    """Inverted T patterns. With keyhole: Wise (areola opening round A). Without: Pitanguy (A, B, C, D, E)."""
    rk = AREOLA_D / 2
    a = np.array([0.0, 0.0])
    medial, lateral = st.march(a, -T_ANGLE / 2, rk + LIMB), st.march(a, T_ANGLE / 2, rk + LIMB)
    b, c = medial[-1], lateral[-1]
    d, e = fold_ends(st, fold_margin)
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


def ring(st: Standing, nipple: np.ndarray):
    """Periareolar pattern (round block): an eccentric ellipse round the areola. Its top is the upper border of the new
    areola (AREOLA_D / 2 above point A); below and beside the areola it runs RING_BELOW and RING_SIDE outside the
    areolotome's circle. The line starts at its lowest point and goes up the medial side."""
    a = np.array([0.0, 0.0])
    top = -AREOLA_D / 2
    bottom = float(nipple[1]) + AREOLA_D / 2 + RING_BELOW
    half = AREOLA_D / 2 + RING_SIDE
    centre, semi = (top + bottom) / 2, (bottom - top) / 2
    t = np.linspace(0, 2 * np.pi, 97)
    line = np.c_[-half * np.sin(t), centre + semi * np.cos(t)]
    points = {"A": a, "S": np.array([0.0, top]), "I": np.array([0.0, bottom]), "M": np.array([-half, centre]), "L": np.array([half, centre])}
    return points, {"anel": line}, [line]


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
    grid = np.c_[gx.ravel(), gy.ravel()]
    grid = grid[shapely.contains_xy(inner, grid[:, 0], grid[:, 1])].reshape(-1, 2)
    rings = [region.exterior, *region.interiors]
    border = np.vstack([np.array([ring.interpolate(s).coords[0] for s in np.arange(0, ring.length, spacing * 0.7)]) for ring in rings])
    pts = np.vstack([grid, border])
    tri = Delaunay(pts).simplices
    keep = region.buffer(0.05)
    centres = pts[tri].mean(1)
    tri = tri[shapely.contains_xy(keep, centres[:, 0], centres[:, 1])]
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
    """Tissue behind one or more frontal regions; each part has its own depth range. The rest positions (the map
    inverted, the expensive part) are worked out when first asked for, so that a design can be searched on volumes."""

    def __init__(self, front: Front, inverse: Inverse, parts: list[tuple[Polygon, object, object]], spacing: float = 3.5) -> None:
        self.front = front
        self.inverse = inverse
        self.parts = []
        verts, faces, offset = [], [], 0
        for region, top, bottom in parts:
            region = region.intersection(front.domain).buffer(0)
            for polygon in region.geoms if region.geom_type == "MultiPolygon" else [region]:
                if polygon.is_empty or polygon.area < 80:
                    continue
                self.parts.append((polygon, top, bottom))
                v, f = prism(polygon, top, bottom, spacing=spacing, fade=front.fade)
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
        self._rest = None
        self.residual = float("nan")

    @property
    def rest(self) -> np.ndarray:
        if self._rest is None:
            self._rest, residual = self.inverse(self.standing)
            self.residual = float(residual.max())
        return self._rest

    def contains(self, standing_points: np.ndarray) -> np.ndarray:
        inside = np.zeros(len(standing_points), bool)
        for region, top, bottom in self.parts:
            inside |= self.front.contains(region, top, bottom, standing_points)
        return inside


class EmptyPiece:
    """No tissue: the pedicle of a technique that has none (the free nipple graft)."""

    def __init__(self) -> None:
        self.parts: list = []
        self.standing = np.zeros((0, 3))
        self.rest = np.zeros((0, 3))
        self.faces = np.zeros((0, 3), int)
        self.volume, self.closed, self.residual = 0.0, True, 0.0

    def contains(self, standing_points: np.ndarray) -> np.ndarray:
        return np.zeros(len(standing_points), bool)


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


class Planner:
    """The techniques on one standing breast (one method per technique of TECHNIQUES). `design` (default_design / design_for): where the fold incision
    stops, how thin each pedicle is cut (pedicleDepthMm: mm of tissue under its skin; absent = full thickness) and how
    thick the skin flaps are left round the pattern (flapMm: the tissue under them is taken, down to the layer left on
    the fascia; absent = only the wedges of the technique)."""

    def __init__(self, st: Standing, front: Front, inverse: Inverse, design: dict | None = None) -> None:
        self.st, self.front, self.inverse = st, front, inverse
        self.design = design or default_design("ptose-2")
        self.nipple = st.chart_of_rest(st.um, 0.0)  # the nipple today, on the unrolled skin
        self.rim = Polygon(front.project(st.ring(self.nipple, AREOLA_D / 2 + RIM)))
        self.areola_now = front.project(st.ring(self.nipple, AREOLA_D / 2))
        self.new_areola = Polygon(front.project(st.ring(np.array([0.0, 0.0]), AREOLA_D / 2)))
        self.nipple_uv = front.project(self.nipple[None])[0]
        self.a_uv = front.project(np.array([[0.0, 0.0]]))[0]
        # the pieces of the larger breasts are meshed a little coarser, so that every case weighs about the same
        self.spacing = self.design.get("pieceSpacingMm", 3.5 if self.design["resultMl"] is None else 5.5)

    # ---- shared ---------------------------------------------------------------------------------------------
    def piece(self, parts) -> Piece:
        return Piece(self.front, self.inverse, parts, spacing=self.spacing)

    def wedges(self, points: dict, centre: Polygon) -> Polygon:
        """Lower pole under the medial and lateral skin flaps of the inverted T, between the fold ends."""
        front = self.front
        b_uv, c_uv, d_uv, e_uv = (front.project(points[key][None])[0] for key in "BCDE")
        medial = box(d_uv[0], front.v0, b_uv[0], 200.0)
        lateral = box(c_uv[0], front.v0, e_uv[0], 200.0)
        return unary_union([medial, lateral]).intersection(front.hanging).difference(centre).buffer(0)

    def thinned(self, key: str, pattern: Polygon, keep: Polygon, taken: Polygon) -> list:
        """The tissue under the skin flaps round the pattern, all over the breast seen from the front, except the pedicle
        (`keep`) and what another part of the resection already takes (`taken`): what lies deeper than flapMm under the
        skin (UPPER_FLAP_EXTRA more above point A) comes out, down to the layer left on the fascia."""
        flap = self.design["flapMm"].get(key)
        if flap is None:
            return []
        front = self.front
        region = front.domain.difference(pattern).difference(keep.buffer(3.0)).difference(taken).difference(self.supply(key)).buffer(-1.0).buffer(1.0)
        a_v = float(self.a_uv[1])

        def surface(uv):
            thick = flap + UPPER_FLAP_EXTRA * np.clip((uv[:, 1] - a_v) / 30.0 + 0.5, 0, 1)
            return np.maximum(front.top(uv) - thick, front.bottom_spare(uv))
        return [(region, surface, front.bottom_spare)]

    def courses(self, key: str) -> list[np.ndarray]:
        """Standing chart courses of the vessels and nerves the pedicle is built on."""
        if not ANATOMY_JSON.exists():
            return []
        if not hasattr(Planner, "_anatomy"):
            Planner._anatomy = json.loads(ANATOMY_JSON.read_text())["geometry"]
        return [standing_course(self.st, Planner._anatomy[name]) for name in PEDICLE_SUPPLY[key]]

    def supply(self, key: str) -> Polygon:
        """Corridor round the courses of the vessels and nerves the pedicle is built on, seen from the front."""
        lines = [LineString(course[:, :2]).buffer(SUPPLY_CORRIDOR) for course in self.courses(key)]
        return unary_union(lines).buffer(0) if lines else Polygon()

    def supply_floor(self, key: str):
        """The deepest a thinned pedicle may be cut at each point seen from the front: SUPPLY_DEPTH behind the deepest of
        its vessels within SUPPLY_CORRIDOR (no limit elsewhere)."""
        samples = [resample_course(course, 1.5) for course in self.courses(key)]
        if not samples:
            return lambda uv: np.full(len(uv), np.inf)
        points = np.vstack(samples)
        tree = cKDTree(points[:, :2])

        def floor(uv):
            out = np.full(len(uv), np.inf)
            for i, near in enumerate(tree.query_ball_point(np.asarray(uv)[:, :2], SUPPLY_CORRIDOR)):
                if near:
                    out[i] = points[near, 2].min() - SUPPLY_DEPTH
            return out
        return floor

    def pedicle_floor(self, key: str, keep=None):
        """Deep face of a pedicle: the wall (full thickness) or, when thinned, `depth` below its skin; it is never cut into
        `keep` (a surface: the plane of the horizontal septum under the inferior pedicle) nor into the layer behind the
        vessels the pedicle is built on."""
        depth = self.design["pedicleDepthMm"].get(key)
        front = self.front
        if depth is None:
            return front.bottom_full, None
        vessels = self.supply_floor(key)
        if keep is None:
            return (lambda uv: np.maximum(np.minimum(front.top(uv) - depth, vessels(uv)), front.bottom_full(uv))), depth
        return (lambda uv: np.maximum(np.minimum(np.minimum(front.top(uv) - depth, keep(uv)), vessels(uv)), front.bottom_full(uv))), depth

    # ---- Pitanguy: inverted T, superior pedicle, keel resection ---------------------------------------------
    def pitanguy(self) -> dict:
        # The pedicle is a dermoglandular flap based above the areola; the upper ends of the limbs, inside its footprint,
        # are only de-epithelialised. The keel goes on under the flap, tapering upwards.
        st, front = self.st, self.front
        points, lines, _ = inverted_t(st, keyhole=False, fold_margin=self.design["foldMarginMm"])
        pattern = frontal_pattern(front, points["A"][None], lines["ramo lateral"], lines["ramo medial"])
        superior = hull(np.array(self.rim.exterior.coords), np.array(self.new_areola.exterior.coords)).buffer(0)
        # the keel reaches 30 mm above the edge of the areola (in ptosis II that is 25 mm above point A); in a long breast
        # it reaches as high as in ptosis II, 25 mm above A, so that the tissue behind the long pedicle comes out too
        apex_v = self.nipple_uv[1] + AREOLA_D / 2 + 30.0
        apex = np.array([self.nipple_uv[0], apex_v if apex_v > self.a_uv[1] else self.a_uv[1] + 25.0])
        b_uv, c_uv = front.project(points["B"][None])[0], front.project(points["C"][None])[0]
        keel = Polygon([apex, [c_uv[0], KEEL_BASE], [b_uv[0], KEEL_BASE]]).buffer(0)
        wedges = self.wedges(points, pattern.union(superior))
        extra = self.thinned("pitanguy", pattern, superior, wedges)
        return {
            "points": points, "lines": lines, "pattern": pattern, "footprint": superior, "baseOnOutline": True,
            "pedicle": self.piece([(superior, front.top, front.flap(SUPERIOR_THICKNESS))]),
            "resection": self.piece([
                (pattern.difference(superior), front.top, front.bottom_spare),
                (superior.intersection(keel), front.flap(SUPERIOR_THICKNESS), front.bottom_spare),
                (wedges, front.flap(FLAP_THICKNESS), front.bottom_spare),
                *extra,
            ]),
        }

    # ---- Wise pattern with inferior pedicle -------------------------------------------------------------------
    def wise(self) -> dict:
        # The pedicle is the middle of the lower pole, from the areola to its base on the fold, with its root on the wall
        # under an oblique plane (the plane of the horizontal septum, which carries its vessels). What lies above that
        # plane inside the pattern, the medial and lateral parts and the wedges under the flaps come out; a thinned
        # pedicle also loses the tissue behind it where the breast hangs (the root on the wall is kept whole).
        st, front = self.st, self.front
        nipple_uv, rim = self.nipple_uv, self.rim
        points, lines, _ = inverted_t(st, keyhole=True, fold_margin=self.design["foldMarginMm"])
        pattern = frontal_pattern(front, lines["fechadura"], lines["ramo lateral"], lines["ramo medial"])
        heights = np.arange(nipple_uv[1], front.v0, -4.0)
        span = max(nipple_uv[1] - (st.fold_height - 62.0), 1.0)
        half_mm = (AREOLA_D / 2 + RIM) + (INFERIOR_BASE / 2 - AREOLA_D / 2 - RIM) * np.clip((nipple_uv[1] - heights) / span, 0, 1)
        radius = front.sample(front.front_filled, np.c_[np.full(len(heights), nipple_uv[0]), heights])
        half_u = half_mm * RREF / radius
        band = Polygon(np.vstack([np.c_[nipple_uv[0] - half_u, heights], np.c_[nipple_uv[0] + half_u, heights][::-1]]))
        hanging_part = unary_union([rim, band]).intersection(pattern).buffer(0)
        rim_top = float(hanging_part.bounds[3])
        root_bottom = rim_top - 12.0  # the root reaches down to the areola: the pedicle is one piece from the wall to it
        root_top = st.fold_height + ROOT_HEIGHT
        wall_radius = float(front.sample(front.wall, np.array([[nipple_uv[0], st.fold_height]]))[0])
        to_u = RREF / wall_radius
        root = Polygon([
            [nipple_uv[0] - INFERIOR_BASE / 2 * to_u, root_bottom], [nipple_uv[0] + INFERIOR_BASE / 2 * to_u, root_bottom],
            [nipple_uv[0] + ROOT_TOP_WIDTH / 2 * to_u, root_top], [nipple_uv[0] - ROOT_TOP_WIDTH / 2 * to_u, root_top],
        ]).buffer(8.0).buffer(-8.0).difference(hanging_part).buffer(0)
        septum_plane = front.ramp(float(nipple_uv[1]), root_top)  # from the nipple back and up to the wall
        floor, thinned = self.pedicle_floor("wise", keep=lambda uv: septum_plane(uv) - SEPTUM_MARGIN)
        vessels = self.supply_floor("wise") if thinned else None

        def root_floor(uv):
            """Deep face of the root: where the breast hangs, a thinned root keeps the layer under the septum, which carries
            its vessels to the nipple; on the wall it stays whole (the vessels come out of the intercostal spaces there)."""
            if vessels is None:
                return front.bottom_full(uv)
            hanging = shapely.contains_xy(front.hanging, uv[:, 0], uv[:, 1])
            thin = np.maximum(np.minimum(septum_plane(uv) - ROOT_KEEP, vessels(uv)), front.bottom_full(uv))
            return np.where(hanging, thin, front.bottom_full(uv))
        wedges = self.wedges(points, pattern.union(hanging_part))
        extra = self.thinned("wise", pattern, unary_union([hanging_part, root]), wedges)
        behind = [(hanging_part, floor, front.bottom_spare), (root.intersection(front.hanging), root_floor, front.bottom_spare)] if thinned else []
        return {
            "points": points, "lines": lines, "pattern": pattern, "footprint": hanging_part, "baseOnOutline": False,
            "pedicle": self.piece([(hanging_part, front.top, floor), (root, septum_plane, root_floor)]),
            "resection": self.piece([
                (pattern.difference(hanging_part).difference(root), front.top, front.bottom_spare),
                (root.intersection(pattern), front.top, septum_plane),
                (wedges, front.flap(FLAP_THICKNESS), front.bottom_spare),
                *extra,
                *behind,
            ]),
        }

    # ---- vertical pattern with superomedial pedicle -----------------------------------------------------------
    def vertical(self) -> dict:
        # Full-thickness pedicle based on the medial half of the dome and the start of the medial limb (thinned from
        # behind in the large cases); the lower and lateral part of the pattern comes out, the pillars stay.
        st, front = self.st, self.front
        points, lines, _ = vertical(st)
        pattern = frontal_pattern(front, lines["cúpula"], lines["ramo lateral"], lines["ramo medial"])
        medial_border = np.vstack([lines["cúpula"][: len(lines["cúpula"]) // 2 + 1][::-1], lines["ramo medial"]])
        model_border = st.model(st.skin(medial_border))
        travelled = np.r_[0, np.cumsum(np.linalg.norm(np.diff(model_border, axis=0), axis=1))]
        base = front.project(medial_border[travelled <= SUPEROMEDIAL_BASE])
        superomedial = hull(base, np.array(self.rim.exterior.coords)).intersection(pattern).buffer(0)
        dome_base = front.project(np.array([points["M"], points["L"]]))
        below_dome = pattern.intersection(box(pattern.bounds[0], front.v0, pattern.bounds[2], float(dome_base[:, 1].min())))
        lo, hi = st.b.fold_range
        lateral_side = front.hanging.difference(pattern).intersection(box(self.nipple_uv[0], front.v0, hi - FOLD_MARGIN, 200.0)).buffer(0)
        floor, thinned = self.pedicle_floor("vertical")
        extra = self.thinned("vertical", pattern, superomedial, lateral_side)
        behind = [(superomedial, floor, front.bottom_spare)] if thinned else []
        return {
            "points": points, "lines": lines, "pattern": pattern, "footprint": superomedial, "baseOnOutline": True,
            "pedicle": self.piece([(superomedial, front.top, floor)]),
            "resection": self.piece([
                (below_dome.difference(superomedial), front.top, front.bottom_spare),
                (lateral_side, front.flap(FLAP_THICKNESS + 5.0), front.bottom_spare),  # under the lateral pillar
                *extra,
                *behind,
            ]),
        }

    # ---- vertical pattern with superior pedicle (Lejour) -------------------------------------------------------
    def lejour(self) -> dict:
        # The pedicle is the dermoglandular flap of Pitanguy's technique, from the areola up to the dome. The lower
        # central part of the pattern comes out in full thickness and, under the flap, a keel that tapers upwards; the
        # medial and lateral pillars stay and are sutured to each other.
        st, front = self.st, self.front
        points, lines, _ = vertical(st)
        pattern = frontal_pattern(front, lines["cúpula"], lines["ramo lateral"], lines["ramo medial"])
        superior = hull(np.array(self.rim.exterior.coords), np.array(self.new_areola.exterior.coords)).intersection(pattern).buffer(0)
        dome_base = front.project(np.array([points["M"], points["L"]]))
        below_dome = pattern.intersection(box(pattern.bounds[0], front.v0, pattern.bounds[2], float(dome_base[:, 1].min())))
        apex_v = self.nipple_uv[1] + AREOLA_D / 2 + 30.0
        apex = np.array([self.nipple_uv[0], apex_v if apex_v > self.a_uv[1] else self.a_uv[1] + 25.0])
        wide = front.project(np.array([[-VERTICAL_HALF, DOME_BASE + 20.0], [VERTICAL_HALF, DOME_BASE + 20.0]]))
        keel = Polygon([apex, [wide[1, 0], KEEL_BASE], [wide[0, 0], KEEL_BASE]]).buffer(0)
        return {
            "points": points, "lines": lines, "pattern": pattern, "footprint": superior, "baseOnOutline": True,
            # the skin of the dome is only de-epithelialised: the whole dome is the base of the pedicle
            "base": pattern.difference(below_dome).buffer(0),
            "pedicle": self.piece([(superior, front.top, front.flap(SUPERIOR_THICKNESS))]),
            "resection": self.piece([
                (below_dome.difference(superior), front.top, front.bottom_spare),
                (superior.intersection(keel), front.flap(SUPERIOR_THICKNESS), front.bottom_spare),
            ]),
        }

    # ---- Wise pattern with superomedial pedicle (Orlando and Guthrie) ------------------------------------------
    def orlando(self) -> dict:
        # Full-thickness pedicle (thinned from behind in the large cases) based on the medial half of the keyhole and
        # the whole medial vertical limb (about 9 cm: the perforators of the internal thoracic artery reach a long
        # breast low on that limb); it turns into the keyhole. The rest of the pattern and the wedges under the skin
        # flaps come out.
        st, front = self.st, self.front
        points, lines, _ = inverted_t(st, keyhole=True, fold_margin=self.design["foldMarginMm"])
        pattern = frontal_pattern(front, lines["fechadura"], lines["ramo lateral"], lines["ramo medial"])
        arc = lines["fechadura"]  # from the medial limb, over the top, to the lateral limb
        medial_border = np.vstack([arc[: len(arc) // 2 + 1][::-1], lines["ramo medial"]])
        base = front.project(medial_border)
        superomedial = hull(base, np.array(self.rim.exterior.coords)).intersection(pattern).buffer(0)
        floor, thinned = self.pedicle_floor("orlando")
        wedges = self.wedges(points, pattern.union(superomedial))
        extra = self.thinned("orlando", pattern, superomedial, wedges)
        behind = [(superomedial, floor, front.bottom_spare)] if thinned else []
        return {
            "points": points, "lines": lines, "pattern": pattern, "footprint": superomedial, "baseOnOutline": True,
            "pedicle": self.piece([(superomedial, front.top, floor)]),
            "resection": self.piece([
                (pattern.difference(superomedial), front.top, front.bottom_spare),
                (wedges, front.flap(FLAP_THICKNESS), front.bottom_spare),
                *extra,
                *behind,
            ]),
        }

    # ---- periareolar ring (Benelli's round block) with an inferior wedge -----------------------------------------
    def periareolar(self) -> dict:
        # The skin between the areolotome's circle and the ring is only de-epithelialised: the areola stays on the gland
        # (central pedicle, not lifted off the fascia). Through the lower half of the ring an inferior wedge is taken,
        # under the skin of the lower pole and under a dermoglandular layer that carries the areola.
        st, front = self.st, self.front
        points, lines, _ = ring(st, self.nipple)
        region = Polygon(front.project(lines["anel"])).buffer(0)
        nu, nv = float(self.nipple_uv[0]), float(self.nipple_uv[1])
        k = RREF / float(front.sample(front.front_filled, np.array([[nu, nv]]))[0])  # mm of u per mm across the breast
        top_v = nv - WEDGE_START
        wedge = Polygon([
            [nu - WEDGE_TOP_HALF * k, top_v], [nu + WEDGE_TOP_HALF * k, top_v],
            [nu + WEDGE_BASE_HALF * k, front.v0], [nu - WEDGE_BASE_HALF * k, front.v0],
        ]).intersection(front.domain).buffer(0)
        under_ring, below_ring = wedge.intersection(region).buffer(0), wedge.difference(region).buffer(0)
        return {
            "points": points, "lines": lines, "pattern": region, "footprint": region, "baseOnOutline": True,
            # the dermis is cut along the lower half of the ring (the way in); above the nipple it is left whole
            "base": region.intersection(box(-1e4, nv, 1e4, 1e4)).buffer(0),
            "pedicle": self.piece([(region.difference(wedge), front.top, front.bottom_full), (under_ring, front.top, front.flap(CENTRAL_THICKNESS))]),
            "resection": self.piece([
                (under_ring, front.flap(CENTRAL_THICKNESS), front.bottom_spare),
                (below_ring, front.flap(FLAP_THICKNESS), front.bottom_spare),
            ]),
        }

    # ---- inverted T with a free nipple graft (Thorek) ---------------------------------------------------------------
    def thorek(self) -> dict:
        # No pedicle: the nipple-areola complex is taken as a full-thickness skin graft and the lower pole is amputated
        # whole, with the wedges under the skin flaps. The flaps are closed as an inverted T and the graft is laid on a
        # de-epithelialised bed at the apex of the cone (round point A).
        st, front = self.st, self.front
        points, lines, _ = inverted_t(st, keyhole=False, fold_margin=self.design["foldMarginMm"])
        pattern = frontal_pattern(front, points["A"][None], lines["ramo lateral"], lines["ramo medial"])
        site = self.new_areola.buffer(0)
        wedges = self.wedges(points, pattern)
        extra = self.thinned("thorek", pattern.union(site), Polygon(), wedges)
        return {
            "points": points, "lines": lines, "pattern": pattern, "footprint": site, "baseOnOutline": False, "graft": True,
            "pedicle": EmptyPiece(),
            "resection": self.piece([
                (pattern.difference(site), front.top, front.bottom_spare),
                (wedges, front.flap(FLAP_THICKNESS), front.bottom_spare),
                *extra,
            ]),
        }

    def build(self, key: str) -> dict:
        item = getattr(self, key)()
        item["nipple"], item["areolaNow"], item["a"] = self.nipple, self.areola_now, self.a_uv
        return item


def techniques(st: Standing, front: Front, inverse: Inverse, design: dict | None = None, keys=None) -> dict:
    """The techniques `keys` (default: the three of ptosis II, as accepted in review) on a standing breast."""
    planner = Planner(st, front, inverse, design)
    return {key: planner.build(key) for key in (keys or ("pitanguy", "wise", "vertical"))}


def bisect(f, lo: float, hi: float, target: float, rising: bool, steps: int = 9) -> float:
    """x in [lo, hi] where the monotone f(x) reaches target."""
    for _ in range(steps):
        mid = (lo + hi) / 2
        if (f(mid) < target) == rising:
            lo = mid
        else:
            hi = mid
    return round((lo + hi) / 2, 1)


def design_for(case: str, st: Standing, front: Front, inverse: Inverse, mound_ml: float) -> dict:
    """Dimensions of the large cases: per technique, the pedicle is thinned (never below MIN_PEDICLE_DEPTH, and the
    inferior pedicle never into the plane of the septum) until it is the share of the result it is in ptosis II; then the
    skin flaps round the pattern are thinned until what stays is the breast aimed at, never below MIN_FLAP. Where those
    limits stop it short, the result is larger and the plan says so."""
    design = default_design(case)
    target = design["resultMl"]
    if target is None:
        return design
    report = {}
    for key in CASES[case]["techniques"]:
        def build(**change):
            for field, value in change.items():
                if value is None:
                    design[field].pop(key, None)
                else:
                    design[field][key] = value
            return Planner(st, front, inverse, design).build(key)

        if key in PEDICLE_SHARE:
            goal = PEDICLE_SHARE[key] * target
            if build(pedicleDepthMm=None)["pedicle"].volume > goal:
                if build(pedicleDepthMm=MIN_PEDICLE_DEPTH)["pedicle"].volume >= goal:
                    design["pedicleDepthMm"][key] = MIN_PEDICLE_DEPTH
                else:
                    design["pedicleDepthMm"][key] = bisect(lambda depth: build(pedicleDepthMm=depth)["pedicle"].volume, MIN_PEDICLE_DEPTH, 160.0, goal, rising=True)

        def left_ml(flap):
            return mound_ml - build(flapMm=flap)["resection"].volume
        if left_ml(None) <= target * (1 + VOLUME_TOLERANCE):
            design["flapMm"].pop(key, None)
        elif left_ml(MIN_FLAP) > target:
            design["flapMm"][key] = MIN_FLAP
        else:
            design["flapMm"][key] = bisect(left_ml, MIN_FLAP, 120.0, target, rising=True)
        left = left_ml(design["flapMm"].get(key))
        report[key] = f"pedículo {design['pedicleDepthMm'].get(key, 'espessura total')} mm · retalhos {design['flapMm'].get(key, '—')} mm · fica {left:.0f} mL"
    print(f"[{case}] desenho para {target:.0f} mL: " + "; ".join(f"{k}: {v}" for k, v in report.items()))
    return design


# --------------------------------------------------------------------------------------------------
# what each technique keeps and cuts
# --------------------------------------------------------------------------------------------------
def neurovascular(st: Standing, front: Front, plan: dict) -> dict:
    """Follows every schematic vessel and nerve to the nipple. A branch is cut by a technique when it runs inside
    the resection, or when it crosses the outline of the skin pattern while superficial (within FLAP_THICKNESS of
    the skin: the incision and the plane under the skin flaps), unless it crosses where the pedicle is attached
    (its base, only de-epithelialised: the footprint of the pedicle, or the part of it the technique names as `base`).
    Deeper tissue is only cut where it belongs to the resection. A free graft keeps nothing: every branch counts as cut.
    Returns, per branch and technique, the mm of course inside the resection and the number of incisions crossed."""
    if not ANATOMY_JSON.exists():
        return {}
    anatomy = json.loads(ANATOMY_JSON.read_text())
    ch = st.b.ch
    result = {}
    for name, geometry in anatomy["geometry"].items():
        if geometry["kind"] != "tube":
            continue
        standing = standing_course(st, geometry)
        step = np.r_[np.linalg.norm(np.diff(ch.to_model(standing), axis=0), axis=1), 0.0]
        result[name] = {}
        for key, item in plan.items():
            inside_mm = float(step[item["resection"].contains(standing)].sum())
            in_pattern = shapely.contains_xy(item["pattern"], standing[:, 0], standing[:, 1])
            crossings = 1 if item.get("graft") else 0
            base = item.get("base", item["footprint"]).buffer(1.5)
            for i in np.nonzero(in_pattern[1:] != in_pattern[:-1])[0]:
                # the point where the course crosses the outline (the samples are some mm apart)
                lo, hi = 0.0, 1.0
                for _ in range(10):
                    half = (lo + hi) / 2
                    point = standing[i] + half * (standing[i + 1] - standing[i])
                    if bool(shapely.contains_xy(item["pattern"], point[0], point[1])) == bool(in_pattern[i]):
                        lo = half
                    else:
                        hi = half
                cross = standing[i] + (lo + hi) / 2 * (standing[i + 1] - standing[i])
                skin = front.top(cross[None, :2])[0]
                superficial = skin - FLAP_THICKNESS <= cross[2] <= skin + 1.0
                at_base = item["baseOnOutline"] and base.contains(Point(cross[:2]))
                crossings += int(superficial and not at_base)
            result[name][key] = {"insideMm": round(inside_mm, 1), "incisions": crossings}
    return result


# --------------------------------------------------------------------------------------------------
# output
# --------------------------------------------------------------------------------------------------
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
RING_NOTES = {
    "S": "borda superior do anel: borda superior da nova aréola",
    "I": "borda inferior do anel",
    "M": "borda medial do anel",
    "L": "borda lateral do anel",
}
A_RISEN = "novo mamilo: 2 cm acima do atual, que já está na altura do sulco"


def resample_course(points: np.ndarray, step: float) -> np.ndarray:
    """A polyline of (u, v, r) points resampled every `step` mm along it (in the chart: close enough for a corridor)."""
    s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))]
    t = np.linspace(0, s[-1], max(2, int(np.ceil(s[-1] / step)) + 1))
    return np.stack([np.interp(t, s, points[:, c]) for c in range(points.shape[1])], 1)


def standing_course(st: Standing, geometry: dict) -> np.ndarray:
    """A schematic tube (src/data/breastAnatomy.json) in the standing breast: its centre line carried by the map, plus the
    push that keeps it under the skin in that state. Standing chart (u, v, r)."""
    ch = st.b.ch
    rest = np.array(geometry["points"]).reshape(-1, 3) / MM
    standing = ch.to_model(st.to_state(ch.to_chart(rest)))
    state_id = bb.STATES[st.k]["id"]
    for index, *shift in geometry.get("clearance", {}).get(state_id, []):
        standing[index] += np.array(shift) / MM
    return ch.to_chart(standing)


def case_setup(case: str) -> tuple:
    """Standing breast, frontal grid and inverse map of a case."""
    state = [s["id"] for s in bb.STATES].index(case)
    breast = bb.Breast("op", bb.trunk_axis())
    st = Standing(breast, state, min_rise=MIN_RISE)
    return breast, st, Front(st), Inverse(breast, state), state


def design_path(case: str) -> Path:
    return Path(str(OUT_JSON).format(suffix=CASES[case]["suffix"]))


def load_design(case: str) -> dict:
    """The design written by this script for a case (build_mammaplasty_steps.py builds the same pieces)."""
    return json.loads(design_path(case).read_text())["design"]


def main() -> None:
    cases = [c for c in CASES if "--case" not in sys.argv or c == sys.argv[sys.argv.index("--case") + 1]]
    for case in cases:
        write_case(case)


def write_case(case: str) -> None:
    suffix = CASES[case]["suffix"]
    breast, st, front, inverse, state = case_setup(case)
    ch = breast.ch
    mound_ml = bb.mound_volumes(breast)[state + 1]
    design = design_for(case, st, front, inverse, mound_ml)
    plan = techniques(st, front, inverse, design, CASES[case]["techniques"])
    cut = neurovascular(st, front, plan)
    a_risen = st.ref_height > st.fold_height + 0.5  # point A above the projection of the fold (ptosis grade I)
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
    references = f"mamo-reference-lines{suffix}"
    structure(references, "Linhas de referência (linha média, meridiano, sulco)", ch.to_model(ch.nipple[None])[0])
    v_line = np.arange(float(ch.to_chart(notch[None])[0, 1]) - 4, st.fold_height - 70, -2.5)
    midline = ch.to_model(np.c_[np.zeros(len(v_line)), v_line, skin_field(np.zeros(len(v_line)), v_line) + MARK_LIFT])
    add_tube(references, f"mamo_ref_midline{suffix}", "Linha média", midline, COLORS["reference"], 0.6)
    meridian_s = np.c_[np.zeros(200), np.linspace(-160.0, float(st.fold_s(0.0)), 200)]
    add_tube(references, f"mamo_ref_meridian{suffix}", "Meridiano da mama", rest_of(resample(meridian_s, 2.5), MARK_LIFT), COLORS["reference"], 0.6)
    lo, hi = breast.fold_range
    fold_x = np.linspace((lo + 6 - st.um) * st.rho, (hi - 6 - st.um) * st.rho, 160)
    fold_line = np.c_[fold_x, st.fold_s(fold_x)]
    add_tube(references, f"mamo_ref_fold{suffix}", "Sulco inframamário", rest_of(resample(fold_line, 2.5), MARK_LIFT), "#b91c1c", 0.6)

    # ---- techniques ---------------------------------------------------------------------------------------
    notch_chart = ch.to_chart(notch[None])[0]
    for technique, item in plan.items():
        key = case_key(technique, case)
        info = TECHNIQUES[technique]
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
            notes = {**POINT_NOTES, **(RING_NOTES if info["skin"] == "ring" else {}), **({"A": A_RISEN} if a_risen else {})}
            points_out[f"mamo:{key}:{point_name}"] = {"rest": r4(rest_of(xs, MARK_LIFT)[0] * MM), "label": point_name, "note": notes[point_name]}
        pedicle, resection = item["pedicle"], item["resection"]
        if pedicle.volume > 0:
            structure(f"mamo-pedicle-{key}", f"Pedículo {info['pedicle']}", ch.to_model(pedicle.rest.mean(0)[None])[0])
            add_piece(f"mamo-pedicle-{key}", f"mamo_{key}_pediculo", f"Pedículo {info['pedicle']}", pedicle, COLORS["pedicle"], 0.88)
        structure(f"mamo-resection-{key}", f"Ressecção {info['resection']}" + (f" (pedículo {info['pedicle']})" if info["pedicle"] else ""), ch.to_model(resection.rest.mean(0)[None])[0])
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
            "leftMl": round(mound_ml - resection.volume),
            "berrocal": bb.berrocal(resection.volume * DENSITY),
            "cut": sorted(name for name, value in cut.items() if value[technique]["insideMm"] >= 4.0 or value[technique]["incisions"] > 0),
            "kept": sorted(name for name, value in cut.items() if not (value[technique]["insideMm"] >= 4.0 or value[technique]["incisions"] > 0)),
        }
        if technique in design["pedicleDepthMm"]:
            m["pedicleDepthMm"] = design["pedicleDepthMm"][technique]
        if technique in design["flapMm"]:
            m["flapMm"] = design["flapMm"][technique]
        if "B" in pts:
            m["limbEndsApartMm"] = round(float(np.linalg.norm(model_of(pts["B"])[0] - model_of(pts["C"])[0])), 0)
            m["horizontalMinusFoldMm"] = round(m["linesMm"]["horizontal medial"] + m["linesMm"]["horizontal lateral"] - m["linesMm"]["sulco"], 0)
        if "F" in pts:
            m["openingMm"] = m["linesMm"]["cúpula"]
        if info["skin"] == "ring":
            # skin taken between the areolotome's circle and the ring: above, below and beside the areola
            m["openingMm"] = m["linesMm"]["anel"]
            m["ringMarginsMm"] = {"top": round(float(item["nipple"][1]), 0), "bottom": RING_BELOW, "side": RING_SIDE}
        measures[technique] = m
        print(f"[{case}] {info['label']}: fúrcula–A {m['notchToAMm']:.0f} mm · subida do CAP {m['nippleRiseMm']:.0f} mm · linhas {m['linesMm']}")
        if pedicle.volume > 0:
            print(f"   pedículo {info['pedicle']}: {pedicle.volume:.0f} mL ≈ {m['pedicleG']} g ({'fechada' if pedicle.closed else 'ABERTA'}, {len(pedicle.rest)} vértices, inverso {pedicle.residual:.3f} mm)")
        print(f"   ressecção {info['resection']}: {resection.volume:.0f} mL ≈ {m['resectionG']} g = {m['resectionPct']}% do monte, Berrocal {m['berrocal']}; fica {m['leftMl']} mL ({'fechada' if resection.closed else 'ABERTA'}, {len(resection.rest)} vértices, inverso {resection.residual:.3f} mm)")
        print(f"   secciona: {', '.join(m['cut']) or '—'}")

    out_bin = Path(str(OUT_BIN).format(suffix=suffix))
    out_json = design_path(case)
    out_bin.write_bytes(b"".join(blobs))
    out = {
        "version": 2, "source": SOURCE, "case": case, "state": case, "side": "op",
        # the content hash keeps the service worker (cache first) from serving an older binary with newer data
        "bin": f"models/hybrid/{out_bin.name}?v={hashlib.sha1(out_bin.read_bytes()).hexdigest()[:10]}", "byteLength": offset,
        "dimensions": {"areolaMm": AREOLA_D, "areolaNowMm": CASES[case]["areolaNowMm"], "limbMm": LIMB, "limbAngleDeg": T_ANGLE, "rimMm": RIM, "inferiorBaseMm": INFERIOR_BASE, "superiorThicknessMm": SUPERIOR_THICKNESS, "superomedialBaseMm": SUPEROMEDIAL_BASE, "leftOnFasciaMm": LEFT_ON_FASCIA, "flapMm": FLAP_THICKNESS, "centralThicknessMm": CENTRAL_THICKNESS, "minRiseMm": MIN_RISE, "densityGPerMl": DENSITY, "moundMl": round(mound_ml), "resultMl": CASES[case]["resultMl"], "aRisenMm": round(st.rise) if a_risen else 0},
        "design": design,
        "techniques": {case_key(key, case): {**TECHNIQUES[key], "technique": key, "measurements": measures[key]} for key in plan},
        "points": points_out,
        "structures": structures,
        "meshes": meshes,
        "geometry": {**tubes, **pieces_out},
    }
    out_json.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"wrote {out_json.relative_to(bb.ROOT)} ({out_json.stat().st_size / 1e3:.0f} kB) and {out_bin.relative_to(bb.ROOT)} ({offset / 1e3:.0f} kB)")
    if "--figures" in sys.argv:
        figures(st, front, plan, Path(sys.argv[sys.argv.index("--figures") + 1]) / case)


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
