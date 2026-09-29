"""Add the built package to updates.json (Zotero's update manifest).

Usage: python3 tools/make-updates.py [path/to/hicite-export.xpi]

Reads id, version and the compatible Zotero range from addon/manifest.json, and
the SHA-256 of the .xpi you are about to upload to the GitHub release. Earlier
versions already listed in updates.json are kept; an entry for the same version
is replaced. Run this after `make xpi`, commit updates.json, then publish the
release with exactly that .xpi (a rebuilt .xpi has a different hash).
"""
import hashlib, json, os, sys

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
manifest = json.load(open(os.path.join(root, 'addon', 'manifest.json')))
z = manifest['applications']['zotero']
xpi = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, 'hicite-export.xpi')
version = manifest['version']
repo = 'https://github.com/jnsheff/zotero-hicite'

entry = {
    'version': version,
    'update_link': f'{repo}/releases/download/v{version}/hicite-export.xpi',
    'update_hash': 'sha256:' + hashlib.sha256(open(xpi, 'rb').read()).hexdigest(),
    'applications': {'zotero': {
        'strict_min_version': z['strict_min_version'],
        'strict_max_version': z['strict_max_version'],
    }},
}

path = os.path.join(root, 'updates.json')
data = json.load(open(path)) if os.path.exists(path) else {'addons': {z['id']: {'updates': []}}}
updates = data['addons'].setdefault(z['id'], {'updates': []})['updates']
updates[:] = [u for u in updates if u['version'] != version] + [entry]
json.dump(data, open(path, 'w'), indent=2)
open(path, 'a').write('\n')
print(f'updates.json: {z["id"]} {version} {entry["update_hash"][:23]}...')
