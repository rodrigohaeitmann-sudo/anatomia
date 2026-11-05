#!/usr/bin/env python3
"""Study layers for the hybrid torso: bony landmarks, muscle attachment areas, muscle portions,
fibre directions, neurovascular hila, skin markings and perforator zones.

Nothing here is drawn by hand. Every item is either transferred from a published source or computed
from the meshes the viewer shows, and each output carries its provenance:

* Z-Anatomy (CC BY-SA 4.0) labels bony features and draws muscle attachment areas on its bones. Its
  bones derive from BodyParts3D like ours, so each Z-Anatomy bone is aligned onto the matching
  BodyParts3D bone (similarity fit, then a per-bone rigid fit) and landmarks/areas are moved with it
  and snapped onto our bone surface. The fit residual is recorded per bone.
* Attachments missing from Z-Anatomy (latissimus dorsi, teres major and coracobrachialis on the
  humerus, short head of biceps on the coracoid) come from where the muscle mesh touches the bone.
* Fibre directions solve a Laplace problem on each muscle surface between its origin (u = 0) and
  insertion (u = 1) areas (Choi & Blemker 2013) and trace streamlines of the gradient.
* Serratus anterior digitations and pectoralis minor slips are a harmonic partition of the muscle by
  rib of origin.
* Hila, skin markings and zones use the vessel/nerve, muscle, bone and skin meshes; literature values
  shown next to them live in src/data/literature.ts.

Inputs (see scripts/hybrid/README.md):
  assets/source/hybrid/z-anatomy/extracted/skeleton.json   node scripts/hybrid/extract_zanatomy_skeleton.mjs
  assets/build/model-meshes/                               node scripts/hybrid/decode_model.mjs
Outputs:
  src/data/anatomyLayers.json            metadata, points and polylines (imported by the app)
  public/models/hybrid/anatomy-layers.bin  attachment meshes, fibre polylines, partition samples
"""
from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

import fast_simplification
import numpy as np
import trimesh
from scipy.sparse import coo_matrix, diags, identity
from scipy.sparse.linalg import spsolve
from scipy.spatial import ConvexHull, cKDTree

ROOT = Path(__file__).resolve().parents[2]
SKELETON = ROOT / "assets/source/hybrid/z-anatomy/extracted/skeleton.json"
MESH_DIR = ROOT / "assets/build/model-meshes"
MANIFEST = ROOT / "src/data/hybridTorsoManifest.json"
OUT_JSON = ROOT / "src/data/anatomyLayers.json"
OUT_BIN = ROOT / "public/models/hybrid/anatomy-layers.bin"

manifest = json.loads(MANIFEST.read_text())
MM = manifest["landmarks"]["unitsPerMm"]  # model units per millimetre
BY_SOURCE = {m["sourceName"]: m for m in manifest["meshes"]}
RIBS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"]


def rng() -> np.random.Generator:
    return np.random.default_rng(7)


# --------------------------------------------------------------------------------------------------
# meshes
# --------------------------------------------------------------------------------------------------
@lru_cache(maxsize=None)
def app_mesh(source_name: str) -> trimesh.Trimesh:
    rec = BY_SOURCE[source_name]
    pos = np.fromfile(MESH_DIR / f"{rec['name']}.pos.bin", dtype=np.float32).reshape(-1, 3).astype(np.float64)
    idx = np.fromfile(MESH_DIR / f"{rec['name']}.idx.bin", dtype=np.uint32).reshape(-1, 3).astype(np.int64)
    mesh = trimesh.Trimesh(pos, idx, process=True)
    mesh.update_faces(mesh.nondegenerate_faces())
    return mesh


@lru_cache(maxsize=None)
def proximity(source_name: str) -> trimesh.proximity.ProximityQuery:
    return trimesh.proximity.ProximityQuery(app_mesh(source_name))


def outward_sign(mesh: trimesh.Trimesh) -> float:
    """BodyParts3D bones/muscles are closed; after the global reflection some may be wound inwards."""
    try:
        return 1.0 if mesh.volume >= 0 else -1.0
    except Exception:  # noqa: BLE001 - open meshes: assume outward
        return 1.0


def snap(source_name: str, points: np.ndarray, lift_mm: float = 0.0):
    mesh = app_mesh(source_name)
    closest, distance, tri = proximity(source_name).on_surface(points)
    normals = mesh.face_normals[tri] * outward_sign(mesh)
    return closest + normals * lift_mm * MM, distance / MM, normals


def sample_surface(vertices: np.ndarray, faces: np.ndarray, n: int, generator: np.random.Generator) -> np.ndarray:
    a, b, c = vertices[faces[:, 0]], vertices[faces[:, 1]], vertices[faces[:, 2]]
    area = np.linalg.norm(np.cross(b - a, c - a), axis=1) / 2
    f = generator.choice(len(faces), n, p=area / area.sum())
    u, v = generator.random(n), generator.random(n)
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    return a[f] + (b[f] - a[f]) * u[:, None] + (c[f] - a[f]) * v[:, None]


def simplify(mesh: trimesh.Trimesh, max_faces: int) -> trimesh.Trimesh:
    if len(mesh.faces) <= max_faces:
        return mesh
    points, faces = fast_simplification.simplify(mesh.vertices.astype(np.float32), mesh.faces.astype(np.int32), 1 - max_faces / len(mesh.faces))
    out = trimesh.Trimesh(points.astype(np.float64), faces.astype(np.int64), process=True)
    out.update_faces(out.nondegenerate_faces())
    out.remove_unreferenced_vertices()
    return out


# --------------------------------------------------------------------------------------------------
# 1. align Z-Anatomy bones onto the BodyParts3D bones of the model
# --------------------------------------------------------------------------------------------------
BONES: dict[str, tuple[str, str, str]] = {
    "Humerusl": ("Left humerus", "axilla", "Úmero"),
    "Scapulal": ("Left scapula", "axilla", "Escápula"),
    "Claviclel": ("Left clavicle", "axilla", "Clavícula"),
    "Manubrium_of_sternum": ("Manubrium", "chest-wall", "Manúbrio"),
    "Body_of_sternum": ("Body of sternum", "chest-wall", "Corpo do esterno"),
    "Xiphoid_process": ("Xiphoid process", "chest-wall", "Processo xifoide"),
    "Hip_bonel": ("Left hip bone", "iliac-crest", "Osso do quadril"),
    **{f"{name.capitalize()}_ribl": (f"Left {name} rib", "chest-wall", f"{i}ª costela") for i, name in enumerate(RIBS, 1)},
}


def umeyama(x: np.ndarray, y: np.ndarray, scale: bool = True, reflection: bool = True):
    mx, my = x.mean(0), y.mean(0)
    xc, yc = x - mx, y - my
    u, s, vt = np.linalg.svd(yc.T @ xc / len(x))
    d = np.eye(3)
    if not reflection and np.linalg.det(u @ vt) < 0:
        d[2, 2] = -1
    r = u @ d @ vt
    k = (s * np.diag(d)).sum() / xc.var(0).sum() if scale else 1.0
    return k, r, my - k * r @ mx


def fit_bones(skeleton: dict):
    gen = rng()
    src, dst, trees = {}, {}, {}
    for zb, (app, _, _) in BONES.items():
        zv = np.array(skeleton["bones"][zb]["pos"], float).reshape(-1, 3)
        zf = np.array(skeleton["bones"][zb]["idx"], int).reshape(-1, 3)
        src[zb] = sample_surface(zv, zf, 1500, gen)
        mesh = app_mesh(app)
        dst[zb] = sample_surface(mesh.vertices, mesh.faces, 30000, gen)
        trees[zb] = cKDTree(dst[zb])
    names = list(BONES)
    # the global reflection (source left presented as right) is found by the centroid fit
    s, r, t = umeyama(np.array([src[b].mean(0) for b in names]), np.array([dst[b].mean(0) for b in names]))
    for _ in range(30):
        xs, ys = [], []
        for b in names:
            p = s * src[b] @ r.T + t
            d, j = trees[b].query(p)
            keep = d < np.percentile(d, 90)
            xs.append(src[b][keep])
            ys.append(dst[b][j[keep]])
        s, r, t = umeyama(np.vstack(xs), np.vstack(ys))
    transforms, report = {}, {}
    for b in names:
        p = s * src[b] @ r.T + t
        r2, t2 = np.eye(3), np.zeros(3)
        for _ in range(25):
            q = p @ r2.T + t2
            d, j = trees[b].query(q)
            keep = d < np.percentile(d, 95)
            _, r2, t2 = umeyama(p[keep], dst[b][j[keep]], scale=False, reflection=False)
        d, _ = trees[b].query(p @ r2.T + t2)
        d /= MM
        transforms[b] = (s, r2 @ r, r2 @ t + t2)
        report[b] = {"medianMm": round(float(np.median(d)), 2), "p95Mm": round(float(np.percentile(d, 95)), 2)}
    return transforms, report


def apply(transform, points: np.ndarray) -> np.ndarray:
    s, r, t = transform
    return s * np.asarray(points, float) @ r.T + t


# --------------------------------------------------------------------------------------------------
# 2. bony landmarks
# --------------------------------------------------------------------------------------------------
# Z-Anatomy name -> (id, name, note, palpable)
LANDMARKS: dict[str, dict[str, tuple[str, str, str, bool]]] = {
    "Humerusl": {
        "Head_of_humerus": ("cabeca", "Cabeça do úmero", "Articula-se com a cavidade glenoidal.", False),
        "Anatomical_neck_of_humerus": ("colo-anatomico", "Colo anatômico", "Limite de inserção da cápsula articular.", False),
        "Surgical_neck_of_humerus": ("colo-cirurgico", "Colo cirúrgico", "O nervo axilar e os vasos circunflexos posteriores do úmero contornam-no pelo espaço quadrangular.", False),
        "Greater_tubercle": ("tuberculo-maior", "Tubérculo maior", "Inserções do supraespinal, infraespinal e redondo menor.", True),
        "Lesser_tubercle": ("tuberculo-menor", "Tubérculo menor", "Inserção do subescapular.", False),
        "Intertubercular_sulcus": ("sulco-intertubercular", "Sulco intertubercular", "Contém o tendão da cabeça longa do bíceps. No assoalho insere-se o grande dorsal.", False),
        "Crest_of_greater_tubercle": ("crista-tuberculo-maior", "Crista do tubérculo maior (lábio lateral)", "Inserção do peitoral maior.", False),
        "Crest_of_lesser_tubercle": ("crista-tuberculo-menor", "Crista do tubérculo menor (lábio medial)", "Inserção do redondo maior.", False),
        "Deltoid_tuberosity": ("tuberosidade-deltoidea", "Tuberosidade deltóidea", "Inserção do deltoide.", False),
        "Radial_groove": ("sulco-radial", "Sulco do nervo radial", "Nervo radial e vasos braquiais profundos.", False),
        "Medial_epicondyle_of_humerus": ("epicondilo-medial", "Epicôndilo medial", "O nervo ulnar passa posteriormente a ele.", True),
        "Lateral_epicondyle_of_humerus": ("epicondilo-lateral", "Epicôndilo lateral", "Origem dos extensores do antebraço.", True),
    },
    "Scapulal": {
        "Coracoid_process": ("coracoide", "Processo coracoide", "Inserção do peitoral menor; origem do coracobraquial e da cabeça curta do bíceps. O plexo braquial e os vasos axilares passam inferomedialmente a ele.", True),
        "Acromion": ("acromio", "Acrômio", "Origem da parte acromial do deltoide; inserção do trapézio.", True),
        "Acromial_angle": ("angulo-acromio", "Ângulo do acrômio", "Ponto palpável na junção do acrômio com a espinha.", True),
        "Glenoid_fossa": ("glenoide", "Cavidade glenoidal", "Articulação do ombro.", False),
        "Supraglenoid_tubercle": ("tuberculo-supraglenoidal", "Tubérculo supraglenoidal", "Origem da cabeça longa do bíceps.", False),
        "Infraglenoid_tubercle": ("tuberculo-infraglenoidal", "Tubérculo infraglenoidal", "Origem da cabeça longa do tríceps.", False),
        "Neck_of_scapula": ("colo", "Colo da escápula", "", False),
        "Spine_of_scapula": ("espinha", "Espinha da escápula", "Palpável no dorso; origem da parte espinal do deltoide e inserção do trapézio.", True),
        "Superior_angle_of_scapula": ("angulo-superior", "Ângulo superior", "Inserção do levantador da escápula.", False),
        "Inferior_angle_of_scapula": ("angulo-inferior", "Ângulo inferior", "Palpável; a borda superior do grande dorsal cruza-o. Referência para os retalhos escapular e do grande dorsal.", True),
        "Medial_border_of_scapula": ("margem-medial", "Margem medial", "Inserção do serrátil anterior (face costal) e dos romboides.", True),
        "Lateral_border_of_scapula": ("margem-lateral", "Margem lateral", "Origem do redondo maior (inferior) e do redondo menor. Limita os espaços triangular e quadrangular.", False),
        "Superior_border_of_scapula": ("margem-superior", "Margem superior", "", False),
        "Scapular_notch": ("incisura", "Incisura da escápula", "O nervo supraescapular passa sob o ligamento transverso superior.", False),
        "Spinoglenoid_notch": ("incisura-espinoglenoidal", "Incisura espinoglenoidal", "Passagem do nervo supraescapular para a fossa infraespinal.", False),
        "Supraspinous_fossa": ("fossa-supraespinal", "Fossa supraespinal", "Origem do supraespinal.", False),
        "Infraspinous_fossa": ("fossa-infraespinal", "Fossa infraespinal", "Origem do infraespinal.", False),
        "Subscapular_fossa": ("fossa-subescapular", "Fossa subescapular", "Origem do subescapular; parede posterior da axila.", False),
        "Deltoid_tubercle": ("tuberculo-deltoideo", "Tubérculo deltóideo da espinha", "", False),
    },
    "Claviclel": {
        "Sternal_end": ("extremidade-esternal", "Extremidade esternal", "Palpável na articulação esternoclavicular.", True),
        "Acromial_end": ("extremidade-acromial", "Extremidade acromial", "Palpável na articulação acromioclavicular.", True),
        "Conoid_tubercle": ("tuberculo-conoide", "Tubérculo conoide", "Fixação do ligamento conoide (coracoclavicular).", False),
        "Trapezoid_line": ("linha-trapezoide", "Linha trapezoide", "Fixação do ligamento trapezoide.", False),
        "Groove_for_subclavius_muscle": ("sulco-subclavio", "Sulco do músculo subclávio", "Inserção do subclávio; os vasos subclávios passam logo abaixo.", False),
        "Impression_for_costoclavicular_ligament": ("impressao-costoclavicular", "Impressão do ligamento costoclavicular", "", False),
        "Body_of_clavicle": ("corpo", "Corpo da clavícula", "Palpável em todo o comprimento.", True),
    },
    "Manubrium_of_sternum": {
        "Clavicular_notch": ("incisura-clavicular", "Incisura clavicular", "Articulação esternoclavicular.", False),
    },
    "Body_of_sternum": {
        "Sternal_angle": ("angulo-esternal", "Ângulo esternal (de Louis)", "Articula-se com a 2ª cartilagem costal: ponto de partida para contar costelas e espaços intercostais.", True),
        "Costal_notches": ("incisuras-costais", "Incisuras costais", "Articulações com as cartilagens costais.", False),
    },
    "Sixth_ribl": {
        "Head_of_rib": ("cabeca", "Cabeça da costela (6ª)", "Articula-se com os corpos vertebrais.", False),
        "Neck_of_rib": ("colo", "Colo da costela (6ª)", "", False),
        "Tubercle_of_rib": ("tuberculo", "Tubérculo da costela (6ª)", "Articula-se com o processo transverso.", False),
        "Angle_of_rib": ("angulo", "Ângulo da costela (6ª)", "", False),
        "Costal_groove": ("sulco-costal", "Sulco costal (6ª)", "Abriga o feixe intercostal (veia, artéria e nervo, de cima para baixo) na margem inferior da costela.", False),
    },
    "Hip_bonel": {
        "Iliac_crests": ("crista-iliaca", "Crista ilíaca", "Origem do grande dorsal no terço posterior; inserção do oblíquo externo.", True),
        "Iliac_crest": ("crista-iliaca", "Crista ilíaca", "Origem do grande dorsal no terço posterior; inserção do oblíquo externo.", True),
        "Iliac_tubercle": ("tuberculo-iliaco", "Tubérculo ilíaco", "", True),
        "Anterior_superior_iliac_spine": ("eias", "Espinha ilíaca anterossuperior", "", True),
        "Posterior_superior_iliac_spine": ("eips", "Espinha ilíaca posterossuperior", "", True),
    },
}
BONE_SLUG = {"Humerusl": "umero", "Scapulal": "escapula", "Claviclel": "clavicula", "Manubrium_of_sternum": "esterno", "Body_of_sternum": "esterno", "Xiphoid_process": "esterno", "Hip_bonel": "quadril", "Sixth_ribl": "costela6"}


def bone_landmarks(skeleton: dict, transforms: dict) -> list[dict]:
    out, seen = [], set()
    for lm in skeleton["landmarks"]:
        spec = LANDMARKS.get(lm["bone"], {}).get(lm["name"])
        if not spec:
            continue
        ident = f"{BONE_SLUG[lm['bone']]}.{spec[0]}"
        if ident in seen:
            continue
        seen.add(ident)
        app = BONES[lm["bone"]][0]
        verts = apply(transforms[lm["bone"]], np.array(lm["verts"], float).reshape(-1, 3))
        centre = verts.mean(0)
        _, _, vt = np.linalg.svd(verts - centre, full_matrices=False)
        along = (verts - centre) @ vt[0]
        ends = [verts[along <= along.min() + 1e-9].mean(0), verts[along >= along.max() - 1e-9].mean(0)]
        # the label sits off the bone; the other end of the leader line touches the feature
        _, dist, _ = snap(app, np.array(ends))
        tip = ends[int(np.argmin(dist))]
        point, offset, normal = snap(app, tip[None])
        out.append(landmark(ident, spec[1], lm["bone"], point[0], normal[0], "Z-Anatomy", spec[2], spec[3], offset_mm=float(offset[0])))
    return out


def landmark(ident, name, zbone, point, normal, source, note, palpable, offset_mm=None, category="osseo", bone=None, structure=None):
    app, struct, label = BONES[zbone] if zbone in BONES else (None, structure, bone)
    item = {
        "id": ident,
        "name": name,
        "category": category,
        "bone": label if bone is None else bone,
        "structure": struct if structure is None else structure,
        "point": [round(float(v), 5) for v in point],
        "normal": [round(float(v), 4) for v in normal],
        "source": source,
        "note": note,
        "palpable": palpable,
    }
    if offset_mm is not None:
        item["sourceOffsetMm"] = round(offset_mm, 2)
    return item


def computed_landmarks() -> list[dict]:
    out = []
    manubrium = app_mesh("Manubrium").vertices
    mid_x = np.median(manubrium[:, 0])
    near_mid = manubrium[np.abs(manubrium[:, 0] - mid_x) < 6 * MM]
    top = near_mid[np.argmax(near_mid[:, 1])]
    p, _, n = snap("Manubrium", top[None])
    out.append(landmark("esterno.incisura-jugular", "Incisura jugular", "Manubrium_of_sternum", p[0], n[0], "calculado", "Borda superior do manúbrio, na linha mediana.", True))
    xiphoid = app_mesh("Xiphoid process").vertices
    tip = xiphoid[np.argmin(xiphoid[:, 1])]
    p, _, n = snap("Xiphoid process", tip[None])
    out.append(landmark("esterno.xifoide", "Ápice do processo xifoide", "Xiphoid process", p[0], n[0], "calculado", "Limite inferior do esterno; nível aproximado de T9–T10.", True))
    for level in (1, 3, 7, 12):
        name = {1: "First", 3: "Third", 7: "Seventh", 12: "Twelfth"}[level]
        verts = app_mesh(f"{name} thoracic vertebra").vertices
        spine = verts[np.argmin(verts[:, 2])]  # posterior-most point
        out.append(landmark(f"vertebra.t{level}-espinhoso", f"Processo espinhoso de T{level}", None, spine, [0, 0, -1], "calculado",
                            {1: "", 3: "Nível aproximado da raiz da espinha da escápula.", 7: "Nível aproximado do ângulo inferior da escápula; início da origem vertebral do grande dorsal.", 12: ""}[level],
                            True, bone="Vértebra", structure="chest-wall"))
    return out


def rib_labels() -> list[dict]:
    """A label point on each rib at its most lateral point (roughly the mid-axillary line)."""
    out = []
    for i, name in enumerate(RIBS, 1):
        verts = app_mesh(f"Left {name} rib").vertices
        lateral = verts[np.argmin(verts[:, 0])]
        p, _, n = snap(f"Left {name} rib", lateral[None])
        out.append(landmark(f"costela.{i}", f"{i}ª costela", f"{name.capitalize()}_ribl", p[0], n[0], "calculado",
                            "Ponto mais lateral da costela (aproximadamente a linha axilar média)." if i > 1 else "A 1ª costela fica sob a clavícula; conte a partir do ângulo esternal (2ª).",
                            i > 2 and i < 11, category="costela"))
    return out


# --------------------------------------------------------------------------------------------------
# 3. attachment areas
# --------------------------------------------------------------------------------------------------
# (Z-Anatomy muscle, Z-Anatomy bone or "*") -> (structure, part or None, classical kind)
ATTACHMENTS = {
    ("Pectoralis_major_muscle", "Claviclel"): ("pectoralis-major", "pectoralis-major#clavicular", "origin"),
    ("Pectoralis_major_muscle", "Humerusl"): ("pectoralis-major", None, "insertion"),
    ("Sternocostal_head_of_pectoralis_major_muscle", "*"): ("pectoralis-major", "pectoralis-major#sternocostal", "origin"),
    ("Latissimus_dorsi_muscle", "*"): ("latissimus-dorsi", None, "origin"),
    ("Teres_major_muscle", "*"): ("teres-major", None, "origin"),
    ("Teres_minor_muscle", "Scapulal"): ("teres-minor", None, "origin"),
    ("Teres_minor_muscle", "Humerusl"): ("teres-minor", None, "insertion"),
    ("Subscapularis_muscle", "Scapulal"): ("subscapularis", None, "origin"),
    ("Subscapularis_muscle", "Humerusl"): ("subscapularis", None, "insertion"),
    ("Supraspinatus_muscle", "Scapulal"): ("supraspinatus", None, "origin"),
    ("Supraspinatus_muscle", "Humerusl"): ("supraspinatus", None, "insertion"),
    ("Infraspinatus_muscle", "Scapulal"): ("infraspinatus", None, "origin"),
    ("Infraspinatus_muscle", "Humerusl"): ("infraspinatus", None, "insertion"),
    ("Serratus_anterior_muscle", "Scapulal"): ("serratus-anterior", None, "insertion"),
    ("Serratus_anterior_muscle", "*"): ("serratus-anterior", "serratus-anterior#rib-{rib}", "origin"),
    ("Pectoralis_minor_muscle", "Scapulal"): ("pectoralis-minor", None, "insertion"),
    ("Pectoralis_minor_muscle", "*"): ("pectoralis-minor", "pectoralis-minor#rib-{rib}", "origin"),
    ("Subclavius_muscle", "Claviclel"): ("subclavius", None, "insertion"),
    ("Deltoid_muscle", "Humerusl"): ("deltoid", None, "insertion"),
    ("Clavicular_part_of_deltoid_muscle", "*"): ("deltoid", "deltoid#clavicular", "origin"),
    ("Acromial_part_of_deltoid_muscle", "*"): ("deltoid", "deltoid#acromial", "origin"),
    ("Scapular_spinal_part_of_deltoid_muscle", "*"): ("deltoid", "deltoid#spinal", "origin"),
    # Z-Anatomy swaps "ascending" and "descending" here: its "ascending" area lies on the clavicle,
    # where the descending (superior) fibres insert. Parts are assigned by the bone they lie on.
    ("Ascending_part_of_trapezius_muscle", "Claviclel"): ("trapezius", "trapezius#descending", "insertion"),
    ("Descending_part_of_trapezius_muscle", "Scapulal"): ("trapezius", "trapezius#ascending", "insertion"),
    ("Transverse_part_of_trapezius_muscle", "*"): ("trapezius", "trapezius#transverse", "insertion"),
    ("Levator_scapulae", "Scapulal"): ("levator-scapulae", None, "insertion"),
    ("Rhomboid_major_muscle", "*"): ("rhomboids", "rhomboids#major", "insertion"),
    ("Rhomboid_minor_muscle", "*"): ("rhomboids", "rhomboids#minor", "insertion"),
    ("Long_head_of_biceps_brachii", "*"): ("coracobrachialis-biceps", "coracobrachialis-biceps#biceps-long", "origin"),
    ("Coracobrachialis_muscle", "*"): ("coracobrachialis-biceps", "coracobrachialis-biceps#coracobrachialis", "origin"),
    ("Long_head_of_triceps_brachii", "*"): ("triceps", "triceps#long", "origin"),
    ("Lateral_head_of_triceps_brachii", "*"): ("triceps", "triceps#lateral", "origin"),
    ("Medial_head_of_triceps_brachii", "*"): ("triceps", "triceps#medial", "origin"),
    ("External_abdominal_oblique_muscle", "Hip_bonel"): ("external-oblique", None, "insertion"),
    ("External_abdominal_oblique_muscle", "*"): ("external-oblique", None, "origin"),
    ("Serratus_posterior_superior_muscle", "*"): ("serratus-posterior", "serratus-posterior#superior", "insertion"),
    ("Serratus_posterior_inferior_muscle", "*"): ("serratus-posterior", "serratus-posterior#inferior", "insertion"),
}
RIB_INDEX = {f"{name.capitalize()}_ribl": i for i, name in enumerate(RIBS, 1)}

# muscle portions that already exist as separate meshes in the model
MESH_PARTS = {
    "pectoralis-major#clavicular": ("Clavicular part of left pectoralis major", "Peitoral maior · parte clavicular"),
    "pectoralis-major#sternocostal": ("Sternocostal part of left pectoralis major", "Peitoral maior · parte esternocostal"),
    "pectoralis-major#abdominal": ("Abdominal part of left pectoralis major", "Peitoral maior · parte abdominal"),
    "deltoid#clavicular": ("Clavicular part of left deltoid", "Deltoide · parte clavicular"),
    "deltoid#acromial": ("Acromial part of left deltoid", "Deltoide · parte acromial"),
    "deltoid#spinal": ("Spinal part of left deltoid", "Deltoide · parte espinal"),
    "trapezius#descending": ("Descending part of left trapezius", "Trapézio · parte descendente"),
    "trapezius#transverse": ("Transverse part of left trapezius", "Trapézio · parte transversa"),
    "trapezius#ascending": ("Ascending part of left trapezius", "Trapézio · parte ascendente"),
    "triceps#long": ("Long head of left triceps brachii", "Tríceps · cabeça longa"),
    "triceps#lateral": ("Lateral head of left triceps brachii", "Tríceps · cabeça lateral"),
    "triceps#medial": ("Medial head of left triceps brachii", "Tríceps · cabeça medial"),
    "coracobrachialis-biceps#coracobrachialis": ("Left coracobrachialis", "Coracobraquial"),
    "coracobrachialis-biceps#biceps-short": ("Short head of left biceps brachii", "Bíceps · cabeça curta"),
    "coracobrachialis-biceps#biceps-long": ("Long head of left biceps brachii", "Bíceps · cabeça longa"),
    "rhomboids#major": ("Left rhomboid major", "Romboide maior"),
    "rhomboids#minor": ("Left rhomboid minor", "Romboide menor"),
    "serratus-posterior#superior": ("Left serratus posterior superior", "Serrátil posterior superior"),
    "serratus-posterior#inferior": ("Left serratus posterior inferior", "Serrátil posterior inferior"),
}


def structure_label(structure: str) -> str:
    return manifest["structures"][structure]["label"]


def finish_patch(app_bone: str, vertices: np.ndarray, faces: np.ndarray, max_faces: int = 700):
    mesh = trimesh.Trimesh(vertices, faces, process=True)
    mesh.update_faces(mesh.nondegenerate_faces())
    mesh = simplify(mesh, max_faces)
    area_mm2 = float(mesh.area / MM**2)
    lifted, _, _ = snap(app_bone, mesh.vertices, lift_mm=0.45)
    return lifted, mesh.faces, area_mm2


def transferred_attachments(skeleton: dict, transforms: dict) -> list[dict]:
    out = []
    counters: dict[str, int] = {}
    for item in skeleton["attachments"]:
        spec = ATTACHMENTS.get((item["muscle"], item["bone"])) or ATTACHMENTS.get((item["muscle"], "*"))
        if not spec or item["bone"] not in BONES:
            continue
        structure, part, kind = spec
        rib = RIB_INDEX.get(item["bone"])
        if part and "{rib}" in part:
            part = part.format(rib=rib)
        app_bone, bone_structure, bone_label = BONES[item["bone"]]
        verts = apply(transforms[item["bone"]], np.array(item["pos"], float).reshape(-1, 3))
        faces = np.array(item["idx"], int).reshape(-1, 3)
        if len(faces) < 4:
            continue
        lifted, faces, area = finish_patch(app_bone, verts, faces)
        if area < 4:
            continue
        key = f"{structure}:{kind}:{BONE_SLUG.get(item['bone'], 'costela' + str(rib))}"
        counters[key] = counters.get(key, 0) + 1
        out.append({
            "id": f"{key}:{counters[key]}",
            "muscle": structure,
            "part": part,
            "kind": kind,
            "bone": bone_label,
            "boneStructure": bone_structure,
            "rib": rib,
            "source": "Z-Anatomy",
            "sourceTag": f"{item['muscle']} ({item['tag']}{item['part']})",
            "areaMm2": round(area),
            "vertices": lifted,
            "faces": faces,
        })
    return out


def contact_patch(muscle: str, bone: str, threshold_mm: float = 1.6, near: np.ndarray | None = None, radius_mm: float | None = None):
    """Area of the bone surface lying within threshold_mm of the muscle surface."""
    bone_mesh = app_mesh(bone)
    v, f = trimesh.remesh.subdivide_to_size(bone_mesh.vertices, bone_mesh.faces, max_edge=1.2 * MM, max_iter=12)
    centroids = v[f].mean(1)
    muscle_mesh = app_mesh(muscle)
    samples = sample_surface(muscle_mesh.vertices, muscle_mesh.faces, 250000, rng())
    d, _ = cKDTree(samples).query(centroids)
    keep = d / MM < threshold_mm
    if near is not None:
        keep &= np.linalg.norm(centroids - near, axis=1) / MM < radius_mm
    if keep.sum() < 3:
        return None
    patch = trimesh.Trimesh(v, f[keep], process=True)
    labels = trimesh.graph.connected_component_labels(patch.face_adjacency, node_count=len(patch.faces))
    areas = np.bincount(labels, weights=patch.area_faces) / MM**2
    faces = patch.faces[areas[labels] > 15]
    if not len(faces):
        return None
    patch = trimesh.Trimesh(patch.vertices, faces, process=True)
    return finish_patch(bone, patch.vertices, patch.faces)


def computed_attachments(landmarks: list[dict]) -> list[dict]:
    lm = {item["id"]: np.array(item["point"]) for item in landmarks}
    head = lm["umero.cabeca"]
    specs = [
        ("latissimus-dorsi", None, "insertion", "Left latissimus dorsi", "Left humerus", head, 140, "Úmero"),
        ("teres-major", None, "insertion", "Left teres major", "Left humerus", head, 140, "Úmero"),
        ("coracobrachialis-biceps", "coracobrachialis-biceps#coracobrachialis", "insertion", "Left coracobrachialis", "Left humerus", None, None, "Úmero"),
        ("coracobrachialis-biceps", "coracobrachialis-biceps#biceps-short", "origin", "Short head of left biceps brachii", "Left scapula", lm["escapula.coracoide"], 30, "Escápula"),
    ]
    out = []
    for structure, part, kind, muscle, bone, near, radius, bone_label in specs:
        result = contact_patch(muscle, bone, near=near, radius_mm=radius)
        if result is None:
            print(f"  no contact for {muscle} on {bone}")
            continue
        verts, faces, area = result
        out.append({
            "id": f"{structure}:{kind}:{'umero' if bone == 'Left humerus' else 'escapula'}:calc",
            "muscle": structure, "part": part, "kind": kind, "bone": bone_label, "boneStructure": "axilla", "rib": None,
            "source": "calculado", "sourceTag": "contato músculo-osso (< 1,6 mm) nas malhas BodyParts3D",
            "areaMm2": round(area), "vertices": verts, "faces": faces,
        })
    return out


# --------------------------------------------------------------------------------------------------
# 4. harmonic fields on muscle surfaces: fibres and partitions
# --------------------------------------------------------------------------------------------------
def cotan_laplacian(v: np.ndarray, f: np.ndarray):
    n = len(v)

    def cot(a, b, c):
        u, w = v[b] - v[a], v[c] - v[a]
        return (u * w).sum(1) / np.maximum(np.linalg.norm(np.cross(u, w), axis=1), 1e-12)

    i0, i1, i2 = f[:, 0], f[:, 1], f[:, 2]
    c0, c1, c2 = cot(i0, i1, i2), cot(i1, i2, i0), cot(i2, i0, i1)
    rows = np.concatenate([i1, i2, i2, i0, i0, i1])
    cols = np.concatenate([i2, i1, i0, i2, i1, i0])
    w = np.maximum(np.concatenate([c0, c0, c1, c1, c2, c2]) * 0.5, 1e-3)
    a = coo_matrix((w, (rows, cols)), shape=(n, n)).tocsr()
    return diags(np.asarray(a.sum(1)).ravel()) - a


def harmonic(lap, fixed: np.ndarray, values: np.ndarray) -> np.ndarray:
    n = lap.shape[0]
    u = np.zeros(n)
    u[fixed] = values
    free = np.setdiff1d(np.arange(n), fixed)
    lff = lap[free][:, free] + identity(len(free)) * 1e-9
    rhs = -lap[free][:, fixed] @ values
    u[free] = spsolve(lff.tocsc(), rhs)
    return u


def face_gradients(v: np.ndarray, f: np.ndarray, u: np.ndarray) -> np.ndarray:
    v0, v1, v2 = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    normal = np.cross(v1 - v0, v2 - v0)
    double_area = np.maximum(np.linalg.norm(normal, axis=1, keepdims=True), 1e-12)
    nn = normal / double_area
    g = u[f[:, 0], None] * np.cross(nn, v2 - v1) + u[f[:, 1], None] * np.cross(nn, v0 - v2) + u[f[:, 2], None] * np.cross(nn, v1 - v0)
    return g / double_area


def region_vertices(mesh: trimesh.Trimesh, targets: list[np.ndarray], radius_mm: float = 2.5) -> np.ndarray:
    if not targets:
        return np.zeros(0, int)
    points = np.vstack(targets)
    tree = cKDTree(points)
    for r in (radius_mm, 4.0, 6.0, 9.0, 13.0):
        d, _ = tree.query(mesh.vertices)
        sel = np.nonzero(d / MM < r)[0]
        if len(sel) >= 12:
            return sel
    return sel


def extreme_vertices(mesh: trimesh.Trimesh, direction, fraction: float = 0.06) -> np.ndarray:
    score = mesh.vertices @ (np.array(direction, float) / np.linalg.norm(direction))
    return np.nonzero(score >= np.quantile(score, 1 - fraction))[0]


def dense(points: np.ndarray, faces: np.ndarray) -> np.ndarray:
    return np.vstack([points, sample_surface(points, faces, max(200, len(faces) * 3), rng())]) if len(faces) else points


def trace_fibres(mesh: trimesh.Trimesh, u: np.ndarray, sign: float, max_lines: int = 55, separation_mm: float = 3.8):
    v, f = mesh.vertices, mesh.faces
    grad = face_gradients(v, f, u)
    gnorm = np.linalg.norm(grad, axis=1)
    query = trimesh.proximity.ProximityQuery(mesh)
    seeds = sample_surface(v, f, 650, rng())
    seeds, _, tri = query.on_surface(seeds)

    def u_at(points, tris):
        bary = trimesh.triangles.points_to_barycentric(v[f[tris]], points)
        return (u[f[tris]] * bary).sum(1)

    us = u_at(seeds, tri)
    ok = (us > 0.03) & (us < 0.97) & (gnorm[tri] > 1e-9)
    seeds, tri = seeds[ok], tri[ok]
    step = 1.8 * MM

    def run(direction: float):
        paths = [[p] for p in seeds]
        pos, faces_now = seeds.copy(), tri.copy()
        uval = u_at(pos, faces_now)
        alive = np.ones(len(pos), bool)
        stall = np.zeros(len(pos), int)
        for _ in range(450):
            idx = np.nonzero(alive)[0]
            if not len(idx):
                break
            g = grad[faces_now[idx]] * direction
            g /= np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-12)
            moved = pos[idx] + g * step
            moved, _, new_tri = query.on_surface(moved)
            new_u = u_at(moved, new_tri)
            progress = (new_u - uval[idx]) * direction
            stall[idx] = np.where(progress > 1e-6, 0, stall[idx] + 1)
            pos[idx], faces_now[idx], uval[idx] = moved, new_tri, new_u
            for k, i in enumerate(idx):
                paths[i].append(moved[k])
            done = (new_u >= 0.985) if direction > 0 else (new_u <= 0.015)
            alive[idx[done | (stall[idx] > 6)]] = False
        return paths

    forward, backward = run(1.0), run(-1.0)
    lines = []
    for fw, bw in zip(forward, backward):
        line = np.array(bw[::-1] + fw[1:])
        length = np.linalg.norm(np.diff(line, axis=0), axis=1).sum() / MM
        if length > 15:
            lines.append((length, line))
    lines.sort(key=lambda item: -item[0])
    accepted: list[np.ndarray] = []
    accepted_points = np.zeros((0, 3))
    for _, line in lines:
        if len(accepted) >= max_lines:
            break
        # fibres converge on the insertion: judge spacing on the origin side only
        head = line[: max(2, int(len(line) * 0.6))]
        if len(accepted_points):
            d, _ = cKDTree(accepted_points).query(head)
            if (d / MM < separation_mm).mean() > 0.25:
                continue
        accepted.append(line)
        accepted_points = np.vstack([accepted_points, head])
    # lift slightly off the surface and simplify
    result = []
    for line in accepted:
        closest, _, tris = query.on_surface(line)
        lifted = closest + mesh.face_normals[tris] * sign * 0.5 * MM
        result.append(rdp(lifted, 0.3 * MM))
    return result


def rdp(points: np.ndarray, tolerance: float) -> np.ndarray:
    if len(points) < 3:
        return points
    start, end = points[0], points[-1]
    seg = end - start
    length = np.linalg.norm(seg)
    if length < 1e-12:
        d = np.linalg.norm(points - start, axis=1)
    else:
        d = np.linalg.norm(np.cross(points - start, seg / length), axis=1)
    i = int(np.argmax(d))
    if d[i] > tolerance:
        return np.vstack([rdp(points[: i + 1], tolerance)[:-1], rdp(points[i:], tolerance)])
    return np.vstack([start, end])


def attachment_points(attachments: list[dict], **match) -> list[np.ndarray]:
    out = []
    for item in attachments:
        if all(item.get(k) == val if not callable(val) else val(item.get(k)) for k, val in match.items()):
            out.append(dense(item["vertices"], item["faces"]))
    return out


def fibre_specs(attachments: list[dict]):
    att = lambda **m: attachment_points(attachments, **m)  # noqa: E731
    cartilages = [app_mesh(f"Left {n} costal cartilage").vertices for n in RIBS[:6]]
    return [
        ("pectoralis-major#clavicular", "Clavicular part of left pectoralis major", att(part="pectoralis-major#clavicular"), att(muscle="pectoralis-major", kind="insertion"), None),
        ("pectoralis-major#sternocostal", "Sternocostal part of left pectoralis major", att(part="pectoralis-major#sternocostal") + cartilages, att(muscle="pectoralis-major", kind="insertion"), None),
        ("pectoralis-major#abdominal", "Abdominal part of left pectoralis major", [], att(muscle="pectoralis-major", kind="insertion"), (0.45, -1.0, 0.2)),
        ("pectoralis-minor", "Left pectoralis minor", att(muscle="pectoralis-minor", kind="origin"), att(muscle="pectoralis-minor", kind="insertion"), None),
        ("serratus-anterior", "Left serratus anterior", att(muscle="serratus-anterior", kind="origin"), att(muscle="serratus-anterior", kind="insertion"), None),
        ("latissimus-dorsi", "Left latissimus dorsi", att(muscle="latissimus-dorsi", kind="origin"), att(muscle="latissimus-dorsi", kind="insertion"), "medial"),
        ("teres-major", "Left teres major", att(muscle="teres-major", kind="origin"), att(muscle="teres-major", kind="insertion"), None),
        ("subscapularis", "Left subscapularis", att(muscle="subscapularis", kind="origin"), att(muscle="subscapularis", kind="insertion"), None),
        ("deltoid#clavicular", "Clavicular part of left deltoid", att(part="deltoid#clavicular"), att(muscle="deltoid", kind="insertion"), None),
        ("deltoid#acromial", "Acromial part of left deltoid", att(part="deltoid#acromial"), att(muscle="deltoid", kind="insertion"), None),
        ("deltoid#spinal", "Spinal part of left deltoid", att(part="deltoid#spinal"), att(muscle="deltoid", kind="insertion"), None),
    ]


def muscle_field(source: str, origin_points, insertion_points, extra_origin=None, max_faces: int = 9000):
    mesh = simplify(app_mesh(source), max_faces)
    origin = region_vertices(mesh, origin_points)
    if extra_origin == "medial":
        x = mesh.vertices[:, 0]
        origin = np.union1d(origin, np.nonzero(x > x.max() - 14 * MM)[0])
    elif extra_origin is not None:
        origin = np.union1d(origin, extreme_vertices(mesh, extra_origin))
    insertion = region_vertices(mesh, insertion_points)
    insertion = np.setdiff1d(insertion, origin)
    if len(origin) < 3 or len(insertion) < 3:
        return mesh, None, origin, insertion
    lap = cotan_laplacian(mesh.vertices, mesh.faces)
    fixed = np.concatenate([origin, insertion])
    u = harmonic(lap, fixed, np.concatenate([np.zeros(len(origin)), np.ones(len(insertion))]))
    return mesh, np.clip(u, 0, 1), origin, insertion


def partition(source: str, groups: list[tuple[str, np.ndarray]], max_faces: int = 9000):
    """Harmonic partition: each vertex goes to the origin whose harmonic field is largest there."""
    mesh = simplify(app_mesh(source), max_faces)
    sets = [(label, region_vertices(mesh, [pts], radius_mm=2.5)) for label, pts in groups]
    sets = [(label, s) for label, s in sets if len(s) >= 3]
    lap = cotan_laplacian(mesh.vertices, mesh.faces)
    fields = []
    for k, (_, s) in enumerate(sets):
        others = np.setdiff1d(np.concatenate([o for j, (_, o) in enumerate(sets) if j != k]), s)
        fixed = np.concatenate([s, others])
        fields.append(harmonic(lap, fixed, np.concatenate([np.ones(len(s)), np.zeros(len(others))])))
    labels = np.argmax(np.vstack(fields), axis=0)
    return mesh, [label for label, _ in sets], labels


# --------------------------------------------------------------------------------------------------
# 5. hila, borders, skin markings and zones
# --------------------------------------------------------------------------------------------------
def first_contact(vessel: str, muscle: str, start: np.ndarray, threshold_mm: float = 3.0):
    """Point where the vessel/nerve first reaches the muscle, walking from its proximal end."""
    vessel_mesh = app_mesh(vessel)
    pts = sample_surface(vessel_mesh.vertices, vessel_mesh.faces, 40000, rng())
    muscle_mesh = app_mesh(muscle)
    msamples = sample_surface(muscle_mesh.vertices, muscle_mesh.faces, 250000, rng())
    d, _ = cKDTree(msamples).query(pts)
    touching = pts[d / MM < threshold_mm]
    if not len(touching):
        return None
    order = np.linalg.norm(touching - start, axis=1)
    return touching[np.argmin(order)]


def body_axis():
    verts = np.vstack([app_mesh(f"Left {n} rib").vertices for n in RIBS[:10]] + [app_mesh(f"Right {n} rib").vertices for n in RIBS[:10]])
    return np.array([verts[:, 0].mean(), 0.0, verts[:, 2].mean()])


AXIS = None


def angle_about_axis(points: np.ndarray) -> np.ndarray:
    """0 = lateral on the operative side (-X), +90 deg = anterior, -90 deg = posterior."""
    return np.degrees(np.arctan2(points[:, 2] - AXIS[2], -(points[:, 0] - AXIS[0])))


def latissimus_border() -> np.ndarray:
    verts = app_mesh("Left latissimus dorsi").vertices
    top, bottom = verts[:, 1].max(), verts[:, 1].min()
    pts = []
    for y in np.arange(top - 6 * MM, bottom, -6 * MM):
        band = verts[np.abs(verts[:, 1] - y) < 3 * MM]
        if len(band) < 10:
            continue
        band = band[band[:, 0] < AXIS[0]]
        if not len(band):
            continue
        pts.append(band[np.argmax(angle_about_axis(band))])
    pts = np.array(pts)
    smooth = pts.copy()
    smooth[1:-1] = (pts[:-2] + pts[1:-1] + pts[2:]) / 3
    return smooth


def skin_project(points: np.ndarray, max_mm: float = 45.0):
    closest, distance, tri = proximity("VH_F_skin (trunk region)").on_surface(points)
    normals = app_mesh("VH_F_skin (trunk region)").face_normals[tri]
    radial = closest - AXIS
    radial[:, 1] = 0
    normals = np.where(((normals * radial).sum(1) < 0)[:, None], -normals, normals)
    lifted = closest + normals * 1.2 * MM
    ok = distance / MM < max_mm
    return lifted, ok


def densify(points: np.ndarray, spacing_mm: float = 4.0) -> np.ndarray:
    out = [points[0]]
    for a, b in zip(points[:-1], points[1:]):
        n = max(1, int(np.linalg.norm(b - a) / (spacing_mm * MM)))
        out.extend(a + (b - a) * (k / n) for k in range(1, n + 1))
    return np.array(out)


def skin_line(points: np.ndarray, max_mm: float = 45.0) -> np.ndarray:
    lifted, ok = skin_project(densify(points), max_mm)
    return lifted[ok]


def skin_ring(y: float) -> np.ndarray:
    """Horizontal skin contour at height y on the operative half (exact plane section, 1-degree bins)."""
    skin = app_mesh("VH_F_skin (trunk region)")
    segments = trimesh.intersections.mesh_plane(skin, plane_normal=[0, 1, 0], plane_origin=[0, y, 0])
    if not len(segments):
        return np.zeros((0, 3))
    pts = segments.reshape(-1, 3)
    pts = np.vstack([pts, segments.mean(1)])
    pts = pts[pts[:, 0] < AXIS[0] + 30 * MM]
    theta = angle_about_axis(pts)
    radius = np.hypot(pts[:, 0] - AXIS[0], pts[:, 2] - AXIS[2])
    angles = np.arange(np.floor(theta.min()), np.ceil(theta.max()), 1.0) + 0.5
    radii = np.full(len(angles), np.nan)
    for k, t in enumerate(angles):
        sel = np.abs(theta - t) < 0.5
        if sel.any():
            radii[k] = radius[sel].max()  # outer surface where the section folds (axilla)
    ok = ~np.isnan(radii)
    if ok.sum() < 7:
        return np.zeros((0, 3))
    radii = np.interp(angles, angles[ok], radii[ok])
    a = np.radians(angles)
    return np.stack([AXIS[0] - radii * np.cos(a), np.full(len(a), y), AXIS[2] + radii * np.sin(a)], axis=1)


def walk_on_skin(start: np.ndarray, distances_mm: list[float], towards: float) -> list[np.ndarray | None]:
    """Points on the skin contour through `start` at the given arc lengths; towards=+1 anterior, -1 posterior."""
    ring = skin_ring(start[1])
    if len(ring) < 10:
        return [None] * len(distances_mm)
    i = int(np.argmin(np.linalg.norm(ring - start, axis=1)))
    step = 1 if towards > 0 else -1
    walked, j, results = 0.0, i, {}
    while 0 <= j + step < len(ring) and len(results) < len(distances_mm):
        seg = np.linalg.norm(ring[j + step] - ring[j]) / MM
        for t in distances_mm:
            if t not in results and walked + seg >= t:
                a = (t - walked) / max(seg, 1e-9)
                results[t] = ring[j] + (ring[j + step] - ring[j]) * a
        walked += seg
        j += step
    return [results.get(t) for t in distances_mm]


def rib_level_near(rib: int, point: np.ndarray) -> float:
    verts = app_mesh(f"Left {RIBS[rib - 1]} rib").vertices
    return float(verts[np.argmin(np.linalg.norm(verts - point, axis=1))][1])


def rib_at_line(rib: int, x: float) -> np.ndarray | None:
    meshes = [app_mesh(f"Left {RIBS[rib - 1]} rib").vertices]
    if rib <= 10:
        meshes.append(app_mesh(f"Left {RIBS[rib - 1]} costal cartilage").vertices)
    verts = np.vstack(meshes)
    band = verts[(np.abs(verts[:, 0] - x) < 4 * MM) & (verts[:, 2] > AXIS[2])]
    if not len(band):
        return None
    return band[np.argmax(band[:, 2])]


def strip(left: list[np.ndarray], right: list[np.ndarray]):
    pairs = [(a, b) for a, b in zip(left, right) if a is not None and b is not None]
    if len(pairs) < 2:
        return None
    a = np.array([p[0] for p in pairs])
    b = np.array([p[1] for p in pairs])

    def lift(points):  # contour points lie on the skin: push them out radially by 1.2 mm
        radial = points - AXIS
        radial[:, 1] = 0
        return points + radial / np.linalg.norm(radial, axis=1, keepdims=True) * 1.2 * MM

    return {"left": rnd(lift(a)), "right": rnd(lift(b))}


def rnd(points) -> list:
    return [[round(float(c), 5) for c in p] for p in np.asarray(points)]


def markings_and_zones(landmarks: list[dict]):
    lm = {item["id"]: np.array(item["point"]) for item in landmarks}
    markings, zones, info = [], [], {}
    border = latissimus_border()
    info["ldBorder"] = border
    border_skin = skin_line(border, max_mm=60)
    markings.append({"id": "borda-grande-dorsal", "label": "Borda anterior (livre) do grande dorsal", "kind": "line", "color": "#a78bfa", "points": rnd(border_skin),
                     "note": "Projeção na pele da borda livre do grande dorsal (prega axilar posterior). Referência para retalhos do grande dorsal, TDAP e perfurantes laterais."})
    # anterior axillary fold: inferolateral border of pectoralis major in frontal projection
    pm = np.vstack([app_mesh(s).vertices for s in ("Clavicular part of left pectoralis major", "Sternocostal part of left pectoralis major", "Abdominal part of left pectoralis major")])
    ring = list(ConvexHull(pm[:, :2]).vertices)  # counter-clockwise, indices into pm
    ia = int(np.argmin(pm[ring, 0]))  # most lateral (operative side is -X)
    ib = int(np.argmin(pm[ring, 1]))  # lowest
    forward = [ring[(ia + k) % len(ring)] for k in range((ib - ia) % len(ring) + 1)]
    backward = [ring[(ia - k) % len(ring)] for k in range((ia - ib) % len(ring) + 1)]
    chain = min((forward, backward), key=lambda c: (pm[c, 0] + pm[c, 1]).mean())  # the inferolateral one
    fold = pm[chain]
    markings.append({"id": "prega-axilar-anterior", "label": "Borda inferolateral do peitoral maior (prega axilar anterior)", "kind": "line", "color": "#f472b6", "points": rnd(skin_line(fold, 50)),
                     "note": "Limite anterior da axila; a incisão axilar costuma ficar posterior a ela."})
    clav = app_mesh("Left clavicle").vertices
    c0 = clav.mean(0)
    _, _, vt = np.linalg.svd(clav - c0, full_matrices=False)
    t = (clav - c0) @ vt[0]
    clav_line = []
    for lo in np.linspace(t.min(), t.max(), 14)[:-1]:
        band = clav[(t >= lo) & (t < lo + (t.max() - t.min()) / 13)]
        if len(band):
            clav_line.append(band[np.argmax(band[:, 1] + band[:, 2])])
    markings.append({"id": "clavicula", "label": "Clavícula", "kind": "line", "color": "#e2e8f0", "points": rnd(skin_line(np.array(clav_line), 30)), "note": ""})
    scap = app_mesh("Left scapula").vertices
    medial = []
    for y in np.arange(scap[:, 1].max() - 3 * MM, scap[:, 1].min(), -6 * MM):
        band = scap[np.abs(scap[:, 1] - y) < 3 * MM]
        if len(band):
            medial.append(band[np.argmax(band[:, 0])])
    markings.append({"id": "margem-medial-escapula", "label": "Margem medial da escápula", "kind": "line", "color": "#e2e8f0", "points": rnd(skin_line(np.array(medial), 60)), "note": ""})
    sternum = np.vstack([app_mesh(s).vertices for s in ("Manubrium", "Body of sternum", "Xiphoid process")])
    mid = []
    for y in np.arange(sternum[:, 1].max() - 2 * MM, sternum[:, 1].min(), -8 * MM):
        band = sternum[np.abs(sternum[:, 1] - y) < 4 * MM]
        if len(band):
            mid.append(band[np.argmax(band[:, 2])])
    markings.append({"id": "linha-esternal", "label": "Linha esternal mediana", "kind": "line", "color": "#e2e8f0", "points": rnd(skin_line(np.array(mid), 30)), "note": ""})
    x_mc = (lm["clavicula.extremidade-esternal"][0] + lm["clavicula.extremidade-acromial"][0]) / 2
    info["xMidclavicular"] = x_mc
    skin = app_mesh("VH_F_skin (trunk region)").vertices
    mcl = []
    for y in np.arange(lm["clavicula.corpo"][1], lm["esterno.xifoide"][1] - 40 * MM, -6 * MM):
        band = skin[(np.abs(skin[:, 0] - x_mc) < 2.5 * MM) & (np.abs(skin[:, 1] - y) < 3 * MM)]
        if len(band):
            mcl.append(band[np.argmax(band[:, 2])])
    mcl_skin, _ = skin_project(np.array(mcl))
    markings.append({"id": "linha-hemiclavicular", "label": "Linha hemiclavicular", "kind": "line", "color": "#94a3b8", "points": rnd(mcl_skin), "note": "Vertical pelo ponto médio da clavícula."})
    fat = app_mesh("VH_F_fat_L").vertices
    imf = []
    for x in np.arange(fat[:, 0].min() + 6 * MM, fat[:, 0].max() - 6 * MM, 6 * MM):
        band = fat[np.abs(fat[:, 0] - x) < 3 * MM]
        if len(band):
            imf.append(band[np.argmin(band[:, 1])])
    markings.append({"id": "sulco-inframamario", "label": "Sulco inframamário", "kind": "line", "color": "#fda4af", "points": rnd(skin_line(np.array(imf), 25)),
                     "note": "Limite inferior do corpo adiposo mamário projetado na pele."})
    for ident, label, note in (
        ("esterno.incisura-jugular", "Incisura jugular", ""),
        ("esterno.angulo-esternal", "Ângulo esternal · 2ª costela", "Comece aqui a contagem de costelas e espaços intercostais."),
        ("esterno.xifoide", "Processo xifoide", ""),
        ("escapula.coracoide", "Processo coracoide", "Palpável no sulco deltopeitoral, abaixo da clavícula."),
        ("escapula.acromio", "Acrômio", ""),
        ("escapula.angulo-inferior", "Ângulo inferior da escápula", "Nível aproximado de T7."),
    ):
        if ident in lm:
            p, ok = skin_project(lm[ident][None], 70)
            if ok[0]:
                markings.append({"id": "pt-" + ident, "label": label, "kind": "point", "color": "#e2e8f0", "points": rnd(p), "note": note})
    # intercostal spaces on the midclavicular line
    ribs_mcl = {k: rib_at_line(k, x_mc) for k in range(1, 6)}
    for k in range(1, 5):
        a, b = ribs_mcl.get(k), ribs_mcl.get(k + 1)
        if a is None or b is None:
            continue
        p, ok = skin_project(((a + b) / 2)[None], 60)
        if ok[0]:
            markings.append({"id": f"eic-{k}", "label": f"{k}º EIC", "kind": "point", "color": "#94a3b8", "points": rnd(p), "note": "Espaço intercostal na linha hemiclavicular."})

    # --- perforator zones (probabilistic; values in src/data/literature.ts) --------------------
    rib_y = {}
    # use each rib's crossing with the border: nearest rib vertex to the border polyline
    for k in range(3, 10):
        verts = app_mesh(f"Left {RIBS[k - 1]} rib").vertices
        d, j = cKDTree(border).query(verts)
        rib_y[k] = float(verts[np.argmin(d)][1])
    info["ribYAtBorder"] = rib_y

    def border_at(y):
        i = np.argmin(np.abs(border[:, 1] - y))
        return border[i]

    def licap_strip(lo_rib, hi_rib):
        ys = np.linspace(rib_y[lo_rib], rib_y[hi_rib], 8)
        left, right = [], []
        for y in ys:
            start, _ = skin_project(border_at(y)[None])
            p1, p2 = walk_on_skin(start[0], [26.7, 34.9], +1)
            left.append(p1)
            right.append(p2)
        return strip(left, right)

    licap = licap_strip(4, 8)
    dominant = licap_strip(6, 7)
    if licap:
        zones.append({"id": "licap", "label": "Perfurantes intercostais laterais (LICAP)", "color": "#38bdf8", "strip": licap, "emphasis": dominant,
                      "emphasisLabel": "6º EIC: maior perfurante em 38,6%", "refs": ["licap-2008"],
                      "note": "Faixa a 2,7–3,5 cm anterior à borda do grande dorsal, do 4º ao 7º espaço intercostal (médias por espaço do estudo cadavérico). Medida na pele do modelo; no estudo, sobre a parede torácica."})
    # TDAP: 9.5-15.4 cm below the posterior axillary fold, up to 4.3 cm posterior to the LD border
    fold_top = border_skin[np.argmax(border_skin[:, 1])]
    arc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(border_skin, axis=0), axis=1))]) / MM
    left, right = [], []
    for s in np.linspace(95, 154, 8):
        if s > arc[-1]:
            break
        i = int(np.searchsorted(arc, s))
        p = border_skin[min(i, len(border_skin) - 1)]
        q = walk_on_skin(p, [0.5, 43], -1)
        left.append(q[0])
        right.append(q[1])
    tdap = strip(left, right)
    if tdap:
        zones.append({"id": "tdap", "label": "Perfurantes do ramo descendente da toracodorsal (TDAP)", "color": "#f59e0b", "strip": tdap, "refs": ["tdap-2010"],
                      "note": "9,5–15,4 cm abaixo da prega axilar posterior, até 4,3 cm medial à borda do grande dorsal (estudo de injeção, 15 retalhos). Referência clínica comum: primeira perfurante ~8 cm abaixo da prega."})
    info["posteriorFold"] = fold_top
    # IMAP: 1st-3rd intercostal spaces, 0.9-2.5 cm lateral to the sternal border
    sternum_body = np.vstack([app_mesh(s).vertices for s in ("Manubrium", "Body of sternum")])
    rib_mid = {k: rib_at_line(k, float(np.percentile(sternum_body[:, 0], 5)) - 12 * MM) for k in range(1, 5)}
    left, right = [], []
    for k in range(1, 4):
        a, b = rib_mid.get(k), rib_mid.get(k + 1)
        if a is None or b is None:
            continue
        for y in np.linspace(a[1], b[1], 4)[1:-1]:
            band = sternum_body[np.abs(sternum_body[:, 1] - y) < 4 * MM]
            if not len(band):
                continue
            edge = band[np.argmin(band[:, 0])]
            start, _ = skin_project(edge[None])
            p1, p2 = walk_on_skin(start[0], [9, 25], -1)
            left.append(p1)
            right.append(p2)
    imap = strip(left, right)
    if imap:
        zones.append({"id": "imap", "label": "Perfurantes da torácica interna (IMAP)", "color": "#34d399", "strip": imap, "refs": ["imap-2017"],
                      "note": "1º a 3º espaços intercostais, 0,9–2,5 cm lateral à borda do esterno; a dominante sai do 2º EIC em 55% (angiotomografia). Medida na pele do modelo."})
    return markings, zones, info


# --------------------------------------------------------------------------------------------------
# 6. measurements (model values; literature ranges live in src/data/literature.ts)
# --------------------------------------------------------------------------------------------------
def humeral_axis(landmarks):
    hum = app_mesh("Left humerus").vertices
    c = hum.mean(0)
    _, _, vt = np.linalg.svd(hum - c, full_matrices=False)
    axis = vt[0]
    head = np.array(next(item["point"] for item in landmarks if item["id"] == "umero.cabeca"))
    if np.dot(head - c, axis) > 0:
        axis = -axis
    top = ((hum - c) @ axis).min()
    return c, axis, top


def span_on_humerus(points, c, axis, top):
    t = ((points - c) @ axis - top) / MM
    return round(float(t.min()), 1), round(float(t.max()), 1)


def measurements(landmarks, attachments, info):
    c, axis, top = humeral_axis(landmarks)
    out = {}
    pm = next((a for a in attachments if a["muscle"] == "pectoralis-major" and a["kind"] == "insertion" and a["source"] == "Z-Anatomy"), None)
    if pm is not None:
        lo, hi = span_on_humerus(pm["vertices"], c, axis, top)
        out["pecMajorInsertion"] = {"fromHeadTopMm": lo, "lengthMm": round(hi - lo, 1), "source": "área Z-Anatomy transferida"}
    parts = {}
    hum = app_mesh("Left humerus")
    hs = sample_surface(hum.vertices, hum.faces, 60000, rng())
    for part, (source, _) in MESH_PARTS.items():
        if not part.startswith("pectoralis-major"):
            continue
        m = app_mesh(source)
        d, _ = cKDTree(sample_surface(m.vertices, m.faces, 150000, rng())).query(hs)
        touching = hs[d / MM < 2.0]
        if len(touching):
            lo, hi = span_on_humerus(touching, c, axis, top)
            parts[part] = {"fromHeadTopMm": lo, "toMm": hi}
    out["pecMajorPartsOnHumerus"] = parts
    for structure in ("latissimus-dorsi", "teres-major"):
        a = next((x for x in attachments if x["muscle"] == structure and x["kind"] == "insertion"), None)
        if a is not None:
            lo, hi = span_on_humerus(a["vertices"], c, axis, top)
            out[f"{structure}Insertion"] = {"fromHeadTopMm": lo, "lengthMm": round(hi - lo, 1), "source": "contato músculo-osso"}
    out["humerusLengthMm"] = round(float(((hum.vertices - c) @ axis - top).max() / MM))
    hilum = info.get("ldHilum")
    if hilum is not None:
        border = info["ldBorder"]
        out["ldHilum"] = {
            "toBorderMm": round(float(np.min(np.linalg.norm(border - hilum, axis=1)) / MM), 1),
            "toSubscapularOriginMm": round(float(np.linalg.norm(hilum - info["subscapularOrigin"]) / MM), 1),
        }
    return out


# --------------------------------------------------------------------------------------------------
# 7. binary packing
# --------------------------------------------------------------------------------------------------
class Packer:
    def __init__(self, lo: np.ndarray, hi: np.ndarray):
        self.lo = lo
        self.scale = (hi - lo) / 65535.0
        self.positions: list[np.ndarray] = []
        self.indices: list[np.ndarray] = []
        self.counts: list[np.ndarray] = []
        self.labels: list[np.ndarray] = []
        self.n_pos = self.n_idx = self.n_counts = self.n_labels = 0

    def add_positions(self, points: np.ndarray) -> tuple[int, int]:
        q = np.clip(np.round((points - self.lo) / self.scale), 0, 65535).astype(np.uint16)
        start = self.n_pos
        self.positions.append(q)
        self.n_pos += len(q)
        return start, len(q)

    def add_indices(self, faces: np.ndarray) -> tuple[int, int]:
        start = self.n_idx
        flat = faces.astype(np.uint16).ravel()
        self.indices.append(flat)
        self.n_idx += len(flat)
        return start, len(flat)

    def add_counts(self, counts) -> tuple[int, int]:
        start = self.n_counts
        arr = np.asarray(counts, np.uint16)
        self.counts.append(arr)
        self.n_counts += len(arr)
        return start, len(arr)

    def add_labels(self, labels) -> tuple[int, int]:
        start = self.n_labels
        arr = np.asarray(labels, np.uint8)
        self.labels.append(arr)
        self.n_labels += len(arr)
        return start, len(arr)

    def write(self, path: Path) -> dict:
        blobs = [
            ("positions", np.concatenate(self.positions).ravel() if self.positions else np.zeros(0, np.uint16)),
            ("indices", np.concatenate(self.indices) if self.indices else np.zeros(0, np.uint16)),
            ("lineCounts", np.concatenate(self.counts) if self.counts else np.zeros(0, np.uint16)),
            ("labels", np.concatenate(self.labels) if self.labels else np.zeros(0, np.uint8)),
        ]
        layout, offset, chunks = {}, 0, []
        for name, arr in blobs:
            data = arr.tobytes()
            layout[name] = {"byteOffset": offset, "length": int(arr.size)}
            chunks.append(data)
            offset += len(data)
            pad = (-offset) % 4
            chunks.append(b"\0" * pad)
            offset += pad
        path.write_bytes(b"".join(chunks))
        return {"layout": layout, "byteLength": offset, "quantization": {"min": [float(v) for v in self.lo], "step": [float(v) for v in self.scale]}}


# --------------------------------------------------------------------------------------------------
def main() -> None:
    global AXIS
    skeleton = json.loads(SKELETON.read_text())
    AXIS = body_axis()
    print("fitting Z-Anatomy bones onto the model …")
    transforms, fit = fit_bones(skeleton)
    for b, r in fit.items():
        print(f"  {b:22s} median {r['medianMm']:.2f} mm  p95 {r['p95Mm']:.2f} mm")

    print("landmarks …")
    landmarks = bone_landmarks(skeleton, transforms) + computed_landmarks() + rib_labels()

    print("attachment areas …")
    attachments = transferred_attachments(skeleton, transforms) + computed_attachments(landmarks)

    print("hila …")
    hila = []
    info: dict = {}
    sub = app_mesh("Trunk of left subscapular artery").vertices
    axillary = app_mesh("Left axillary artery")
    d, _ = cKDTree(sample_surface(axillary.vertices, axillary.faces, 40000, rng())).query(sub)
    info["subscapularOrigin"] = sub[np.argmin(d)]
    hilum = first_contact("Left thoracodorsal artery", "Left latissimus dorsi", info["subscapularOrigin"])
    if hilum is not None:
        p, _, n = snap("Left latissimus dorsi", hilum[None])
        info["ldHilum"] = p[0]
        hila.append(landmark("hilo.grande-dorsal", "Hilo neurovascular do grande dorsal", None, p[0], n[0], "calculado",
                             "Onde a artéria toracodorsal alcança a face profunda do músculo (contato < 3 mm entre as malhas).", False,
                             category="hilo", bone="Grande dorsal", structure="latissimus-dorsi"))
    nerve = first_contact("Left thoracodorsal nerve", "Left latissimus dorsi", info["subscapularOrigin"])
    if nerve is not None:
        p, _, n = snap("Left latissimus dorsi", nerve[None])
        hila.append(landmark("hilo.nervo-toracodorsal", "Entrada do nervo toracodorsal no grande dorsal", None, p[0], n[0], "calculado",
                             "Primeiro contato do nervo com a face profunda do músculo.", False, category="hilo", bone="Grande dorsal", structure="latissimus-dorsi"))
    mpn = first_contact("Left medial pectoral nerve", "Left pectoralis minor", info["subscapularOrigin"], threshold_mm=2.0)
    if mpn is not None:
        p, _, n = snap("Left pectoralis minor", mpn[None])
        hila.append(landmark("hilo.peitoral-medial", "Nervo peitoral medial no peitoral menor", None, p[0], n[0], "calculado",
                             "O nervo peitoral medial costuma perfurar o peitoral menor a caminho do peitoral maior.", False,
                             category="hilo", bone="Peitoral menor", structure="pectoralis-minor"))

    print("markings and zones …")
    markings, zones, zinfo = markings_and_zones(landmarks)
    info.update(zinfo)

    print("fibres and partitions …")
    lo = np.min([app_mesh("VH_F_skin (trunk region)").bounds[0], app_mesh("Left humerus").bounds[0], app_mesh("Left hip bone").bounds[0]], axis=0) - 0.05
    hi = np.max([app_mesh("VH_F_skin (trunk region)").bounds[1], app_mesh("Left humerus").bounds[1], app_mesh("Left hip bone").bounds[1]], axis=0) + 0.05
    packer = Packer(lo, hi)
    att_out = []
    for a in attachments:
        p0, pn = packer.add_positions(a["vertices"])
        i0, iN = packer.add_indices(a["faces"])
        centroid = a["vertices"].mean(0)
        att_out.append({k: v for k, v in a.items() if k not in ("vertices", "faces")} | {"centroid": rnd([centroid])[0], "positions": [p0, pn], "indices": [i0, iN]})
    fibres_out = []
    for ident, source, origin, insertion, extra in fibre_specs(attachments):
        mesh, u, o, i = muscle_field(source, origin, insertion, extra)
        if u is None:
            print(f"  {ident}: origin {len(o)} / insertion {len(i)} vertices — skipped")
            continue
        lines = trace_fibres(mesh, u, outward_sign(mesh))
        counts = [len(line) for line in lines]
        p0, pn = packer.add_positions(np.vstack(lines))
        c0, cn = packer.add_counts(counts)
        structure, _, part = ident.partition("#")
        fibres_out.append({"id": ident, "structure": structure, "part": ident if part else None, "lines": len(lines), "positions": [p0, pn], "counts": [c0, cn]})
        print(f"  {ident}: {len(lines)} fibres, {pn} points (origin {len(o)}, insertion {len(i)} vertices)")
    regions_out = []
    for structure, source, label_fmt, min_rib in (
        ("serratus-anterior", "Left serratus anterior", "Serrátil anterior · digitação da {rib}", 1),
        ("pectoralis-minor", "Left pectoralis minor", "Peitoral menor · fascículo da {rib}", 3),
    ):
        groups = [(a["rib"], dense(a["vertices"], a["faces"])) for a in attachments if a["muscle"] == structure and a["kind"] == "origin" and a["rib"]]
        mesh, ribs, labels = partition(source, groups)
        p0, pn = packer.add_positions(mesh.vertices)
        l0, ln = packer.add_labels(labels)
        parts = []
        for k, rib in enumerate(ribs):
            text = "1ª–2ª costelas" if (structure == "serratus-anterior" and rib == 1) else f"{rib}ª costela"
            parts.append({"id": f"{structure}#rib-{rib}", "label": label_fmt.format(rib=text), "rib": rib, "labelIndex": k})
        regions_out.append({"structure": structure, "parts": parts, "positions": [p0, pn], "labels": [l0, ln],
                            "method": "partição harmônica pela costela de origem (áreas de fixação Z-Anatomy)"})
        print(f"  {structure}: {len(parts)} regions, {pn} samples")

    meas = measurements(landmarks, attachments, info)
    print("measurements:", json.dumps(meas, ensure_ascii=False))
    layout = packer.write(OUT_BIN)
    parts = [{"id": part, "structure": part.split("#")[0], "label": label, "meshNames": [BY_SOURCE[source]["name"]]} for part, (source, label) in MESH_PARTS.items() if source in BY_SOURCE]
    data = {
        "version": 1,
        "bin": "models/hybrid/anatomy-layers.bin",
        **layout,
        "fit": {BONES[b][2] if b in BONES else b: r for b, r in fit.items()},
        "landmarks": landmarks + hila,
        "attachments": att_out,
        "parts": parts,
        "regions": regions_out,
        "fibres": fibres_out,
        "markings": markings,
        "zones": zones,
        "measurements": meas,
    }
    OUT_JSON.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{len(landmarks) + len(hila)} landmarks, {len(att_out)} attachment areas, {len(fibres_out)} fibre sets, {len(markings)} markings, {len(zones)} zones")
    print(f"wrote {OUT_JSON.relative_to(ROOT)} ({OUT_JSON.stat().st_size / 1e3:.0f} kB) and {OUT_BIN.relative_to(ROOT)} ({OUT_BIN.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
