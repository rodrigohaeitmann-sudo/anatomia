#!/usr/bin/env python3
"""Anatomy of the flap reconstructions that the torso model does not carry (docs/plano-retalhos-miocutaneos.md, 3.4).

The TRAM needs the abdominal wall below the costal margin. The torso model has only the external oblique and the
left hip bone. Its skin also stops just below the anterior superior iliac spines. These sources are placed in the
frame of the model with the very transforms of build_hybrid_model.py, recomputed here (the ICP is deterministic), and
written into assets/build/flap-meshes/ in model space (the format of decode_model.mjs). The build_flaps.py pipeline
reads them; the torso GLB is not touched.

  * Z-Anatomy, by the similarity estimated on the serratus and the latissimus: both recti abdominis and pyramidales,
    the linea alba, the internal oblique and the transversus of the operated side, the external oblique of the other
    side, the investing fascia of the abdomen and the inguinal ligaments;
  * BodyParts3D 4.3, in its own frame (flap-sources.json): deep and superficial inferior epigastric vessels, external
    iliac vessels, the epigastric vessels of the other side, the right hip bone and the inguinal ligaments;
  * HRA, by the rigid skin-to-skin ICP: the skin of the lower trunk down to the pubis.

A check reports how far the transforms reproduce the torso model (meshes present in both).

Conformation of the abdominal wall. The deep anatomy is that of male bodies (BodyParts3D, and Z-Anatomy placed on it).
The skin is that of the Visible Human Female, registered on the chest. Below the costal margin, her abdomen lies some
10 cm in front of the male recti and obliques: a TRAM cut from that skin would be 10 cm thick. As with the base of the
breast in build_hybrid_model.py, the deep structures of the anterior abdominal wall are moved forwards, radially in the
chart of the trunk, by a smooth field. The field leaves the subcutaneous layer of a woman with abundant lower abdominal
tissue (CONFORM.target: 25 mm in the epigastrium to 38 mm in the lower abdomen) and fades to zero at the insertions of
the rectus (costal cartilages above, pubis below) and towards the flanks. All the layers of the wall move together; the
pelvis, the external iliac vessels and the bones do not move. The superior epigastric vessels and the external oblique of the operated side,
which are in the torso model, get conformed copies here; the TRAM views show those instead (reconstructionSteps.json
`replaces`).

Usage: python3 scripts/hybrid/build_flap_sources.py   (after fetch_sources.py and extract_zanatomy.mjs)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree

sys.path.insert(0, str(Path(__file__).parent))
import build_breast as bb  # noqa: E402
import build_hybrid_model as hm  # noqa: E402
from meshio_utils import apply, load_obj, load_stl, load_za, weld  # noqa: E402

OUT = hm.ROOT / "assets" / "build" / "flap-meshes"
MODEL = hm.ROOT / "assets" / "build" / "model-meshes"
ZA_DIR = hm.SRC / "z-anatomy" / "extracted"
# Z-Anatomy name -> (part, tissue)
ZA_PARTS = {
    "Rectus_abdominis_musclel": ("rectus", "muscle"),
    "Rectus_abdominis_muscler": ("contra-rectus", "muscle"),
    "Pyramidalis_musclel": ("pyramidalis", "muscle"),
    "Pyramidalis_muscler": ("contra-pyramidalis", "muscle"),
    "Linea_alba": ("linea-alba", "fascia"),
    "Internal_abdominal_oblique_musclel": ("internal-oblique", "muscle"),
    "Transversus_abdominis_musclel": ("transversus", "muscle"),
    "External_abdominal_oblique_muscler": ("contra-external-oblique", "muscle"),
    "Investing_abdominal_fascial": ("investing-fascia", "fascia"),
    "Investing_abdominal_fasciar": ("contra-investing-fascia", "fascia"),
}
# the lower trunk skin kept from the HRA envelope (model frame, mm): the whole circumference between these heights
SKIN_Y = (-470.0, -90.0)
# meshes of the torso model the TRAM views show conformed (see above)
MODEL_CONFORMED = {"bp43_FJ1452M": ("external-oblique", "muscle"), "bp43_FJ1971": ("sea", "artery"), "bp43_FJ3530": ("sev", "vein")}
# conformation of the abdominal wall (chart of the trunk, mm): target subcutaneous thickness by height above the nipple,
# fades (to zero at the insertions of the rectus, towards the flanks) and the depth over which it fades below the wall
CONFORM = {
    "target": [(-90.0, 25.0), (-150.0, 30.0), (-204.0, 35.0), (-280.0, 38.0), (-330.0, 34.0), (-370.0, 30.0)],
    "top": (-45.0, 85.0), "bottom": (-362.0, 70.0), "lateral": (300.0, 130.0), "sigmaMm": 15.0,
}
WALL_PARTS = {"rectus", "contra-rectus", "linea-alba", "internal-oblique", "contra-external-oblique", "investing-fascia", "contra-investing-fascia"}
NOT_CONFORMED = {"iliac", "contra-iliac", "contra-hip", "lower-skin"}


def write(name: str, verts_view: np.ndarray, faces: np.ndarray, index: dict, meta: dict) -> None:
    (OUT / f"{name}.pos.bin").write_bytes(verts_view.astype(np.float32).tobytes())
    (OUT / f"{name}.idx.bin").write_bytes(faces.astype(np.uint32).tobytes())
    index[name] = {**meta, "vertices": int(len(verts_view)), "triangles": int(len(faces))}


def model_mesh(name: str) -> np.ndarray:
    return np.fromfile(MODEL / f"{name}.pos.bin", dtype=np.float32).reshape(-1, 3).astype(np.float64)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    report: dict = {}
    # the two BodyParts3D muscles the Z-Anatomy similarity is estimated on (build_hybrid_model.register_zanatomy)
    serratus = next(s for s in json.loads((Path(__file__).parent / "bp3d43-selection.json").read_text()) if s["name"] == "Left serratus anterior")
    mesh = weld(*load_obj(hm.SRC / "bp3d-4.3" / "obj" / f"{serratus['fj']}.obj"))
    hm.add_mesh(f"bp43_{serratus['fj']}", np.asarray(mesh.vertices), np.asarray(mesh.faces), "serratus-anterior", "muscle", "BodyParts3D 4.3", serratus["name"])
    mesh = weld(*load_stl(hm.SRC / "bp3d-3.0" / "FMA13359.stl"))
    hm.add_mesh("bp30_FMA13359", np.asarray(mesh.vertices), np.asarray(mesh.faces), "latissimus-dorsi", "muscle", "BodyParts3D 3.0", "Left latissimus dorsi")
    t_za = hm.register_zanatomy(report)
    t_hra, skin = hm.register_hra(report)

    def to_view(points: np.ndarray) -> np.ndarray:
        return hm.to_view(points, t_za)

    units = json.loads((hm.ROOT / "src/data/hybridTorsoManifest.json").read_text())["landmarks"]["unitsPerMm"]
    # the transforms reproduce the torso model: the same source meshes land where the model has them
    check = {}
    for name in ("za_Pectoral_fascial", "bp43_FJ1459M"):
        record = next(m for m in hm.MESHES if m["id"] == name)
        distance = cKDTree(model_mesh(name)).query(to_view(record["verts"]))[0] / units
        check[name] = round(float(np.quantile(distance, 0.99)), 3)
    print("transforms reproduce the model (p99 distance, mm):", check)

    index: dict = {}
    for name, (part, tissue) in ZA_PARTS.items():
        v, f = load_za(ZA_DIR, name)
        mesh = weld(apply(t_za, v), f)
        # the reflection to the presented side flips the winding (build_hybrid_model.write_glb)
        write(f"za_{name}", to_view(np.asarray(mesh.vertices)), np.asarray(mesh.faces)[:, ::-1], index,
              {"part": part, "tissue": tissue, "source": "Z-Anatomy", "sourceName": name.replace("_", " "), "license": hm.LICENSES["Z-Anatomy"]})
    for item in json.loads((Path(__file__).parent / "flap-sources.json").read_text()):
        mesh = weld(*load_obj(hm.SRC / "bp3d-4.3" / "obj" / f"{item['fj']}.obj"))
        write(f"bp43_{item['fj']}", to_view(np.asarray(mesh.vertices)), np.asarray(mesh.faces)[:, ::-1], index,
              {"part": item["part"], "tissue": item["tissue"], "source": "BodyParts3D 4.3", "sourceName": item["name"], "license": hm.LICENSES["BodyParts3D 4.3"], "sourceId": item["fj"]})
    # lower trunk skin: whole faces between the two heights, the trunk only (below the shoulders the abducted arms of
    # the HRA body are separate pieces of the mesh)
    view = to_view(np.asarray(skin.vertices))
    y = view[:, 1] / units
    faces = np.asarray(skin.faces)
    keep = ((y[faces] > SKIN_Y[0]) & (y[faces] < SKIN_Y[1])).all(1)
    faces = faces[keep]
    labels = components(faces, len(view))
    axis_x = bb.trunk_axis()[0]
    centres = {c: np.abs(view[np.unique(faces[labels == c]), 0].mean() / units - axis_x) for c in np.unique(labels)}
    faces = faces[np.isin(labels, [c for c, d in centres.items() if d < 60.0])]
    used = np.unique(faces)
    remap = -np.ones(len(view), int)
    remap[used] = np.arange(len(used))
    write("hra_lower_trunk_skin", view[used], remap[faces][:, ::-1], index,
          {"part": "lower-skin", "tissue": "skin", "source": "HRA", "sourceName": "VH_F_skin (lower trunk)", "license": hm.LICENSES["HRA"]})
    for name, (part, tissue) in MODEL_CONFORMED.items():
        record = next(m for m in json.loads((hm.ROOT / "src/data/hybridTorsoManifest.json").read_text())["meshes"] if m["name"] == name)
        idx = np.fromfile(MODEL / f"{name}.idx.bin", dtype=np.uint32).reshape(-1, 3)
        write(name, model_mesh(name), idx, index, {"part": part, "tissue": tissue, "source": record["source"], "sourceName": record["sourceName"], "license": record["license"], "fromModel": True})
    conform = conformation(index, units)
    (OUT / "index.json").write_text(json.dumps({"registration": report, "check": check, "conformation": conform, "meshes": index}, indent=1))
    print(f"wrote {len(index)} meshes into {OUT.relative_to(hm.ROOT)}")


def components(faces: np.ndarray, count: int) -> np.ndarray:
    """Connected component of every face (union-find on shared vertices)."""
    parent = np.arange(count)

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b, c in faces:
        ra, rb, rc = find(a), find(b), find(c)
        parent[rb] = ra
        parent[rc] = ra
    return np.array([find(f[0]) for f in faces])


def conformation(index: dict, units: float) -> dict:
    """Moves the deep anatomy of the anterior abdominal wall forwards (see the module docstring); rewrites the meshes."""
    ch = bb.Chart("op", bb.trunk_axis())
    us, vs = np.arange(-300.0, 302.0, 2.0), np.arange(-440.0, 2.0, 2.0)

    def mesh_of(name):
        pos = np.fromfile(OUT / f"{name}.pos.bin", dtype=np.float32).reshape(-1, 3).astype(np.float64) / units
        idx = np.fromfile(OUT / f"{name}.idx.bin", dtype=np.uint32).reshape(-1, 3).astype(np.int64)
        return pos, idx

    def field(meshes):
        grid = np.full((len(us), len(vs)), -np.inf)
        for pos, idx in meshes:
            q = ch.to_chart(bb.sample_surface(pos, idx, 1.0))
            iu, iv = np.round((q[:, 0] - us[0]) / 2).astype(int), np.round((q[:, 1] - vs[0]) / 2).astype(int)
            ok = (iu >= 0) & (iu < len(us)) & (iv >= 0) & (iv < len(vs))
            np.maximum.at(grid, (iu[ok], iv[ok]), q[ok, 2])
        grid[~np.isfinite(grid)] = np.nan
        return bb.fill_nan(grid)

    skin = field([mesh_of("hra_lower_trunk_skin"), bb.mesh(bb.SKIN)])
    wall = gaussian_filter(field([mesh_of(n) for n, item in index.items() if item["part"] in WALL_PARTS] + [mesh_of("bp43_FJ1452M")]), 1.5)
    c = CONFORM
    tv, tt = np.array([t[0] for t in c["target"]]), np.array([t[1] for t in c["target"]])
    target = np.interp(vs, tv[::-1], tt[::-1])[None, :]
    fade = (bb.smootherstep((c["top"][0] - vs) / c["top"][1]) * bb.smootherstep((vs - c["bottom"][0]) / c["bottom"][1]))[None, :]
    fade = fade * bb.smootherstep((c["lateral"][0] - np.abs(us)) / c["lateral"][1])[:, None]
    shift = gaussian_filter(np.maximum(skin - wall - target, 0.0) * fade, c["sigmaMm"] / 2.0)

    def sample(grid, u, v):
        from scipy.ndimage import map_coordinates
        return map_coordinates(grid, [(u - us[0]) / 2.0, (v - vs[0]) / 2.0], order=1, mode="nearest")

    moved = {}
    for name, item in index.items():
        if item["part"] in NOT_CONFORMED:
            continue
        pos, idx = mesh_of(name)
        q = ch.to_chart(pos)
        # every layer of the wall moves together (a fade with depth would thicken the muscles)
        q[:, 2] += sample(shift, q[:, 0], q[:, 1])
        out = ch.to_model(q)
        (OUT / f"{name}.pos.bin").write_bytes((out * units).astype(np.float32).tobytes())
        moved[name] = round(float(np.linalg.norm(out - pos, axis=1).max()), 1)
    # the subcutaneous layer along the paramedian line of the operated side, before and after
    after = gaussian_filter(field([mesh_of(n) for n, item in index.items() if item["part"] in WALL_PARTS] + [mesh_of("bp43_FJ1452M")]), 1.5)
    line = {}
    for v in (-60, -100, -150, -204, -250, -300, -330, -350):
        i, j = int(round((30 - us[0]) / 2)), int(round((v - vs[0]) / 2))
        line[str(v)] = [round(float(skin[i, j] - wall[i, j]), 1), round(float(skin[i, j] - after[i, j]), 1)]
    print("subcutaneous layer at u = 30 mm (v: before, after, mm):", line)
    print("largest shift per mesh (mm):", moved)
    return {"paramedianMm": line, "shiftMm": moved, "parameters": CONFORM}


if __name__ == "__main__":
    main()
