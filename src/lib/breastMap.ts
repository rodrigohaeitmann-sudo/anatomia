/**
 * Breast chart and ptosis map, evaluated on the device.
 *
 * Mirror of scripts/hybrid/build_breast.py (see docs/plano-mamoplastia.md): the pipeline measures the
 * chart on the model's own skin and breast meshes and ships it as a small parametric model
 * (src/data/breastModel.json + breast-chart.bin); this module applies it to any point. Vertices of the
 * real meshes, labels, markings and surgical pieces therefore all move with the same function.
 * scripts/hybrid/check_breast_map.mjs compares both implementations on test vectors written by the pipeline.
 *
 * Chart (per side): u = rref * angle about a vertical trunk axis (lateral +), v = height above the
 * nipple, r = radius; depth d = r - B(u, v) in front of the base surface B (the trunk without the
 * mound). Everything here is in millimetres except the public entry points, which take model units.
 *
 * No imports on purpose: the check script loads this file directly with Node.
 */

export type BreastSideData = {
  /** +1 operative side (lateral = -x), -1 contralateral */
  s: number;
  xc: number;
  zc: number;
  y0: number;
  u0: number;
  v0: number;
  nu: number;
  nv: number;
  byteOffset: number;
  qmin: number;
  qstep: number;
  foldRange: number[];
  fold: number[];
  hinge: number[];
  top: number[];
  nippleChart: number[];
  meshes: string[];
};

export type BreastStateData = { id: string; label: string; short: string; descent: number; hinge: number; description: string };

export type BreastModelParams = {
  unitsPerMm: number;
  rref: number;
  cell: number;
  taperMm: number;
  flow: { shear: number; rise: number; decel: number[]; lmin: number; stepMm: number };
  hinge: { rise: number; hold: number; end: number; gmax: number; ramp: number };
  states: BreastStateData[];
};

const smoothstep = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};
const dsmoothstep = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return 6 * x * (1 - x);
};
const RAD = Math.PI / 180;

/** One breast: chart, base surface and the state maps. */
export class BreastSide {
  readonly data: BreastSideData;
  private readonly p: BreastModelParams;
  private readonly base: Float64Array;
  // scratch pair returned by the inner maps (avoids allocating per vertex)
  private oa = 0;
  private od = 0;

  /** `bin`: the whole breast-chart.bin; this side's base surface starts at data.byteOffset (uint16, little endian). */
  constructor(data: BreastSideData, params: BreastModelParams, bin: ArrayBuffer) {
    this.data = data;
    this.p = params;
    const count = data.nu * data.nv;
    const view = new DataView(bin, data.byteOffset, count * 2);
    this.base = new Float64Array(count);
    for (let i = 0; i < count; i++) this.base[i] = view.getUint16(i * 2, true) * data.qstep + data.qmin;
  }

  // ---- chart ----------------------------------------------------------------------------------------
  /** Base surface radius at (u, v): bilinear, clamped to the shipped window. */
  baseAt(u: number, v: number) {
    const { u0, v0, nu, nv } = this.data;
    const cell = this.p.cell;
    let fu = (u - u0) / cell;
    let fv = (v - v0) / cell;
    fu = fu < 0 ? 0 : fu > nu - 1 ? nu - 1 : fu;
    fv = fv < 0 ? 0 : fv > nv - 1 ? nv - 1 : fv;
    const i = Math.min(Math.floor(fu), nu - 2);
    const j = Math.min(Math.floor(fv), nv - 2);
    const tu = fu - i;
    const tv = fv - j;
    const b = this.base;
    const k = i * nv + j;
    return (b[k] * (1 - tv) + b[k + 1] * tv) * (1 - tu) + (b[k + nv] * (1 - tv) + b[k + nv + 1] * tv) * tu;
  }

  private curve(values: number[], u: number) {
    let f = (u - this.data.u0) / this.p.cell;
    const last = values.length - 1;
    f = f < 0 ? 0 : f > last ? last : f;
    const i = Math.min(Math.floor(f), last - 1);
    return values[i] + (values[i + 1] - values[i]) * (f - i);
  }

  /** 1 over the central meridians, 0 at the medial and lateral ends of the fold. */
  taper(u: number) {
    const [lo, hi] = this.data.foldRange;
    return smoothstep((u - lo) / this.p.taperMm) * smoothstep((hi - u) / this.p.taperMm);
  }

  // ---- ptosis flow (incompressible, attached to the wall) -----------------------------------------------
  private va = 0;
  private vd = 0;
  private velocity(a: number, d: number, s: number, top: number) {
    const { shear, rise, decel, lmin } = this.p.flow;
    const t = d <= 0 ? 0 : d >= shear ? 1 : d / shear;
    const wp = t * t * (3 - 2 * t);
    const w = d < shear ? shear * (t * t * t - 0.5 * t * t * t * t) : 0.5 * shear + (d - shear);
    const up = smoothstep((top - a) / rise);
    const dup = -dsmoothstep((top - a) / rise) / rise;
    const x = (a - decel[0]) / (decel[1] - decel[0]);
    const down = lmin + (1 - lmin) * smoothstep(x);
    const ddown = ((1 - lmin) * dsmoothstep(x)) / (decel[1] - decel[0]);
    this.va = -s * wp * up * down;
    this.vd = s * w * (dup * down + up * ddown);
  }

  private advance(a: number, d: number, amp: number, top: number, fromMm: number, toMm: number) {
    const steps = Math.ceil((toMm - fromMm) / this.p.flow.stepMm);
    if (steps > 0) {
      const s = (toMm - fromMm) * amp;
      const h = 1 / steps;
      for (let n = 0; n < steps; n++) {
        this.velocity(a, d, s, top);
        const k1a = this.va, k1d = this.vd;
        this.velocity(a + 0.5 * h * k1a, d + 0.5 * h * k1d, s, top);
        const k2a = this.va, k2d = this.vd;
        this.velocity(a + 0.5 * h * k2a, d + 0.5 * h * k2d, s, top);
        const k3a = this.va, k3d = this.vd;
        this.velocity(a + h * k3a, d + h * k3d, s, top);
        a += (h * (k1a + 2 * k2a + 2 * k3a + this.va)) / 6;
        d = Math.max(d + (h * (k1d + 2 * k2d + 2 * k3d + this.vd)) / 6, 0);
      }
    }
    this.oa = a;
    this.od = d;
  }

  /** C1 monotone 0 -> 1 ramp with quadratic ends: value in rv, slope in rs. */
  private rv = 0;
  private rs = 0;
  private ramp(t: number) {
    const e = this.p.hinge.ramp;
    const x = t < 0 ? 0 : t > 1 ? 1 : t;
    const k = 1 / (1 - e);
    if (x < e) {
      this.rv = (k * x * x) / (2 * e);
      this.rs = (k * x) / e;
    } else if (x > 1 - e) {
      this.rv = 1 - (k * (1 - x) * (1 - x)) / (2 * e);
      this.rs = (k * (1 - x)) / e;
    } else {
      this.rv = k * (x - e / 2);
      this.rs = k;
    }
  }

  /** Polar warp about the fold (major ptosis): the pouch swings against the abdominal wall. */
  private warp(a: number, d: number, amp: number, peakDeg: number) {
    const { rise, hold, end, gmax } = this.p.hinge;
    const a1 = rise * RAD, a2 = hold * RAD, a3 = end * RAD;
    const rho = Math.hypot(a, d);
    const alpha = Math.atan2(d, a);
    let delta: number, slope: number;
    if (alpha < a1) {
      this.ramp(alpha / a1);
      delta = this.rv;
      slope = this.rs / a1;
    } else if (alpha < a2) {
      delta = 1;
      slope = 0;
    } else {
      this.ramp((a3 - alpha) / (a3 - a2));
      delta = this.rv;
      slope = -this.rs / (a3 - a2);
    }
    const k = peakDeg * RAD * amp;
    const alpha2 = alpha + delta * k;
    const rho2 = rho * Math.min(1 / Math.sqrt(Math.max(1 + slope * k, 0.05)), gmax);
    this.oa = rho2 * Math.cos(alpha2);
    this.od = rho2 * Math.sin(alpha2);
  }

  // ---- public ---------------------------------------------------------------------------------------
  /**
   * Displacement of `count` points in every state. `positions`: xyz in model units (rest positions).
   * Returns one Float32Array (xyz deltas, model units) per state, or null when no point of the set moves.
   */
  displacements(positions: ArrayLike<number>, count = positions.length / 3): Float32Array[] | null {
    const { s, xc, zc, y0 } = this.data;
    const { unitsPerMm, rref, states } = this.p;
    const hingeCurve = this.data.hinge;
    const topCurve = this.data.top;
    let out: Float32Array[] | null = null;
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3] / unitsPerMm;
      const y = positions[i * 3 + 1] / unitsPerMm;
      const z = positions[i * 3 + 2] / unitsPerMm;
      const dx = -s * (x - xc);
      const dz = z - zc;
      const u = rref * Math.atan2(dx, dz);
      const amp = this.taper(u);
      if (amp <= 1e-4) continue;
      const v = y - y0;
      const depth = Math.hypot(dx, dz) - this.baseAt(u, v);
      if (depth <= 0) continue;
      const hinge = this.curve(hingeCurve, u);
      const top = this.curve(topCurve, u) - hinge;
      const theta = u / rref;
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);
      let a = v - hinge;
      let d = depth;
      let travelled = 0;
      if (!out) out = states.map(() => new Float32Array(count * 3));
      for (let k = 0; k < states.length; k++) {
        this.advance(a, d, amp, top, travelled, states[k].descent);
        a = this.oa;
        d = this.od;
        travelled = states[k].descent;
        if (states[k].hinge) this.warp(a, d, amp, states[k].hinge);
        const v2 = hinge + this.oa;
        const r2 = this.baseAt(u, v2) + this.od;
        const target = out[k];
        target[i * 3] = (xc - s * r2 * sin) * unitsPerMm - positions[i * 3];
        target[i * 3 + 1] = (v2 + y0) * unitsPerMm - positions[i * 3 + 1];
        target[i * 3 + 2] = (zc + r2 * cos) * unitsPerMm - positions[i * 3 + 2];
      }
    }
    return out;
  }
}

/**
 * Displacement of a rest-pose point at a (fractional) state position: 0 = rest, 1 = first state, ...
 * Piecewise linear between states, exactly as the morph targets are blended.
 */
export function blendStates(deltas: Float32Array[], index: number, level: number): [number, number, number] {
  const k = Math.min(Math.max(level, 0), deltas.length);
  const hi = Math.min(Math.ceil(k), deltas.length);
  if (hi === 0) return [0, 0, 0];
  const lo = hi - 1;
  const t = k - lo;
  const at = (state: number, c: number) => (state === 0 ? 0 : deltas[state - 1][index * 3 + c]);
  return [0, 1, 2].map((c) => at(lo, c) * (1 - t) + at(hi, c) * t) as [number, number, number];
}
