#!/usr/bin/env python3
"""Schematic neurovascular and fascial anatomy of the breast (docs/plano-mamoplastia.md, fase 5).

The source meshes stop at the vascular trunks and at the Cooper ligaments: no artery enters the breast,
no nerve reaches the nipple and the fascial suspension of the gland is missing. These are exactly the
structures that tell one pedicle from another, so they are traced here from the literature, as centre
lines and sheets *anchored on the model's own landmarks*:

  * rib and intercostal space levels measured on the ribs and costal cartilages;
  * the internal thoracic and lateral thoracic arteries and the pectoral branch of the thoracoacromial
    artery (real meshes), from which the new branches start;
  * the surface of the chest wall (outer envelope of muscles, ribs and cartilages), the skin, the nipple,
    the areola and the inframammary fold, through the breast chart of build_breast.py.

Every structure written here is marked as schematic (source "Esquemático (literatura)") and shown as such in
the app. Courses follow Würinger et al. 1998 (horizontal septum, ligaments and the vessels and nerve they
carry), Schlenz et al. 2000 (innervation of the nipple-areola complex), van Deventer 2004 and O'Dey et al.
2007 (arterial sources of the complex) and Bayati & Seckel 1995 (inframammary crease ligament).

Output: src/data/breastAnatomy.json (centre lines with radii, sheets as grids, manifest entries).
        The app builds the meshes (tubes, sheets) and moves them with the breast states.

Usage: node scripts/hybrid/decode_model.mjs && python3 scripts/hybrid/build_breast_anatomy.py [--figures DIR]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy.interpolate import splev, splprep
from scipy.ndimage import gaussian_filter, gaussian_filter1d, map_coordinates
from scipy.spatial import cKDTree

sys.path.insert(0, str(Path(__file__).parent))
import build_breast as bb  # noqa: E402

OUT_JSON = bb.ROOT / "src/data/breastAnatomy.json"
SOURCE = "Esquemático (literatura)"
LICENSE = "Traçado deste projeto sobre marcos das malhas do modelo (CC BY-SA 4.0, como a obra derivada)"
MM = bb.MM
STEP = 2.5  # mm between centre line samples
# Display calibre (radius, mm): larger than life so that a branch can be seen and touched; the taper is kept.
CALIBRE = 1.35
# Sheets are shipped as mid-surfaces and drawn as thin slabs, with their own colour (they are neither the
# Cooper ligaments nor a fascia of the source atlases).
SHEET_STYLE = {
    "horizontal-septum": {"color": "#5fb4d8", "opacity": 0.62, "thicknessMm": 1.0},
    "septum-ligaments": {"color": "#7fcf9a", "opacity": 0.9, "thicknessMm": 1.4},
    "inframammary-ligament": {"color": "#c4d96a", "opacity": 0.9, "thicknessMm": 1.4},
}
ORDINAL = {2: "second", 3: "third", 4: "fourth", 5: "fifth", 6: "sixth", 7: "seventh"}

BY_SOURCE: dict[str, list[str]] = {}
for record in bb.MANIFEST["meshes"]:
    BY_SOURCE.setdefault(record["sourceName"], []).append(record["name"])


def source_points(*names: str) -> np.ndarray:
    return np.vstack([bb.mesh(mesh)[0] for name in names for mesh in BY_SOURCE[name]])


def source_samples(*names: str, spacing: float = 1.0) -> np.ndarray:
    return np.vstack([bb.sample_surface(*bb.mesh(mesh), spacing) for name in names for mesh in BY_SOURCE[name]])


class Scene:
    """Landmarks of the operative side, all measured on the meshes (chart coordinates u, v, r in mm)."""

    def __init__(self) -> None:
        self.breast = bb.Breast("op", bb.trunk_axis())
        ch = self.ch = self.breast.ch
        self.un = float(ch.nipple[0])
        self.fold_v = float(np.interp(self.un, ch.us, self.breast.fold))
        self.skin_field = gaussian_filter(self.breast.RS, 1.5)
        # chest wall under the breast: outer envelope of muscles, ribs and cartilages (the pectoral fascia lies on it)
        deep = [m["name"] for m in bb.MANIFEST["meshes"] if m["tissue"] in ("muscle", "bone", "cartilage") and m["structure"] != "contralateral-pectoral"]
        grid = np.full((ch.nu, ch.nv), -np.inf)
        for name in deep:
            q = ch.to_chart(bb.sample_surface(*bb.mesh(name), 1.0))
            iu = np.round((q[:, 0] - bb.U_RANGE[0]) / bb.CELL).astype(int)
            iv = np.round((q[:, 1] - bb.V_RANGE[0]) / bb.CELL).astype(int)
            ok = (iu >= 0) & (iu < ch.nu) & (iv >= 0) & (iv < ch.nv) & (q[:, 2] < 175)  # the arm is not chest wall
            np.maximum.at(grid, (iu[ok], iv[ok]), q[ok, 2])
        grid[~np.isfinite(grid)] = np.nan
        self.wall_field = gaussian_filter(np.minimum(bb.fill_nan(grid), self.skin_field - 3.0), 2.0)
        # ribs with their cartilages: centre, lower and upper edge and front radius along u
        self.rib_u = np.arange(20.0, 301.0, 2.0)
        self.ribs: dict[int, dict[str, np.ndarray]] = {}
        for k, name in ORDINAL.items():
            q = ch.to_chart(source_samples(f"Left {name} rib", f"Left {name} costal cartilage", spacing=1.5))
            q = q[q[:, 2] > 40]
            rows = {key: np.full(len(self.rib_u), np.nan) for key in ("mid", "lo", "hi", "front")}
            for i, u in enumerate(self.rib_u):
                sel = np.abs(q[:, 0] - u) < 3
                if sel.sum() < 8:
                    continue
                rows["lo"][i], rows["hi"][i] = np.percentile(q[sel, 1], [3, 97])
                rows["mid"][i] = (rows["lo"][i] + rows["hi"][i]) / 2
                rows["front"][i] = np.percentile(q[sel, 2], 97)
            known = ~np.isnan(rows["mid"])
            self.ribs[k] = {key: gaussian_filter1d(np.interp(self.rib_u, self.rib_u[known], value[known]), 3.0) for key, value in rows.items()}
        bone = source_samples(*[f"Left {name} rib" for name in ORDINAL.values()], *[f"Left {name} costal cartilage" for name in ORDINAL.values()], "Body of sternum", "Manubrium", spacing=1.5)
        self.bone = cKDTree(bone)
        # arterial trunks (real meshes): centre lines ordered by height
        self.ita = self.centre_line("Trunk of left internal thoracic artery")
        self.lta = self.centre_line("Left lateral thoracic artery")
        self.tab = self.centre_line("Pectoral branch of left thoraco-acromial artery")
        # lateral border of pectoralis major on the chest (per height)
        pm = ch.to_chart(source_samples("Sternocostal part of left pectoralis major", "Abdominal part of left pectoralis major", spacing=1.5))
        pm = pm[pm[:, 2] < 150]
        self.pm_v = np.arange(-45.0, 46.0, 5.0)
        self.pm_border = gaussian_filter1d(np.array([np.percentile(pm[np.abs(pm[:, 1] - v) < 3, 0], 99) for v in self.pm_v]), 1.0)
        # areola (real mesh): radius about the nipple, on the skin
        areola = ch.to_chart(source_points("VH_F_areola_L"))
        self.areola_r = float(np.percentile(np.hypot(areola[:, 0] - self.un, areola[:, 1]), 97))
        # outline of the adipose body on the chest (per height): medial and lateral limits
        self.fp_v = np.arange(-50.0, 100.0, 2.0)
        cols = [np.nonzero(self.breast.footprint[:, int(round((v - bb.V_RANGE[0]) / bb.CELL))])[0] for v in self.fp_v]
        self.fp_medial = gaussian_filter1d(np.array([ch.us[c.min()] if len(c) else np.nan for c in cols]), 2.0)
        self.fp_lateral = gaussian_filter1d(np.array([ch.us[c.max()] if len(c) else np.nan for c in cols]), 2.0)

    # ---- fields ---------------------------------------------------------------------------------------
    def _sample(self, field: np.ndarray, u, v) -> np.ndarray:
        scalar = np.ndim(u) == 0 and np.ndim(v) == 0
        u, v = np.broadcast_arrays(np.atleast_1d(np.asarray(u, float)), np.atleast_1d(np.asarray(v, float)))
        out = map_coordinates(field, [(u - bb.U_RANGE[0]) / bb.CELL, (v - bb.V_RANGE[0]) / bb.CELL], order=1, mode="nearest")
        return out[0] if scalar else out

    def skin(self, u, v) -> np.ndarray:
        return self._sample(self.skin_field, u, v)

    def wall(self, u, v) -> np.ndarray:
        return self._sample(self.wall_field, u, v)

    def model(self, chart_points) -> np.ndarray:
        return self.ch.to_model(np.atleast_2d(np.asarray(chart_points, float)))

    def centre_line(self, name: str) -> np.ndarray:
        """Centre line of a (roughly vertical) vessel mesh in chart coordinates, from top to bottom."""
        q = self.ch.to_chart(source_points(name))
        rows = []
        for v in np.arange(q[:, 1].max() - 4, q[:, 1].min() + 4, -4.0):
            sel = np.abs(q[:, 1] - v) < 4
            if sel.sum() >= 4:
                rows.append([q[sel, 0].mean(), v, q[sel, 2].mean()])
        return np.array(rows)

    def on_line(self, line: np.ndarray, v: float) -> np.ndarray:
        """Chart point of a centre line at height v."""
        order = np.argsort(line[:, 1])
        return np.array([np.interp(v, line[order, 1], line[order, 0]), v, np.interp(v, line[order, 1], line[order, 2])])

    def space(self, k: int, u: float) -> tuple[float, float]:
        """k-th intercostal space at u: height of its middle and radius of the front of the two ribs."""
        upper, lower = self.ribs[k], self.ribs[k + 1]
        f = lambda rows, key: float(np.interp(u, self.rib_u, rows[key]))
        return (f(upper, "lo") + f(lower, "hi")) / 2, (f(upper, "front") + f(lower, "front")) / 2

    def rib(self, k: int, u, key: str = "mid") -> np.ndarray:
        return np.interp(u, self.rib_u, self.ribs[k][key])

    def clear(self, chart_point, span: float = 5.0) -> np.ndarray:
        """The chart point moved up or down (at most `span` mm) to where it is farthest from ribs and cartilages:
        the middle of the intercostal space at that depth."""
        point = np.asarray(chart_point, float)
        trials = np.repeat(point[None], 21, axis=0)
        trials[:, 1] += np.linspace(-span, span, 21)
        distance, _ = self.bone.query(self.model(trials))
        return trials[int(np.argmax(distance - 0.02 * np.abs(trials[:, 1] - point[1])))]

    def areola_edge(self, angle_deg: float, depth: float, margin: float = 1.0) -> np.ndarray:
        """Chart point under the edge of the areola; angle 0 = lateral, 90 = cranial, 180 = medial."""
        a = np.radians(angle_deg)
        u, v = self.un + (self.areola_r + margin) * np.cos(a), (self.areola_r + margin) * np.sin(a)
        return np.array([u, v, float(self.skin(u, v)) - depth])


# --------------------------------------------------------------------------------------------------
# curves and sheets
# --------------------------------------------------------------------------------------------------
class Course:
    """A centre line assembled from legs given in chart coordinates and smoothed in model space."""

    def __init__(self, scene: Scene) -> None:
        self.scene = scene
        self.chart: list[np.ndarray] = []

    def point(self, chart_point) -> "Course":
        self.chart.append(np.atleast_2d(np.asarray(chart_point, float)))
        return self

    def along(self, field: str, start, end, offsets: tuple[float, float], bow: float = 0.0) -> "Course":
        """Leg from (u, v) to (u, v), straight in the chart, at field + offset (field: 'skin' or 'wall').
        `bow` bends the leg sideways in the chart (mm at mid-course)."""
        start, end = np.asarray(start, float), np.asarray(end, float)
        n = max(3, int(np.hypot(*(end - start)) / 3.0))
        t = np.linspace(0, 1, n)
        normal = np.array([-(end - start)[1], (end - start)[0]]) / max(np.hypot(*(end - start)), 1e-9)
        uv = start[None] + (end - start)[None] * t[:, None] + normal[None] * (bow * 4 * t * (1 - t))[:, None]
        radius = getattr(self.scene, field)(uv[:, 0], uv[:, 1]) + offsets[0] + (offsets[1] - offsets[0]) * t
        self.chart.append(np.c_[uv, radius])
        return self

    def finish(self, smooth: float = 1.2) -> np.ndarray:
        """Model-space polyline (mm), smoothed (rms tolerance `smooth` mm) and resampled every STEP."""
        raw = self.scene.model(np.vstack(self.chart))
        keep = np.r_[True, np.linalg.norm(np.diff(raw, axis=0), axis=1) > 1e-6]
        raw = raw[keep]
        # densify so that the spline follows the straight legs between sparse control points
        seg = np.linalg.norm(np.diff(raw, axis=0), axis=1)
        dense = [raw[0]]
        for a, b, length in zip(raw[:-1], raw[1:], seg):
            m = max(1, int(np.ceil(length / 2.0)))
            dense.extend(a + (b - a) * (j / m) for j in range(1, m + 1))
        dense = np.array(dense)
        tck, _ = splprep(dense.T, s=len(dense) * smooth**2, k=3)
        fine = np.array(splev(np.linspace(0, 1, 800), tck)).T
        arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(fine, axis=0), axis=1))]
        count = max(4, int(round(arc[-1] / STEP)) + 1)
        return np.stack([np.interp(np.linspace(0, arc[-1], count), arc, fine[:, c]) for c in range(3)], 1)


def tube_mesh(points: np.ndarray, radii: tuple[float, float], sides: int = 8):
    """Tube around a centre line (parallel transport frames), linear taper, closed by end fans."""
    p = np.asarray(points, float)
    tangent = np.gradient(p, axis=0)
    tangent /= np.maximum(np.linalg.norm(tangent, axis=1, keepdims=True), 1e-12)
    normal = np.cross(tangent[0], [0.0, 1.0, 0.0] if abs(tangent[0][1]) < 0.9 else [1.0, 0.0, 0.0])
    normal /= np.linalg.norm(normal)
    frames = []
    for i in range(len(p)):
        normal = normal - tangent[i] * (normal @ tangent[i])
        normal /= max(np.linalg.norm(normal), 1e-12)
        frames.append((normal, np.cross(tangent[i], normal)))
    radius = np.linspace(radii[0], radii[1], len(p))
    angle = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    rings = np.array([p[i] + radius[i] * (np.cos(angle)[:, None] * frames[i][0] + np.sin(angle)[:, None] * frames[i][1]) for i in range(len(p))])
    verts = np.vstack([rings.reshape(-1, 3), p[:1], p[-1:]])
    faces = []
    for i in range(len(p) - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            faces += [[a, b, a + sides], [b, b + sides, a + sides]]
    first, last = len(p) * sides, len(p) * sides + 1
    for k in range(sides):
        faces.append([first, (k + 1) % sides, k])
        faces.append([last, (len(p) - 1) * sides + k, (len(p) - 1) * sides + (k + 1) % sides])
    return verts, np.array(faces)


def sheet_mesh(grid: np.ndarray):
    """Triangles of an (nu, nv, 3) grid."""
    nu, nv = grid.shape[:2]
    index = np.arange(nu * nv).reshape(nu, nv)
    a, b, c, d = index[:-1, :-1].ravel(), index[1:, :-1].ravel(), index[1:, 1:].ravel(), index[:-1, 1:].ravel()
    return grid.reshape(-1, 3), np.vstack([np.c_[a, b, c], np.c_[a, c, d]])


# --------------------------------------------------------------------------------------------------
# the structures
# --------------------------------------------------------------------------------------------------
def build(scene: Scene) -> tuple[dict, list[dict]]:
    s = scene
    un = s.un
    tubes: list[dict] = []
    sheets: list[dict] = []

    def tube(name: str, structure: str, tissue: str, label: str, course: Course, radii: tuple[float, float], smooth: float = 1.2) -> None:
        tubes.append({"name": name, "structure": structure, "tissue": tissue, "label": label, "points": course.finish(smooth), "radius": tuple(r * CALIBRE for r in radii)})

    def sheet(name: str, structure: str, tissue: str, label: str, chart_grid: np.ndarray) -> None:
        sheets.append({"name": name, "structure": structure, "tissue": tissue, "label": label, "grid": s.model(chart_grid.reshape(-1, 3)).reshape(chart_grid.shape)})

    # ---- 1. perforating branches of the internal thoracic artery (medial mammary branches) ---------------
    # They leave the trunk behind the cartilages, cross the 2nd-4th spaces beside the sternum, pierce pectoralis
    # major and run in the subcutaneous fat, about 1 cm deep, to the medial and upper edge of the areola.
    u_exit = 52.0  # just lateral to the sternal border
    for k, target, radius in ((2, 118.0, 1.25), (3, 150.0, 1.1), (4, 182.0, 1.0)):
        v_space, front = s.space(k, u_exit)
        through = s.clear([u_exit, v_space, front - 2.0])
        behind = s.clear([u_exit - 3, through[1], front - 9.0], span=2.0)
        origin = s.on_line(s.ita, behind[1] + 2)
        v_space = float(through[1])
        out = np.array([u_exit + 6, v_space - 2, float(s.wall(u_exit + 6, v_space - 2)) + 2.0])
        end = s.areola_edge(target, 6.0)
        start = np.array([u_exit + 16, v_space - 5])
        course = Course(s).point(origin).point(behind).point(through).point(out).along("skin", start, end[:2], (-10.0, -6.0), bow=-6.0 if k == 2 else 0.0)
        tube(f"lit_ita_perforator_{k}", "internal-thoracic-perforators", "artery", f"Perfurante da torácica interna, {k}º espaço intercostal", course, (radius, 0.6))

    # ---- 2. lateral mammary branches of the lateral thoracic artery -----------------------------------
    # The trunk descends on serratus anterior beside the border of pectoralis major; its mammary branches turn
    # round that border and run medially in the subcutaneous fat to the lateral edge of the areola.
    for i, (v_origin, target, radius) in enumerate(((26.0, 28.0, 1.2), (-2.0, -22.0, 1.0)), start=1):
        origin = s.on_line(s.lta, v_origin)
        border = float(np.interp(v_origin - 6, s.pm_v, s.pm_border))
        turn = np.array([max(border + 4, origin[0] - 12), v_origin - 6])
        end = s.areola_edge(target, 6.0)
        course = Course(s).point(origin).along("skin", turn, end[:2], (-9.0, -6.0), bow=5.0 if i == 1 else -4.0)
        tube(f"lit_lateral_mammary_{i}", "lateral-mammary-branches", "artery", f"Ramo mamário lateral {'superior' if i == 1 else 'inferior'} (torácica lateral)", course, (radius, 0.6))

    # ---- 3. horizontal septum (Würinger) -------------------------------------------------------------------
    # From the pectoral fascia along the fifth rib to the nipple; its medial and lateral ends turn upwards into
    # the vertical ligaments (sternal border, lateral border of the gland beside pectoralis minor).
    def limit(curve: np.ndarray, v: float) -> float:
        return float(np.interp(v, s.fp_v, curve))

    v5 = lambda u: float(s.rib(5, u))  # noqa: E731
    u_medial = limit(s.fp_medial, v5(60.0)) + 8
    u_lateral = limit(s.fp_lateral, v5(170.0)) - 6
    apex_depth = 9.0  # the septum ends in the retroareolar tissue
    nu, nv = 41, 25
    grid = np.zeros((nu, nv, 3))
    for i, w in enumerate(np.linspace(0, 1, nu)):
        u0 = u_medial + (u_lateral - u_medial) * w
        v0 = v5(u0)
        u1 = un + (w - 0.5) * 1.5 * s.areola_r
        r0 = float(s.wall(u0, v0)) + 0.5
        r1 = float(s.skin(u1, 0.0)) - apex_depth
        for j, t in enumerate(np.linspace(0, 1, nv)):
            # eased towards the nipple so the sheet leaves the wall at a right angle and stays inside the gland
            e = t * t * (3 - 2 * t) * 0.5 + t * 0.5
            u, v = u0 + (u1 - u0) * e, v0 + (0.0 - v0) * e
            grid[i, j] = [u, v, min(r0 + (r1 - r0) * t, float(s.skin(u, v)) - 5.0)]
    sheet("lit_horizontal_septum", "horizontal-septum", "ligament", "Septo horizontal (Würinger)", grid)
    septum_origin = lambda u: np.array([u, v5(u), float(s.wall(u, v5(u)))])  # noqa: E731

    # vertical ligaments: from the wall to the dermis, from the septum up to the level of the second/third rib
    def ligament(name: str, label: str, u_of_v, v_low: float, v_high: float, lean: float) -> None:
        nl, nd = 25, 9
        g = np.zeros((nl, nd, 3))
        for i, v in enumerate(np.linspace(v_low, v_high, nl)):
            u = u_of_v(v)
            deep = float(s.wall(u, v)) + 0.5
            for j, t in enumerate(np.linspace(0, 1, nd)):
                # the ligament thins upwards: full thickness beside the septum, half of it at its upper end
                reach = 1.0 - 0.45 * (v - v_low) / (v_high - v_low)
                uu = u + lean * t
                top = float(s.skin(uu, v)) - 1.5
                g[i, j] = [uu, v, deep + (top - deep) * t * reach]
        sheet(name, "septum-ligaments", "ligament", label, g)

    v_med_low = v5(u_medial)
    ligament("lit_medial_ligament", "Ligamento medial (esternal)", lambda v: limit(s.fp_medial, v) + 6, v_med_low, float(s.rib(2, 60.0)) - 6, 4.0)
    v_lat_low = v5(u_lateral)
    ligament("lit_lateral_ligament", "Ligamento lateral", lambda v: limit(s.fp_lateral, v) - 4, v_lat_low, float(s.rib(3, 190.0)) + 4, -4.0)

    # ---- 4. inframammary fold ligament (Bayati & Seckel) -----------------------------------------------
    us = np.linspace(s.breast.fold_range[0] + 14, s.breast.fold_range[1] - 14, 49)
    fold = np.interp(us, s.ch.us, s.breast.fold)
    g = np.zeros((len(us), 7, 3))
    for i, (u, v) in enumerate(zip(us, fold)):
        deep = np.array([u, v + 9.0, float(s.wall(u, v + 9.0)) + 0.5])  # origin on the wall, a little above the crease
        skin = np.array([u, v, float(s.skin(u, v)) - 1.2])
        for j, t in enumerate(np.linspace(0, 1, 7)):
            g[i, j] = deep + (skin - deep) * t
    sheet("lit_inframammary_ligament", "inframammary-ligament", "ligament", "Ligamento do sulco inframamário", g)

    # ---- 5. vessels carried by the septum ---------------------------------------------------------------
    # caudal layer: perforators of the anterior intercostal arteries (4th-6th spaces), 1-2 cm medial to the meridian
    for k, du, lift, radius in ((4, -20.0, 3.5, 1.0), (5, -14.0, -3.5, 1.1), (6, -16.0, -3.5, 1.0)):
        u0 = un + du
        v_space, front = s.space(k, u0)
        deep = np.array([u0, v_space, front - 3.0])
        out = np.array([u0 + 1, v_space, float(s.wall(u0 + 1, v_space)) + 3.0])
        # they join the septum (4th: cranial face near its origin; 5th, 6th: caudal face) and follow it to the nipple
        join_t = 0.45
        mid_u = u0 + (un - u0) * join_t
        mid_v = v5(mid_u) * (1 - join_t) + lift
        mid_r = float(s.wall(mid_u, v5(mid_u))) + (float(s.skin(un, 0.0)) - apex_depth - float(s.wall(mid_u, v5(mid_u)))) * join_t
        end = np.array([un + du * 0.15, lift * 0.6, float(s.skin(un, 0.0)) - apex_depth - 1.0])
        course = Course(s).point(deep).point(out).point([mid_u, mid_v, mid_r]).point(end)
        tube(f"lit_intercostal_perforator_{k}", "intercostal-perforators", "artery", f"Perfurante intercostal anterior, {k}º espaço", course, (radius, 0.6), smooth=2.0)

    # cranial layer: branch of the pectoral branch of the thoracoacromial artery, through pectoralis major
    start = s.tab[-1]
    v4, _ = s.space(4, un + 24)
    pierce = np.array([un + 24, v4 - 4, float(s.wall(un + 24, v4 - 4)) - 5.0])
    out = np.array([un + 20, v4 - 8, float(s.wall(un + 20, v4 - 8)) + 4.0])
    join_t = 0.5
    mid_u = un + 12
    mid_r = float(s.wall(mid_u, v5(mid_u))) + (float(s.skin(un, 0.0)) - apex_depth - float(s.wall(mid_u, v5(mid_u)))) * join_t
    end = np.array([un + 3, 4.0, float(s.skin(un, 0.0)) - apex_depth - 1.0])
    course = Course(s).point(start).along("wall", start[:2], pierce[:2], (start[2] - float(s.wall(start[0], start[1])), -5.0)).point(out).point([mid_u, v5(mid_u) * (1 - join_t) + 4.5, mid_r]).point(end)
    tube("lit_thoracoacromial_branch", "thoracoacromial-mammary-branch", "artery", "Ramo mamário do ramo peitoral da toracoacromial", course, (1.1, 0.6), smooth=2.0)

    # ---- 6. nerves of the nipple-areola complex ---------------------------------------------------------------
    # lateral cutaneous branch of the 4th intercostal nerve: leaves the 4th space near the midaxillary line
    u_axillary = 268.0
    v4_lat, _ = s.space(4, u_axillary)
    emerge = np.array([u_axillary, v4_lat, float(s.wall(u_axillary, v4_lat)) + 1.0])
    inside = np.array([u_axillary + 4, v4_lat + 1, float(s.wall(u_axillary, v4_lat)) - 7.0])
    # deep branch (93%): within the pectoral fascia to the middle of the breast, then forwards to the nipple along the septum
    base_u = un + 6
    course = (
        Course(s)
        .point(inside)
        .point(emerge)
        .along("wall", emerge[:2], [base_u, v5(base_u) + 3.0], (1.0, 1.0), bow=6.0)
        .point([un + 3.5, v5(base_u) * 0.5 + 3.0, (float(s.wall(base_u, v5(base_u))) + float(s.skin(un, 0.0)) - apex_depth) / 2])
        .point([un + 1.0, 1.5, float(s.skin(un, 0.0)) - 7.0])
    )
    tube("lit_lcb4_deep", "fourth-intercostal-lateral-branch", "nerve", "Ramo cutâneo lateral do 4º intercostal, ramo profundo", course, (0.9, 0.55), smooth=1.6)
    # superficial branch (7%): in the subcutaneous fat to the lateral edge of the areola
    end = s.areola_edge(8.0, 5.0)
    course = Course(s).point(emerge).along("skin", [u_axillary - 22, v4_lat - 8], end[:2], (-9.0, -5.0), bow=-7.0)
    tube("lit_lcb4_superficial", "fourth-intercostal-lateral-branch", "nerve", "Ramo cutâneo lateral do 4º intercostal, ramo superficial", course, (0.8, 0.5))
    # lateral cutaneous branches of the 3rd and 5th: skin of the lateral breast, towards the areola
    for k, target in ((3, (un + 34, 34.0)), (5, (un + 24, -22.0))):
        vk, _ = s.space(k, u_axillary)
        e = np.array([u_axillary, vk, float(s.wall(u_axillary, vk)) + 1.0])
        i_ = np.array([u_axillary + 4, vk + 1, float(s.wall(u_axillary, vk)) - 7.0])
        course = Course(s).point(i_).point(e).along("skin", [u_axillary - 20, vk - 4], target, (-9.0, -4.5))
        tube(f"lit_lcb_{k}", "lateral-cutaneous-branches", "nerve", f"Ramo cutâneo lateral do {k}º intercostal", course, (0.8, 0.5))
    # anterior cutaneous branches (3rd-5th): beside the sternum, superficial, to the medial edge of the areola
    for k, target in ((3, None), (4, 176.0), (5, None)):
        v_space, front = s.space(k, u_exit)
        # the nerve leaves the space below the artery, as far from the cartilages as the space allows
        deep = s.clear([u_exit + 1, v_space - 3.0, front - 6.0], span=3.0)
        v_nerve = float(deep[1])
        out = np.array([u_exit + 5, v_nerve - 1, float(s.wall(u_exit + 5, v_nerve - 1)) + 2.0])
        if target is None:
            aim = np.array([un - 38.0, 26.0 if k == 3 else -16.0])
            end_uv = np.array([u_exit + 10, v_nerve - 3]) + (aim - np.array([u_exit + 10, v_nerve - 3])) * 1.0
            depth_end = -4.5
        else:
            end_uv, depth_end = s.areola_edge(target, 5.0)[:2], -5.0
        course = Course(s).point(deep).point(out).along("skin", [u_exit + 12, v_nerve - 3], end_uv, (-7.0, depth_end))
        tube(f"lit_acb_{k}", "anterior-cutaneous-branches", "nerve", f"Ramo cutâneo anterior do {k}º intercostal", course, (0.8, 0.5))

    return {"septum_origin": septum_origin}, tubes + sheets


STRUCTURES = {
    "internal-thoracic-perforators": ("Perfurantes da torácica interna (ramos mamários mediais)", "Vasos"),
    "lateral-mammary-branches": ("Ramos mamários laterais (torácica lateral)", "Vasos"),
    "intercostal-perforators": ("Perfurantes intercostais anteriores (4º–6º espaços)", "Vasos"),
    "thoracoacromial-mammary-branch": ("Ramo mamário da toracoacromial", "Vasos"),
    "horizontal-septum": ("Septo horizontal da mama (Würinger)", "Mama"),
    "septum-ligaments": ("Ligamentos medial e lateral da mama", "Mama"),
    "inframammary-ligament": ("Ligamento do sulco inframamário", "Mama"),
    "fourth-intercostal-lateral-branch": ("Ramo cutâneo lateral do 4º nervo intercostal", "Nervos"),
    "lateral-cutaneous-branches": ("Ramos cutâneos laterais (3º e 5º intercostais)", "Nervos"),
    "anterior-cutaneous-branches": ("Ramos cutâneos anteriores (3º–5º intercostais)", "Nervos"),
}


def check(scene: Scene, items: list[dict]) -> None:
    """Every course must stay under the skin and clear of the bones."""
    ch = scene.ch
    for item in items:
        pts = item["points"] if "points" in item else item["grid"].reshape(-1, 3)
        q = ch.to_chart(pts)
        margin = scene.skin(q[:, 0], q[:, 1]) - q[:, 2]
        bone, _ = scene.bone.query(pts)
        length = float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum()) if "points" in item else 0.0
        flag = "  <-- CHECK" if margin.min() < 1.0 or ("points" in item and bone.min() < 1.0) else ""
        print(f"  {item['name']:30s} {'%5.0f mm' % length if length else '  sheet '} · sob a pele ≥ {margin.min():5.1f} mm · osso ≥ {bone.min():5.1f} mm{flag}")


def main() -> None:
    scene = Scene()
    print(f"mamilo u={scene.un:.1f}; aréola r={scene.areola_r:.1f} mm; sulco v={scene.fold_v:.1f}")
    print("espaços intercostais (altura no meridiano / junto ao esterno): " + ", ".join(f"{k}º {scene.space(k, scene.un)[0]:+.0f}/{scene.space(k, 52.0)[0]:+.0f}" for k in (2, 3, 4, 5, 6)))
    _, items = build(scene)
    check(scene, items)
    r4 = lambda values: [round(float(x), 4) for x in values]  # noqa: E731
    meshes, geometry, structures = [], {}, {}
    for item in items:
        if "points" in item:
            verts, faces = tube_mesh(item["points"], item["radius"])
            geometry[item["name"]] = {"kind": "tube", "points": r4((item["points"] * MM).ravel()), "radiusMm": [round(x, 2) for x in item["radius"]]}
            anchor = item["points"][len(item["points"]) * 2 // 3]
        else:
            verts, faces = sheet_mesh(item["grid"])
            geometry[item["name"]] = {"kind": "sheet", "size": list(item["grid"].shape[:2]), "points": r4((item["grid"] * MM).ravel()), "thicknessMm": SHEET_STYLE[item["structure"]]["thicknessMm"]}
            anchor = item["grid"][item["grid"].shape[0] // 2, item["grid"].shape[1] // 2]
        style = SHEET_STYLE.get(item["structure"], {})
        meshes.append({"name": item["name"], "structure": item["structure"], "tissue": item["tissue"], "source": SOURCE, "sourceName": item["label"], "license": LICENSE, "triangles": int(len(faces)), **{key: style[key] for key in ("color", "opacity") if key in style}})
        entry = structures.setdefault(item["structure"], {"label": STRUCTURES[item["structure"]][0], "group": STRUCTURES[item["structure"]][1], "visible": False, "labelAnchor": r4(anchor * MM), "meshNames": []})
        entry["meshNames"].append(item["name"])
    out = {
        "version": 1,
        "source": SOURCE,
        "side": "op",
        "structures": {key: structures[key] for key in STRUCTURES if key in structures},
        "meshes": meshes,
        "geometry": geometry,
    }
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"wrote {OUT_JSON.relative_to(bb.ROOT)} ({OUT_JSON.stat().st_size / 1e3:.0f} kB): {len(structures)} estruturas, {len(meshes)} malhas")
    if "--figures" in sys.argv:
        figures(scene, items, Path(sys.argv[sys.argv.index("--figures") + 1]))


def figures(scene: Scene, items: list[dict], out: Path) -> None:
    """Review renders: the new structures over the ribs, with the gland and the skin see-through; at rest and in ptosis."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    from pilot_mammaplasty import splat

    out.mkdir(parents=True, exist_ok=True)
    colors = {"artery": (0.85, 0.15, 0.15), "nerve": (0.96, 0.84, 0.25), "ligament": (0.5, 0.8, 0.6)}
    ch = scene.ch
    breast = scene.breast
    bones = [bb.mesh(mesh) for name in [f"Left {o} rib" for o in ORDINAL.values()] + [f"Left {o} costal cartilage" for o in ORDINAL.values()] + ["Body of sternum", "Manubrium"] for mesh in BY_SOURCE[name]]
    trunks = [bb.mesh(mesh) for name in ("Trunk of left internal thoracic artery", "Left lateral thoracic artery", "Pectoral branch of left thoraco-acromial artery") for mesh in BY_SOURCE[name]]
    skin = bb.mesh(bb.SKIN)
    lobes = bb.mesh(next(n for n in bb.SIDE_MESHES["op"] if "lobes" in n))
    nac = [bb.mesh(n) for n in bb.SIDE_MESHES["op"] if "nipple" in n or "areola_L" in n]
    centre = ch.to_model(np.array([[scene.un, 15.0, 140.0]]))[0]
    for state in (-1, 1, 2):
        move = (lambda p: p) if state < 0 else (lambda p: ch.to_model(bb.deform(breast, ch.to_chart(p))[state]))  # noqa: E731
        layers = [(p, i, (0.9, 0.87, 0.78), 1.0) for p, i in bones] + [(p, i, (0.6, 0.1, 0.1), 1.0) for p, i in trunks]
        for item in items:
            if "points" in item:
                verts, faces = tube_mesh(move(item["points"]), item["radius"])
                layers.append((verts, faces, colors[item["tissue"]], 1.0))
            else:
                verts, faces = sheet_mesh(move(item["grid"].reshape(-1, 3)).reshape(item["grid"].shape))
                layers.append((verts, faces, (0.37, 0.7, 0.85) if item["structure"] == "horizontal-septum" else colors[item["tissue"]], 0.75 if item["structure"] == "horizontal-septum" else 1.0))
        layers += [(move(p), i, (0.55, 0.3, 0.24), 1.0) for p, i in nac]
        layers.append((move(lobes[0]), lobes[1], (0.9, 0.55, 0.65), 0.18))
        layers.append((move(skin[0]), skin[1], (0.92, 0.74, 0.64), 0.16))
        views = ((0, 0), (40, 0), (88, 0), (40, -35))
        image = np.hstack([splat(layers, yaw, pitch, centre, half=150, size=560, spacing=0.6) for yaw, pitch in views])
        plt.imsave(out / f"breast-anatomy-{'rest' if state < 0 else bb.STATES[state]['id']}.png", image)


if __name__ == "__main__":
    main()
