#!/usr/bin/env python3
"""Tissue rearrangement of a reduction mammaplasty, step by step (docs/plano-mamoplastia.md, fase 4).

For each technique of build_mammaplasty.py (Pitanguy, Wise with inferior pedicle, vertical with superomedial
pedicle) this script works out where every part of the operated breast goes, the patient standing:

  K0 marcacao      the ptotic breast (ptosis grade II with moderate hypertrophy) with its marking
  K1 incisao       the same, the skin cut along the marking and the pedicle de-epithelialised
  K2 resseccao     the resection (and the skin over it) taken out
  K3 transposicao  the pedicle carries the nipple-areola complex to its new place
  K4 fechamento    the pillars and the skin flaps close round it: the expected result

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
FRAMES = [
    {"id": "marcacao", "label": "Marcação"},
    {"id": "incisao", "label": "Incisão e desepitelização"},
    {"id": "resseccao", "label": "Ressecção"},
    {"id": "transposicao", "label": "Transposição do complexo areolopapilar"},
    {"id": "fechamento", "label": "Fechamento e resultado"},
]
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
    "skin": "#e7b8a0", "excised": "#e9a27f", "dermis": "#d97a82", "nac": "#9b5a47",
    "pedicle": "#3fae6b", "resection": "#e08a2e", "pillar-medial": "#4f7fd6", "pillar-lateral": "#9a6fd6", "scar": "#7d2f32",
}


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
        lines = {name: rest.carry(xs) for name, xs in item["lines"].items()}
        self.regions_and_lines(lines)
        self.patch = mr.SkinPatch(rest, [("nac", Point(0, 0).buffer(AREOLA_R + 0.6, 64)), ("dermis", self.dermis), ("excised", self.pattern), ("stay", None)], self.named, skirt=SKIRT)
        self.closure = mr.Closure(self.patch, ("stay",), self.targets, AREOLA_R, seam="seam" if "seam" in self.named else None)
        self.removed_ml = item["resection"].volume
        self.result = mr.result_state(self.breast, mound_ml - self.removed_ml, NIPPLE_ABOVE_FOLD)
        self.field = self.displacement_field()

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
            tau_f = (abs(f_point[1]) - AREOLA_R) / (abs(bottom[1]) - AREOLA_R)
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
            cover = BURY * smooth01((rho - AREOLA_R) / 8.0)
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
        reach = max(float(np.percentile(rho, 98)), AREOLA_R + 10)
        w = smooth01(1 - (rho - AREOLA_R) / (reach - AREOLA_R)) * smooth01(t / 0.6)
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
    """Meshes of one technique: positions at their key frames, quantised over one box, and indices."""

    def __init__(self) -> None:
        self.meshes: list[dict] = []

    def add(self, name: str, structure: str, label: str, color: str, opacity: float, tissue: str, faces: np.ndarray, frames: dict[int, np.ndarray]) -> None:
        used = np.unique(faces)
        remap = -np.ones(max(int(faces.max()) + 1, 1), int)
        remap[used] = np.arange(len(used))
        frames = {k: np.asarray(v)[used] for k, v in sorted(frames.items())}
        self.meshes.append({"name": name, "structure": structure, "label": label, "color": color, "opacity": opacity, "tissue": tissue, "faces": remap[faces], "frames": frames})

    def write(self, path: Path) -> tuple[list[dict], dict]:
        allpos = np.vstack([p for m in self.meshes for p in m["frames"].values()]) * MM
        lo, hi = allpos.min(0) - 1e-4, allpos.max(0) + 1e-4
        blobs, offset, records = [], 0, []
        for m in self.meshes:
            n = len(next(iter(m["frames"].values())))
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


def nac_meshes(breast: bb.Breast, keep: float = 0.12):
    """The real nipple, areola and tubercles of the operated side, simplified, in rest model space (mm)."""
    out = []
    for name in bb.SIDE_MESHES["op"]:
        if not ("nipple" in name or "areola" in name):
            continue
        pos, idx = bb.mesh(name)
        p2, i2 = fast_simplification.simplify(pos.astype(np.float32), idx.astype(np.int32), target_reduction=1 - keep)
        out.append((name, np.asarray(p2, float), np.asarray(i2, int)))
    return out


def measure(tech: Technique, before: dict, notch: np.ndarray) -> dict:
    """Clinical measurements of the result, taken on the result skin as a tape would."""
    st, ch, breast, rest = tech.st, tech.ch, tech.breast, tech.rest
    fold_v = float(np.interp(st.um, st.us, st.V[:, -1]))
    nipple = mr.state_map(breast, ch.nipple[None], tech.result)[0]
    skin = lambda u, v: np.c_[u, v, st.skin_r(u, v)]  # noqa: E731
    notch_chart = ch.to_chart(notch[None])[0]
    t = np.linspace(0, 1, 160)
    upper = skin(notch_chart[0] + (st.um - notch_chart[0]) * t, notch_chart[1] + (0 - notch_chart[1]) * t)
    lower_v = np.linspace(0, fold_v, 80)
    lower = skin(np.full(80, st.um), lower_v)
    final = lambda q: tech.skin_final(q)  # noqa: E731
    sn = bb.polyline_length(final(upper))
    nimf = bb.polyline_length(final(lower))
    after = {
        "nippleToFoldMm": round(float(nipple[1] - fold_v), 1),
        "notchToNippleMm": round(sn),
        "nippleToFoldSkinMm": round(nimf),
        "projectionMm": round(float(nipple[2] - breast.base(nipple[:1], nipple[1:2])[0])),
        "volumeMl": round(mr.mound_volume(breast, lambda q: mr.state_map(breast, q, tech.result))),
    }
    keys = ("nippleToFoldMm", "notchToNippleMm", "nippleToFoldSkinMm", "projectionMm", "volumeMl")
    return {"before": {k: before[k] for k in keys}, "after": after}


def main() -> None:
    state = [s["id"] for s in bb.STATES].index(bm.STATE)
    breast = bb.Breast("op", bb.trunk_axis())
    ch = breast.ch
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
    structures, manifest, techniques = {}, [], {}
    figures_dir = Path(sys.argv[sys.argv.index("--figures") + 1]) if "--figures" in sys.argv else None
    for key, item in plan.items():
        info = bm.TECHNIQUES[key]
        tech = Technique(key, item, st, front, inverse, rest, mound_ml)
        patch, closure = tech.patch, tech.closure
        print(f"{info['label']}: pele {len(patch.iso)} vértices; fechamento: {closure.unassigned} sem condição, {closure.flipped} triângulos invertidos (degenerados no sulco)")
        print(f"   resultado: descida {tech.result['descent']} mm, crescimento {tech.result['growth']}")
        writer = Writer()
        lift = np.c_[np.zeros((len(patch.iso), 2)), np.full(len(patch.iso), 0.0)]
        k0 = tech.standing(patch.rest_chart)
        # ---- skin -----------------------------------------------------------------------------------------
        uv_final = patch.rest_uv.copy()
        uv_final[closure.vertices] = closure.target_uv
        stay_final = tech.skin_final(np.c_[uv_final, st.skin_r(uv_final[:, 0], uv_final[:, 1]) + patch.lift])
        # the skirt: trunk skin round the outline, where the result fades into the skin that stays as it is
        skirt = np.unique(patch.faces("skirt"))
        rim = np.nonzero(patch.on_outline)[0]
        from scipy.spatial import cKDTree
        distance, nearest = cKDTree(patch.iso[rim]).query(patch.iso[skirt])
        fade = (1 - smooth01(distance / SKIRT))[:, None]
        stay_final[skirt] = k0[skirt] + fade * (stay_final[rim[nearest]] - k0[rim[nearest]])
        print(f"   contorno: o resultado se afasta até {float(np.linalg.norm(stay_final[rim] - k0[rim], axis=1).max()):.1f} mm da pele em pé; a saia de {SKIRT:.0f} mm absorve")
        nac_skin_final = tech.skin_final(patch.rest_chart)
        dermis_rest = patch.rest_chart.copy()
        dermis_flat = tech.final(dermis_rest, "pedicle", buried=False)
        dermis_buried = tech.final(dermis_rest, "pedicle", buried=True)
        dermis_swing = tech.swing(dermis_rest, k0, dermis_flat)
        out_dir = out_direction(ch, k0[np.unique(patch.faces("excised"))].mean(0), st)
        s_key = f"mamo-step-skin-{key}"
        writer.add(f"mamo_{key}_step_skin", s_key, "Pele que fica", COLORS["skin"], 1.0, "skin", patch.faces("stay", "skirt"), {0: k0, 4: stay_final})
        writer.add(f"mamo_{key}_step_nac_skin", s_key, "Pele sob a aréola", COLORS["skin"], 1.0, "skin", patch.faces("nac"), {0: k0, 3: tech.swing(patch.rest_chart, k0, nac_skin_final)})
        # skin coloured: the views of the incision onwards tint them (excised skin, de-epithelialised dermis)
        writer.add(f"mamo_{key}_step_excised", f"mamo-step-excised-{key}", "Pele ressecada", COLORS["skin"], 1.0, "skin", patch.faces("excised"), {0: k0, 2: k0 + out_dir})
        writer.add(f"mamo_{key}_step_dermis", f"mamo-step-dermis-{key}", "Derme desepitelizada do pedículo", COLORS["skin"], 1.0, "skin", patch.faces("dermis"), {0: k0, 3: dermis_swing, 4: dermis_buried})
        # ---- pieces -----------------------------------------------------------------------------------------
        ped, res = item["pedicle"], item["resection"]
        ped_k0 = ch.to_model(ped.standing)
        ped_flat = tech.final(ped.rest, "pedicle", buried=False)
        writer.add(f"mamo_{key}_step_pedicle", f"mamo-step-pedicle-{key}", f"Pedículo {info['pedicle']}", COLORS["pedicle"], 0.9, "piece", ped.faces, {0: ped_k0, 3: tech.swing(ped.rest, ped_k0, ped_flat), 4: tech.final(ped.rest, "pedicle", buried=True)})
        res_k0 = ch.to_model(res.standing)
        writer.add(f"mamo_{key}_step_resection", f"mamo-step-resection-{key}", f"Ressecção {info['resection']}", COLORS["resection"], 0.9, "piece", res.faces, {0: res_k0, 2: res_k0 + out_dir})
        pill = pillars(key, item, front, inverse, st)
        volumes = {}
        for side, piece in pill.items():
            k0p = ch.to_model(piece.standing)
            label = ("Retalho " if key == "wise" else "Pilar ") + side
            writer.add(f"mamo_{key}_step_pillar_{side}", f"mamo-step-pillar-{side}-{key}", label, COLORS[f"pillar-{side}"], 0.9, "piece", piece.faces, {0: k0p, 4: tech.final(piece.rest, "pillar")})
            volumes[side] = round(piece.volume)
        # ---- nipple-areola complex ----------------------------------------------------------------------------
        for name, pos, idx in nacs:
            q = ch.to_chart(pos)
            a = ch.to_model(bb.deform(breast, q)[st.k])
            b = tech.skin_final(q)
            writer.add(f"mamo_{key}_step_{name.split('_')[-2]}", f"mamo-step-nac-{key}", "Complexo areolopapilar", COLORS["nac"], 1.0, "areola", idx, {0: a, 3: b})
        # ---- scars ----------------------------------------------------------------------------------------------
        scars = scar_lines(tech)
        for n_, (label, iso) in enumerate(scars):
            uv = rest.uv(iso)
            pts = tech.skin_final(np.c_[uv, st.skin_r(uv[:, 0], uv[:, 1]) + SCAR_LIFT])
            v, f = tube(pts, radius=SCAR_RADIUS, sides=6)
            writer.add(f"mamo_{key}_step_scar_{n_}", f"mamo-step-scars-{key}", label, COLORS["scar"], 1.0, "marking", f, {4: v})
        records, box_ = writer.write(Path(str(OUT_BIN).format(key=key)))
        points = anchor_points(tech, writer, scars)
        m = measure(tech, before, notch)
        print(f"   antes {m['before']}\n   depois {m['after']}")
        # the content hash keeps the service worker (cache first) from serving an older binary with newer data
        digest = hashlib.sha1(Path(str(OUT_BIN).format(key=key)).read_bytes()).hexdigest()[:10]
        techniques[key] = {
            "bin": f"models/hybrid/mammaplasty-{key}.bin?v={digest}", **box_,
            "result": tech.result, "measurements": m, "pillarsMl": volumes, "points": points,
            "meshes": records,
        }
        for mesh in writer.meshes:
            structures.setdefault(mesh["structure"], {"label": structure_label(mesh["structure"], info), "group": "Mamoplastia", "visible": False, "labelAnchor": [round(float(x) * MM, 4) for x in next(iter(mesh["frames"].values())).mean(0)], "meshNames": []})["meshNames"].append(mesh["name"])
            manifest.append({"name": mesh["name"], "structure": mesh["structure"], "tissue": mesh["tissue"], "source": bm.SOURCE, "sourceName": mesh["label"], "license": bm.LICENSE, "triangles": int(len(mesh["faces"])), "color": mesh["color"], "opacity": mesh["opacity"]})
        if figures_dir is not None:
            review(tech, writer, figures_dir)
    # where the skin of the trunk gives way to the patch of each technique (rest chart u, v of the operated side)
    hole = rest.uv(np.array(tech.patch.mesh_domain.buffer(-1.5).simplify(0.3).exterior.coords))
    out = {
        "version": 1, "source": bm.SOURCE, "state": bm.STATE, "frames": FRAMES, "nippleAboveFoldMm": NIPPLE_ABOVE_FOLD,
        "hole": [[round(float(u), 2), round(float(v), 2)] for u, v in hole],
        "techniques": techniques, "structures": structures, "meshes": manifest,
    }
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    sizes = ", ".join(f"{k} {v['byteLength'] / 1e3:.0f} kB" for k, v in techniques.items())
    print(f"wrote {OUT_JSON.relative_to(bb.ROOT)} ({OUT_JSON.stat().st_size / 1e3:.0f} kB) and binaries: {sizes}")


def structure_label(structure: str, info: dict) -> str:
    kind = structure.split("-")[2]
    return {
        "skin": f"Pele, passo a passo ({info['label']})",
        "excised": f"Pele ressecada ({info['label']})",
        "dermis": f"Derme do pedículo {info['pedicle']}",
        "pedicle": f"Pedículo {info['pedicle']}, passo a passo",
        "resection": f"Ressecção {info['resection']}, passo a passo",
        "pillar": f"{'Retalho' if 'Wise' in info['label'] else 'Pilar'} {structure.split('-')[3]} ({info['label']})",
        "nac": f"Complexo areolopapilar ({info['label']})",
        "scars": f"Cicatrizes ({info['label']})",
    }[kind]


def out_direction(ch, centre: np.ndarray, st) -> np.ndarray:
    q = ch.to_chart(centre[None])[0]
    theta = q[0] / bb.RREF
    radial = np.array([-ch.s * np.sin(theta), 0.0, np.cos(theta)])
    medial = np.array([ch.s, 0.0, 0.0])  # the operated side lies towards -x
    return radial * OUT_OFFSET["radial"] + medial * OUT_OFFSET["medial"] + np.array([0.0, -OUT_OFFSET["down"], 0.0])


def anchor_points(tech: Technique, writer: Writer, scars: list[tuple[str, np.ndarray]]) -> dict:
    """Label anchors of the step views: a vertex of every piece near its middle, where its first frame puts it
    (model units). The viewer snaps a label to that vertex and then follows it through the key frames."""
    key = tech.key
    by_name = {m["name"]: m for m in writer.meshes}

    def nearest(name: str, target=None) -> list[float]:
        p = next(iter(by_name[name]["frames"].values()))
        t = p.mean(0) if target is None else target
        return [round(float(x) * MM, 5) for x in p[np.argmin(np.linalg.norm(p - t, axis=1))]]

    out = {
        "nac": nearest(f"mamo_{key}_step_areola"),
        "pedicle": nearest(f"mamo_{key}_step_pedicle"),
        "resection": nearest(f"mamo_{key}_step_resection"),
        "excised": nearest(f"mamo_{key}_step_excised"),
        "dermis": nearest(f"mamo_{key}_step_dermis"),
    }
    for side in ("medial", "lateral"):
        out[f"pillar-{side}"] = nearest(f"mamo_{key}_step_pillar_{side}")
    for n_, _ in enumerate(scars):
        name = f"mamo_{key}_step_scar_{n_}"
        p = next(iter(by_name[name]["frames"].values()))
        out[f"scar-{n_}"] = nearest(name, p[len(p) // 2])
    # where the camera of the sequence looks: between the nipple before and after, 30 mm deep to the skin
    areola = by_name[f"mamo_{key}_step_areola"]["frames"]
    centre = (areola[0].mean(0) + areola[max(areola)].mean(0)) / 2 - np.array([0.0, 0.0, 30.0])
    out["centre"] = [round(float(x) * MM, 5) for x in centre]
    return out


def scar_lines(tech: Technique) -> list[tuple[str, np.ndarray]]:
    """Suture lines of the result in the isotropic rest chart (the skin the result state then shapes)."""
    rest = tech.rest
    circle = np.c_[AREOLA_R * np.sin(np.linspace(0, 2 * np.pi, 120)), AREOLA_R * np.cos(np.linspace(0, 2 * np.pi, 120))]
    fold_bottom = np.array([0.0, float(np.interp(tech.st.um, tech.st.us, tech.st.V[:, -1]))])
    out = [("Cicatriz periareolar", circle)]
    if tech.fold_ends is not None:
        out.append(("Cicatriz vertical", np.c_[np.zeros(60), np.linspace(-AREOLA_R, fold_bottom[1] + 0.5, 60)]))
        d, e = tech.fold_ends
        out.append(("Cicatriz no sulco", rest.outline_between(e, d, below=True)))
    else:
        f_y = float(tech.named["seam"][0, 1])
        out.append(("Cicatriz vertical", np.c_[np.zeros(40), np.linspace(-AREOLA_R, f_y, 40)]))
    return out


def review(tech: Technique, writer: Writer, out: Path) -> None:
    """Renders of the five frames (pieces inside the see-through skin) and of the result (opaque skin, scars)."""
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

    def frame(k: int, solid: bool, pieces: bool, scars: bool):
        layers = [(trunk, trunk_idx, rgb(COLORS["skin"]), 1.0)]
        for m in writer.meshes:
            keys = [f for f in m["frames"] if f <= k]
            if not keys:
                continue
            pos = m["frames"][max(keys)]
            kind = m["structure"].split("-")[2]
            if kind == "scars" and not scars:
                continue
            if kind in ("pedicle", "resection", "pillar"):
                if pieces and not (kind == "resection" and k >= 3):
                    layers.append((pos, m["faces"], rgb(m["color"]), 1.0))
                continue
            if kind == "excised" and k >= 3:
                continue
            if kind == "dermis" and k >= 4 and solid:
                continue
            alpha = 1.0 if (solid or kind in ("nac", "scars")) else 0.3
            layers.append((pos, m["faces"], rgb(m["color"]), alpha))
        return np.hstack([splat(layers, yaw, pitch, centre, half=150, size=420, spacing=0.75) for yaw, pitch in ((0, 0), (45, 0), (88, 0))])

    rows = [frame(k, False, True, False) for k in (0, 2, 3, 4)] + [frame(4, True, False, True)]
    plt.imsave(out / f"passos-{tech.key}.png", np.vstack(rows))


if __name__ == "__main__":
    main()
