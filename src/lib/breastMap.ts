/**
 * Breast chart and ptosis/hypertrophy map, evaluated on the device.
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

/** Growth of the mound in a state: factors for depth, width about the nipple meridian and length below the fold; `hang` thins the pouch as it hangs. */
export type BreastGrowth = { depth: number; width: number; length: number; hang: number };

export type BreastStateData = { id: string; label: string; short: string; descent: number; tilt: number; growth: BreastGrowth; description: string };

export type BreastModelParams = {
  unitsPerMm: number;
  rref: number;
  cell: number;
  taperMm: number;
  flow: { shear: number; shearFold: number; shearBlend: number[]; rise: number; decel: number[]; lmin: number; stepMm: number };
  tilt: { reach: number; fade: number[]; stepMm: number };
  growth: { shear: number; blend: number; hangMm: number };
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

  // ---- flows (incompressible in the chart, attached to the wall) ----------------------------------------
  private va = 0;
  private vd = 0;

  /** Ptosis: the tissue descends along the wall beyond a shear layer (thin over the fascia, thick around the fold). */
  private descend(a: number, d: number, s: number, top: number) {
    const { shear, shearFold, shearBlend, rise, decel, lmin } = this.p.flow;
    const x = (a - shearBlend[0]) / (shearBlend[1] - shearBlend[0]);
    const delta = shearFold + (shear - shearFold) * smoothstep(x);
    const ddelta = ((shear - shearFold) * dsmoothstep(x)) / (shearBlend[1] - shearBlend[0]);
    const t = d <= 0 ? 0 : d / delta;
    const tc = t < 1 ? t : 1;
    const profile = tc * tc * (3 - 2 * tc);
    const integral = t < 1 ? tc * tc * tc - 0.5 * tc * tc * tc * tc : 0.5 + (t - 1);
    const up = smoothstep((top - a) / rise);
    const dup = -dsmoothstep((top - a) / rise) / rise;
    const y = (a - decel[0]) / (decel[1] - decel[0]);
    const down = lmin + (1 - lmin) * smoothstep(y);
    const ddown = ((1 - lmin) * dsmoothstep(y)) / (decel[1] - decel[0]);
    const drive = up * down;
    const ddrive = dup * down + up * ddown;
    this.va = -s * drive * profile;
    this.vd = s * (ddrive * delta * integral + drive * ddelta * (integral - t * profile));
  }

  /** Tilt (major ptosis): below the fold the tissue descends the more the farther it is from the wall. */
  private tilt(a: number, d: number, k: number) {
    const { reach, fade } = this.p.tilt;
    const x = (a - fade[0]) / (fade[1] - fade[0]);
    const m = 1 - smoothstep(x);
    const dm = -dsmoothstep(x) / (fade[1] - fade[0]);
    const t = (d > 0 ? d : 0) / reach;
    this.va = (-k * m * reach * t * t) / (1 + t * t);
    this.vd = k * dm * reach * reach * (t - Math.atan(t));
  }

  /** RK4 over unit time of one of the two fields; the result is left in oa/od. */
  private integrate(tilting: boolean, a: number, d: number, s: number, top: number, steps: number) {
    const h = 1 / steps;
    for (let n = 0; n < steps; n++) {
      if (tilting) this.tilt(a, d, s);
      else this.descend(a, d, s, top);
      const k1a = this.va, k1d = this.vd;
      if (tilting) this.tilt(a + 0.5 * h * k1a, d + 0.5 * h * k1d, s);
      else this.descend(a + 0.5 * h * k1a, d + 0.5 * h * k1d, s, top);
      const k2a = this.va, k2d = this.vd;
      if (tilting) this.tilt(a + 0.5 * h * k2a, d + 0.5 * h * k2d, s);
      else this.descend(a + 0.5 * h * k2a, d + 0.5 * h * k2d, s, top);
      const k3a = this.va, k3d = this.vd;
      if (tilting) this.tilt(a + h * k3a, d + h * k3d, s);
      else this.descend(a + h * k3a, d + h * k3d, s, top);
      a += (h * (k1a + 2 * k2a + 2 * k3a + this.va)) / 6;
      d = Math.max(d + (h * (k1d + 2 * k2d + 2 * k3d + this.vd)) / 6, 0);
    }
    this.oa = a;
    this.od = d;
  }

  // ---- public ---------------------------------------------------------------------------------------
  /** Chart coordinates (mm) of a rest point given in model units: u (lateral +), v (height above the nipple), depth in front of the base. */
  chart(x: number, y: number, z: number): [number, number, number] {
    const { s, xc, zc, y0 } = this.data;
    const { unitsPerMm, rref } = this.p;
    const dx = -s * (x / unitsPerMm - xc);
    const dz = z / unitsPerMm - zc;
    const u = rref * Math.atan2(dx, dz);
    const v = y / unitsPerMm - y0;
    return [u, v, Math.hypot(dx, dz) - this.baseAt(u, v)];
  }

  /**
   * Displacement of `count` points in every state. `positions`: xyz in model units (rest positions).
   * Returns one Float32Array (xyz deltas, model units) per state, or null when no point of the set moves.
   */
  displacements(positions: ArrayLike<number>, count = positions.length / 3): Float32Array[] | null {
    const { s, xc, zc, y0 } = this.data;
    const { unitsPerMm, rref, states, flow, growth } = this.p;
    const tiltReach = this.p.tilt.reach;
    const tiltStep = this.p.tilt.stepMm;
    const hingeCurve = this.data.hinge;
    const topCurve = this.data.top;
    const um = this.data.nippleChart[0];
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
      // the descent of every state continues the previous one; tilt and growth are applied on top of it
      let a = v - hinge;
      let d = depth;
      let travelled = 0;
      if (!out) out = states.map(() => new Float32Array(count * 3));
      for (let k = 0; k < states.length; k++) {
        const state = states[k];
        const descent = Math.ceil(Math.abs(state.descent - travelled) / flow.stepMm);
        if (descent > 0) {
          this.integrate(false, a, d, (state.descent - travelled) * amp, top, descent);
          a = this.oa;
          d = this.od;
          travelled = state.descent;
        }
        let a2 = a;
        let d2 = d;
        const tilting = Math.ceil((Math.abs(state.tilt) * tiltReach) / tiltStep);
        if (tilting > 0) {
          this.integrate(true, a, d, state.tilt * amp, top, tilting);
          a2 = this.oa;
          d2 = this.od;
        }
        // hypertrophy: thicker, wider about the meridian, longer below the fold; the pendulous pouch hangs thinner
        const g = state.growth;
        const superficial = smoothstep(d2 / growth.shear) * amp;
        const below = smoothstep((growth.blend - a2) / (2 * growth.blend));
        const u2 = u + (g.width - 1) * superficial * (u - um);
        a2 += (g.length - 1) * superficial * below * a2;
        d2 *= (1 + (g.depth - 1) * amp) * (1 - g.hang * amp * smoothstep(-a2 / growth.hangMm));
        const v2 = hinge + a2;
        const r2 = this.baseAt(u2, v2) + d2;
        const theta = u2 / rref;
        const target = out[k];
        target[i * 3] = (xc - s * r2 * Math.sin(theta)) * unitsPerMm - positions[i * 3];
        target[i * 3 + 1] = (v2 + y0) * unitsPerMm - positions[i * 3 + 1];
        target[i * 3 + 2] = (zc + r2 * Math.cos(theta)) * unitsPerMm - positions[i * 3 + 2];
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
