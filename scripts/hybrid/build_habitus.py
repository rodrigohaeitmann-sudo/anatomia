#!/usr/bin/env python3
"""Body habitus of the large breast states (docs/plano-pele-habito-vasos.md, phase D).

Large ptosis and hypertrophy usually come with obesity (mean BMI 28 to 34 in reduction mammaplasty series; breast volume
correlates with BMI, r = 0.83). The trunk of the model, a woman with a waist of 93 to 97 cm, is kept for the rest state,
ptosis I and II; ptosis III, G3 and G4 widen it by WAIST_GAIN_MM of waist circumference.

The habitus is a smooth field of outward offsets on a cylindrical chart about the trunk axis (theta from the anterior
midline, height y), like the breast chart:
  * per cell: rest skin radius R_s, subcutaneous thickness t0 (skin to the nearest muscle, bone or cartilage; T0_NOMINAL
    where the model has no wall under the skin, the abdomen), outward normal of the skin;
  * regional weights W (abdomen, flanks, lumbar back, lateral chest roll, back at the bra line, axilla, infraclavicular,
    shoulders), normalised around the waist, scaled per state so the waist perimeter grows by WAIST_GAIN_MM;
  * contact: the abdomen under a hanging pouch stays CONTACT_GAP_MM behind it (the pouch rests on the abdomen).
A point p moves by offset(theta, y) * f * (1 - M) along the normal, where f = clamp(1 - (R_s - r) / t0, 0, 1) is its
depth fraction in the subcutaneous layer (deep fascia 0, a cutaneous nerve halfway through the fat 1/2; the skin itself
always 1, folds and the navel included) and M the mound of either breast at rest (taper times the mound thickness,
smoothed over MASK_SIGMA_MM on the chart): inside the mounds the breast map rules.

Outputs:
  src/data/habitusModel.json              grid, states, weights, measurements
  public/models/hybrid/habitus.bin        offsets per state (int16, 0.05 mm), R_s and t0 (uint16, 0.05 mm), normals (int8)
  scripts/hybrid/habitus-test-vectors.json  rest points and their displacements (check_habitus_map.mjs)
Mirrored in src/lib/habitusMap.ts. Usage: npm run breast:hybrid && python3 scripts/hybrid/build_habitus.py
"""
from __future__ import annotations

import json
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter, grey_dilation
from scipy.spatial import ConvexHull

sys.path.insert(0, str(Path(__file__).parent))
import build_breast as bb  # noqa: E402

ROOT = bb.ROOT
MM = bb.MM
OUT_JSON = ROOT / "src/data/habitusModel.json"
OUT_BIN = ROOT / "public/models/hybrid/habitus.bin"
OUT_VECTORS = Path(__file__).parent / "habitus-test-vectors.json"

# waist gain (mm of circumference) per breast state; the others keep the model's trunk (decision of 2026-11-17)
WAIST_GAIN_MM = {"ptose-3": 30.0, "g3": 100.0, "g4": 180.0}
WAIST_Y_MM = -240.0  # the model's narrowest section (iliac crest level), below every pouch
THETA_STEP = 3.0  # degrees
Y_RANGE = (-340.0, 250.0)
Y_STEP = 5.0
T0_NOMINAL_MM = 25.0  # abdominal subcutaneous fat at the umbilicus, CT of 545 women (Kim et al. 2012)
T0_MAX_MM = 80.0  # thicker than this, there is no wall under the skin in the model
SMOOTH_MM = 25.0
NORMAL_SIGMA_MM = 20.0
CONTACT_GAP_MM = 1.0
UNIT = 0.05  # mm per step of the shipped values
MOUND = {"fromMm": 2.0, "toMm": 10.0}  # rest mound thickness over which the breast takes over from the habitus
MASK_SIGMA_MM = 15.0  # the hand-over from the breast map to the habitus is spread over a few cm (no step at the border)
OUTSIDE_MM = (5.0, 15.0)  # points this far outside the trunk skin (the arm beyond the cut) fade out of the habitus


def smootherstep(t):
    t = np.clip(t, 0, 1)
    return t * t * t * (t * (6 * t - 15) + 10)


def band(x, lo, hi, fade):
    """1 inside [lo, hi], fading to 0 over `fade` outside it (C2)."""
    return smootherstep((x - lo + fade) / fade) * smootherstep((hi - x + fade) / fade)


class Grid:
    def __init__(self, axis: tuple[float, float]):
        self.xc, self.zc = axis
        self.thetas = np.arange(-180.0, 180.0, THETA_STEP)
        self.ys = np.arange(Y_RANGE[0], Y_RANGE[1] + 1e-6, Y_STEP)
        self.nt, self.ny = len(self.thetas), len(self.ys)

    def chart(self, p: np.ndarray) -> np.ndarray:
        """theta (degrees, 0 = anterior midline), y, r (mm) of model points (mm)."""
        dx, dz = p[..., 0] - self.xc, p[..., 2] - self.zc
        return np.stack([np.degrees(np.arctan2(dx, dz)), p[..., 1], np.hypot(dx, dz)], -1)

    def cell(self, q: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        it = np.round((q[:, 0] + 180.0) / THETA_STEP).astype(int) % self.nt
        iy = np.round((q[:, 1] - Y_RANGE[0]) / Y_STEP).astype(int)
        ok = (iy >= 0) & (iy < self.ny)
        return it, iy, ok

    def radius(self, pts: np.ndarray, outer: bool, inside: np.ndarray | None = None) -> np.ndarray:
        q = self.chart(pts)
        it, iy, ok = self.cell(q)
        if inside is not None:
            ok &= q[:, 2] < inside[it % self.nt, np.clip(iy, 0, self.ny - 1)] - 1.0
        grid = np.full((self.nt, self.ny), -np.inf if outer else np.inf)
        (np.maximum if outer else np.minimum).at(grid, (it[ok], iy[ok]), q[ok, 2])
        grid[~np.isfinite(grid)] = np.nan
        return grid

    def sample(self, values: np.ndarray, theta: np.ndarray, y: np.ndarray) -> np.ndarray:
        """Bicubic Catmull-Rom, periodic in theta, clamped in y (as habitusMap.ts)."""
        ft = (theta + 180.0) / THETA_STEP
        fy = np.clip((y - Y_RANGE[0]) / Y_STEP, 0, self.ny - 1)
        i = np.floor(ft).astype(int)
        j = np.minimum(np.floor(fy).astype(int), self.ny - 2)
        wt = bb.catmull_rom_weights(ft - i)
        wy = bb.catmull_rom_weights(fy - j)
        out = 0.0
        for a, wa in zip((-1, 0, 1, 2), wt):
            ii = (i + a) % self.nt
            row = 0.0
            for b, wb in zip((-1, 0, 1, 2), wy):
                row = row + wb * values[ii, np.clip(j + b, 0, self.ny - 1)]
            out = out + wa * row
        return out


def fill_nan_periodic(grid: np.ndarray) -> np.ndarray:
    """Nearest known value (theta periodic)."""
    from scipy.spatial import cKDTree

    known = np.argwhere(~np.isnan(grid))
    nt = grid.shape[0]
    pts = np.vstack([known, known + [nt, 0], known - [nt, 0]])
    vals = np.concatenate([grid[tuple(known.T)]] * 3)
    _, near = cKDTree(pts).query(np.argwhere(np.ones_like(grid, bool)))
    return vals[near].reshape(grid.shape)


def smooth(grid: np.ndarray, sigma_mm: float, radius_mm: float = 150.0) -> np.ndarray:
    return gaussian_filter(grid, (sigma_mm / (np.radians(THETA_STEP) * radius_mm), sigma_mm / Y_STEP), mode=("wrap", "nearest"))


def weights(g: Grid) -> np.ndarray:
    """Regional weights of the offset; the waist ring averages 1."""
    th = np.abs(g.thetas)[:, None]
    y = g.ys[None, :]
    ring = np.interp(th, [0, 45, 90, 135, 180], [1.45, 1.45, 1.10, 0.55, 0.55])  # anterior abdomen, flanks, lumbar back
    abdomen = 1 - smootherstep((y + 150.0) / 90.0)  # below -150 mm, up to the folds (-60 mm)
    thorax = (
        0.25  # chest wall under and between the breasts (the mounds themselves are masked)
        + 0.55 * band(th, 70, 110, 20) * band(y, -90, 30, 30)  # lateral chest roll
        + 0.35 * band(th, 125, 180, 20) * band(y, -110, 0, 30)  # back at the bra line
        + 0.15 * band(th, 70, 110, 20) * band(y, 40, 110, 30)  # axilla
        - 0.10 * band(th, 0, 60, 20) * band(y, 60, 150, 30)  # infraclavicular: 0.15
        - 0.15 * smootherstep((y - 150.0) / 40.0)  # shoulders and neck: 0.10
    )
    w = abdomen * ring + (1 - abdomen) * thorax
    w = smooth(w, SMOOTH_MM)
    waist = int(np.argmin(np.abs(g.ys - WAIST_Y_MM)))
    return w / w[:, waist].mean()


@lru_cache(maxsize=1)
def breasts() -> dict:
    axis = bb.trunk_axis()
    return {side: bb.Breast(side, axis) for side in ("op", "contra")}


def mound(pts: np.ndarray) -> np.ndarray:
    """1 inside the rest mound of either breast (where the breast map rules), 0 off it (sharp: see mound_mask)."""
    out = np.zeros(len(pts))
    for breast in breasts().values():
        q = breast.ch.to_chart(pts)
        thick = breast.thickness(q[:, 0], q[:, 1])
        inside = breast.taper(q[:, 0]) * smootherstep((thick - MOUND["fromMm"]) / (MOUND["toMm"] - MOUND["fromMm"]))
        out = np.maximum(out, inside)
    return out


def mound_mask(g: Grid, rs: np.ndarray) -> np.ndarray:
    """The mounds on the habitus chart: mound() at the rest skin of every cell, smoothed over MASK_SIGMA_MM."""
    th = np.radians(g.thetas)[:, None]
    skin = np.stack([g.xc + rs * np.sin(th), np.broadcast_to(g.ys[None, :], rs.shape), g.zc + rs * np.cos(th)], -1)
    mask = mound(skin.reshape(-1, 3)).reshape(rs.shape)
    return np.clip(smooth(mask, MASK_SIGMA_MM), 0, 1)


class Habitus:
    def __init__(self, g: Grid, rs: np.ndarray, t0: np.ndarray, normal: np.ndarray, mask: np.ndarray, offsets: list[np.ndarray]):
        self.g, self.rs, self.t0, self.normal, self.mask, self.offsets = g, rs, t0, normal, mask, offsets

    def displacements(self, pts: np.ndarray, skin: bool = False) -> list[np.ndarray]:
        """Displacement (mm) of rest points in every breast state (zero where a state has no habitus). `skin`: the
        points are the skin itself (depth fraction 1)."""
        g = self.g
        q = g.chart(pts)
        rs = g.sample(self.rs, q[:, 0], q[:, 1])
        t0 = g.sample(self.t0, q[:, 0], q[:, 1])
        # depth fraction in the subcutaneous layer; nothing outside the trunk skin moves (the arm beyond the cut)
        depth = np.ones(len(pts)) if skin else np.clip(1 - (rs - q[:, 2]) / np.maximum(t0, 1.0), 0, 1) * (1 - smootherstep((q[:, 2] - rs - OUTSIDE_MM[0]) / (OUTSIDE_MM[1] - OUTSIDE_MM[0])))
        f = depth * (1 - np.clip(g.sample(self.mask, q[:, 0], q[:, 1]), 0, 1))
        n = np.stack([g.sample(self.normal[..., c], q[:, 0], q[:, 1]) for c in range(3)], 1)
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
        out = []
        for offset in self.offsets:
            if offset is None:
                out.append(np.zeros_like(pts))
            else:
                out.append((g.sample(offset, q[:, 0], q[:, 1]) * f)[:, None] * n)
        return out


def perimeter(points: np.ndarray, y: float) -> float:
    sel = np.abs(points[:, 1] - y) < 2.5
    xz = points[sel][:, [0, 2]]
    hull = ConvexHull(xz)
    v = xz[hull.vertices]
    return float(np.linalg.norm(np.diff(np.vstack([v, v[:1]]), axis=0), axis=1).sum())


def build() -> tuple[Habitus, dict]:
    axis = bb.trunk_axis()
    g = Grid(axis)
    skin_pos, skin_idx = bb.mesh(bb.SKIN)
    skin_samples = bb.sample_surface(skin_pos, skin_idx, 1.5)
    rs = g.radius(skin_samples, outer=True)
    has_skin = ~np.isnan(rs)
    rs = fill_nan_periodic(rs)
    rs = smooth(rs, 3.0)
    deep = []
    for rec in bb.MANIFEST["meshes"]:
        if rec["tissue"] in ("muscle", "bone", "cartilage"):
            pos, idx = bb.mesh(rec["name"])
            deep.append(bb.sample_surface(pos, idx, 2.0))
    rd = g.radius(np.vstack(deep), outer=True, inside=rs)
    t0 = rs - rd
    t0 = np.where(np.isnan(t0) | (t0 > T0_MAX_MM), T0_NOMINAL_MM, t0)
    t0 = smooth(np.clip(t0, 3.0, T0_MAX_MM), 8.0)
    # direction of the offsets: outward normal of the trunk shape (skin smoothed over NORMAL_SIGMA_MM, as smooth as the
    # offsets themselves, so folds, the navel and the arm openings do not turn it): P(theta, y) = axis + R (sin, 0, cos)
    shape = smooth(rs, NORMAL_SIGMA_MM)
    th = np.radians(g.thetas)[:, None]
    dr_dth = (np.roll(shape, -1, 0) - np.roll(shape, 1, 0)) / (2 * np.radians(THETA_STEP))
    dr_dy = np.gradient(shape, Y_STEP, axis=1)
    e_r = np.stack([np.sin(th) * np.ones_like(rs), np.zeros_like(rs), np.cos(th) * np.ones_like(rs)], -1)
    e_t = np.stack([np.cos(th) * np.ones_like(rs), np.zeros_like(rs), -np.sin(th) * np.ones_like(rs)], -1)
    d_theta = dr_dth[..., None] * e_r + shape[..., None] * e_t
    d_y = dr_dy[..., None] * e_r + np.array([0.0, 1.0, 0.0])
    normal = np.cross(d_y, d_theta)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    normal *= np.sign(np.einsum("...k,...k->...", normal, e_r))[..., None]
    # no offsets where the trunk has no skin (the arm openings): what lies there (the arm and its vessels and nerves
    # beyond the cut) does not move, and the arm poses keep their own
    cover = smooth(has_skin.astype(float), 8.0)
    w = weights(g) * smootherstep((cover - 0.2) / 0.6)
    habitus = Habitus(g, rs, t0, normal, mound_mask(g, rs), [None] * len(bb.STATES))
    report = {"waistYmm": WAIST_Y_MM, "states": {}}
    # skin in every state with the breast maps (for the perimeters and the contact)
    carried = [skin_pos.copy() for _ in bb.STATES]
    for breast in breasts().values():
        for k, moved in enumerate(bb.deform(breast, breast.ch.to_chart(skin_pos))):
            carried[k] += breast.ch.to_model(moved) - skin_pos
    rest_waist = perimeter(skin_pos, WAIST_Y_MM)
    for k, state in enumerate(bb.STATES):
        gain = WAIST_GAIN_MM.get(state["id"])
        if not gain:
            continue
        # contact: the posterior surface of the pouch (skin the map carries below the rest folds)
        moved = carried[k]
        shift = np.linalg.norm(moved - skin_pos, axis=1)
        pouch = moved[(shift > 5.0) & (moved[:, 1] < -64.0)]
        q = g.chart(pouch)
        it, iy, ok = g.cell(q)
        back = np.full((g.nt, g.ny), np.inf)
        np.minimum.at(back, (it[ok], iy[ok]), q[ok, 2])
        back = -grey_dilation(np.where(np.isfinite(back), -back, -np.inf), size=(3, 3))  # close the gaps between samples
        room = np.where(np.isfinite(back) & (back > rs), back - rs - CONTACT_GAP_MM, np.inf)
        scale = gain / (2 * np.pi)
        for _ in range(4):
            offset = w * scale
            excess = np.maximum(offset - np.maximum(room, 0), 0)
            excess = gaussian_filter(grey_dilation(excess, size=(5, 5)), (1.5, 1.5), mode=("wrap", "nearest"))
            offset = np.clip(offset - excess, 0, None)
            offset = np.minimum(offset, np.maximum(room, 0))
            habitus.offsets[k] = offset
            grown = perimeter(skin_pos + habitus.displacements(skin_pos, skin=True)[k], WAIST_Y_MM) - rest_waist
            scale *= gain / max(grown, 1e-6)
        habitus.offsets[k] = offset
        final = carried[k] + habitus.displacements(skin_pos, skin=True)[k]
        report["states"][state["id"]] = {
            "waistGainMm": round(perimeter(final, WAIST_Y_MM) - perimeter(carried[k], WAIST_Y_MM), 1),
            "gainAtMinus180Mm": round(perimeter(final, -180.0) - perimeter(carried[k], -180.0), 1),
            "maxOffsetMm": round(float(offset.max()), 1),
            "abdomenMm": round(float(g.sample(offset, np.array([0.0]), np.array([-220.0]))[0]), 1),
            "flankMm": round(float(g.sample(offset, np.array([90.0]), np.array([-220.0]))[0]), 1),
            "lateralRollMm": round(float(g.sample(offset, np.array([90.0]), np.array([-40.0]))[0]), 1),
            "braLineMm": round(float(g.sample(offset, np.array([160.0]), np.array([-60.0]))[0]), 1),
            "infraclavicularMm": round(float(g.sample(offset, np.array([25.0]), np.array([110.0]))[0]), 1),
            "contactCells": int(np.isfinite(room).sum()),
        }
    report["restWaistMm"] = round(rest_waist, 1)
    report["skinCellsPct"] = round(float(has_skin.mean() * 100), 1)
    return habitus, report


@lru_cache(maxsize=1)
def load() -> Habitus:
    """The shipped habitus (for the other pipeline scripts and the checks)."""
    meta = json.loads(OUT_JSON.read_text())
    g = Grid((meta["xc"], meta["zc"]))
    raw = OUT_BIN.read_bytes()
    n = g.nt * g.ny

    def u16(offset: int) -> np.ndarray:
        return np.frombuffer(raw, dtype="<u2", count=n, offset=offset).astype(np.float64).reshape(g.nt, g.ny) * UNIT

    rs, t0 = u16(meta["radiusOffset"]), u16(meta["thicknessOffset"])
    mask = np.frombuffer(raw, dtype=np.uint8, count=n, offset=meta["maskOffset"]).astype(np.float64).reshape(g.nt, g.ny) / 255.0
    normal = np.frombuffer(raw, dtype=np.int8, count=n * 3, offset=meta["normalOffset"]).astype(np.float64).reshape(g.nt, g.ny, 3) / 127.0
    offsets = []
    for state in bb.STATES:
        entry = meta["states"].get(state["id"])
        offsets.append(None if entry is None else np.frombuffer(raw, dtype="<i2", count=n, offset=entry["byteOffset"]).astype(np.float64).reshape(g.nt, g.ny) * UNIT)
    return Habitus(g, rs, t0, normal, mask, offsets)


def displacements(pts: np.ndarray, skin: bool = False) -> list[np.ndarray]:
    """Habitus displacement (mm) of rest model points (mm) in every breast state, from the shipped files; `skin`: the
    points are on the skin itself."""
    return load().displacements(pts, skin)


def main() -> None:
    habitus, report = build()
    g = habitus.g
    blobs, offset, states = [], 0, {}

    def push(data: bytes) -> int:
        nonlocal offset
        start = offset
        blobs.append(data)
        offset += len(data)
        return start

    radius_offset = push(np.round(habitus.rs / UNIT).astype("<u2").tobytes())
    thickness_offset = push(np.round(habitus.t0 / UNIT).astype("<u2").tobytes())
    normal_offset = push(np.round(np.clip(habitus.normal, -1, 1) * 127).astype(np.int8).tobytes())
    mask_offset = push(np.round(np.clip(habitus.mask, 0, 1) * 255).astype(np.uint8).tobytes())
    if offset % 2:
        push(b"\0")
    for state, values in zip(bb.STATES, habitus.offsets):
        if values is not None:
            states[state["id"]] = {"byteOffset": push(np.round(values / UNIT).astype("<i2").tobytes()), "waistGainMm": WAIST_GAIN_MM[state["id"]]}
    OUT_BIN.write_bytes(b"".join(blobs))
    meta = {
        "version": 1,
        "unitsPerMm": MM,
        "xc": g.xc, "zc": g.zc,
        "thetaStep": THETA_STEP, "yMin": Y_RANGE[0], "yStep": Y_STEP, "nTheta": g.nt, "nY": g.ny,
        "unit": UNIT,
        "bin": "models/hybrid/habitus.bin", "byteLength": offset,
        "radiusOffset": radius_offset, "thicknessOffset": thickness_offset, "normalOffset": normal_offset, "maskOffset": mask_offset,
        "mound": MOUND, "maskSigmaMm": MASK_SIGMA_MM, "outsideMm": list(OUTSIDE_MM),
        "states": states,
        "report": report,
    }
    OUT_JSON.write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")) + "\n")
    load.cache_clear()
    # test vectors: skin, a few deeper points and points of the mounds
    rng = np.random.default_rng(11)
    skin = bb.mesh(bb.SKIN)[0]
    pts = skin[rng.choice(len(skin), 200, replace=False)]
    deeper = pts[:60] - 10.0 * (pts[:60] - np.array([g.xc, pts[0, 1], g.zc])) / np.linalg.norm(pts[:60] - np.array([g.xc, pts[0, 1], g.zc]), axis=1, keepdims=True)
    deeper[:, 1] = pts[:60, 1]
    rest = np.vstack([pts, deeper])
    vectors = {"rest": np.round(rest * MM, 6).tolist(),
               "states": [np.round(d * MM, 6).tolist() for d in displacements(rest)],
               "skinStates": [np.round(d * MM, 6).tolist() for d in displacements(rest, skin=True)]}
    OUT_VECTORS.write_text(json.dumps(vectors, separators=(",", ":")) + "\n")
    print(f"cintura em repouso (y = {WAIST_Y_MM:.0f} mm): {report['restWaistMm']:.0f} mm")
    for sid, entry in report["states"].items():
        print(f"   {sid:8s} cintura +{entry['waistGainMm']:.0f} mm (em y = -180: +{entry['gainAtMinus180Mm']:.0f}); abdome {entry['abdomenMm']} mm, flanco {entry['flankMm']}, rolo lateral {entry['lateralRollMm']}, linha do sutiã {entry['braLineMm']}, infraclavicular {entry['infraclavicularMm']}; máx {entry['maxOffsetMm']} mm; células de contato {entry['contactCells']}")
    print(f"wrote {OUT_JSON.relative_to(ROOT)}, {OUT_BIN.relative_to(ROOT)} ({offset / 1e3:.0f} kB) and {OUT_VECTORS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
