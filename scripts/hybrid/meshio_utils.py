"""Mesh loading and registration helpers for the hybrid torso pipeline.

Every loader returns (vertices float64[N,3], faces int64[M,3]) in the source
file's own coordinate frame. Registration helpers never alter a mesh's shape:
they only estimate rigid/similarity transforms between frames.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np
import trimesh
from scipy.spatial import cKDTree


def load_obj(path: Path) -> tuple[np.ndarray, np.ndarray]:
    verts: list[list[float]] = []
    faces: list[list[int]] = []
    with open(path, "r", encoding="latin1") as handle:
        for line in handle:
            if line.startswith("v "):
                verts.append([float(x) for x in line.split()[1:4]])
            elif line.startswith("f "):
                idx = [int(tok.split("/")[0]) for tok in line.split()[1:]]
                idx = [i - 1 if i > 0 else len(verts) + i for i in idx]
                for k in range(1, len(idx) - 1):
                    faces.append([idx[0], idx[k], idx[k + 1]])
    return np.asarray(verts, dtype=np.float64), np.asarray(faces, dtype=np.int64)


def load_stl(path: Path) -> tuple[np.ndarray, np.ndarray]:
    raw = path.read_bytes()
    count = struct.unpack("<I", raw[80:84])[0]
    dtype = np.dtype([("n", "<3f4"), ("v", "<9f4"), ("a", "<u2")])
    tris = np.frombuffer(raw[84 : 84 + count * 50], dtype=dtype)["v"].reshape(-1, 3).astype(np.float64)
    faces = np.arange(len(tris)).reshape(-1, 3)
    return tris, faces


def load_za(extracted_dir: Path, name: str) -> tuple[np.ndarray, np.ndarray]:
    pos = np.fromfile(extracted_dir / f"{name}.pos.bin", dtype=np.float32).reshape(-1, 3).astype(np.float64)
    idx_path = extracted_dir / f"{name}.idx.bin"
    if idx_path.exists():
        faces = np.fromfile(idx_path, dtype=np.uint32).reshape(-1, 3).astype(np.int64)
    else:
        faces = np.arange(len(pos)).reshape(-1, 3)
    return pos, faces


def load_glb_meshes(path: Path) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """Returns every mesh of a glTF scene in scene (world) coordinates, keyed by node name."""
    scene = trimesh.load(path, force="scene", process=False)
    out: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for node in scene.graph.nodes_geometry:
        transform, geom_name = scene.graph[node]
        mesh = scene.geometry[geom_name]
        verts = trimesh.transform_points(np.asarray(mesh.vertices, dtype=np.float64), transform)
        out[node] = (verts, np.asarray(mesh.faces, dtype=np.int64))
    return out


def weld(verts: np.ndarray, faces: np.ndarray) -> trimesh.Trimesh:
    mesh = trimesh.Trimesh(verts, faces, process=False)
    mesh.merge_vertices(digits_vertex=5)
    mesh.update_faces(mesh.nondegenerate_faces())
    mesh.remove_unreferenced_vertices()
    return mesh


def apply(transform: np.ndarray, points: np.ndarray) -> np.ndarray:
    return points @ transform[:3, :3].T + transform[:3, 3]


def similarity_umeyama(src: np.ndarray, dst: np.ndarray, with_scale: bool = True) -> np.ndarray:
    mu_s, mu_d = src.mean(0), dst.mean(0)
    xs, xd = src - mu_s, dst - mu_d
    cov = xd.T @ xs / len(src)
    u, s, vt = np.linalg.svd(cov)
    d = np.eye(3)
    if np.linalg.det(u @ vt) < 0:
        d[2, 2] = -1
    rot = u @ d @ vt
    scale = (s * np.diag(d)).sum() / xs.var(0).sum() if with_scale else 1.0
    out = np.eye(4)
    out[:3, :3] = scale * rot
    out[:3, 3] = mu_d - scale * rot @ mu_s
    return out


def icp(src: np.ndarray, dst: np.ndarray, init: np.ndarray, iterations: int = 60, trim: float = 0.8, with_scale: bool = True) -> tuple[np.ndarray, float]:
    """Trimmed point-to-point ICP (similarity). Returns transform and RMS of kept pairs."""
    tree = cKDTree(dst)
    transform = init.copy()
    rms = np.inf
    for _ in range(iterations):
        moved = apply(transform, src)
        dist, idx = tree.query(moved)
        keep = dist <= np.quantile(dist, trim)
        step = similarity_umeyama(moved[keep], dst[idx[keep]], with_scale)
        transform = step @ transform
        new_rms = float(np.sqrt((dist[keep] ** 2).mean()))
        if abs(rms - new_rms) < 1e-7:
            break
        rms = new_rms
    return transform, rms


def sample_surface(verts: np.ndarray, faces: np.ndarray, count: int, seed: int = 0) -> np.ndarray:
    mesh = trimesh.Trimesh(verts, faces, process=False)
    points, _ = trimesh.sample.sample_surface(mesh, count, seed=seed)
    return np.asarray(points)


def dump_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
