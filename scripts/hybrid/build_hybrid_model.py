"""Builds the hybrid female torso model used by the viewer.

Sources (all real, segmented anatomy — nothing is procedurally modelled):
  * HRA / NIH Visible Human Female: skin envelope and both mammary glands
    (adipose body, lobes, lactiferous ducts and sinuses, suspensory ligaments,
    nipple, areola, areolar tubercles).
  * BodyParts3D 4.3 (DBCLS): chest-wall skeleton, muscles, and every named
    vessel and nerve of the axilla / chest wall / proximal arm.
  * BodyParts3D 3.0 (DBCLS): latissimus dorsi (absent from 4.x).
  * Z-Anatomy: axillary lymph-node groups, pectoral / clavipectoral /
    thoracolumbar fasciae and the lateral pectoral nerve (absent from BP3D).

Anatomical references are preserved as follows:
  * All BodyParts3D meshes stay in their native, mutually consistent frame;
    they are never scaled, warped or re-shaped.
  * Z-Anatomy meshes are brought into that frame with one similarity
    transform estimated from shared muscles (RMS ~2 mm).
  * The HRA skin and breasts are placed with one rigid transform at true scale
    (skin-to-skin ICP on the torso). The only shape change in the whole model
    is a depth-wise compression of the posterior breast base so it rests on the
    male chest wall (front surface, nipple and areola are kept fixed); its
    magnitude is recorded in the manifest.
  * The operative side is modelled on the source LEFT side, where BodyParts3D
    4.3 contains the complete brachial plexus branches (thoracodorsal, long
    thoracic, pectoral, intercostobrachial nerves). The whole assembly is then
    reflected as one rigid body so it is presented as the RIGHT side used by
    the surgical atlas. A global reflection keeps every spatial relationship.

Usage: python3 scripts/hybrid/build_hybrid_model.py
Sources are expected under assets/source/hybrid/ (see scripts/hybrid/README.md).
"""

from __future__ import annotations

import json
import re
import struct
import sys
from pathlib import Path

import fast_simplification
import numpy as np
import trimesh
from scipy.ndimage import gaussian_filter, map_coordinates
from scipy.spatial import cKDTree

sys.path.insert(0, str(Path(__file__).parent))
from meshio_utils import apply, dump_json, icp, load_glb_meshes, load_obj, load_stl, load_za, sample_surface, weld  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "assets" / "source" / "hybrid"
OUT_GLB = ROOT / "assets" / "build" / "hybrid-torso.raw.glb"
OUT_MANIFEST = ROOT / "src" / "data" / "hybridTorsoManifest.json"

# Old viewer frame (Z-Anatomy torso GLB): p_view = OLD_SCALE * (p_zanatomy - OLD_CENTER).
# Kept so existing camera presets, annotations and step choreography stay valid.
OLD_SCALE = 0.0648752226872084
OLD_CENTER = np.array([-4.86960125, 125.10400009, 3.418293])

LICENSES = {
    "HRA": "CC BY 4.0",
    "BodyParts3D 4.3": "CC BY-SA 2.1 JP (DBCLS); official archive now lists CC BY 4.0",
    "BodyParts3D 3.0": "CC BY-SA 2.1 JP (DBCLS); official archive now lists CC BY 4.0",
    "Z-Anatomy": "CC BY-SA 4.0",
}

# --------------------------------------------------------------------------------------
# Structure catalogue: id -> (label, tissue default, default visible)
# --------------------------------------------------------------------------------------
STRUCTURES: dict[str, dict] = {
    "skin": {"label": "Pele (HRA feminino)", "group": "Superfície", "visible": True},
    "breast": {"label": "Glândula mamária: lobos, ductos e seios", "group": "Mama", "visible": True},
    "breast-fat": {"label": "Tecido adiposo mamário", "group": "Mama", "visible": True},
    "breast-ligaments": {"label": "Ligamentos suspensores (Cooper)", "group": "Mama", "visible": False},
    "nipple-areola": {"label": "Mamilo, aréola e tubérculos", "group": "Mama", "visible": True},
    "contralateral-breast": {"label": "Mama contralateral", "group": "Mama", "visible": True},
    "latissimus-dorsi": {"label": "Músculo grande dorsal", "group": "Músculos", "visible": True},
    "serratus-anterior": {"label": "Serrátil anterior", "group": "Músculos", "visible": False},
    "pectoralis-major": {"label": "Peitoral maior", "group": "Músculos", "visible": False},
    "pectoralis-minor": {"label": "Peitoral menor", "group": "Músculos", "visible": False},
    "subclavius": {"label": "Subclávio", "group": "Músculos", "visible": False},
    "trapezius": {"label": "Trapézio", "group": "Músculos", "visible": False},
    "rhomboids": {"label": "Romboides", "group": "Músculos", "visible": False},
    "levator-scapulae": {"label": "Levantador da escápula", "group": "Músculos", "visible": False},
    "teres-major": {"label": "Redondo maior", "group": "Músculos", "visible": False},
    "teres-minor": {"label": "Redondo menor", "group": "Músculos", "visible": False},
    "subscapularis": {"label": "Subescapular", "group": "Músculos", "visible": False},
    "infraspinatus": {"label": "Infraespinhal", "group": "Músculos", "visible": False},
    "supraspinatus": {"label": "Supraespinhal", "group": "Músculos", "visible": False},
    "deltoid": {"label": "Deltoide", "group": "Músculos", "visible": False},
    "coracobrachialis-biceps": {"label": "Coracobraquial e bíceps", "group": "Músculos", "visible": False},
    "triceps": {"label": "Tríceps braquial", "group": "Músculos", "visible": False},
    "external-oblique": {"label": "Oblíquo externo", "group": "Músculos", "visible": False},
    "serratus-posterior": {"label": "Serráteis posteriores", "group": "Músculos", "visible": False},
    "intercostal-muscles": {"label": "Músculos intercostais", "group": "Músculos", "visible": False},
    "contralateral-pectoral": {"label": "Peitorais contralaterais", "group": "Músculos", "visible": False},
    "pectoral-fascia": {"label": "Fáscias peitoral e clavipeitoral", "group": "Fáscias", "visible": False},
    "thoracolumbar-fascia": {"label": "Fáscia toracolombar", "group": "Fáscias", "visible": False},
    "deltoid-fascia": {"label": "Fáscia deltoidea", "group": "Fáscias", "visible": False},
    "axillary-vessels": {"label": "Artéria e veia axilares", "group": "Vasos", "visible": False},
    "subclavian-vessels": {"label": "Artéria e veia subclávias", "group": "Vasos", "visible": False},
    "thoracoacromial-vessels": {"label": "Artéria toracoacromial e ramos", "group": "Vasos", "visible": False},
    "lateral-thoracic-vessels": {"label": "Vasos torácicos laterais", "group": "Vasos", "visible": False},
    "subscapular-vessels": {"label": "Vasos subescapulares e circunflexos da escápula", "group": "Vasos", "visible": False},
    "thoracodorsal-vessels": {"label": "Vasos toracodorsais (pedículo)", "group": "Vasos", "visible": True},
    "circumflex-humeral-vessels": {"label": "Vasos circunflexos do úmero", "group": "Vasos", "visible": False},
    "brachial-vessels": {"label": "Vasos braquiais, cefálica e basílica", "group": "Vasos", "visible": False},
    "internal-thoracic-vessels": {"label": "Vasos torácicos internos", "group": "Vasos", "visible": False},
    "intercostal-vessels": {"label": "Vasos intercostais", "group": "Vasos", "visible": False},
    "scapular-cervical-vessels": {"label": "Vasos supraescapulares e cervicais transversos", "group": "Vasos", "visible": False},
    "thoracodorsal-nerve": {"label": "Nervo toracodorsal", "group": "Nervos", "visible": True},
    "long-thoracic-nerve": {"label": "Nervo torácico longo", "group": "Nervos", "visible": False},
    "pectoral-nerves": {"label": "Nervos peitorais medial e lateral", "group": "Nervos", "visible": False},
    "intercostobrachial-nerve": {"label": "Nervo intercostobraquial", "group": "Nervos", "visible": False},
    "intercostal-nerves": {"label": "Nervos intercostais", "group": "Nervos", "visible": False},
    "brachial-plexus": {"label": "Plexo braquial (troncos, fascículos, ramos)", "group": "Nervos", "visible": False},
    "arm-nerves": {"label": "Nervos axilar, radial, mediano, ulnar e musculocutâneo", "group": "Nervos", "visible": False},
    "axillary-lymph-nodes": {"label": "Linfonodos axilares e paraesternais", "group": "Linfáticos", "visible": False},
    "chest-wall": {"label": "Costelas, esterno e vértebras", "group": "Esqueleto", "visible": True},
    "costal-cartilages": {"label": "Cartilagens costais", "group": "Esqueleto", "visible": True},
    "axilla": {"label": "Escápula, clavícula e úmero", "group": "Esqueleto", "visible": True},
    "iliac-crest": {"label": "Osso do quadril (crista ilíaca)", "group": "Esqueleto", "visible": False},
}

# BP3D 4.3 selection ids -> viewer structure ids (where they differ)
BP43_STRUCTURE_MAP = {"spine": "chest-wall", "scapula-clavicle": "axilla", "humerus": "axilla"}
# Heavy meshes that are reduced; every other mesh keeps its full source resolution.
DECIMATE = {"intercostal-muscles": 0.3, "contralateral-breast-fat": 0.2}

ZA_MESHES = {
    "Pectoral_fascial": ("pectoral-fascia", "fascia"),
    "Clavipectoral_fascial": ("pectoral-fascia", "fascia"),
    "Anterior_layer_of_thoracolumbar_fascial": ("thoracolumbar-fascia", "fascia"),
    "Middle_layer_of_thoracolumbar_fascial": ("thoracolumbar-fascia", "fascia"),
    "Posterior_layer_of_thoracolumbar_fascial": ("thoracolumbar-fascia", "fascia"),
    "Deltoid_fascial": ("deltoid-fascia", "fascia"),
    "Anterior_axillary_nodesl": ("axillary-lymph-nodes", "lymph-node"),
    "Posterior_axillary_nodesl": ("axillary-lymph-nodes", "lymph-node"),
    "Lateral_axillary_nodesl": ("axillary-lymph-nodes", "lymph-node"),
    "Central_axillary_nodesl": ("axillary-lymph-nodes", "lymph-node"),
    "Apical_axillary_nodesl": ("axillary-lymph-nodes", "lymph-node"),
    "Interpectoral_nodesl": ("axillary-lymph-nodes", "lymph-node"),
    "Parasternal_nodesl": ("axillary-lymph-nodes", "lymph-node"),
    "Lateral_pectoral_nervel": ("pectoral-nerves", "nerve"),
}

HRA_PART_MAP = {
    "fat": ("breast-fat", "fat"),
    "mammary_lobes": ("breast", "gland"),
    "main_lactiferous_ducts": ("breast", "duct"),
    "main_lactiferous_sinuses": ("breast", "duct"),
    "suspensory_ligaments": ("breast-ligaments", "ligament"),
    "nipple": ("nipple-areola", "nipple"),
    "areola": ("nipple-areola", "areola"),
    "areolar_tubercles": ("nipple-areola", "areola"),
}

MESHES: list[dict] = []  # final records (vertices in BP3D mm frame until export)


def tissue_for(name: str, category: str) -> str:
    low = name.lower()
    if category == "vessel":
        return "vein" if "vein" in low or "venous" in low else "artery"
    if category == "bone":
        return "cartilage" if "cartilage" in low else "bone"
    return category


def add_mesh(mesh_id: str, verts: np.ndarray, faces: np.ndarray, structure: str, tissue: str, source: str, source_name: str, extra: dict | None = None) -> None:
    MESHES.append({
        "id": re.sub(r"[^A-Za-z0-9_-]", "_", mesh_id),
        "verts": verts,
        "faces": faces,
        "structure": structure,
        "tissue": tissue,
        "source": source,
        "sourceName": source_name,
        "license": LICENSES[source],
        **(extra or {}),
    })


def decimate(verts: np.ndarray, faces: np.ndarray, keep: float) -> tuple[np.ndarray, np.ndarray]:
    v, f = fast_simplification.simplify(verts.astype(np.float32), faces.astype(np.int32), target_reduction=1 - keep)
    return v.astype(np.float64), f.astype(np.int64)


# --------------------------------------------------------------------------------------
# 1. BodyParts3D (native frame: mm, +x = left, -y = anterior, +z = cranial)
# --------------------------------------------------------------------------------------
def load_bodyparts3d() -> None:
    selection = json.loads((Path(__file__).parent / "bp3d43-selection.json").read_text())
    for item in selection:
        v, f = load_obj(SRC / "bp3d-4.3" / "obj" / f"{item['fj']}.obj")
        mesh = weld(v, f)
        v, f = np.asarray(mesh.vertices), np.asarray(mesh.faces)
        structure = BP43_STRUCTURE_MAP.get(item["structure"], item["structure"])
        if item["structure"] in DECIMATE:
            v, f = decimate(v, f, DECIMATE[item["structure"]])
        add_mesh(f"bp43_{item['fj']}", v, f, structure, tissue_for(item["name"], item["category"]), "BodyParts3D 4.3", item["name"],
                 {"fma": item["fma"], "sourceId": item["fj"]})
    v, f = load_stl(SRC / "bp3d-3.0" / "FMA13359.stl")
    mesh = weld(v, f)
    add_mesh("bp30_FMA13359", np.asarray(mesh.vertices), np.asarray(mesh.faces), "latissimus-dorsi", "muscle", "BodyParts3D 3.0",
             "Left latissimus dorsi", {"fma": "FMA13359", "sourceId": "FMA13359"})


def bp_points(structures: set[str], side: str | None = None, per_mesh: int = 4000) -> np.ndarray:
    pts = []
    for m in MESHES:
        if m["source"].startswith("BodyParts3D") and m["structure"] in structures:
            p = sample_surface(m["verts"], m["faces"], min(per_mesh, max(300, len(m["faces"]))))
            if side == "left":
                p = p[p[:, 0] > 0]
            elif side == "right":
                p = p[p[:, 0] < 0]
            pts.append(p)
    return np.vstack(pts)


# --------------------------------------------------------------------------------------
# 2. Z-Anatomy -> BodyParts3D (similarity from shared muscles)
# --------------------------------------------------------------------------------------
def register_zanatomy(report: dict) -> np.ndarray:
    za_dir = SRC / "z-anatomy" / "extracted"
    src = np.vstack([sample_surface(*load_za(za_dir, "Serratus_anterior_musclel"), 8000),
                     sample_surface(*load_za(za_dir, "Latissimus_dorsi_musclel"), 8000)])
    serratus = next(m for m in MESHES if m["sourceName"] == "Left serratus anterior")
    latissimus = next(m for m in MESHES if m["id"] == "bp30_FMA13359")
    dst = np.vstack([sample_surface(serratus["verts"], serratus["faces"], 8000), sample_surface(latissimus["verts"], latissimus["faces"], 8000)])
    # Z-Anatomy is Y-up centimetres; BodyParts3D is Z-up millimetres with anterior = -Y.
    rot = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float64)
    init = np.eye(4)
    init[:3, :3] = 10 * rot
    init[:3, 3] = dst.mean(0) - 10 * rot @ src.mean(0)
    transform, rms = icp(src, dst, init, 80)
    dist, _ = cKDTree(dst).query(apply(transform, src))
    report["zAnatomyToBodyParts3D"] = {
        "method": "trimmed similarity ICP on left serratus anterior + latissimus dorsi",
        "rmsMm": round(rms, 2), "medianMm": round(float(np.median(dist)), 2), "p95Mm": round(float(np.quantile(dist, 0.95)), 2),
        "scale": round(float(np.cbrt(np.linalg.det(transform[:3, :3]))), 4),
    }
    for name, (structure, tissue) in ZA_MESHES.items():
        v, f = load_za(za_dir, name)
        mesh = weld(apply(transform, v), f)
        add_mesh(f"za_{name}", np.asarray(mesh.vertices), np.asarray(mesh.faces), structure, tissue, "Z-Anatomy", name.replace("_", " "))
    return transform


# --------------------------------------------------------------------------------------
# 3. HRA female skin + breasts -> BodyParts3D (rigid, true scale)
# --------------------------------------------------------------------------------------
def register_hra(report: dict) -> tuple[np.ndarray, trimesh.Trimesh]:
    skin_v, skin_f = list(load_glb_meshes(SRC / "hra" / "VH_F_skin.glb").values())[0]
    male_v, male_f = load_obj(SRC / "bp3d-4.3" / "skin_FJ2810.obj")
    # HRA: metres, +Y cranial, +Z anterior, +X left.
    rot = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float64)
    init = np.eye(4)
    init[:3, :3] = 1000 * rot
    hv = apply(init, skin_v)
    init[:3, 3] = [0, 0, male_v[:, 2].min() - hv[:, 2].min()]

    def torso(p: np.ndarray) -> np.ndarray:
        return p[(p[:, 2] > 960) & (p[:, 2] < 1360) & (np.abs(p[:, 0]) < 150)]

    src = sample_surface(skin_v, skin_f, 200000)
    dst = torso(sample_surface(male_v, male_f, 200000))
    t0 = init.copy()
    moved = torso(apply(t0, src))
    t0[:3, 3] += [0, dst[:, 1].mean() - moved[:, 1].mean(), 0]
    # coarse similarity then rigid at true scale (scale 1 keeps deep anatomy inside the skin)
    step, _ = icp(torso(apply(t0, src)), dst, np.eye(4), 80, trim=0.7, with_scale=False)
    transform = step @ t0
    step, rms = icp(torso(apply(transform, src)), dst, np.eye(4), 80, trim=0.7, with_scale=False)
    transform = step @ transform
    skin = trimesh.Trimesh(apply(transform, skin_v), skin_f, process=True)
    report["hraToBodyParts3D"] = {"method": "rigid ICP, true scale, torso skin (T10-C7 band)", "rmsMm": round(rms, 2)}
    return transform, skin


def signed_inside(mesh: trimesh.Trimesh, pts: np.ndarray) -> np.ndarray:
    """Positive inside, via nearest-vertex normal (mesh must be dense)."""
    tree = cKDTree(mesh.vertices)
    _, idx = tree.query(pts)
    normals = np.asarray(mesh.vertex_normals)
    return -np.einsum("ij,ij->i", pts - mesh.vertices[idx], normals[idx])


def conform_breast_base(parts: dict[str, tuple[np.ndarray, np.ndarray]], wall: np.ndarray, gap: float = 2.0) -> tuple[dict, dict]:
    """Depth-wise compression of the posterior breast so it rests anterior to the chest wall.

    Per (x, z) column the anterior surface (min y) of the adipose body is fixed and the
    tissue behind it is linearly compressed so the posterior surface stays `gap` mm in
    front of the chest wall. The same monotone column map is applied to every part, so
    lobes, ducts and ligaments keep their positions relative to the breast.
    """
    fat_v = parts["fat"][0]
    cell = 4.0
    lo = fat_v[:, [0, 2]].min(0) - 30
    hi = fat_v[:, [0, 2]].max(0) + 30
    shape = np.ceil((hi - lo) / cell).astype(int) + 1

    def grid_extreme(points: np.ndarray, fn: str) -> np.ndarray:
        ij = np.floor((points[:, [0, 2]] - lo) / cell).astype(int)
        ok = (ij >= 0).all(1) & (ij < shape).all(1)
        g = np.full(shape, np.nan)
        order = np.argsort(points[ok, 1]) if fn == "min" else np.argsort(-points[ok, 1])
        sel = ij[ok][order]
        vals = points[ok, 1][order]
        g_flat = g.reshape(-1)
        lin = np.ravel_multi_index(sel.T, shape)
        _, first = np.unique(lin, return_index=True)
        g_flat[lin[first]] = vals[first]
        return g

    def fill_smooth(g: np.ndarray, sigma: float) -> np.ndarray:
        mask = ~np.isnan(g)
        if not mask.any():
            return g
        ii = np.argwhere(mask)
        tree = cKDTree(ii)
        allij = np.argwhere(np.ones_like(g, bool))
        _, near = tree.query(allij)
        filled = g[tuple(ii[near].T)].reshape(g.shape)
        return gaussian_filter(filled, sigma)

    front = fill_smooth(grid_extreme(fat_v, "min"), 1.5)
    back = fill_smooth(grid_extreme(fat_v, "max"), 1.5)
    wall_front = grid_extreme(wall, "min")
    covered = ~np.isnan(wall_front)
    wall_front = fill_smooth(wall_front, 1.5)
    limit = wall_front - gap
    ratio = np.where(covered & (back > limit), (limit - front) / np.maximum(back - front, 1e-6), 1.0)
    ratio = gaussian_filter(np.clip(ratio, 0.35, 1.0), 2.0)

    def sample(g: np.ndarray, pts: np.ndarray) -> np.ndarray:
        coords = ((pts[:, [0, 2]] - lo) / cell).T
        return map_coordinates(g, coords, order=1, mode="nearest")

    out = {}
    for key, (v, f) in parts.items():
        r = sample(ratio, v)
        fr = sample(front, v)
        nv = v.copy()
        behind = v[:, 1] > fr
        nv[behind, 1] = fr[behind] + (v[behind, 1] - fr[behind]) * r[behind]
        out[key] = (nv, f)
    depth_before = back - front
    stats = {
        "minDepthRatio": round(float(ratio.min()), 3),
        "maxPosteriorAdvanceMm": round(float(((1 - ratio) * depth_before).max()), 1),
        "columnsCompressedPct": round(float((ratio < 0.999).mean() * 100), 1),
    }
    return out, stats


def load_hra(transform: np.ndarray, skin: trimesh.Trimesh, report: dict) -> None:
    # Skin: trunk only (the HRA arms are abducted and do not match the BP3D arm pose)
    c = skin.triangles_center
    keep = (c[:, 2] > 870) & (c[:, 2] < 1415) & ((np.abs(c[:, 0]) < 178) | (c[:, 2] > 1330)) & (np.abs(c[:, 0]) < 215)
    sub = skin.submesh([np.where(keep)[0]], append=True)
    add_mesh("hra_VH_F_skin", np.asarray(sub.vertices), np.asarray(sub.faces), "skin", "skin", "HRA", "VH_F_skin (trunk region)")

    deep_structs = {"chest-wall", "costal-cartilages", "serratus-anterior", "trapezius", "axilla", "pectoralis-major", "pectoralis-minor", "rhomboids", "latissimus-dorsi", "external-oblique"}
    deep = bp_points(deep_structs, per_mesh=3000)
    deep = deep[np.abs(deep[:, 0]) < 175]
    sd = signed_inside(skin, deep)
    report["deepAnatomyOutsideSkinPct"] = round(float((sd < 0).mean() * 100), 3)
    report["deepAnatomyMaxOutsideMm"] = round(float(max(0.0, -sd.min())), 2)

    breast_report = {}
    for side, fname, sign in (("left", "VH_F_mammary_gland_L.glb", 1), ("right", "VH_F_mammary_gland_R.glb", -1)):
        raw = load_glb_meshes(SRC / "hra" / fname)
        parts: dict[str, tuple[np.ndarray, np.ndarray]] = {}
        names = {}
        for node, (v, f) in raw.items():
            key = next(k for k in sorted(HRA_PART_MAP, key=len, reverse=True) if k in node)
            parts[key] = (apply(transform, v), f)
            names[key] = node
        wall_structs = {"pectoralis-major", "pectoralis-minor", "chest-wall", "costal-cartilages", "intercostal-muscles", "serratus-anterior", "external-oblique"} if side == "left" else {"contralateral-pectoral", "chest-wall", "costal-cartilages", "intercostal-muscles"}
        wall = bp_points(wall_structs, side=side, per_mesh=6000)
        before = signed_inside(trimesh.Trimesh(*parts["fat"], process=True), wall)
        parts, stats = conform_breast_base(parts, wall)
        fat_after = trimesh.Trimesh(*parts["fat"], process=True)
        after = signed_inside(fat_after, wall)
        stats["chestWallPointsInsideFatBefore"] = int((before > 2).sum())
        stats["chestWallPointsInsideFatAfter"] = int((after > 2).sum())
        breast_report[side] = stats
        for key, (v, f) in parts.items():
            mesh = weld(v, f)
            v, f = np.asarray(mesh.vertices), np.asarray(mesh.faces)
            structure, tissue = HRA_PART_MAP[key]
            if side == "right":
                structure = "contralateral-breast"
                if key == "fat":
                    v, f = decimate(v, f, DECIMATE["contralateral-breast-fat"])
            add_mesh(f"hra_{names[key]}", v, f, structure, tissue, "HRA", names[key], {"side": side})
    report["breastConformation"] = breast_report


# --------------------------------------------------------------------------------------
# 4. Present as the right side + viewer frame
# --------------------------------------------------------------------------------------
def to_view(points_bp: np.ndarray, t_za: np.ndarray) -> np.ndarray:
    mirrored = points_bp * np.array([-1.0, 1.0, 1.0])
    za = apply(np.linalg.inv(t_za), mirrored)
    return OLD_SCALE * (za - OLD_CENTER)


def landmarks(t_za: np.ndarray) -> dict:
    def pts(pred) -> np.ndarray:
        return np.vstack([m["verts"] for m in MESHES if pred(m)])

    def v(p: np.ndarray) -> list[float]:
        return [round(float(x), 4) for x in to_view(p[None, :], t_za)[0]]

    def box(p: np.ndarray) -> dict:
        q = to_view(p, t_za)
        return {"min": [round(float(x), 4) for x in q.min(0)], "max": [round(float(x), 4) for x in q.max(0)]}

    nipple = pts(lambda m: m["tissue"] == "nipple" and m.get("side") == "left")
    fat = pts(lambda m: m["structure"] == "breast-fat")
    lat = pts(lambda m: m["structure"] == "latissimus-dorsi")
    scap = pts(lambda m: m["sourceName"] == "Left scapula")
    hip = pts(lambda m: m["structure"] == "iliac-crest")
    td_a = pts(lambda m: m["sourceName"] == "Left thoracodorsal artery")
    td_n = pts(lambda m: m["sourceName"] == "Left thoracodorsal nerve")
    ax_a = pts(lambda m: m["sourceName"] == "Left axillary artery")
    trap = pts(lambda m: m["sourceName"] == "Ascending part of left trapezius")
    skin = pts(lambda m: m["structure"] == "skin")
    lat_c = lat.mean(0)
    # skin point over the latissimus (posterolateral), for the skin paddle
    lat_dir = lat_c - np.array([0.0, lat_c[1], lat_c[2]])
    ring = skin[(np.abs(skin[:, 2] - lat_c[2]) < 15) & (skin[:, 0] > 60) & (skin[:, 1] > -40)]
    paddle = ring[np.argmax(ring[:, 0] + 0.6 * ring[:, 1])] if len(ring) else lat_c
    anterior_border = lat[lat[:, 1] < np.quantile(lat[:, 1], 0.05)]
    return {
        "frame": "viewer (old Z-Anatomy torso frame); operative side presented as right",
        "nipple": v(nipple.mean(0)),
        "breastCenter": v(fat.mean(0)),
        "breastBounds": box(fat),
        "inframammaryFold": v(fat[np.argmin(fat[:, 2])]),
        "latissimusCenter": v(lat_c),
        "latissimusBounds": box(lat),
        "latissimusAnteriorBorder": [v(anterior_border[np.argmax(anterior_border[:, 2])]), v(anterior_border[np.argmin(anterior_border[:, 2])])],
        "latissimusInferior": v(lat[np.argmin(lat[:, 2])]),
        "scapulaInferiorAngle": v(scap[np.argmin(scap[:, 2])]),
        "trapeziusInferiorBorder": v(trap[np.argmin(trap[:, 2])]),
        "iliacCrestTop": v(hip[np.argmax(hip[:, 2])]),
        "thoracodorsalArteryOrigin": v(td_a[np.argmax(td_a[:, 2])]),
        "thoracodorsalArteryDistal": v(td_a[np.argmin(td_a[:, 2])]),
        "thoracodorsalNerveDistal": v(td_n[np.argmin(td_n[:, 2])]),
        "axillaryArteryCenter": v(ax_a.mean(0)),
        "skinPaddleCenter": v(paddle),
        "unitsPerMm": round(float(OLD_SCALE / np.cbrt(np.linalg.det(t_za[:3, :3]))), 6),
    }


# --------------------------------------------------------------------------------------
# 5. glTF writer (one node + mesh per source structure, provenance in extras)
# --------------------------------------------------------------------------------------
TISSUE_COLORS = {
    "skin": [0.90, 0.71, 0.61], "fat": [0.95, 0.81, 0.48], "gland": [0.91, 0.54, 0.65], "duct": [0.85, 0.27, 0.48],
    "ligament": [0.95, 0.94, 0.90], "nipple": [0.54, 0.29, 0.23], "areola": [0.61, 0.35, 0.28], "muscle": [0.70, 0.26, 0.23],
    "bone": [0.91, 0.86, 0.77], "cartilage": [0.72, 0.83, 0.86], "fascia": [0.91, 0.89, 0.83], "artery": [0.78, 0.16, 0.16],
    "vein": [0.12, 0.31, 0.64], "nerve": [0.95, 0.82, 0.29], "lymph-node": [0.50, 0.75, 0.42],
}


def write_glb(path: Path, t_za: np.ndarray) -> list[dict]:
    tissues = sorted({m["tissue"] for m in MESHES})
    materials = [{"name": t, "pbrMetallicRoughness": {"baseColorFactor": TISSUE_COLORS[t] + [1.0], "metallicFactor": 0.0, "roughnessFactor": 0.6}, "doubleSided": True} for t in tissues]
    buffers = bytearray()
    views, accessors, meshes, nodes, records = [], [], [], [], []

    def push(data: bytes, target: int) -> int:
        nonlocal buffers
        while len(buffers) % 4:
            buffers.append(0)
        views.append({"buffer": 0, "byteOffset": len(buffers), "byteLength": len(data), "target": target})
        buffers.extend(data)
        return len(views) - 1

    for m in MESHES:
        verts = to_view(m["verts"], t_za).astype(np.float32)
        faces = m["faces"][:, ::-1].astype(np.uint32)  # reflection flips winding
        mesh = trimesh.Trimesh(verts, faces, process=False)
        normals = np.asarray(mesh.vertex_normals, dtype=np.float32)
        pv = push(verts.tobytes(), 34962)
        accessors.append({"bufferView": pv, "componentType": 5126, "count": len(verts), "type": "VEC3", "min": verts.min(0).tolist(), "max": verts.max(0).tolist()})
        pos_acc = len(accessors) - 1
        nv = push(normals.tobytes(), 34962)
        accessors.append({"bufferView": nv, "componentType": 5126, "count": len(normals), "type": "VEC3"})
        nrm_acc = len(accessors) - 1
        iv = push(faces.reshape(-1).tobytes(), 34963)
        accessors.append({"bufferView": iv, "componentType": 5125, "count": int(faces.size), "type": "SCALAR"})
        extras = {k: m[k] for k in ("structure", "tissue", "source", "sourceName", "license", "fma", "sourceId", "side") if k in m}
        meshes.append({"name": m["id"], "primitives": [{"attributes": {"POSITION": pos_acc, "NORMAL": nrm_acc}, "indices": len(accessors) - 1, "material": tissues.index(m["tissue"])}]})
        nodes.append({"name": m["id"], "mesh": len(meshes) - 1, "extras": extras})
        records.append({"name": m["id"], **extras, "triangles": int(len(faces))})
    gltf = {
        "asset": {"version": "2.0", "generator": "anatomia hybrid torso builder"},
        "scene": 0,
        "scenes": [{"name": "HybridFemaleTorso", "nodes": list(range(len(nodes)))}],
        "nodes": nodes, "meshes": meshes, "materials": materials, "accessors": accessors, "bufferViews": views,
        "buffers": [{"byteLength": len(buffers)}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    while len(buffers) % 4:
        buffers.append(0)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(buffers)))
        fh.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        fh.write(struct.pack("<II", len(buffers), 0x004E4942) + bytes(buffers))
    return records


def main() -> None:
    report: dict = {}
    load_bodyparts3d()
    t_za = register_zanatomy(report)
    t_hra, skin = register_hra(report)
    load_hra(t_hra, skin, report)
    records = write_glb(OUT_GLB, t_za)
    structures = {}
    for sid, meta in STRUCTURES.items():
        names = [r["name"] for r in records if r["structure"] == sid]
        if not names:
            raise SystemExit(f"structure without meshes: {sid}")
        pts = to_view(np.vstack([m["verts"] for m in MESHES if m["structure"] == sid]), t_za)
        centre = pts.mean(0)
        # label anchor: the structure's own surface point nearest to its centroid
        anchor = pts[np.argmin(((pts - centre) ** 2).sum(1))]
        structures[sid] = {**meta, "labelAnchor": [round(float(x), 4) for x in anchor], "meshNames": names}
    unknown = {r["structure"] for r in records} - set(STRUCTURES)
    if unknown:
        raise SystemExit(f"meshes with unknown structure: {unknown}")
    manifest = {
        "modelPath": "models/hybrid/torso-female-hybrid.glb",
        "operativeSide": "right (source left side, globally reflected)",
        "sources": {
            "HRA": "https://github.com/hubmapconsortium/ccf-3d-reference-object-library (VH_Female v1.3 skin, mammary glands)",
            "BodyParts3D 4.3": "https://github.com/olivercase/body_parts_3d_api (DBCLS Anatomography 4.3 meshes)",
            "BodyParts3D 3.0": "https://github.com/Kevin-Mattheus-Moerman/BodyParts3D (FMA13359 left latissimus dorsi)",
            "Z-Anatomy": "https://github.com/LluisV/Z-Anatomy/tree/PC-Version/Resources/Models/FBX",
        },
        "licenses": LICENSES,
        "registration": report,
        "totalTriangles": int(sum(r["triangles"] for r in records)),
        "landmarks": landmarks(t_za),
        "structures": structures,
        "meshes": records,
    }
    dump_json(OUT_MANIFEST, manifest)
    print(json.dumps(report, indent=2))
    print("meshes", len(records), "triangles", manifest["totalTriangles"])


if __name__ == "__main__":
    main()
