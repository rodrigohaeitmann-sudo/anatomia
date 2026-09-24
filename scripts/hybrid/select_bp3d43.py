"""Selects the BodyParts3D 4.3 meshes used by the hybrid torso (axilla, chest wall, back, proximal arm).

Reads the bounds header of every 4.3 mesh (HTTP range requests on the olivercase/body_parts_3d_api
mirror) and applies the explicit name rules below. Writes scripts/hybrid/bp3d43-selection.json,
which is committed so the build is reproducible without re-running this step.

Usage: python3 scripts/hybrid/select_bp3d43.py
"""
import concurrent.futures as cf
import csv
import io
import json
import re
import ssl
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
MIRROR = "olivercase/body_parts_3d_api"
RAW = f"https://raw.githubusercontent.com/{MIRROR}/main/"
MEDIA = f"https://media.githubusercontent.com/media/{MIRROR}/main/"
CTX = ssl.create_default_context()


def fetch(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    return urllib.request.urlopen(req, context=CTX, timeout=120).read()


def tree():
    data = json.loads(fetch(f"https://api.github.com/repos/{MIRROR}/git/trees/main?recursive=1"))
    return [t["path"] for t in data["tree"] if t["path"].startswith("meshes/") and t["path"].endswith(".obj")]


def bounds(path):
    text = fetch(MEDIA + urllib.parse.quote(path), {"Range": "bytes=0-700"}).decode("latin1")
    m = re.search(r"Bounds\(mm\): \(([^)]*)\)-\(([^)]*)\)", text)
    return path, {"min": [float(x) for x in m.group(1).split(",")], "max": [float(x) for x in m.group(2).split(",")]}


names = tree()
with cf.ThreadPoolExecutor(24) as ex:
    h = dict(ex.map(bounds, names))
man = {r["fj_id"]: r for r in csv.DictReader(io.StringIO(fetch(RAW + "MANIFEST.csv").decode()))}
# (structureId, category, regex on lowercase name). Order matters: first match wins.
RULES=[
 # --- vessels (operative side = left in source) ---
 ('axillary-vessels','vessel',r'^left axillary (artery|vein)$'),
 ('subclavian-vessels','vessel',r'^(trunk of left subclavian artery|left subclavian vein)$'),
 ('thoracoacromial-vessels','vessel',r'thoraco-acromial artery'),
 ('lateral-thoracic-vessels','vessel',r'^left lateral thoracic (artery|vein)$'),
 ('subscapular-vessels','vessel',r'^(trunk of left subscapular artery|left subscapular vein|left circumflex scapular (artery|vein))$'),
 ('thoracodorsal-vessels','vessel',r'^left thoracodorsal (artery|vein)$'),
 ('circumflex-humeral-vessels','vessel',r'^left (anterior|posterior) circumflex humeral (artery|vein)$'),
 ('brachial-vessels','vessel',r'^(left brachial artery|left deep brachial artery|left basilic vein|left cephalic vein|left medial brachial vein|left lateral brachial vein)$'),
 ('internal-thoracic-vessels','vessel',r'^(trunk of left internal thoracic artery|left internal thoracic vein|left musculophrenic (artery|vein)|left superior epigastric (artery|vein))$'),
 ('intercostal-vessels','vessel',r'^(set of posterior intercostal arteries|set of anterior intercostal veins|left (first|second) posterior intercostal artery|left superior intercostal (artery|vein)|left subcostal (artery|vein)|lumbar (artery|vein))$'),
 ('scapular-cervical-vessels','vessel',r'^(left suprascapular (artery|vein)|left dorsal scapular artery|left superficial cervical artery|trunk of left transverse cervical artery)$'),
 # --- nerves ---
 ('thoracodorsal-nerve','nerve',r'^left thoracodorsal nerve$'),
 ('long-thoracic-nerve','nerve',r'long thoracic nerve'),
 ('pectoral-nerves','nerve',r'pectoral nerve'),
 ('intercostobrachial-nerve','nerve',r'intercostobrachial'),
 ('intercostal-nerves','nerve',r'intercostal nerve'),
 ('brachial-plexus','nerve',r'(brachial nerve plexus|^trunk of left (fifth|sixth|seventh|eighth) cervical nerve$|^trunk of left first thoracic nerve$|^trunk of left subclavian nerve$|^left superior subscapular nerve$|^left supraclavicular nerve$)'),
 ('arm-nerves','nerve',r'^left (axillary|radial|median|ulnar|musculocutaneous) nerve$'),
 # --- muscles ---
 ('serratus-anterior','muscle',r'^left serratus anterior$'),
 ('pectoralis-major','muscle',r'part of left pectoralis major$'),
 ('pectoralis-minor','muscle',r'^left pectoralis minor$'),
 ('contralateral-pectoral','muscle',r'(part of right pectoralis major|^right pectoralis minor)$'),
 ('subclavius','muscle',r'^left subclavius$'),
 ('trapezius','muscle',r'part of left trapezius$'),
 ('rhomboids','muscle',r'^left rhomboid (major|minor)$'),
 ('levator-scapulae','muscle',r'^left levator scapulae$'),
 ('teres-major','muscle',r'^left teres major$'),
 ('teres-minor','muscle',r'^left teres minor$'),
 ('subscapularis','muscle',r'^left subscapularis$'),
 ('infraspinatus','muscle',r'^left infraspinatus( muscle)?$'),
 ('supraspinatus','muscle',r'^left supraspinatus$'),
 ('deltoid','muscle',r'part of left deltoid$'),
 ('coracobrachialis-biceps','muscle',r'^(left coracobrachialis|short head of left biceps brachii|long head of left biceps brachii)$'),
 ('triceps','muscle',r'head of left triceps brachii$'),
 ('external-oblique','muscle',r'^left external oblique$'),
 ('serratus-posterior','muscle',r'^left serratus posterior (inferior|superior)$'),
 ('intercostal-muscles','muscle',r'^(external|internal|innermost) intercostal muscle$'),
 # --- bones (bilateral thoracic cage) ---
 ('chest-wall','bone',r'^(left|right) (first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth) rib$'),
 ('costal-cartilages','bone',r'costal cartilage$'),
 ('chest-wall','bone',r'^(manubrium of sternum|manubrium|body of sternum|xiphoid process)$'),
 ('spine','bone',r'^(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth) thoracic vertebra$|^(first|second) lumbar vertebra$'),
 ('scapula-clavicle','bone',r'^(left|right) (scapula|clavicle)$'),
 ('humerus','bone',r'^left humerus$'),
 ('iliac-crest','bone',r'^left hip bone$'),
]
sel=[];seen=set()
for n,v in sorted(h.items()):
    fn=n.split('/')[-1][:-4]; fj,bp,fma,name=fn.split('_',3)
    l=name.lower()
    for sid,cat,rx in RULES:
        if re.search(rx,l):
            key=(name,tuple(round(x,1) for x in v['min']),tuple(round(x,1) for x in v['max']))
            if key in seen: break
            seen.add(key)
            sel.append(dict(file=n,fj=fj,bp=bp,fma=fma,name=name,structure=sid,category=cat,faces=int(man[fj]['faces']),bytes=int(man[fj]['bytes'])))
            break


def iou(a, b):
    lo = [max(a["min"][i], b["min"][i]) for i in range(3)]
    hi = [min(a["max"][i], b["max"][i]) for i in range(3)]
    inter = va = vb = 1.0
    for i in range(3):
        inter *= max(0, hi[i] - lo[i])
        va *= a["max"][i] - a["min"][i]
        vb *= b["max"][i] - b["min"][i]
    return inter / max(1e-9, va + vb - inter)


# drop duplicate elements of the same concept (same name, overlapping bounds)
keep = []
for s in sorted(sel, key=lambda s: -s["faces"]):
    if any(k["name"] == s["name"] and iou(h[k["file"]], h[s["file"]]) > 0.6 for k in keep):
        continue
    keep.append(s)
fields = ("file", "fj", "fma", "name", "structure", "category", "faces", "bytes")
(HERE / "bp3d43-selection.json").write_text(json.dumps([{k: s[k] for k in fields} for s in keep], indent=1))
sel = keep
import collections
c=collections.defaultdict(lambda:[0,0,0])
for s in sel: c[s['structure']][0]+=1; c[s['structure']][1]+=s['faces']; c[s['structure']][2]+=s['bytes']
for k,v in c.items(): print(f"{k:28s} meshes={v[0]:3d} faces={v[1]:7d}")
print('TOTAL',len(sel),sum(s['faces'] for s in sel),sum(s['bytes'] for s in sel)/1e6,'MB')
