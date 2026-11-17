/**
 * Body habitus of the large breast states, evaluated on the device (docs/plano-pele-habito-vasos.md, phase D).
 *
 * Mirror of scripts/hybrid/build_habitus.py: large ptosis and hypertrophy usually come with obesity, so ptosis III, G3
 * and G4 widen the trunk (waist +3, +10 and +18 cm). The pipeline ships a smooth field of outward offsets per state on a
 * cylindrical chart about the trunk axis (theta from the anterior midline, height y), with the rest skin radius, the
 * subcutaneous thickness, the outward normal and the mounds of the breasts (smoothed). A point moves by
 * offset * f * (1 - M) along the normal: f is its depth fraction in the subcutaneous layer (the skin itself 1, deep fascia
 * 0), M the rest mound of either breast (the breast map rules there). The same function moves skin, vessels, nerves,
 * nodes, markings and labels.
 *
 * No imports on purpose: scripts/hybrid/check_habitus_map.mjs loads this file directly with Node.
 */

export type HabitusData = {
  version: number;
  unitsPerMm: number;
  xc: number;
  zc: number;
  thetaStep: number;
  yMin: number;
  yStep: number;
  nTheta: number;
  nY: number;
  unit: number;
  bin: string;
  byteLength: number;
  radiusOffset: number;
  thicknessOffset: number;
  normalOffset: number;
  /** the mounds of the breasts on the chart (uint8, 255 = inside), where the breast map rules */
  maskOffset: number;
  /** points this far outside the trunk skin (mm; the arm beyond the cut) fade out of the habitus */
  outsideMm: [number, number];
  states: Record<string, { byteOffset: number; waistGainMm: number }>;
};

export class Habitus {
  readonly data: HabitusData;
  private readonly radius: Float64Array;
  private readonly thickness: Float64Array;
  private readonly normal: Float64Array;
  private readonly mask: Float64Array;
  /** offsets (mm) per breast state, in the order given to the constructor (null: no habitus in that state) */
  private readonly offsets: (Float64Array | null)[];
  private readonly wt = [0, 0, 0, 0];
  private readonly wy = [0, 0, 0, 0];
  private readonly it = [0, 0, 0, 0];
  private readonly iy = [0, 0, 0, 0];

  constructor(data: HabitusData, bin: ArrayBuffer, stateIds: string[]) {
    this.data = data;
    const n = data.nTheta * data.nY;
    const u16 = (offset: number) => {
      const view = new DataView(bin, offset, n * 2);
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) out[i] = view.getUint16(i * 2, true) * data.unit;
      return out;
    };
    this.radius = u16(data.radiusOffset);
    this.thickness = u16(data.thicknessOffset);
    const normals = new Int8Array(bin, data.normalOffset, n * 3);
    this.normal = new Float64Array(n * 3);
    for (let i = 0; i < n * 3; i++) this.normal[i] = normals[i] / 127;
    const mask = new Uint8Array(bin, data.maskOffset, n);
    this.mask = new Float64Array(n);
    for (let i = 0; i < n; i++) this.mask[i] = mask[i] / 255;
    this.offsets = stateIds.map((id) => {
      const entry = data.states[id];
      if (!entry) return null;
      const view = new DataView(bin, entry.byteOffset, n * 2);
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) * data.unit;
      return out;
    });
  }

  /** Catmull-Rom weights and indices of a (theta degrees, y mm) sample: periodic in theta, clamped in y. */
  private locate(theta: number, y: number) {
    const { thetaStep, yMin, yStep, nTheta, nY } = this.data;
    const ft = (theta + 180) / thetaStep;
    let fy = (y - yMin) / yStep;
    fy = fy < 0 ? 0 : fy > nY - 1 ? nY - 1 : fy;
    const i = Math.floor(ft);
    const j = Math.min(Math.floor(fy), nY - 2);
    const weights = (t: number, out: number[]) => {
      const t2 = t * t;
      const t3 = t2 * t;
      out[0] = (-t3 + 2 * t2 - t) / 2;
      out[1] = (3 * t3 - 5 * t2 + 2) / 2;
      out[2] = (-3 * t3 + 4 * t2 + t) / 2;
      out[3] = (t3 - t2) / 2;
    };
    weights(ft - i, this.wt);
    weights(fy - j, this.wy);
    for (let k = 0; k < 4; k++) {
      this.it[k] = (((i + k - 1) % nTheta) + nTheta) % nTheta;
      const jj = j + k - 1;
      this.iy[k] = jj < 0 ? 0 : jj > nY - 1 ? nY - 1 : jj;
    }
  }

  /** Sample of a grid (stride per cell, component c) at the last located point. */
  private sample(values: Float64Array, stride = 1, c = 0) {
    const nY = this.data.nY;
    let out = 0;
    for (let a = 0; a < 4; a++) {
      let row = 0;
      for (let b = 0; b < 4; b++) row += this.wy[b] * values[(this.it[a] * nY + this.iy[b]) * stride + c];
      out += this.wt[a] * row;
    }
    return out;
  }

  /**
   * Displacement of `count` rest points (xyz, model units) in every breast state, model units; null when nothing moves.
   * `skin`: the points are the skin itself (it moves by the whole offset, in its folds too).
   */
  displacements(positions: ArrayLike<number>, skin = false, count = positions.length / 3): Float32Array[] | null {
    const { unitsPerMm, xc, zc } = this.data;
    if (!this.offsets.some(Boolean)) return null;
    let out: Float32Array[] | null = null;
    for (let i = 0; i < count; i++) {
      const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
      const dx = px / unitsPerMm - xc;
      const dz = pz / unitsPerMm - zc;
      const theta = (Math.atan2(dx, dz) * 180) / Math.PI;
      this.locate(theta, py / unitsPerMm);
      let mound = this.sample(this.mask);
      mound = mound < 0 ? 0 : mound > 1 ? 1 : mound;
      if (mound >= 1 - 1e-6) continue;
      let f = 1;
      if (!skin) {
        const rs = this.sample(this.radius);
        const t0 = this.sample(this.thickness);
        const r = Math.hypot(dx, dz);
        f = 1 - (rs - r) / (t0 > 1 ? t0 : 1);
        f = f < 0 ? 0 : f > 1 ? 1 : f;
        // nothing outside the trunk skin moves (the arm beyond the cut)
        const [near, far] = this.data.outsideMm;
        let out = (r - rs - near) / (far - near);
        out = out < 0 ? 0 : out > 1 ? 1 : out;
        f *= 1 - out * out * out * (out * (6 * out - 15) + 10);
      }
      f *= 1 - mound;
      if (f <= 0) continue;
      let nx = this.sample(this.normal, 3, 0);
      let ny = this.sample(this.normal, 3, 1);
      let nz = this.sample(this.normal, 3, 2);
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
      for (let k = 0; k < this.offsets.length; k++) {
        const grid = this.offsets[k];
        if (!grid) continue;
        const move = this.sample(grid) * f * unitsPerMm;
        if (!move) continue;
        if (!out) out = this.offsets.map(() => new Float32Array(count * 3));
        out[k][i * 3] = nx * move;
        out[k][i * 3 + 1] = ny * move;
        out[k][i * 3 + 2] = nz * move;
      }
    }
    return out;
  }
}
