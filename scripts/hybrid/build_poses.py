#!/usr/bin/env python3
"""Upper-limb poses for the hybrid torso: deformed (not only rotated) muscles, vessels and nerves.

Pipeline (see docs/movimento-membro-superior.md):

1. Joints from the model's own bones: glenohumeral centre (sphere fit to the humeral head),
   sternoclavicular and acromioclavicular joints (clavicle landmarks), scapular plane (PCA) and
   humeral long axis (head centre to epicondyles).
2. Kinematics: clavicle elevation/retraction at the SC joint, scapular upward rotation at the AC joint,
   glenohumeral elevation in the chosen plane plus axial rotation, chained thorax -> clavicle -> scapula ->
   humerus. The glenohumeral angle is solved so the humerus reaches the requested humerothoracic elevation
   (scapulohumeral rhythm); the scapular posterior tilt is solved so the inferior angle keeps its rest
   clearance from the thoracic cage (the scapula glides on the thorax instead of winging).
3. Skinning weights over four rigid bodies (thorax, clavicle, scapula, humerus), anatomically
   constrained instead of Euclidean (which would leak across the air between arm and trunk):
   * muscles: harmonic field on the muscle's own surface between its origin and insertion bones
     (Dirichlet on the vertices touching each bone);
   * vessels, nerves, lymph nodes, fasciae: weights of the nearest muscles/bones, smoothed over all of
     them together so cross-sections and branch junctions move as one;
   * bones: rigid; trunk skin, breast and thoracic wall stay with the thorax.
4. Deformation per keyframe: dual-quaternion skinning (no "candy-wrapper" collapse), then
   * fibre chords: stretched fibres of the muscles spanning the axilla run straight between their moved
     attachments instead of swinging around the joint (pectoralis major, latissimus dorsi, teres major);
   * volume preservation: the belly of a muscle that shortens thickens and one that lengthens thins
     (cross-section ~ 1/sqrt(stretch), profile sin(pi*u) from origin to insertion);
   * sliding: tissue near the chest wall keeps most of its rest clearance from the thoracic envelope;
   * collisions: soft-tissue vertices that end up inside a bone are pushed back to its surface;
   * the corrections of each muscle are carried over to the vessels, nerves and fasciae around it.
5. Output per model variant (desktop/mobile GLB, decoded by decode_model.mjs): sparse morph deltas
   (int16, 0.025 mm) per keyframe, loaded on demand by the app and played as morph targets.

Outputs:
  src/data/armPoses.json                         poses, kinematics, bone transforms, overlay weights
  public/models/hybrid/poses/<variant>-index.bin vertex indices that move (uint32, per mesh)
  public/models/hybrid/poses/<variant>-<pose>.bin deltas (int16 x3 x keyframes)
  public/models/hybrid/poses/fibres-<pose>.bin   displacement of the fibre polylines (int16 x3, final keyframe)

`--overlays` recomputes only the fibre and hila offsets from the pose files already written.
"""
from __future__ import annotations

import json
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np
import trimesh
from scipy.sparse import coo_matrix, diags, identity
from scipy.sparse.linalg import splu
from scipy.spatial import ConvexHull, cKDTree

sys.path.insert(0, str(Path(__file__).parent))
from build_anatomy_layers import cotan_laplacian  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = json.loads((ROOT / "src/data/hybridTorsoManifest.json").read_text())
LAYERS = json.loads((ROOT / "src/data/anatomyLayers.json").read_text())
MM = MANIFEST["landmarks"]["unitsPerMm"]
BY_SOURCE = {m["sourceName"]: m for m in MANIFEST["meshes"]}
BY_NAME = {m["name"]: m for m in MANIFEST["meshes"]}
OUT_JSON = ROOT / "src/data/armPoses.json"
OUT_DIR = ROOT / "public/models/hybrid/poses"
VARIANTS = {"desktop": "assets/build/model-meshes", "mobile": "assets/build/model-meshes-mobile"}
KEYFRAMES = 3
STEP_MM = 0.025  # delta quantisation

BONES = ["thorax", "clavicle", "scapula", "humerus"]
T, C, S, H = range(4)
MOVING_BONES = {"Left clavicle": C, "Left scapula": S, "Left humerus": H}

# Origin and insertion bodies of every muscle that crosses a moving joint.
MUSCLES: dict[str, tuple[tuple[int, ...], int]] = {
    "Clavicular part of left pectoralis major": ((C,), H),
    "Sternocostal part of left pectoralis major": ((T,), H),
    "Abdominal part of left pectoralis major": ((T,), H),
    "Left pectoralis minor": ((T,), S),
    "Left subclavius": ((T,), C),
    "Clavicular part of left deltoid": ((C,), H),
    "Acromial part of left deltoid": ((S,), H),
    "Spinal part of left deltoid": ((S,), H),
    "Descending part of left trapezius": ((T,), C),
    "Transverse part of left trapezius": ((T,), S),
    "Ascending part of left trapezius": ((T,), S),
    "Left rhomboid major": ((T,), S),
    "Left rhomboid minor": ((T,), S),
    "Left levator scapulae": ((T,), S),
    "Left serratus anterior": ((T,), S),
    "Left latissimus dorsi": ((T, S), H),
    "Left teres major": ((S,), H),
    "Left teres minor": ((S,), H),
    "Left infraspinatus": ((S,), H),
    "Left supraspinatus": ((S,), H),
    "Left subscapularis": ((S,), H),
    "Left coracobrachialis": ((S,), H),
    "Short head of left biceps brachii": ((S,), H),
    "Long head of left biceps brachii": ((S,), H),
    "Long head of left triceps brachii": ((S,), H),
    "Lateral head of left triceps brachii": ((H,), H),
    "Medial head of left triceps brachii": ((H,), H),
}
# soft tissue that follows its neighbours (vessels, nerves, nodes, fasciae)
FOLLOWER_TISSUES = {"artery", "vein", "nerve", "lymph-node", "fascia"}
# Muscles whose belly spans the axilla between trunk and arm. Blended skinning swings their middle
# portion around the glenohumeral centre (an arc, a hook at large elevations); a stretched muscle runs
# straight between its attachments instead. Strength of the fibre-chord correction (see chord_correct).
CHORD_MUSCLES = {
    "Clavicular part of left pectoralis major": 1.0,
    "Sternocostal part of left pectoralis major": 1.0,
    "Abdominal part of left pectoralis major": 1.0,
    "Left latissimus dorsi": 0.6,
    "Left teres major": 0.6,
}
# The long head of the biceps slides in the intertubercular groove and inserts on the radius (outside
# the model): its end-to-end distance is not a muscle length, so neither stretch nor volume apply.
STRETCH_UNRELIABLE = {"Long head of left biceps brachii"}

# Surgical positions. Angles in degrees; humerothoracic elevation is solved exactly, clavicle and scapular
# upward rotation are typical values inside the ranges reported by 3D kinematic studies (see the doc) and
# the scapular posterior tilt is solved from the scapulothoracic contact.
POSES = [
    {
        "id": "abducao-90",
        "label": "Abdução 90° (braçadeira)",
        "short": "Abdução 90°",
        "description": "Decúbito dorsal com o braço na braçadeira: posição da dissecção axilar, da biópsia do linfonodo sentinela e da mastectomia. A axila se abre, o peitoral maior e o grande dorsal se alongam e a prega axilar anterior sobe.",
        "plane": 0, "elevation": 90, "external": 30,
        "clavicle": {"elevation": 8, "retraction": 12}, "scapula": {"upward": 22},
    },
    {
        "id": "flexao-90",
        "label": "Flexão 90° (decúbito lateral, braço no apoio)",
        "short": "Flexão 90°",
        "description": "Decúbito lateral com o braço em flexão anterior sobre o apoio: posição do retalho do grande dorsal e dos retalhos toracolaterais. A borda anterior do grande dorsal fica tensa e acessível e a escápula roda para cima.",
        "plane": 90, "elevation": 90, "external": 0,
        "clavicle": {"elevation": 8, "retraction": 6}, "scapula": {"upward": 24},
    },
    {
        "id": "abducao-130",
        "label": "Mão atrás da cabeça (abdução 130° + rotação externa)",
        "short": "Mão na nuca",
        "description": "Abdução acima do ombro com rotação externa, como na mão apoiada atrás da cabeça: abre ao máximo a axila e a parede torácica lateral. Grande amplitude: a deformação é mais aproximada.",
        "plane": 10, "elevation": 130, "external": 60,
        "clavicle": {"elevation": 14, "retraction": 18}, "scapula": {"upward": 34},
    },
]


# --------------------------------------------------------------------------------------------------
# geometry helpers
# --------------------------------------------------------------------------------------------------
@lru_cache(maxsize=None)
def raw_mesh(variant: str, name: str) -> tuple[np.ndarray, np.ndarray]:
    base = ROOT / VARIANTS[variant]
    pos = np.fromfile(base / f"{name}.pos.bin", dtype=np.float32).reshape(-1, 3).astype(np.float64)
    idx = np.fromfile(base / f"{name}.idx.bin", dtype=np.uint32).reshape(-1, 3).astype(np.int64)
    return pos, idx


def by_source(variant: str, source: str):
    return raw_mesh(variant, BY_SOURCE[source]["name"])


def weld(pos: np.ndarray, idx: np.ndarray):
    """Merge duplicated vertices (normal/uv seams) so fields are continuous; returns map raw->welded."""
    key = np.round(pos / (0.01 * MM)).astype(np.int64)
    _, first, inverse = np.unique(key, axis=0, return_index=True, return_inverse=True)
    return pos[first], inverse.ravel()[idx], inverse.ravel()


def vertex_normals(pos: np.ndarray, idx: np.ndarray) -> np.ndarray:
    fn = np.cross(pos[idx[:, 1]] - pos[idx[:, 0]], pos[idx[:, 2]] - pos[idx[:, 0]])
    vn = np.zeros_like(pos)
    for k in range(3):
        np.add.at(vn, idx[:, k], fn)
    return vn / np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)


def adjacency(n: int, idx: np.ndarray):
    rows = np.concatenate([idx[:, 0], idx[:, 1], idx[:, 2], idx[:, 1], idx[:, 2], idx[:, 0]])
    cols = np.concatenate([idx[:, 1], idx[:, 2], idx[:, 0], idx[:, 0], idx[:, 1], idx[:, 2]])
    a = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(n, n)).tocsr()
    a.data[:] = 1.0
    deg = np.asarray(a.sum(1)).ravel()
    return diags(1 / np.maximum(deg, 1)) @ a


# --------------------------------------------------------------------------------------------------
# 1-2. joints and kinematics
# --------------------------------------------------------------------------------------------------
def landmark(ident: str) -> np.ndarray:
    return np.array(next(item["point"] for item in LAYERS["landmarks"] if item["id"] == ident))


def rotation(axis, angle_deg: float) -> np.ndarray:
    axis = np.asarray(axis, float) / np.linalg.norm(axis)
    a = np.radians(angle_deg)
    k = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + np.sin(a) * k + (1 - np.cos(a)) * k @ k


def about(pivot, r: np.ndarray) -> np.ndarray:
    m = np.eye(4)
    m[:3, :3] = r
    m[:3, 3] = pivot - r @ pivot
    return m


def joints() -> dict:
    hum = by_source("desktop", "Left humerus")[0]
    head = landmark("umero.cabeca")
    sel = hum[np.linalg.norm(hum - head, axis=1) < 30 * MM]
    a = np.c_[2 * sel, np.ones(len(sel))]
    c = np.linalg.lstsq(a, (sel**2).sum(1), rcond=None)[0]
    gh = c[:3]
    radius = float(np.sqrt(c[3] + gh @ gh) / MM)
    elbow = (landmark("umero.epicondilo-medial") + landmark("umero.epicondilo-lateral")) / 2
    hum_axis = (gh - elbow) / np.linalg.norm(gh - elbow)  # points up, towards the head
    scap = by_source("desktop", "Left scapula")[0]
    _, _, vt = np.linalg.svd(scap - scap.mean(0), full_matrices=False)
    normal = vt[2] if vt[2][2] > 0 else -vt[2]  # anterior-facing scapular normal
    ac = landmark("clavicula.extremidade-acromial")
    root = landmark("escapula.margem-medial")
    spine_axis = (ac - root) / np.linalg.norm(ac - root)
    return {
        "gh": gh, "ghRadiusMm": radius, "sc": landmark("clavicula.extremidade-esternal"), "ac": ac,
        "humAxis": hum_axis, "scapNormal": normal, "spineAxis": spine_axis,
        "inferiorAngle": landmark("escapula.angulo-inferior"), "elbow": elbow,
    }


def elevation_of(m_hum: np.ndarray, j: dict) -> float:
    down = -(m_hum[:3, :3] @ j["humAxis"])
    return float(np.degrees(np.arccos(np.clip(-down[1], -1, 1))))


SOLVED_TILT: dict[tuple[str, float], float] = {}
MAX_POSTERIOR_TILT = 30.0  # degrees; McClure et al. 2001 report ~30° of posterior tilt at maximal elevation


@lru_cache(maxsize=None)
def thorax_hull() -> tuple[np.ndarray, np.ndarray]:
    """Convex envelope of the thoracic cage (ribs, sternum, costal cartilages): outward facet normals, offsets."""
    pts = []
    for rec in MANIFEST["meshes"]:
        name = rec["sourceName"]
        cage = rec["tissue"] == "cartilage" or (rec["tissue"] == "bone" and ("rib" in name or name in ("Body of sternum", "Manubrium", "Xiphoid process")))
        if cage:
            pts.append(raw_mesh("desktop", rec["name"])[0])
    hull = ConvexHull(np.vstack(pts))
    return hull.equations[:, :3].copy(), hull.equations[:, 3].copy()


def thorax_clearance(points: np.ndarray, with_normals: bool = False):
    """Signed distance (outside > 0) of points to the thoracic envelope, and the normal of the closest facet."""
    a, b = thorax_hull()
    dist = np.empty(len(points))
    facet = np.empty(len(points), np.int64)
    for c in range(0, len(points), 20000):
        d = points[c:c + 20000] @ a.T + b
        facet[c:c + 20000] = np.argmax(d, 1)
        dist[c:c + 20000] = d[np.arange(len(d)), facet[c:c + 20000]]
    return (dist, a[facet]) if with_normals else dist


def tilt_sign(j: dict) -> float:
    """Sign of the rotation about the scapular spine axis that tilts the scapula posteriorly (inferior angle forward)."""
    test = about(j["ac"], rotation(j["spineAxis"], 10)) @ np.r_[j["inferiorAngle"], 1]
    return -1.0 if test[2] < j["inferiorAngle"][2] else 1.0


def scapulothoracic_contact(clav: np.ndarray, up: np.ndarray, j: dict) -> tuple[np.ndarray, float]:
    """Posterior tilt that keeps the scapula gliding on the thorax.

    Upward rotation about the AC joint swings the inferior angle laterally along the scapular plane, off the
    curved chest wall (winging). The scapula is tilted posteriorly about its spine axis until the inferior
    angle is back at its rest clearance from the thoracic cage; the tilt is solved, not prescribed, and
    capped at the end-range value of 3D kinematic studies (~30°), beyond which some lift-off remains.
    """
    ia = np.r_[j["inferiorAngle"], 1.0]
    target = thorax_clearance(ia[None, :3])[0]
    sign = tilt_sign(j)

    def make(t: float) -> np.ndarray:
        return clav @ about(j["ac"], rotation(j["spineAxis"], sign * t)) @ up

    def gap(t: float) -> float:
        return thorax_clearance((make(t) @ ia)[None, :3])[0] - target

    lo, hi = -10.0, MAX_POSTERIOR_TILT
    if gap(lo) <= 0:
        return make(lo), lo
    if gap(hi) >= 0:
        return make(hi), hi
    for _ in range(40):
        mid = (lo + hi) / 2
        if gap(mid) > 0:
            lo = mid
        else:
            hi = mid
    return make((lo + hi) / 2), (lo + hi) / 2


def bone_transforms(pose: dict, f: float, j: dict) -> list[np.ndarray]:
    """Rigid transforms (4x4, rest model space) of thorax, clavicle, scapula and humerus at fraction f."""
    clav = about(j["sc"], rotation([0, 1, 0], -pose["clavicle"]["retraction"] * f) @ rotation([0, 0, 1], -pose["clavicle"]["elevation"] * f))
    up = about(j["ac"], rotation(j["scapNormal"], -pose["scapula"]["upward"] * f))
    scap, tilt = scapulothoracic_contact(clav, up, j)
    SOLVED_TILT[(pose["id"], round(f, 4))] = tilt
    phi = np.radians(pose["plane"])
    target_dir = np.cos(phi) * np.array([-1.0, 0, 0]) + np.sin(phi) * np.array([0, 0, 1.0])
    down = -j["humAxis"]
    elev_axis = np.cross(down, target_dir)
    axial = about(j["gh"], rotation(j["humAxis"], -pose["external"] * f))
    rest_elev = elevation_of(np.eye(4), j)
    goal = rest_elev + (pose["elevation"] - rest_elev) * f

    def hum(e):
        return scap @ about(j["gh"], rotation(elev_axis, e)) @ axial

    lo, hi = -40.0, 200.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if elevation_of(hum(mid), j) < goal:
            lo = mid
        else:
            hi = mid
    return [np.eye(4), clav, scap, hum((lo + hi) / 2)]


# --------------------------------------------------------------------------------------------------
# 3. skinning weights (computed on the desktop meshes, transferred to mobile)
# --------------------------------------------------------------------------------------------------
def bone_samples():
    """Dense surface samples of every bone with its body index (for contacts and carriers)."""
    pts, lab = [], []
    gen = np.random.default_rng(3)
    for rec in MANIFEST["meshes"]:
        if rec["tissue"] not in ("bone", "cartilage"):
            continue
        pos, idx = raw_mesh("desktop", rec["name"])
        m = trimesh.Trimesh(pos, idx, process=False)
        n = int(m.area / (1.2 * MM) ** 2) + 50
        f = gen.choice(len(idx), n, p=m.area_faces / m.area_faces.sum())
        u, v = gen.random(n), gen.random(n)
        flip = u + v > 1
        u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
        a, b, c = pos[idx[f, 0]], pos[idx[f, 1]], pos[idx[f, 2]]
        pts.append(a + (b - a) * u[:, None] + (c - a) * v[:, None])
        lab.append(np.full(n, MOVING_BONES.get(rec["sourceName"], T)))
    return np.vstack(pts), np.concatenate(lab)


def harmonic_weights(pos: np.ndarray, idx: np.ndarray, constraints: dict[int, np.ndarray], default: int) -> np.ndarray:
    """Per-vertex weights over the 4 bodies: harmonic interpolation of the Dirichlet sets."""
    n = len(pos)
    w = np.zeros((n, 4))
    fixed = np.zeros(n, bool)
    for body, verts in constraints.items():
        fixed[verts] = True
    if not fixed.any():
        w[:, default] = 1
        return w
    lap = cotan_laplacian(pos, idx)
    free = np.nonzero(~fixed)[0]
    fix = np.nonzero(fixed)[0]
    # tiny pull towards the default body keeps components without constraints well-posed
    eps = 1e-6 * float(np.mean(np.abs(lap.diagonal())))
    lu = splu((lap[free][:, free] + identity(len(free)) * eps).tocsc())
    lfc = lap[free][:, fix]
    for body in range(4):
        values = np.zeros(len(fix))
        if body in constraints:
            values = np.isin(fix, constraints[body]).astype(float)
        if not values.any() and body != default:
            continue
        rhs = -lfc @ values + (eps if body == default else 0.0)
        w[fix, body] = values
        w[free, body] = lu.solve(rhs)
    w = np.clip(w, 0, None)
    return w / np.maximum(w.sum(1, keepdims=True), 1e-12)


def muscle_weights(source: str, origins: tuple[int, ...], insertion: int, bone_tree, bone_lab):
    pos, idx = by_source("desktop", source)
    wpos, widx, inverse = weld(pos, idx)
    d, j = bone_tree.query(wpos)
    nearest_body = bone_lab[j]
    contact_mm = d / MM
    constraints: dict[int, np.ndarray] = {}
    for body in set(origins) | {insertion}:
        for r in (3.0, 5.0, 8.0):
            verts = np.nonzero((nearest_body == body) & (contact_mm < r))[0]
            if len(verts) >= 6:
                break
        if len(verts):
            constraints[body] = verts
    if insertion not in constraints or not any(o in constraints for o in origins):
        # an end that touches no modelled bone (e.g. trapezius from the neck): use the far end
        known = insertion if insertion in constraints else next((o for o in origins if o in constraints), None)
        if known is not None:
            far = np.linalg.norm(wpos - wpos[constraints[known]].mean(0), axis=1)
            missing = insertion if insertion not in constraints else origins[0]
            constraints[missing] = np.nonzero(far >= np.quantile(far, 0.93))[0]
    if source == "Left latissimus dorsi":
        # vertebral origin via the thoracolumbar fascia: the medial strip of the muscle
        strip = np.nonzero(wpos[:, 0] > wpos[:, 0].max() - 14 * MM)[0]
        constraints[T] = np.union1d(constraints.get(T, np.zeros(0, int)), strip)
    w = harmonic_weights(wpos, widx, constraints, origins[0])
    return w[inverse], {BONES[b]: int(len(v)) for b, v in constraints.items()}


class FollowerField:
    """Smooths per-vertex quantities over all the followers (vessels, nerves, nodes, fasciae) of a variant.

    Values are averaged per 4 mm voxel, blurred with a Gaussian over the neighbouring voxels within 16 mm,
    whatever structure they belong to, read back at each vertex and smoothed along its own mesh. Whole
    cross-sections of a vessel and both sides of a branch junction therefore move together: tubes do not
    open into ribbons (their two sides borrowing weights from different muscles) and branches stay on their
    parent vessel.
    """

    def __init__(self, variant: str, names: list[str], radius_mm: float = 16.0, voxel_mm: float = 4.0, iters: int = 10):
        self.slices, pts, start = {}, [], 0
        for name in names:
            p = raw_mesh(variant, name)[0]
            self.slices[name] = (start, len(p))
            start += len(p)
            pts.append(p)
        pts = np.vstack(pts)
        _, inv, counts = np.unique(np.floor(pts / (voxel_mm * MM)).astype(np.int64), axis=0, return_inverse=True, return_counts=True)
        self.inv = inv.ravel()
        na = len(counts)
        self.mean = diags(1 / counts) @ coo_matrix((np.ones(len(pts)), (self.inv, np.arange(len(pts)))), shape=(na, len(pts))).tocsr()
        anchors = self.mean @ pts
        tree = cKDTree(anchors)
        dist = tree.sparse_distance_matrix(tree, radius_mm * MM, output_type="coo_matrix")
        off = dist.row != dist.col
        sigma = 0.5 * radius_mm * MM
        g = coo_matrix(
            (np.r_[np.exp(-(dist.data[off] ** 2) / (2 * sigma**2)) * counts[dist.col[off]], counts.astype(float)], (np.r_[dist.row[off], np.arange(na)], np.r_[dist.col[off], np.arange(na)])),
            shape=(na, na),
        ).tocsr()
        self.blur = diags(1 / np.asarray(g.sum(1)).ravel()) @ g
        self.meshes = {}
        for name in names:
            pos, idx = raw_mesh(variant, name)
            wpos, widx, winv = weld(pos, idx)
            self.meshes[name] = (adjacency(len(wpos), widx), winv, np.bincount(winv, minlength=len(wpos)).astype(float))
        self.iters = iters

    def __call__(self, values: np.ndarray) -> np.ndarray:
        """values: stacked per-vertex rows of every follower (in construction order)."""
        blurred = (self.blur @ (self.mean @ values))[self.inv]
        out = np.empty_like(blurred)
        for name, (a, n) in self.slices.items():
            adj, winv, count = self.meshes[name]
            v = np.zeros((len(count), values.shape[1]))
            np.add.at(v, winv, blurred[a:a + n])
            v /= count[:, None]
            for _ in range(self.iters):
                v = 0.5 * v + 0.5 * (adj @ v)
            out[a:a + n] = v[winv]
        return out

    def split(self, values: np.ndarray) -> dict[str, np.ndarray]:
        return {name: values[a:a + n] for name, (a, n) in self.slices.items()}


def follower_names() -> list[str]:
    return [rec["name"] for rec in MANIFEST["meshes"] if rec["tissue"] in FOLLOWER_TISSUES and not rec["sourceName"].startswith("Right")]


def follower_weights(names: list[str], carrier_tree, carrier_w) -> dict[str, np.ndarray]:
    """Weights of the nearest muscles and bones (inverse square, k = 12 within 40 mm), then smoothed over all followers."""
    raw = []
    for name in names:
        pos = raw_mesh("desktop", name)[0]  # by mesh name: several meshes share a source name
        d, j = carrier_tree.query(pos, k=12, distance_upper_bound=40 * MM)
        ok = np.isfinite(d)
        inv = np.where(ok, 1 / np.maximum(d, 0.5 * MM) ** 2, 0)
        w = (inv[..., None] * carrier_w[np.where(ok, j, 0)]).sum(1)
        w[w.sum(1) < 1e-12, T] = 1
        raw.append(w / w.sum(1, keepdims=True))
    field = FollowerField("desktop", names)
    smoothed = field(np.vstack(raw))
    return field.split(smoothed / smoothed.sum(1, keepdims=True))


class MuscleCorrections:
    """Carries the muscle corrections (fibre chords, volume, sliding, collisions) over to the followers.

    Followers are skinned with weights borrowed from the nearby muscles; the corrections applied to those
    muscles after skinning must reach them too, or a nerve on the deep surface of the pectoralis major would
    stay behind on the skinning arc while the muscle straightens. Interpolated from the nearest muscle
    vertices (full within 10 mm, none beyond 25 mm) and smoothed like the weights (FollowerField).
    """

    def __init__(self, variant: str, names: list[str]):
        self.offsets, start, rest = {}, 0, []
        for source in MUSCLES:
            name = BY_SOURCE[source]["name"]
            pos = raw_mesh(variant, name)[0]
            self.offsets[name] = (start, len(pos))
            start += len(pos)
            rest.append(pos)
        self.delta = np.zeros((start, 3))
        tree = cKDTree(np.vstack(rest))
        self.field = FollowerField(variant, names)
        pts = np.vstack([raw_mesh(variant, name)[0] for name in names])
        d, j = tree.query(pts, k=8, distance_upper_bound=25 * MM)
        ok = np.isfinite(d)
        w = np.where(ok, 1 / np.maximum(d, 0.5 * MM) ** 2, 0)
        near = np.where(ok[:, 0], d[:, 0], np.inf)
        fade = np.clip((25 * MM - near) / (15 * MM), 0, 1)
        self.j = np.where(ok, j, 0)
        self.w = w / np.maximum(w.sum(1, keepdims=True), 1e-12) * fade[:, None]
        self.frame: dict[str, np.ndarray] | None = None

    def record(self, name: str, skinned: np.ndarray, final: np.ndarray) -> None:
        if name in self.offsets:
            a, n = self.offsets[name]
            self.delta[a:a + n] = final - skinned
            self.frame = None  # muscles changed: recompute the follower field on next use

    def apply(self, name: str, skinned: np.ndarray) -> np.ndarray:
        if name not in self.field.slices:
            return skinned
        if self.frame is None:
            self.frame = self.field.split(self.field((self.delta[self.j] * self.w[..., None]).sum(1)))
        return skinned + self.frame[name]


def compute_weights() -> dict[str, np.ndarray]:
    bpts, blab = bone_samples()
    btree = cKDTree(bpts)
    weights: dict[str, np.ndarray] = {}
    report = {}
    for rec in MANIFEST["meshes"]:
        n = len(raw_mesh("desktop", rec["name"])[0])
        if rec["tissue"] in ("bone", "cartilage"):
            w = np.zeros((n, 4))
            w[:, MOVING_BONES.get(rec["sourceName"], T)] = 1
            weights[rec["name"]] = w
    for source, (origins, insertion) in MUSCLES.items():
        w, info = muscle_weights(source, origins, insertion, btree, blab)
        weights[BY_SOURCE[source]["name"]] = w
        report[source] = info
    # carriers: muscles (weighted) and bones
    cpts = [bpts]
    cw = [np.eye(4)[blab]]
    for source in MUSCLES:
        name = BY_SOURCE[source]["name"]
        cpts.append(raw_mesh("desktop", name)[0])
        cw.append(weights[name])
    ctree = cKDTree(np.vstack(cpts))
    cwa = np.vstack(cw)
    weights.update(follower_weights(follower_names(), ctree, cwa))
    for rec in MANIFEST["meshes"]:
        if rec["name"] in weights:
            continue
        w = np.zeros((len(raw_mesh("desktop", rec["name"])[0]), 4))
        w[:, T] = 1  # trunk skin, breast, thoracic wall, contralateral side
        weights[rec["name"]] = w
    return weights, report


def transfer(name: str, desktop_w: np.ndarray) -> np.ndarray:
    src = raw_mesh("desktop", name)[0]
    dst = raw_mesh("mobile", name)[0]
    _, j = cKDTree(src).query(dst, k=3)
    return desktop_w[j].mean(1)


# --------------------------------------------------------------------------------------------------
# 4. deformation
# --------------------------------------------------------------------------------------------------
def quat_from_matrix(r: np.ndarray) -> np.ndarray:
    tr = np.trace(r)
    if tr > 0:
        s = np.sqrt(tr + 1.0) * 2
        q = np.array([0.25 * s, (r[2, 1] - r[1, 2]) / s, (r[0, 2] - r[2, 0]) / s, (r[1, 0] - r[0, 1]) / s])
    else:
        i = int(np.argmax(np.diag(r)))
        jn, kn = (i + 1) % 3, (i + 2) % 3
        s = np.sqrt(1.0 + r[i, i] - r[jn, jn] - r[kn, kn]) * 2
        q = np.zeros(4)
        q[0] = (r[kn, jn] - r[jn, kn]) / s
        q[1 + i] = 0.25 * s
        q[1 + jn] = (r[jn, i] + r[i, jn]) / s
        q[1 + kn] = (r[kn, i] + r[i, kn]) / s
    return q if q[0] >= 0 else -q


def qmul(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    w1, x1, y1, z1 = np.moveaxis(a, -1, 0)
    w2, x2, y2, z2 = np.moveaxis(b, -1, 0)
    return np.stack([w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2, w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2], -1)


def dual_quaternions(mats: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    qr = np.array([quat_from_matrix(m[:3, :3]) for m in mats])
    t = np.array([np.r_[0, m[:3, 3]] for m in mats])
    qd = 0.5 * qmul(t, qr)
    return qr, qd


def rotate(q: np.ndarray, v: np.ndarray) -> np.ndarray:
    u = q[:, 1:]
    w = q[:, :1]
    t = 2 * np.cross(u, v)
    return v + w * t + np.cross(u, t)


def dqs(points: np.ndarray, normals: np.ndarray | None, w: np.ndarray, qr: np.ndarray, qd: np.ndarray):
    br = w @ qr
    bd = w @ qd
    n = np.linalg.norm(br, axis=1, keepdims=True)
    br /= n
    bd /= n
    conj = br * np.array([1, -1, -1, -1])
    trans = 2 * qmul(bd, conj)[:, 1:]
    moved = rotate(br, points) + trans
    return moved, (rotate(br, normals) if normals is not None else None)


_fibres: dict[tuple[str, str], dict | None] = {}


def fibre_fields(key: tuple[str, str], pos: np.ndarray, idx: np.ndarray, u: np.ndarray) -> dict | None:
    """Soft fibre end points of every vertex of a muscle (u: harmonic coordinate, 0 origin -> 1 insertion).

    O(x) and I(x) are harmonic extensions over the muscle surface of the attachment positions (Dirichlet on
    the origin, respectively insertion, vertices; free elsewhere): where the fibres through x come from and
    go to, averaged as a random walk on the surface would reach them. They are smooth by construction, so the
    chord correction cannot tear the mesh where discrete fibre paths would branch. s is the fraction of the
    way from O to I. The factorisations are kept to extend the posed attachments of every keyframe.
    """
    if key in _fibres:
        return _fibres[key]
    wpos, widx, inverse = weld(pos, idx)
    n = len(wpos)
    uw = np.zeros(n)
    uw[inverse] = u
    rep = np.zeros(n, np.int64)
    rep[inverse] = np.arange(len(pos))
    lap = cotan_laplacian(wpos, widx)
    eps = 1e-6 * float(np.mean(np.abs(lap.diagonal())))
    solvers = {}
    for end, fixed in (("o", uw < 0.02), ("i", uw > 0.98)):
        fix, free = np.nonzero(fixed)[0], np.nonzero(~fixed)[0]
        if len(fix) < 3 or not len(free):
            _fibres[key] = None
            return None
        solvers[end] = (fix, free, splu((lap[free][:, free] + identity(len(free)) * eps).tocsc()), lap[free][:, fix])

    def extend(end: str, values: np.ndarray) -> np.ndarray:
        """Harmonic extension of `values` (welded vertices) from the attachment; the tiny regulariser pulls
        vertices that cannot reach the attachment towards their own value."""
        fix, free, lu, lfc = solvers[end]
        out = values.astype(float).copy()
        out[free] = lu.solve(-(lfc @ values[fix]) + eps * values[free])
        return out

    reach = np.minimum(extend("o", np.ones((n, 1)) * (uw < 0.02)[:, None]), extend("i", np.ones((n, 1)) * (uw > 0.98)[:, None]))[:, 0]
    o_rest, i_rest = extend("o", wpos), extend("i", wpos)
    to_o, to_i = np.linalg.norm(wpos - o_rest, axis=1), np.linalg.norm(wpos - i_rest, axis=1)
    s = to_o / np.maximum(to_o + to_i, 1e-12)
    info = {"rep": rep, "inverse": inverse, "extend": extend, "o": o_rest, "i": i_rest, "s": s, "valid": np.clip((reach - 0.3) / 0.4, 0, 1)}
    _fibres[key] = info
    return info


def chord_correct(pos, posed, w, qr, info, strength: float, origins: tuple[int, ...], insertion: int):
    """Straighten the free span of a stretched muscle between its posed attachments.

    A vertex x at fraction s between its soft fibre ends O and I goes to lerp(O', I', s) + R(s) (x - lerp(O, I, s)):
    the fibre is stretched along the straight line between the moved attachments and x keeps its rest offset
    from that line, rotated by the interpolated rotation of the two ends. Blended in where the fibre lengthens;
    fibres that shorten keep the skinning (they bulge and wrap around the joint instead).
    """
    rep, extend = info["rep"], info["extend"]
    rest, moved = pos[rep], posed[rep]
    o_pose, i_pose = extend("o", moved), extend("i", moved)
    w_o = w[rep][:, list(origins)] + 1e-6
    q_o = (w_o / w_o.sum(1, keepdims=True)) @ qr[list(origins)]
    q_o /= np.linalg.norm(q_o, axis=1, keepdims=True)
    q_i = np.broadcast_to(qr[insertion], q_o.shape)
    q_i = np.where(((q_o * q_i).sum(1) < 0)[:, None], -q_i, q_i)
    s = info["s"][:, None]
    q = (1 - s) * q_o + s * q_i
    q /= np.maximum(np.linalg.norm(q, axis=1, keepdims=True), 1e-12)
    chord = (1 - s) * o_pose + s * i_pose + rotate(q, rest - ((1 - s) * info["o"] + s * info["i"]))
    stretch = np.linalg.norm(i_pose - o_pose, axis=1) / np.maximum(np.linalg.norm(info["i"] - info["o"], axis=1), 1e-9)
    alpha = strength * np.clip((stretch - 1.0) / 0.1, 0, 1) * info["valid"]
    out = moved + alpha[:, None] * (chord - moved)
    return out[info["inverse"]]


def muscle_volume(pos, idx, posed, posed_normals, w, origins, insertion):
    """Thicken shortened bellies and thin stretched ones (cross-section ~ 1/sqrt(stretch))."""
    u = w[:, insertion]
    if insertion in origins:
        return posed, 1.0
    o_sel, i_sel = u < 0.12, u > 0.88
    if o_sel.sum() < 3 or i_sel.sum() < 3:
        return posed, 1.0
    rest_len = np.linalg.norm(pos[i_sel].mean(0) - pos[o_sel].mean(0))
    posed_len = np.linalg.norm(posed[i_sel].mean(0) - posed[o_sel].mean(0))
    stretch = posed_len / max(rest_len, 1e-9)
    scale = float(np.clip(stretch**-0.5, 0.75, 1.35))
    if abs(scale - 1) < 0.01:
        return posed, stretch
    thickness = muscle_thickness(pos, idx)
    profile = np.sin(np.pi * np.clip(u, 0, 1))
    offset = (scale - 1) * 0.5 * thickness * profile
    return posed + posed_normals * offset[:, None], stretch


_thickness_cache: dict[int, np.ndarray] = {}


def muscle_thickness(pos: np.ndarray, idx: np.ndarray) -> np.ndarray:
    """Distance from each vertex to the opposite face of the muscle along the inward normal.

    Probes points at increasing depths under the vertex and keeps the nearest opposite-facing vertex
    that lies close to the inward ray (memory-light alternative to ray casting on 100k-vertex meshes).
    """
    key = id(pos)
    if key in _thickness_cache:
        return _thickness_cache[key]
    mesh = trimesh.Trimesh(pos, idx, process=False)
    sign = 1.0 if mesh.volume >= 0 else -1.0
    normals = vertex_normals(pos, idx) * sign
    tree = cKDTree(pos)
    thickness = np.full(len(pos), np.inf)
    for depth in (1.0, 2.0, 3.5, 5.5, 8.0, 11.0, 15.0, 20.0, 26.0):
        probe = pos - normals * depth * MM
        _, j = tree.query(probe, k=4)
        for c in range(4):
            cand = j[:, c]
            rel = pos[cand] - pos
            along = -(rel * normals).sum(1)
            radial = np.linalg.norm(rel + normals * along[:, None], axis=1)
            ok = ((normals[cand] * normals).sum(1) < -0.2) & (along > 0.2 * MM) & (radial < np.maximum(2.0 * MM, 0.4 * along))
            thickness = np.where(ok & (along < thickness), along, thickness)
    thickness[~np.isfinite(thickness)] = 0
    thickness = np.clip(thickness, 0, 30 * MM)
    _thickness_cache[key] = thickness
    return thickness


_rest_clearance: dict[tuple[str, str], np.ndarray] = {}


def thorax_layering(key: tuple[str, str], rest: np.ndarray, posed: np.ndarray, sel: np.ndarray, band_mm: float = 30.0, keep: float = 0.85):
    """Soft tissue near the chest wall slides over it instead of sinking in.

    Skinning moves tissue in straight lines while the scapula and the arm swing around the curved thorax.
    A vertex that lay outside the thoracic envelope, within band_mm of it, keeps at least `keep` of its rest
    clearance: it is pushed back along the facet normal (so muscle layers keep their order and thickness).
    """
    if key not in _rest_clearance:
        _rest_clearance[key] = thorax_clearance(rest)
    d0 = _rest_clearance[key][sel]
    d1, normal = thorax_clearance(posed[sel], with_normals=True)
    target = keep * d0
    fix = (d0 > 0) & (d0 < band_mm * MM) & (d1 < target)
    out = posed.copy()
    rows = sel[fix]
    out[rows] += normal[fix] * (target - d1)[fix, None]
    return out, int(fix.sum())


class BoneColliders:
    def __init__(self, variant: str):
        self.items = []
        for rec in MANIFEST["meshes"]:
            if rec["tissue"] != "bone" or rec["sourceName"].startswith("Right"):
                continue
            body = MOVING_BONES.get(rec["sourceName"], T)
            if body == T and not any(k in rec["sourceName"] for k in ("rib", "sternum", "Manubrium", "Xiphoid")):
                continue
            pos, idx = raw_mesh(variant, rec["name"])
            mesh = trimesh.Trimesh(pos, idx, process=True)
            sign = 1.0 if mesh.volume >= 0 else -1.0  # outward normals after the global reflection
            self.items.append((body, mesh, trimesh.proximity.ProximityQuery(mesh), mesh.bounds, sign))

    def push_out(self, points: np.ndarray, mats: list[np.ndarray], clearance_mm: float = 0.6) -> tuple[np.ndarray, int]:
        out = points.copy()
        moved = 0
        for body, mesh, query, bounds, sign in self.items:
            m = mats[body]
            inv = np.linalg.inv(m)
            local = out @ inv[:3, :3].T + inv[:3, 3]
            near = np.all((local > bounds[0] - 2 * MM) & (local < bounds[1] + 2 * MM), axis=1)
            if not near.any():
                continue
            sel = np.nonzero(near)[0]
            closest, _, tri = query.on_surface(local[sel])
            normal = mesh.face_normals[tri] * sign
            inside = ((local[sel] - closest) * normal).sum(1) < 0
            if not inside.any():
                continue
            fix = sel[inside]
            fixed_local = closest[inside] + normal[inside] * clearance_mm * MM
            out[fix] = fixed_local @ m[:3, :3].T + m[:3, 3]
            moved += int(inside.sum())
        return out, moved


# --------------------------------------------------------------------------------------------------
# 5. output
# --------------------------------------------------------------------------------------------------
def main() -> None:
    j = joints()
    print(f"GH centre {np.round(j['gh'], 4)} (head radius {j['ghRadiusMm']:.1f} mm)")
    frames = {pose["id"]: [bone_transforms(pose, (k + 1) / KEYFRAMES, j) for k in range(KEYFRAMES)] for pose in POSES}
    for pose in POSES:
        final = frames[pose["id"]][-1]
        print(f"{pose['id']}: humeral elevation {elevation_of(final[H], j):.1f} deg, scapular posterior tilt {SOLVED_TILT[(pose['id'], 1.0)]:.1f} deg")

    print("skinning weights …")
    weights, report = compute_weights()
    for source, info in report.items():
        print(f"  {source}: {info}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    meta_variants = {}
    stretch_report = {}
    for variant in VARIANTS:
        colliders = BoneColliders(variant)
        candidates = {}
        for rec in MANIFEST["meshes"]:
            w = weights[rec["name"]] if variant == "desktop" else transfer(rec["name"], weights[rec["name"]])
            sel = np.nonzero(w[:, T] < 1 - 1e-4)[0]
            if len(sel):
                candidates[rec["name"]] = (sel, w)
        posed_all = {pose["id"]: {} for pose in POSES}
        pushed = slid = 0
        corrections = MuscleCorrections(variant, follower_names())
        # muscles first: their corrections after skinning are carried over to the vessels, nerves and fasciae
        order = sorted(candidates, key=lambda n: BY_NAME[n]["sourceName"] not in MUSCLES)
        for pose in POSES:
            for k, mats in enumerate(frames[pose["id"]]):
                qr, qd = dual_quaternions(mats)
                for name in order:
                    sel, w = candidates[name]
                    rec = BY_NAME[name]
                    pos, idx = raw_mesh(variant, name)
                    posed, posed_n = dqs(pos, vertex_normals(pos, idx), w, qr, qd)
                    skinned = posed
                    source = rec["sourceName"]
                    if rec["tissue"] in FOLLOWER_TISSUES:
                        posed = corrections.apply(name, posed)
                    if source in MUSCLES:
                        origins, insertion = MUSCLES[source]
                        fibres = fibre_fields((variant, name), pos, idx, w[:, insertion]) if source in CHORD_MUSCLES else None
                        if fibres is not None:
                            posed = chord_correct(pos, posed, w, qr, fibres, CHORD_MUSCLES[source], origins, insertion)
                            posed_n = vertex_normals(posed, idx)
                        if source not in STRETCH_UNRELIABLE:
                            posed, stretch = muscle_volume(pos, idx, posed, posed_n, w, origins, insertion)
                            if k == KEYFRAMES - 1 and variant == "desktop":
                                stretch_report.setdefault(pose["id"], {})[source] = round(float(stretch), 3)
                    if rec["tissue"] not in ("bone", "cartilage"):
                        posed, n_slid = thorax_layering((variant, name), pos, posed, sel)
                        slid += n_slid
                        posed[sel], n_pushed = colliders.push_out(posed[sel], mats)
                        pushed += n_pushed
                    corrections.record(name, skinned, posed)
                    posed_all[pose["id"]].setdefault(name, []).append(np.clip(np.round((posed[sel] - pos[sel]) / (STEP_MM * MM)), -32767, 32767).astype(np.int16))
            print(f"  [{variant}] {pose['id']} posed")
        print(f"  [{variant}] thoracic sliding: {slid} · bone push-outs: {pushed}")
        # keep the vertices that move by at least 2 quanta in some pose/keyframe
        index_chunks, mesh_table, keep_masks = [], [], {}
        cursor = 0
        for name, (sel, _) in candidates.items():
            amount = np.zeros(len(sel))
            for pose in POSES:
                for d in posed_all[pose["id"]][name]:
                    amount = np.maximum(amount, np.abs(d.astype(np.int32)).max(1))
            keep = amount >= 2
            if not keep.any():
                continue
            keep_masks[name] = keep
            index_chunks.append(sel[keep].astype(np.uint32))
            mesh_table.append({"name": name, "offset": cursor, "count": int(keep.sum())})
            cursor += int(keep.sum())
        np.concatenate(index_chunks).tofile(OUT_DIR / f"{variant}-index.bin")
        print(f"[{variant}] {len(mesh_table)} meshes, {cursor} moving vertices")
        files = {}
        for pose in POSES:
            deltas = np.zeros((KEYFRAMES, cursor, 3), np.int16)
            for entry in mesh_table:
                keep = keep_masks[entry["name"]]
                for k, d in enumerate(posed_all[pose["id"]][entry["name"]]):
                    deltas[k, entry["offset"]: entry["offset"] + entry["count"]] = d[keep]
            path = OUT_DIR / f"{variant}-{pose['id']}.bin"
            deltas.tofile(path)
            files[pose["id"]] = {"file": f"models/hybrid/poses/{path.name}", "bytes": path.stat().st_size}
            print(f"  {variant} {pose['id']}: {path.stat().st_size / 1e6:.2f} MB")
        meta_variants[variant] = {"index": f"models/hybrid/poses/{variant}-index.bin", "meshes": mesh_table, "vertices": cursor, "poses": files}

    overlays = overlay_offsets(meta_variants["desktop"])

    data = {
        "version": 1,
        "keyframes": KEYFRAMES,
        "stepMm": STEP_MM,
        "bones": BONES,
        "joints": {k: [round(float(c), 5) for c in v] for k, v in j.items() if isinstance(v, np.ndarray)},
        "ghRadiusMm": round(j["ghRadiusMm"], 1),
        "poses": [
            {**{k: v for k, v in pose.items()}, "scapula": {**pose["scapula"], "tilt": round(SOLVED_TILT[(pose["id"], 1.0)], 1)},
             "frames": [[np.round(m, 6).tolist() for m in mats] for mats in frames[pose["id"]]],
             "humeralElevation": round(elevation_of(frames[pose["id"]][-1][H], j), 1), "muscleStretch": stretch_report.get(pose["id"], {})}
            for pose in POSES
        ],
        "variants": meta_variants,
        **overlays,
    }
    OUT_JSON.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"wrote {OUT_JSON.relative_to(ROOT)} ({OUT_JSON.stat().st_size / 1e3:.0f} kB)")


def overlay_offsets(desktop: dict) -> dict:
    """Displacement of the overlays that lie on muscles: fibre polylines and hila (anatomy layers).

    Read back from the desktop pose deltas, so the overlays follow the muscles as finally deformed (chords,
    volume, sliding), not merely skinned: each point takes the mean displacement of its 4 nearest muscle
    vertices. Fibres: int16 deltas (STEP_MM) per pose, final keyframe; hila: offsets in the JSON.
    """
    index = np.fromfile(OUT_DIR / "desktop-index.bin", np.uint32)
    table = {m["name"]: m for m in desktop["meshes"]}
    names = [BY_SOURCE[source]["name"] for source in MUSCLES]
    rest = [raw_mesh("desktop", name)[0] for name in names]
    tree = cKDTree(np.vstack(rest))
    layer_bin = (ROOT / "public" / LAYERS["bin"]).read_bytes()
    q = LAYERS["quantization"]
    lay = LAYERS["layout"]["positions"]
    qpos = np.frombuffer(layer_bin, np.uint16, lay["length"], lay["byteOffset"]).reshape(-1, 3)
    first = min(f["positions"][0] for f in LAYERS["fibres"])
    last = max(f["positions"][0] + f["positions"][1] for f in LAYERS["fibres"])
    fibre_points = (qpos * np.array(q["step"]) + np.array(q["min"]))[first:last]
    hila = [item for item in LAYERS["landmarks"] if item["category"] == "hilo"]
    _, near_fibre = tree.query(fibre_points, k=4)
    _, near_hila = tree.query(np.array([item["point"] for item in hila]), k=4)
    files, hila_offsets = {}, {}
    for pose in POSES:
        final = np.fromfile(OUT_DIR / f"desktop-{pose['id']}.bin", np.int16).reshape(KEYFRAMES, desktop["vertices"], 3)[-1]
        disp = np.zeros((sum(len(r) for r in rest), 3))
        start = 0
        for name, r in zip(names, rest):
            if name in table:
                m = table[name]
                disp[start + index[m["offset"]: m["offset"] + m["count"]]] = final[m["offset"]: m["offset"] + m["count"]] * STEP_MM * MM
            start += len(r)
        fibre = np.clip(np.round(disp[near_fibre].mean(1) / (STEP_MM * MM)), -32767, 32767).astype(np.int16)
        path = OUT_DIR / f"fibres-{pose['id']}.bin"
        fibre.tofile(path)
        files[pose["id"]] = f"models/hybrid/poses/{path.name}"
        hila_offsets[pose["id"]] = {item["id"]: [round(float(v), 5) for v in d] for item, d in zip(hila, disp[near_hila].mean(1))}
    stale = OUT_DIR / "fibre-weights.bin"
    if stale.exists():
        stale.unlink()
    return {"fibres": {"first": int(first), "count": int(last - first), "poses": files}, "hilaOffsets": hila_offsets}


def refresh_overlays() -> None:
    """--overlays: recompute only the overlay offsets from the pose files already written."""
    data = json.loads(OUT_JSON.read_text())
    data.pop("fibreWeights", None)
    data.pop("landmarkWeights", None)
    data.update(overlay_offsets(data["variants"]["desktop"]))
    OUT_JSON.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"wrote {OUT_JSON.relative_to(ROOT)} ({OUT_JSON.stat().st_size / 1e3:.0f} kB) and fibre offsets")


if __name__ == "__main__":
    refresh_overlays() if "--overlays" in sys.argv else main()
