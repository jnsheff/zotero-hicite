"""Mirrors the checks Zotero's Extension.sys.mjs applies to a plugin manifest
(applications.zotero.{id,update_url,strict_max_version} are mandatory), plus
that the manifest's compatibility range admits the installed/target version."""
import json, os, re, sys

here = os.path.dirname(os.path.abspath(__file__))
m = json.load(open(os.path.join(here, '..', 'addon', 'manifest.json')))
z = m.get('applications', {}).get('zotero', {})
errors = [f'applications.zotero.{k} not provided' for k in ('id', 'update_url', 'strict_max_version') if not z.get(k)]
if z.get('update_url') and not re.match(r'^https?://[^/\s]+', z['update_url']):
    errors.append('update_url is not a URL')
for k in ('name', 'version', 'manifest_version'):
    if not m.get(k):
        errors.append(f'{k} missing')

def vt(v):  # 9.0.6 -> (9,0,6); "9.0.*" upper bound handled below
    return tuple(int(x) for x in v.split('.') if x.isdigit())

# updates.json (Zotero's update manifest) must list the current version, for this id
upath = os.path.join(here, '..', 'updates.json')
if os.path.exists(upath):
    ups = json.load(open(upath)).get('addons', {}).get(z.get('id'), {}).get('updates', [])
    cur = [u for u in ups if u.get('version') == m.get('version')]
    if not cur:
        errors.append('updates.json has no entry for version ' + str(m.get('version')) + ' (run tools/make-updates.py)')
    else:
        u = cur[0]
        if not u.get('update_link', '').endswith('/v%s/hicite-export.xpi' % m['version']):
            errors.append('updates.json update_link does not match version')
        if not re.match(r'^sha256:[0-9a-f]{64}$', u.get('update_hash', '')):
            errors.append('updates.json update_hash malformed')

target = vt(sys.argv[1] if len(sys.argv) > 1 else '9.0.6')
lo = z.get('strict_min_version')
hi = z.get('strict_max_version', '')
if lo and vt(lo) > target:
    errors.append(f'strict_min_version {lo} excludes Zotero {target}')
if hi and target[:len(vt(hi))] > vt(hi):
    errors.append(f'strict_max_version {hi} excludes Zotero {target}')
print('manifest OK' if not errors else '\n'.join(errors))
sys.exit(1 if errors else 0)
