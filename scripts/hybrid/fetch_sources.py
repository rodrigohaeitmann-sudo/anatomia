"""Downloads every raw source used by build_hybrid_model.py into assets/source/hybrid/ (git-ignored).

  * BodyParts3D 4.3: the meshes listed in bp3d43-selection.json + the male skin used for registration
  * BodyParts3D 3.0: left latissimus dorsi (FMA13359, absent from 4.x)
  * HRA Visible Human Female v1.3: skin and both mammary glands
  * Z-Anatomy: muscular, lymphoid and nervous FBX (then run extract_zanatomy.mjs)

Usage: python3 scripts/hybrid/fetch_sources.py
"""

from __future__ import annotations

import concurrent.futures as cf
import json
import ssl
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
DEST = HERE.parents[1] / "assets" / "source" / "hybrid"
CTX = ssl.create_default_context()

BP43 = "https://media.githubusercontent.com/media/olivercase/body_parts_3d_api/main/"
FILES = {
    "bp3d-4.3/skin_FJ2810.obj": BP43 + "meshes/FJ2810_BP22617_FMA7163_Skin.obj",
    "bp3d-3.0/FMA13359.stl": "https://raw.githubusercontent.com/Kevin-Mattheus-Moerman/BodyParts3D/main/assets/BodyParts3D_data/stl/FMA13359.stl",
    **{f"hra/{name}": f"https://raw.githubusercontent.com/hubmapconsortium/ccf-3d-reference-object-library/master/VH_Female/v1.3/{name}"
       for name in ("VH_F_skin.glb", "VH_F_mammary_gland_L.glb", "VH_F_mammary_gland_R.glb")},
    **{f"z-anatomy/fbx/{name}": "https://raw.githubusercontent.com/LluisV/Z-Anatomy/PC-Version/Resources/Models/FBX/" + urllib.parse.quote(name)
       for name in ("MuscularSystem100.fbx", "LymphoidOrgans100.fbx", "NervousSystem100.fbx")},
}


def download(item: tuple[str, str]) -> int:
    rel, url = item
    out = DEST / rel
    if out.exists() and out.stat().st_size > 0:
        return 0
    out.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(4):
        try:
            data = urllib.request.urlopen(url, context=CTX, timeout=300).read()
            out.write_bytes(data)
            return len(data)
        except Exception:  # noqa: BLE001 - retried, re-raised on the last attempt
            if attempt == 3:
                raise
    return 0


def main() -> None:
    selection = json.loads((HERE / "bp3d43-selection.json").read_text())
    items = list(FILES.items()) + [(f"bp3d-4.3/obj/{s['fj']}.obj", BP43 + urllib.parse.quote(s["file"])) for s in selection]
    with cf.ThreadPoolExecutor(12) as ex:
        total = sum(ex.map(download, items))
    print(f"{len(items)} files, {total / 1e6:.1f} MB downloaded into {DEST}")
    print("next: node scripts/hybrid/extract_zanatomy.mjs && python3 scripts/hybrid/build_hybrid_model.py && npm run pack:hybrid")


if __name__ == "__main__":
    main()
