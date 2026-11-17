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
 * Grids and curves are sampled with Catmull-Rom and every transition whose derivative enters a velocity is C2
 * (docs/plano-pele-habito-vasos.md): a slope jump of the map shows as a crease in the skin.
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
  /** rest thickness of the mound (skin over the base), same window and step, starts here in the bin */
  thicknessOffset: number;
  foldRange: number[];
  fold: number[];
  hinge: number[];
  top: number[];
  nippleChart: number[];
  /** medial and lateral fades of this breast (mm): the model's, scaled by its fold width */
  taperMedialMm?: number;
  taperMm?: number;
  /** depth factors of this breast in place of the state's (the contralateral one: same volume in every state) */
  depth?: Record<string, number>;
  meshes: string[];
};

/** Growth of the mound in a state: factors for depth, width about the nipple meridian and length below the fold; `hang` thins the pouch as it hangs. */
export type BreastGrowth = { depth: number; width: number; length: number; hang: number };

export type BreastStateData = {
  id: string;
  label: string;
  short: string;
  descent: number;
  tilt: number;
  growth: BreastGrowth;
  description: string;
  /** volume (mL) of the breast a reduction of this state aims at (hypertrophy grades G3, G4) */
  resultMl?: number;
};

export type BreastModelParams = {
  unitsPerMm: number;
  rref: number;
  cell: number;
  /** lateral fade of the map (mm); the medial one is taperMedialMm */
  taperMm: number;
  taperMedialMm: number;
  /** the map is off out of the shipped window (fading over windowFadeMm) and more than belowHingeMm below the hinge */
  gate: { belowHingeMm: number; fadeMm: number; windowFadeMm: number };
  flow: { shear: number; shearFold: number; shearBlend: number[]; rise: number; decel: number[]; lmin: number; stepMm: number };
  tilt: { reach: number; fade: number[]; stepMm: number };
  /** hypertrophy flow: superficial layer, blend above the fold, hang scale (mm), RK4 steps over unit time, and the rest
   * mound thickness under which the depth growth fades (the border of the mound keeps its slope) */
  growth: { shear: number; blend: number; hangMm: number; steps: number; fadeMm: number };
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
/** C2 transitions: where their derivative enters a velocity it must stay continuous, or the flow creases the tissue */
const smootherstep = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * x * (x * (6 * x - 15) + 10);
};
const dsmootherstep = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return 30 * x * x * (1 - x) * (1 - x);
};
/** Catmull-Rom weights (C1 interpolation, no slope jump on the grid lines), in the order of build_breast.py. */
const catmullRom = (t: number, out: number[]) => {
  const t2 = t * t;
  const t3 = t2 * t;
  out[0] = (-t3 + 2 * t2 - t) / 2;
  out[1] = (3 * t3 - 5 * t2 + 2) / 2;
  out[2] = (-3 * t3 + 4 * t2 + t) / 2;
  out[3] = (t3 - t2) / 2;
};

/** One breast: chart, base surface and the state maps. */
export class BreastSide {
  readonly data: BreastSideData;
  private readonly p: BreastModelParams;
  private readonly base: Float64Array;
  private readonly thickness: Float64Array;
  // scratch pair returned by the inner maps (avoids allocating per vertex)
  private oa = 0;
  private od = 0;
  private readonly wu = [0, 0, 0, 0];
  private readonly wv = [0, 0, 0, 0];

  /** `bin`: the whole breast-chart.bin; this side's base surface starts at data.byteOffset (uint16, little endian). */
  constructor(data: BreastSideData, params: BreastModelParams, bin: ArrayBuffer) {
    this.data = data;
    this.p = params;
    const count = data.nu * data.nv;
    const view = new DataView(bin, data.byteOffset, count * 2);
    this.base = new Float64Array(count);
    for (let i = 0; i < count; i++) this.base[i] = view.getUint16(i * 2, true) * data.qstep + data.qmin;
    const thickness = new DataView(bin, data.thicknessOffset, count * 2);
    this.thickness = new Float64Array(count);
    for (let i = 0; i < count; i++) this.thickness[i] = thickness.getUint16(i * 2, true) * data.qstep;
  }

  /** Bicubic Catmull-Rom sample of a window grid at (u, v) mm, clamped (edges repeated), as cubic_2d in Python. */
  private grid(values: Float64Array, u: number, v: number) {
    const { u0, v0, nu, nv } = this.data;
    const cell = this.p.cell;
    let fu = (u - u0) / cell;
    let fv = (v - v0) / cell;
    fu = fu < 0 ? 0 : fu > nu - 1 ? nu - 1 : fu;
    fv = fv < 0 ? 0 : fv > nv - 1 ? nv - 1 : fv;
    const i = Math.min(Math.floor(fu), nu - 2);
    const j = Math.min(Math.floor(fv), nv - 2);
    catmullRom(fu - i, this.wu);
    catmullRom(fv - j, this.wv);
    let out = 0;
    for (let a = 0; a < 4; a++) {
      let ii = i + a - 1;
      ii = ii < 0 ? 0 : ii > nu - 1 ? nu - 1 : ii;
      let row = 0;
      for (let b = 0; b < 4; b++) {
        let jj = j + b - 1;
        jj = jj < 0 ? 0 : jj > nv - 1 ? nv - 1 : jj;
        row += this.wv[b] * values[ii * nv + jj];
      }
      out += this.wu[a] * row;
    }
    return out;
  }

  // ---- chart ----------------------------------------------------------------------------------------
  /** Base surface radius at (u, v): bicubic (Catmull-Rom), clamped to the shipped window. */
  baseAt(u: number, v: number) {
    return this.grid(this.base, u, v);
  }

  /** Rest thickness of the mound (skin over the base) at (u, v). */
  thicknessAt(u: number, v: number) {
    return this.grid(this.thickness, u, v);
  }

  private curve(values: number[], u: number) {
    let f = (u - this.data.u0) / this.p.cell;
    const n = values.length;
    f = f < 0 ? 0 : f > n - 1 ? n - 1 : f;
    const i = Math.min(Math.floor(f), n - 2);
    catmullRom(f - i, this.wu);
    let out = 0;
    for (let k = 0; k < 4; k++) {
      let ii = i + k - 1;
      ii = ii < 0 ? 0 : ii > n - 1 ? n - 1 : ii;
      out += this.wu[k] * values[ii];
    }
    return out;
  }

  /** 1 over the central meridians, 0 at the medial and lateral ends of the fold (C2). */
  taper(u: number) {
    const [lo, hi] = this.data.foldRange;
    return smootherstep((u - lo) / (this.data.taperMedialMm ?? this.p.taperMedialMm)) * smootherstep((hi - u) / (this.data.taperMm ?? this.p.taperMm));
  }

  /** 1 where the map acts; 0 out of the shipped window and far below the hinge (the abdomen never moves). */
  gate(u: number, v: number, hinge: number) {
    const { u0, v0, nu, nv } = this.data;
    const { cell } = this.p;
    const { belowHingeMm, fadeMm, windowFadeMm } = this.p.gate;
    const fu = (u - u0) / cell;
    const fv = (v - v0) / cell;
    const edge = Math.min(Math.min(fu, nu - 1 - fu), Math.min(fv, nv - 1 - fv)) * cell;
    return smootherstep(edge / windowFadeMm) * smootherstep((v - hinge + belowHingeMm) / fadeMm);
  }

  // ---- flows (incompressible in the chart, attached to the wall) ----------------------------------------
  private va = 0;
  private vd = 0;

  /** Ptosis: the tissue descends along the wall beyond a shear layer (thin over the fascia, thick around the fold). */
  private descend(a: number, d: number, s: number, top: number) {
    const { shear, shearFold, shearBlend, rise, decel, lmin } = this.p.flow;
    const x = (a - shearBlend[0]) / (shearBlend[1] - shearBlend[0]);
    const delta = shearFold + (shear - shearFold) * smootherstep(x);
    const ddelta = ((shear - shearFold) * dsmootherstep(x)) / (shearBlend[1] - shearBlend[0]);
    const t = d <= 0 ? 0 : d / delta;
    const tc = t < 1 ? t : 1;
    const profile = tc * tc * (3 - 2 * tc);
    const integral = t < 1 ? tc * tc * tc - 0.5 * tc * tc * tc * tc : 0.5 + (t - 1);
    const up = smootherstep((top - a) / rise);
    const dup = -dsmootherstep((top - a) / rise) / rise;
    const y = (a - decel[0]) / (decel[1] - decel[0]);
    const down = lmin + (1 - lmin) * smootherstep(y);
    const ddown = ((1 - lmin) * dsmootherstep(y)) / (decel[1] - decel[0]);
    const drive = up * down;
    const ddrive = dup * down + up * ddown;
    this.va = -s * drive * profile;
    this.vd = s * (ddrive * delta * integral + drive * ddelta * (integral - t * profile));
  }

  /** Tilt (major ptosis): below the fold the tissue descends the more the farther it is from the wall. */
  private tilt(a: number, d: number, k: number) {
    const { reach, fade } = this.p.tilt;
    const x = (a - fade[0]) / (fade[1] - fade[0]);
    const m = 1 - smootherstep(x);
    const dm = -dsmootherstep(x) / (fade[1] - fade[0]);
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

  // ---- hypertrophy flow ------------------------------------------------------------------------------
  private gu = 0;
  private ga = 0;
  private gd = 0;

  /**
   * Velocity of the hypertrophy flow (rates: logarithms of the width, length and depth factors; `fade`: the depth growth
   * of the point, less where the mound is thin at rest); left in gu/ga/gd.
   */
  private growthVelocity(u: number, a: number, d: number, um: number, lw: number, ll: number, ld: number, hang: number, fade: number) {
    const { shear, blend, hangMm } = this.p.growth;
    const taper = this.taper(u);
    const superficial = smoothstep(d / shear) * taper;
    const below = smoothstep((blend - a) / (2 * blend));
    const thin = 1 - hang * taper * smoothstep(-a / hangMm);
    this.gu = lw * superficial * (u - um);
    this.ga = ll * superficial * below * a;
    this.gd = d * (ld * taper * fade + Math.log(thin > 1e-3 ? thin : 1e-3));
  }

  /** The growth as a flow (RK4 over unit time): it cannot fold the tissue and the wall keeps its place. Result in gu/ga/gd. */
  private grow(u: number, a: number, d: number, um: number, g: BreastGrowth, fade: number) {
    const lw = Math.log(g.width);
    const ll = Math.log(g.length);
    const ld = Math.log(g.depth);
    const hang = g.hang;
    const steps = this.p.growth.steps;
    const h = 1 / steps;
    for (let n = 0; n < steps; n++) {
      this.growthVelocity(u, a, d, um, lw, ll, ld, hang, fade);
      const k1u = this.gu, k1a = this.ga, k1d = this.gd;
      this.growthVelocity(u + 0.5 * h * k1u, a + 0.5 * h * k1a, d + 0.5 * h * k1d, um, lw, ll, ld, hang, fade);
      const k2u = this.gu, k2a = this.ga, k2d = this.gd;
      this.growthVelocity(u + 0.5 * h * k2u, a + 0.5 * h * k2a, d + 0.5 * h * k2d, um, lw, ll, ld, hang, fade);
      const k3u = this.gu, k3a = this.ga, k3d = this.gd;
      this.growthVelocity(u + h * k3u, a + h * k3a, d + h * k3d, um, lw, ll, ld, hang, fade);
      u += (h * (k1u + 2 * k2u + 2 * k3u + this.gu)) / 6;
      a += (h * (k1a + 2 * k2a + 2 * k3a + this.ga)) / 6;
      d = Math.max(d + (h * (k1d + 2 * k2d + 2 * k3d + this.gd)) / 6, 0);
    }
    this.gu = u;
    this.ga = a;
    this.gd = d;
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
    const { unitsPerMm, rref, states, flow } = this.p;
    const tiltReach = this.p.tilt.reach;
    const tiltStep = this.p.tilt.stepMm;
    const tiltFade = this.p.tilt.fade;
    const hingeCurve = this.data.hinge;
    const topCurve = this.data.top;
    const um = this.data.nippleChart[0];
    const sideDepth = this.data.depth ?? {};
    const growths = states.map((state) => (sideDepth[state.id] ? { ...state.growth, depth: sideDepth[state.id] } : state.growth));
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
      const r = Math.hypot(dx, dz);
      const depth = r - this.baseAt(u, v);
      if (depth <= 0) continue;
      const hinge = this.curve(hingeCurve, u);
      const gate = this.gate(u, v, hinge);
      if (gate <= 1e-4) continue;
      const fade = smootherstep(this.thicknessAt(u, v) / this.p.growth.fadeMm);
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
        if (tilting > 0 && a < tiltFade[1]) {
          if (a <= tiltFade[0] && state.tilt >= 0) {
            // below the fold the tilt is a pure shear (d constant, constant descent): the exact solution, which is also
            // what RK4 gives there; above the fade the field is zero
            const t = (d > 0 ? d : 0) / tiltReach;
            a2 = a - (state.tilt * amp * tiltReach * t * t) / (1 + t * t);
          } else {
            this.integrate(true, a, d, state.tilt * amp, top, tilting);
            a2 = this.oa;
            d2 = this.od;
          }
        }
        // hypertrophy: thicker, wider about the meridian, longer below the fold; the pendulous pouch hangs thinner
        this.grow(u, a2, d2, um, growths[k], fade);
        a2 = this.ga;
        d2 = this.gd;
        // the gate fades the whole displacement, in chart coordinates
        const u2 = u + gate * (this.gu - u);
        const v2 = v + gate * (hinge + a2 - v);
        const r2 = r + gate * (this.baseAt(this.gu, hinge + a2) + d2 - r);
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
