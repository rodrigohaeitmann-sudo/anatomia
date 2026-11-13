#!/usr/bin/env python3
"""Breast chart and ptosis model for the hybrid torso (docs/plano-mamoplastia.md).

Nothing anatomical is modelled here: the real skin and breast meshes are *deformed* by a smooth,
invertible map built on landmarks measured on those same meshes. The map is shipped as a small
parametric model (a few kB) and evaluated in the app on every vertex (src/lib/breastMap.ts), so the
same function also carries labels, markings and surgical pieces to any breast state.

1. Chart ("carta da mama"), one per side. Cylindrical coordinates about a vertical axis through the
   trunk: u = RREF * theta (arc length, lateral +), v = height above the nipple, r = radius.
   * skin radius field R_S(u, v) (outermost skin hit) and the footprint of the adipose body;
   * base surface B(u, v): the trunk without the breast mound, i.e. the skin radius outside the
     footprint and its harmonic (membrane) continuation inside. Depth d = r - B is the distance of a
     point in front of that wall. Tissue behind B (d <= 0) never moves: it is the padding that stays
     on the chest when the mound empties (retromammary fat and the share of subcutaneous fat the
     trunk has everywhere), so the skin of an emptied upper pole comes to rest on the trunk surface
     instead of sinking to the muscle;
   * inframammary fold curve: the strongest vertical concavity of the skin along the lower limit of
     the adipose body, per column.
2. Ptosis: flow map of an incompressible velocity field in the (a, d) half-plane of every meridian
   (a = height above the fold): psi = -S W(d) L(a).
     w_a = -S W'(d) L(a)   tissue descends; W' = 0 on the wall and 1 beyond a shear layer that is
                           thin over the upper breast (the mound slides as a whole) and thick around
                           the fold, where the tissue is tethered and the lower pole stretches;
     w_d =  S W(d) L'(a)   it thins where the descent accelerates (upper pole) and piles up where it
                           slows down (below the fold): the mound empties into a hanging pouch.
   Being a flow, the map is exactly area-preserving in the chart and cannot fold or cross the wall.
   Major ptosis adds a second flow of the same kind, a tilt: below the fold the tissue descends the
   more the farther it is from the wall (the lower pole is tethered to the fold, the rest of the pouch
   overtakes it), so the axis of the breast turns downwards and the nipple reaches the lowest contour.
3. Hypertrophy: ptosis seldom comes without it, so every grade carries a growth of the mound applied
   after the flows: thicker (depth), wider (about the meridian), longer below the fold and, for the
   pendulous breast, hanging closer to the abdominal wall. The growth is a flow too: a smooth velocity
   field integrated over unit time (RK4), whose divergence is the gain of volume. Being a flow it cannot
   fold the tissue (a displacement applied in one go did, at the lateral edge of the mound, where the
   taper falls faster than the distance from the meridian grows). The volume of every state is measured
   through the Jacobian of the whole map (the chart is cylindrical: tissue carried to a larger radius
   also gains width, so the flows alone already change the volume a little), and the smallest Jacobian
   determinant is checked (FOLD_LIMIT).
4. Regnault grades are picked by measuring the result (nipple against the fold and the lowest contour).

Outputs:
  src/data/breastModel.json                 chart parameters, curves, states, measurements
  public/models/hybrid/breast-chart.bin     base surface B of both sides (uint16)
  scripts/hybrid/breast-test-vectors.json   rest points and their deformed positions (check_breast_map.mjs)

Usage: node scripts/hybrid/decode_model.mjs && python3 scripts/hybrid/build_breast.py
       (`--figures DIR` also writes profile plots and renders for review)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy import sparse
from scipy.ndimage import binary_dilation, binary_fill_holes, gaussian_filter, gaussian_filter1d, map_coordinates
from scipy.sparse.linalg import spsolve
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = json.loads((ROOT / "src/data/hybridTorsoManifest.json").read_text())
LAYERS = json.loads((ROOT / "src/data/anatomyLayers.json").read_text())
MM = MANIFEST["landmarks"]["unitsPerMm"]
MESH_DIR = ROOT / "assets/build/model-meshes"
OUT_JSON = ROOT / "src/data/breastModel.json"
OUT_BIN = ROOT / "public/models/hybrid/breast-chart.bin"
OUT_VECTORS = Path(__file__).parent / "breast-test-vectors.json"

CELL = 2.0  # chart grid, mm
RREF = 170.0  # reference radius: u = RREF * theta is roughly an arc length on the chest
U_RANGE = (-40.0, 340.0)
V_RANGE = (-230.0, 240.0)
B_STEP = 0.005  # mm, quantisation of the base surface

# Ptosis model parameters (mm, degrees). See the module docstring.
FLOW = {"shear": 7.0, "shearFold": 20.0, "shearBlend": [5.0, 65.0], "rise": 60.0, "decel": [-55.0, 15.0], "lmin": 0.7, "stepMm": 4.0}
TILT = {"reach": 60.0, "fade": [0.0, 60.0], "stepMm": 4.0}  # extra descent of the tissue far from the wall, below the fold
GROWTH = {"shear": 15.0, "blend": 20.0, "hangMm": 120.0, "steps": 6}  # width/length follow the superficial tissue; length grows below the fold
FOLD_LIMIT = 0.1  # smallest Jacobian determinant accepted anywhere in the mound (0 would be tissue folding over itself)
TAPER_MM = 28.0
HINGE_FLAT = 0.5  # the pouch hangs from a flatter curve than the fold (broad U instead of a V)

# Breast states: flow descent (mm of travel of the tissue), tilt of the pouch (extra descent far from the wall, as a
# fraction of TILT.reach) and growth of the mound (depth, width about the meridian, length below the fold, and how
# much thinner the pouch hangs HANG mm below the fold).
STATES = [
    {
        "id": "ptose-1",
        "label": "Ptose grau I com hipertrofia leve",
        "short": "Ptose I",
        "descent": 50.0,
        "tilt": 0.0,
        "growth": {"depth": 1.1, "width": 1.08, "length": 1.05, "hang": 0.0},
        "description": "Mamilo na altura do sulco inframamário, ainda acima do contorno inferior da mama. O polo superior começa a esvaziar, o polo inferior ultrapassa o sulco e o volume já é maior.",
    },
    {
        "id": "ptose-2",
        "label": "Ptose grau II com hipertrofia moderada",
        "short": "Ptose II",
        "descent": 77.0,
        "tilt": 0.0,
        "growth": {"depth": 1.18, "width": 1.16, "length": 1.12, "hang": 0.0},
        "description": "Mamilo abaixo do sulco, mas acima do contorno inferior. Polo superior plano, glândula deslizada sobre a fáscia, polo inferior alongado e mama mais pesada: o caso típico da mamoplastia redutora.",
    },
    {
        "id": "ptose-3",
        "label": "Ptose grau III com hipertrofia acentuada",
        "short": "Ptose III",
        "descent": 77.0,
        "tilt": 1.3,
        "growth": {"depth": 1.45, "width": 1.4, "length": 1.3, "hang": 0.5},
        "description": "Mamilo no contorno mais baixo da mama, apontando para baixo. A mama, volumosa, pende sobre a parede abdominal e a aréola se alonga.",
    },
    # Hypertrophy graded by the weight a reduction removes (Berrocal Revueltas: III 800-1000 g, IV >= 1000 g per breast),
    # on a grade III ptosis (docs/plano-mamoplastia-g3-g4.md). `resultMl`: the breast the reduction aims at.
    {
        "id": "g3",
        "label": "G3: ptose grau III com hipertrofia grau III",
        "short": "G3",
        "descent": 80.0,
        "tilt": 1.3,
        "growth": {"depth": 2.4, "width": 1.85, "length": 1.3, "hang": 0.5},
        "resultMl": 700,
        "description": "Hipertrofia grau III de Berrocal Revueltas: a redução retira de 800 a 1.000 g por mama. Mama larga e pendente, mamilo no contorno mais baixo, fúrcula–mamilo acima de 40 cm.",
    },
    {
        "id": "g4",
        "label": "G4: ptose grau III com gigantomastia (hipertrofia grau IV)",
        "short": "G4",
        "descent": 84.0,
        "tilt": 1.4,
        "growth": {"depth": 2.9, "width": 2.0, "length": 1.4, "hang": 0.6},
        "resultMl": 850,
        "description": "Gigantomastia: hipertrofia grau IV de Berrocal Revueltas, a redução retira mais de 1.000 g por mama. Fúrcula–mamilo de 44 cm, faixa em que muitos autores consideram o enxerto livre do complexo areolopapilar.",
    },
]
RESULT_ML = 500  # the breast a reduction aims at when a state does not say (for the expected Berrocal grade)
DENSITY = 0.95  # g/mL, fatty breast tissue


# --------------------------------------------------------------------------------------------------
# meshes (model space, mm)
# --------------------------------------------------------------------------------------------------
def mesh(name: str) -> tuple[np.ndarray, np.ndarray]:
    pos = np.fromfile(MESH_DIR / f"{name}.pos.bin", dtype=np.float32).reshape(-1, 3).astype(np.float64) / MM
    idx = np.fromfile(MESH_DIR / f"{name}.idx.bin", dtype=np.uint32).reshape(-1, 3).astype(np.int64)
    return pos, idx


def names(pred) -> list[str]:
    return [m["name"] for m in MANIFEST["meshes"] if pred(m)]


def layer_landmark(ident: str) -> np.ndarray:
    return np.array(next(item["point"] for item in LAYERS["landmarks"] if item["id"] == ident)) / MM


SKIN = "hra_VH_F_skin"
SIDE_MESHES = {
    "op": names(lambda m: m["structure"] in ("breast", "breast-fat", "breast-ligaments", "nipple-areola")),
    "contra": names(lambda m: m["structure"] == "contralateral-breast"),
}


def sample_surface(pos: np.ndarray, idx: np.ndarray, spacing: float) -> np.ndarray:
    """Deterministic surface samples, about one per spacing^2."""
    a, b, c = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    count = np.maximum(1, np.ceil(area / spacing**2).astype(int))
    tri = np.repeat(np.arange(len(idx)), count)
    gen = np.random.default_rng(1)
    s, t = gen.random(len(tri)), gen.random(len(tri))
    flip = s + t > 1
    s[flip], t[flip] = 1 - s[flip], 1 - t[flip]
    return a[tri] + (b[tri] - a[tri]) * s[:, None] + (c[tri] - a[tri]) * t[:, None]


# --------------------------------------------------------------------------------------------------
# 1. chart
# --------------------------------------------------------------------------------------------------
def trunk_axis() -> tuple[float, float]:
    """Vertical axis of the chart: the sternal midline (x) and the middle of the trunk at nipple level (z)."""
    xc = float((layer_landmark("esterno.incisura-jugular")[0] + layer_landmark("esterno.xifoide")[0]) / 2)
    skin = mesh(SKIN)[0]
    y = np.array(MANIFEST["landmarks"]["nipple"])[1] / MM
    band = skin[np.abs(skin[:, 1] - y) < 10]
    zc = float((band[:, 2].min() + band[:, 2].max()) / 2)
    return round(xc, 1), round(zc, 1)


class Chart:
    def __init__(self, side: str, axis: tuple[float, float]):
        self.side = side
        self.s = 1.0 if side == "op" else -1.0  # operative side: lateral = -x
        self.xc, self.zc = axis
        self.y0 = 0.0
        nipple_meshes = [n for n in SIDE_MESHES[side] if "nipple" in n]
        pts = self.to_chart(np.vstack([mesh(n)[0] for n in nipple_meshes]))
        tip = pts[np.argmax(pts[:, 2])]
        self.y0 = round(float(tip[1]), 2)
        self.nipple = np.array([tip[0], 0.0, tip[2]])
        self.nu = int(round((U_RANGE[1] - U_RANGE[0]) / CELL)) + 1
        self.nv = int(round((V_RANGE[1] - V_RANGE[0]) / CELL)) + 1
        self.us = U_RANGE[0] + CELL * np.arange(self.nu)
        self.vs = V_RANGE[0] + CELL * np.arange(self.nv)

    def to_chart(self, p: np.ndarray) -> np.ndarray:
        dx = -self.s * (p[..., 0] - self.xc)
        dz = p[..., 2] - self.zc
        return np.stack([RREF * np.arctan2(dx, dz), p[..., 1] - self.y0, np.hypot(dx, dz)], -1)

    def to_model(self, q: np.ndarray) -> np.ndarray:
        theta = q[..., 0] / RREF
        return np.stack([self.xc - self.s * q[..., 2] * np.sin(theta), q[..., 1] + self.y0, self.zc + q[..., 2] * np.cos(theta)], -1)

    def radius_field(self, pos: np.ndarray, idx: np.ndarray, outer: bool) -> np.ndarray:
        q = self.to_chart(sample_surface(pos, idx, 0.7))
        iu = np.round((q[:, 0] - U_RANGE[0]) / CELL).astype(int)
        iv = np.round((q[:, 1] - V_RANGE[0]) / CELL).astype(int)
        ok = (iu >= 0) & (iu < self.nu) & (iv >= 0) & (iv < self.nv)
        grid = np.full((self.nu, self.nv), -np.inf if outer else np.inf)
        (np.maximum if outer else np.minimum).at(grid, (iu[ok], iv[ok]), q[ok, 2])
        grid[~np.isfinite(grid)] = np.nan
        return grid


def fill_nan(grid: np.ndarray) -> np.ndarray:
    known = np.argwhere(~np.isnan(grid))
    _, near = cKDTree(known).query(np.argwhere(np.ones_like(grid, bool)))
    return grid[tuple(known[near].T)].reshape(grid.shape)


def membrane_fill(field: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Harmonic continuation of `field` inside `mask` (a soap film spanned on the surrounding values)."""
    nu, nv = field.shape
    index = np.arange(nu * nv).reshape(nu, nv)
    rows, cols = [], []
    degree = np.zeros((nu, nv))
    for du, dv in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        src = (slice(max(0, -du), nu - max(0, du)), slice(max(0, -dv), nv - max(0, dv)))
        dst = (slice(max(0, du), nu - max(0, -du)), slice(max(0, dv), nv - max(0, -dv)))
        rows.append(index[src].ravel())
        cols.append(index[dst].ravel())
        degree[src] += 1
    rows, cols = np.concatenate(rows), np.concatenate(cols)
    lap = sparse.coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(nu * nv, nu * nv)).tocsr() - sparse.diags(degree.ravel())
    unknown = mask.ravel()
    x = field.ravel().copy()
    x[unknown] = spsolve(lap[unknown][:, unknown].tocsc(), -lap[unknown][:, ~unknown] @ x[~unknown])
    return x.reshape(nu, nv)


class Breast:
    """Chart of one breast: base surface, fold, hinge and top curves, window shipped to the app."""

    def __init__(self, side: str, axis: tuple[float, float]):
        ch = self.ch = Chart(side, axis)
        fat = next(n for n in SIDE_MESHES[side] if "fat" in n)
        self.RS = fill_nan(ch.radius_field(*mesh(SKIN), outer=True))
        fat_front = ch.radius_field(*mesh(fat), outer=True)
        self.footprint = binary_fill_holes(~np.isnan(fat_front))
        # base surface: the trunk without the mound (the skin outside the footprint, its harmonic continuation inside)
        base = membrane_fill(gaussian_filter(self.RS, 1.5), binary_dilation(self.footprint, iterations=2))
        base = gaussian_filter(base, 3.0)  # smooth across the fold: no crease in the tissue hanging over it
        # fold: strongest vertical concavity of the skin within 2 cm of the lower limit of the adipose body
        curvature = np.gradient(np.gradient(gaussian_filter(self.RS, 1.5), CELL, axis=1), CELL, axis=1)
        fold = np.full(ch.nu, np.nan)
        top = np.full(ch.nu, np.nan)
        for i in range(ch.nu):
            column = np.nonzero(self.footprint[i])[0]
            if len(column) < 5:
                continue
            top[i] = ch.vs[column.max()]
            window = slice(max(0, column.min() - 8), column.min() + 10)
            j = int(np.argmax(curvature[i, window])) + window.start
            if curvature[i, j] > 0.008:
                fold[i] = ch.vs[j]
        found = np.nonzero(~np.isnan(fold))[0]
        self.fold_range = (float(ch.us[found.min()]), float(ch.us[found.max()]))
        self.fold = gaussian_filter1d(np.interp(np.arange(ch.nu), found, fold[found]), 4.0, mode="nearest")
        has_top = np.nonzero(~np.isnan(top))[0]
        self.top = gaussian_filter1d(np.interp(np.arange(ch.nu), has_top, top[has_top]), 4.0, mode="nearest")
        self.hinge = self.fold.min() + (self.fold - self.fold.min()) * (1 - HINGE_FLAT)
        # window shipped to the app: every column that can move, every height the pouch can reach
        self.i0 = int(np.floor((self.fold_range[0] - U_RANGE[0]) / CELL)) - 10  # room for the widened mound
        self.i1 = int(np.ceil((self.fold_range[1] - U_RANGE[0]) / CELL)) + 11
        self.j0, self.j1 = 0, int(round((170.0 - V_RANGE[0]) / CELL)) + 1
        window = base[self.i0:self.i1, self.j0:self.j1]
        self.qmin = float(np.floor(window.min()))
        self.quantised = np.round((window - self.qmin) / B_STEP).astype(np.uint16)
        self.B = self.quantised.astype(np.float64) * B_STEP + self.qmin
        self.u0 = float(ch.us[self.i0])
        self.v0 = float(ch.vs[self.j0])
        self.curves = {key: np.round(getattr(self, key)[self.i0:self.i1], 3) for key in ("fold", "hinge", "top")}

    # ---- sampling exactly as the app does (bilinear, clamped) ------------------------------------
    def base(self, u: np.ndarray, v: np.ndarray) -> np.ndarray:
        nu, nv = self.B.shape
        fu = np.clip((u - self.u0) / CELL, 0, nu - 1)
        fv = np.clip((v - self.v0) / CELL, 0, nv - 1)
        return map_coordinates(self.B, [fu, fv], order=1, mode="nearest")

    def curve(self, key: str, u: np.ndarray) -> np.ndarray:
        values = self.curves[key]
        f = np.clip((u - self.u0) / CELL, 0, len(values) - 1)
        i = np.minimum(np.floor(f).astype(int), len(values) - 2)
        return values[i] + (values[i + 1] - values[i]) * (f - i)

    def taper(self, u: np.ndarray) -> np.ndarray:
        lo, hi = self.fold_range
        return smoothstep((u - lo) / TAPER_MM) * smoothstep((hi - u) / TAPER_MM)

    def depth(self, q: np.ndarray) -> np.ndarray:
        return q[:, 2] - self.base(q[:, 0], q[:, 1])


# --------------------------------------------------------------------------------------------------
# 2. ptosis map (mirrored in src/lib/breastMap.ts; the test vectors keep both in step)
# --------------------------------------------------------------------------------------------------
def smoothstep(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def dsmoothstep(t):
    t = np.clip(t, 0, 1)
    return 6 * t * (1 - t)


def flow_velocity(a, d, s, top):
    """Velocity of the ptosis flow, from the stream function psi = -s L(a) delta(a) P(d / delta(a)).

    delta(a) is the thickness of the shear layer on the wall: thin over the fascia (the breast slides as a whole
    in the retromammary space), thick around and below the fold, where the tissue is tethered and the lower pole
    stretches gradually (a rounded pouch instead of a block). P is the integral of the profile p across depth
    (0 on the wall, 1 beyond the layer), so the descent is -s L p and the rest follows from incompressibility."""
    d_fold, d_up = FLOW["shearFold"], FLOW["shear"]
    lo_s, hi_s = FLOW["shearBlend"]
    x = (a - lo_s) / (hi_s - lo_s)
    delta = d_fold + (d_up - d_fold) * smoothstep(x)
    ddelta = (d_up - d_fold) * dsmoothstep(x) / (hi_s - lo_s)
    t = np.clip(d / delta, 0, None)
    inside = t < 1
    tc = np.minimum(t, 1)
    profile = tc * tc * (3 - 2 * tc)
    integral = np.where(inside, tc**3 - 0.5 * tc**4, 0.5 + (t - 1))
    lo, hi = FLOW["decel"]
    up = smoothstep((top - a) / FLOW["rise"])
    dup = -dsmoothstep((top - a) / FLOW["rise"]) / FLOW["rise"]
    y = (a - lo) / (hi - lo)
    down = FLOW["lmin"] + (1 - FLOW["lmin"]) * smoothstep(y)
    ddown = (1 - FLOW["lmin"]) * dsmoothstep(y) / (hi - lo)
    drive, ddrive = up * down, dup * down + up * ddown
    return -s * drive * profile, s * (ddrive * delta * integral + drive * ddelta * (integral - t * profile))


def flow_advance(a, d, amp, top, from_mm: float, to_mm: float):
    """Moves (a, d) along the ptosis flow from a descent of from_mm to to_mm (RK4; backwards when to_mm is smaller)."""
    steps = int(np.ceil(abs(to_mm - from_mm) / FLOW["stepMm"]))
    if steps == 0:
        return a, d
    s = (to_mm - from_mm) * amp
    h = 1.0 / steps
    for _ in range(steps):
        k1a, k1d = flow_velocity(a, d, s, top)
        k2a, k2d = flow_velocity(a + 0.5 * h * k1a, d + 0.5 * h * k1d, s, top)
        k3a, k3d = flow_velocity(a + 0.5 * h * k2a, d + 0.5 * h * k2d, s, top)
        k4a, k4d = flow_velocity(a + h * k3a, d + h * k3d, s, top)
        a = a + h * (k1a + 2 * k2a + 2 * k3a + k4a) / 6
        d = np.maximum(d + h * (k1d + 2 * k2d + 2 * k3d + k4d) / 6, 0)
    return a, d


def tilt_velocity(a, d, k):
    """Velocity of the tilt, from psi = -k M(a) Q(d): below the fold (M = 1) a pure shear, the descent q = Q'
    growing with the distance from the wall (no slip on the wall, levelling off at TILT.reach so the tip of the
    pouch stays round); M fades above the fold, where the tissue thins as it is drawn into the pouch."""
    reach = TILT["reach"]
    lo, hi = TILT["fade"]
    x = (a - lo) / (hi - lo)
    m = 1 - smoothstep(x)
    dm = -dsmoothstep(x) / (hi - lo)
    t = np.maximum(d, 0) / reach
    q = reach * t * t / (1 + t * t)
    integral = reach * reach * (t - np.arctan(t))
    return -k * m * q, k * dm * integral


def tilt_advance(a, d, amp, tilt: float):
    """Tilts the pouch: the tissue far from the wall descends `tilt` * TILT.reach more than the wall (RK4)."""
    steps = int(np.ceil(abs(tilt) * TILT["reach"] / TILT["stepMm"]))
    if steps == 0:
        return a, d
    k = tilt * amp
    h = 1.0 / steps
    for _ in range(steps):
        k1a, k1d = tilt_velocity(a, d, k)
        k2a, k2d = tilt_velocity(a + 0.5 * h * k1a, d + 0.5 * h * k1d, k)
        k3a, k3d = tilt_velocity(a + 0.5 * h * k2a, d + 0.5 * h * k2d, k)
        k4a, k4d = tilt_velocity(a + h * k3a, d + h * k3d, k)
        a = a + h * (k1a + 2 * k2a + 2 * k3a + k4a) / 6
        d = np.maximum(d + h * (k1d + 2 * k2d + 2 * k3d + k4d) / 6, 0)
    return a, d


def growth_velocity(breast: Breast, u, a, d, um: float, rates: tuple[float, float, float], hang: float):
    """Velocity of the hypertrophy flow at (u, a, d): the superficial tissue (beyond GROWTH.shear from the wall) moves
    away from the meridian (width) and, below the fold, down (length); depth grows everywhere in the footprint, less
    where the pouch hangs (`hang`: a pendulous breast lies along the abdominal wall instead of standing out). `rates`
    are the logarithms of the width, length and depth factors, so the central tissue grows by exactly those factors."""
    lw, ll, ld = rates
    taper = breast.taper(u)
    superficial = smoothstep(d / GROWTH["shear"]) * taper
    below = smoothstep((GROWTH["blend"] - a) / (2 * GROWTH["blend"]))
    thin = 1 - hang * taper * smoothstep(-a / GROWTH["hangMm"])
    return lw * superficial * (u - um), ll * superficial * below * a, d * (ld * taper + np.log(np.maximum(thin, 1e-3)))


def grow(breast: Breast, u, a, d, um: float, growth: dict):
    """Hypertrophy, applied to the flowed breast as a flow of its own (RK4 over unit time): it cannot fold the tissue,
    and the wall (d = 0) keeps its place."""
    rates = (np.log(growth["width"]), np.log(growth["length"]), np.log(growth["depth"]))
    if not any(rates) and not growth["hang"]:
        return u, a, d
    u, a, d = np.asarray(u, float), np.asarray(a, float), np.asarray(d, float)
    h = 1.0 / GROWTH["steps"]
    for _ in range(GROWTH["steps"]):
        k1 = growth_velocity(breast, u, a, d, um, rates, growth["hang"])
        k2 = growth_velocity(breast, u + 0.5 * h * k1[0], a + 0.5 * h * k1[1], d + 0.5 * h * k1[2], um, rates, growth["hang"])
        k3 = growth_velocity(breast, u + 0.5 * h * k2[0], a + 0.5 * h * k2[1], d + 0.5 * h * k2[2], um, rates, growth["hang"])
        k4 = growth_velocity(breast, u + h * k3[0], a + h * k3[1], d + h * k3[2], um, rates, growth["hang"])
        u = u + h * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6
        a = a + h * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6
        d = np.maximum(d + h * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]) / 6, 0)
    return u, a, d


def deform(breast: Breast, q: np.ndarray) -> list[np.ndarray]:
    """Chart points (u, v, r) in every state, in STATES order (each state continues the previous flow)."""
    u, v, r = q[:, 0], q[:, 1], q[:, 2]
    d = r - breast.base(u, v)
    amp = breast.taper(u)
    sel = (d > 0) & (amp > 1e-4)
    hinge = breast.curve("hinge", u[sel])
    top = breast.curve("top", u[sel]) - hinge
    a, dd, amp_s = v[sel] - hinge, d[sel], amp[sel]
    um = round(float(breast.ch.nipple[0]), 2)  # as shipped (nippleChart)
    out = []
    travelled = 0.0
    for state in STATES:
        a, dd = flow_advance(a, dd, amp_s, top, travelled, state["descent"])
        travelled = state["descent"]
        a2, d2 = tilt_advance(a, dd, amp_s, state["tilt"])
        u2, a2, d2 = grow(breast, u[sel], a2, d2, um, state["growth"])
        moved = q.copy()
        moved[sel, 0] = u2
        moved[sel, 1] = hinge + a2
        moved[sel, 2] = breast.base(u2, moved[sel, 1]) + d2
        out.append(moved)
    return out


# --------------------------------------------------------------------------------------------------
# 3. measurements
# --------------------------------------------------------------------------------------------------
def polyline_length(points: np.ndarray) -> float:
    return float(np.linalg.norm(np.diff(points, axis=0), axis=1).sum())


def mound_jacobians(breast: Breast) -> tuple[np.ndarray, list[np.ndarray]]:
    """Rest volume elements (mm^3) of the mound (tissue in front of the wall, under the skin, where the map acts) and
    the Jacobian determinant of the map at each of them in every state, by finite differences."""
    ch = breast.ch
    lo, hi = breast.fold_range
    step, layers, h = 3.0, 8, 0.4
    U, V = np.meshgrid(np.arange(lo, hi + step, step), np.arange(breast.fold.min() - 6, breast.top.max() + 6, step), indexing="ij")
    U, V = U.ravel(), V.ravel()
    skin = map_coordinates(breast.RS, [(U - U_RANGE[0]) / CELL, (V - V_RANGE[0]) / CELL], order=1, mode="nearest")
    wall = breast.base(U, V)
    keep = (skin - wall > 0.5) & (breast.taper(U) > 1e-4)
    U, V, skin, wall = U[keep], V[keep], skin[keep], wall[keep]
    t = (np.arange(layers) + 0.5) / layers
    r = wall[:, None] + (skin - wall)[:, None] * t[None, :]
    q = np.stack([np.repeat(U, layers), np.repeat(V, layers), r.ravel()], 1)
    dv = step * step * np.repeat((skin - wall) / layers, layers) * q[:, 2] / RREF
    p = ch.to_model(q)
    offsets = [np.zeros(3), np.array([h, 0, 0]), np.array([0, h, 0]), np.array([0, 0, h])]
    moved = [[ch.to_model(m) for m in deform(breast, ch.to_chart(p + o))] for o in offsets]
    dets = [np.linalg.det(np.stack([(moved[i][k] - moved[0][k]) / h for i in (1, 2, 3)], -1)) for k in range(len(STATES))]
    return dv, dets


def mound_volumes(breast: Breast) -> list[float]:
    """Volume (mL) of the mound at rest and in every state: rest volume elements times the Jacobian determinant."""
    dv, dets = mound_jacobians(breast)
    return [float(dv.sum()) / 1000] + [float((dv * np.abs(det)).sum()) / 1000 for det in dets]


def berrocal(grams: float) -> str:
    """Hypertrophy grade by the weight a reduction removes from one breast (Berrocal Revueltas)."""
    return "grau I" if grams <= 500 else "grau II" if grams <= 800 else "grau III" if grams < 1000 else "grau IV"


def measure(breast: Breast, notch_model: np.ndarray, midline_x: float) -> dict:
    """Clinical measurements at rest and in every state, taken on the skin as a tape would."""
    ch = breast.ch
    un = ch.nipple[0]
    fold_v = float(np.interp(un, ch.us, breast.fold))
    skin_r = lambda u, v: map_coordinates(breast.RS, [(u - U_RANGE[0]) / CELL, (v - V_RANGE[0]) / CELL], order=1, mode="nearest")
    # material lines on the rest skin: notch -> nipple, nipple -> fold along the meridian
    notch = ch.to_chart(notch_model[None])[0]
    t = np.linspace(0, 1, 160)
    upper = np.stack([notch[0] + (un - notch[0]) * t, notch[1] + (0 - notch[1]) * t], 1)
    upper = np.c_[upper, skin_r(upper[:, 0], upper[:, 1])]
    upper[-1] = ch.nipple
    lower_v = np.linspace(0, fold_v, 80)
    lower = np.c_[np.full(80, un), lower_v, skin_r(np.full(80, un), lower_v)]
    lower[0] = ch.nipple
    skin = ch.to_chart(mesh(SKIN)[0])
    mound = (breast.depth(skin) > 3) & (breast.taper(skin[:, 0]) > 0.5) & (skin[:, 1] > fold_v - 4) & (skin[:, 1] < 130)
    probes = np.vstack([ch.nipple[None], upper, lower, skin[mound]])
    result = {}
    for key, moved in zip(["rest"] + [s["id"] for s in STATES], [probes] + deform(breast, probes)):
        nipple, up, low, cloud = moved[0], moved[1:161], moved[161:241], moved[241:]
        nipple_model = ch.to_model(nipple[None])[0]
        lowest = float(cloud[:, 1].min())
        result[key] = {
            "nippleToFoldMm": round(float(nipple[1] - fold_v), 1),
            "lowestContourToFoldMm": round(lowest - fold_v, 1),
            "nippleAboveLowestContourMm": round(float(nipple[1] - lowest), 1),
            "notchToNippleMm": round(polyline_length(ch.to_model(up)), 0),
            "nippleToFoldSkinMm": round(polyline_length(ch.to_model(low)), 0),
            "nippleToMidlineMm": round(abs(float(nipple_model[0] - midline_x)), 0),
            "projectionMm": round(float(breast.depth(nipple[None])[0]), 0),
            "nipple": [round(float(c) * MM, 4) for c in nipple_model],
        }
    dv, dets = mound_jacobians(breast)
    volumes = [float(dv.sum()) / 1000] + [float((dv * np.abs(det)).sum()) / 1000 for det in dets]
    for k, (entry, volume) in enumerate(zip(result.values(), volumes)):
        n, low = entry["nippleToFoldMm"], entry["nippleAboveLowestContourMm"]
        entry["regnault"] = "sem ptose" if n > 10 else "grau I" if n >= -10 else "grau III" if low <= 20 else "grau II"
        entry["volumeMl"] = round(volume)
        entry["volumeGainPct"] = round((volume / volumes[0] - 1) * 100)
        if k:
            # what a reduction to the breast this state aims at would remove, and the hypertrophy grade that makes
            state = STATES[k - 1]
            target = state.get("resultMl", RESULT_ML)
            grams = max(volume - target, 0.0) * DENSITY
            entry["reductionToMl"] = target
            entry["reductionG"] = int(round(grams, -1))
            entry["berrocal"] = berrocal(grams)
            entry["minJacobian"] = round(float(dets[k - 1].min()), 3)
    return result


# --------------------------------------------------------------------------------------------------
# output
# --------------------------------------------------------------------------------------------------
def test_vectors(breast: Breast, count: int = 150) -> dict:
    """Rest points and their deformed positions (model units): the app's implementation must match."""
    ch = breast.ch
    pts = np.vstack([mesh(n)[0] for n in SIDE_MESHES[ch.side]] + [mesh(SKIN)[0]])
    q = ch.to_chart(pts)
    moving = np.nonzero((breast.depth(q) > 0.5) & (breast.taper(q[:, 0]) > 0.02))[0]
    pick = np.random.default_rng(7).choice(moving, count, replace=False)
    rest = pts[pick]
    states = [ch.to_model(m) for m in deform(breast, ch.to_chart(rest))]
    return {"rest": np.round(rest * MM, 6).tolist(), "states": [np.round(s * MM, 6).tolist() for s in states]}


def main() -> None:
    axis = trunk_axis()
    midline = axis[0]
    notch = layer_landmark("esterno.incisura-jugular")
    # the notch on the skin: the outermost skin point in front of the bony notch
    skin = mesh(SKIN)[0]
    near = skin[(np.abs(skin[:, 0] - notch[0]) < 6) & (np.abs(skin[:, 1] - notch[1]) < 6) & (skin[:, 2] > notch[2])]
    notch_skin = near[np.argmin(np.linalg.norm(near - notch, axis=1))] if len(near) else notch
    sides, measurements, blobs, vectors = {}, {}, [], {}
    offset = 0
    breasts = {}
    for side in ("op", "contra"):
        breast = breasts[side] = Breast(side, axis)
        ch = breast.ch
        data = breast.quantised.astype("<u2").tobytes()
        sides[side] = {
            "s": ch.s, "xc": ch.xc, "zc": ch.zc, "y0": ch.y0,
            "u0": breast.u0, "v0": breast.v0, "nu": int(breast.B.shape[0]), "nv": int(breast.B.shape[1]),
            "byteOffset": offset, "qmin": breast.qmin, "qstep": B_STEP,
            "foldRange": [round(v, 2) for v in breast.fold_range],
            "fold": breast.curves["fold"].tolist(), "hinge": breast.curves["hinge"].tolist(), "top": breast.curves["top"].tolist(),
            "nippleChart": [round(float(c), 2) for c in ch.nipple],
            "meshes": SIDE_MESHES[side],
        }
        blobs.append(data)
        offset += len(data)
        measurements[side] = measure(breast, notch_skin, midline)
        vectors[side] = test_vectors(breast)
        m = measurements[side]
        print(f"[{side}] fold columns {breast.fold_range}, nipple chart {np.round(ch.nipple, 1)}")
        for key, entry in m.items():
            extra = f" · redução a {entry['reductionToMl']} mL ≈ {entry['reductionG']} g, Berrocal {entry['berrocal']} · jacobiano mín {entry['minJacobian']:.2f}" if "berrocal" in entry else ""
            print(f"   {key:8s} mamilo {entry['nippleToFoldMm']:+6.1f} mm do sulco · contorno {entry['lowestContourToFoldMm']:+6.1f} · fúrcula–mamilo {entry['notchToNippleMm']:.0f} · mamilo–sulco {entry['nippleToFoldSkinMm']:.0f} · projeção {entry['projectionMm']:.0f} · {entry['volumeMl']} mL ({entry['volumeGainPct']:+d}%) · {entry['regnault']}{extra}")
            if entry.get("minJacobian", 1.0) < FOLD_LIMIT:
                raise SystemExit(f"[{side}] {key}: the map folds the tissue (Jacobian {entry['minJacobian']} < {FOLD_LIMIT})")
    OUT_BIN.write_bytes(b"".join(blobs))
    model = {
        "version": 1,
        "unitsPerMm": MM,
        "rref": RREF, "cell": CELL, "taperMm": TAPER_MM,
        "bin": "models/hybrid/breast-chart.bin", "byteLength": offset,
        "flow": FLOW, "tilt": TILT, "growth": GROWTH,
        "skin": SKIN,
        "states": STATES,
        "sides": sides,
        "measurements": measurements,
    }
    OUT_JSON.write_text(json.dumps(model, ensure_ascii=False, separators=(",", ":")) + "\n")
    OUT_VECTORS.write_text(json.dumps(vectors, separators=(",", ":")) + "\n")
    print(f"wrote {OUT_JSON.relative_to(ROOT)} ({OUT_JSON.stat().st_size / 1e3:.0f} kB), {OUT_BIN.relative_to(ROOT)} ({offset / 1e3:.0f} kB) and {OUT_VECTORS.relative_to(ROOT)}")
    if "--figures" in sys.argv:
        figures(breasts, Path(sys.argv[sys.argv.index("--figures") + 1]))


def figures(breasts: dict[str, Breast], out: Path) -> None:
    """Meridian profiles of every state (review aid; needs matplotlib)."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.collections import LineCollection

    out.mkdir(parents=True, exist_ok=True)
    colors = {"skin": "#c08060", "fat": "#d4a800", "gland": "#e0508a", "duct": "#e0508a", "nipple": "#7a3a2a", "areola": "#7a3a2a", "ligament": "#aaaaaa"}
    tissue = {m["name"]: m["tissue"] for m in MANIFEST["meshes"]}
    for side, breast in breasts.items():
        ch = breast.ch
        theta = ch.nipple[0] / RREF
        normal = np.array([ch.s * np.cos(theta), 0, np.sin(theta)])
        origin = np.array([ch.xc, 0, ch.zc])
        fig, axes = plt.subplots(1, len(STATES) + 1, figsize=(7 * (len(STATES) + 1), 9))
        loaded = [(n, *mesh(n)) for n in [SKIN] + SIDE_MESHES[side] if tissue[n] != "ligament"]
        for k, ax in enumerate(axes):
            for name, pos, idx in loaded:
                q = ch.to_chart(pos)
                moved = ch.to_model(deform(breast, q)[k - 1]) if k else pos
                dist = (moved - origin) @ normal
                tri = dist[idx]
                crossing = (tri > 0).any(1) & ~(tri > 0).all(1)
                segments = []
                for f in np.nonzero(crossing)[0]:
                    pts = []
                    for i, j in ((0, 1), (1, 2), (2, 0)):
                        da, db = tri[f, i], tri[f, j]
                        if (da > 0) != (db > 0):
                            pts.append(moved[idx[f, i]] + (moved[idx[f, j]] - moved[idx[f, i]]) * da / (da - db))
                    if len(pts) == 2:
                        segments.append(pts)
                if segments:
                    qs = ch.to_chart(np.array(segments).reshape(-1, 3)).reshape(-1, 2, 3)
                    keep = np.abs(qs[:, :, 0] - ch.nipple[0]).max(1) < 20
                    ax.add_collection(LineCollection(qs[keep][:, :, [2, 1]], colors=colors[tissue[name]], linewidths=1.0))
            vs = np.linspace(-200, 150, 200)
            ax.plot(breast.base(np.full(200, ch.nipple[0]), vs), vs, "g--", lw=0.8)
            ax.axhline(float(np.interp(ch.nipple[0], ch.us, breast.fold)), color="b", lw=0.5)
            ax.set_xlim(95, 250)
            ax.set_ylim(-190, 150)
            ax.set_aspect("equal")
            ax.grid(alpha=0.3)
            ax.set_title("repouso" if k == 0 else STATES[k - 1]["label"])
        fig.savefig(out / f"breast-profile-{side}.png", dpi=60, bbox_inches="tight")
        plt.close(fig)


if __name__ == "__main__":
    main()
