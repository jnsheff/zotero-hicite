// The real bootstrap.js: uninstall() must delete the translator only for a genuine
// uninstall (reason 6), not when Zotero upgrades (7) or downgrades (8) the add-on.
var errors = [], removed = [], reinits = 0;
var Zotero = { initializationPromise: Promise.resolve(), logError: function (e) { errors.push(e.message); },
	getTranslatorsDirectory: function () { return { path: '/tz' }; },
	Translators: { reinit: function () { reinits++; return Promise.resolve(); } } };
var IOUtils = { remove: function (p) { removed.push(p); return Promise.resolve(); } };
var PathUtils = { join: function () { return Array.prototype.join.call(arguments, '/'); } };
var boot = new Function('Zotero', 'IOUtils', 'PathUtils', 'Services',
	read('addon/bootstrap.js') + '; return { uninstall: uninstall };')(Zotero, IOUtils, PathUtils, {});
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(m + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
Promise.all([boot.uninstall({}, 7), boot.uninstall({}, 8), boot.uninstall({})]).then(function () {
	eq(removed, [], 'upgrade / downgrade / unknown reason must not delete the translator');
	return boot.uninstall({}, 6);
}).then(function () {
	eq(removed, ['/tz/hicite.js'], 'real uninstall deletes the translator');
	eq(reinits, 1, 'translators reloaded after real uninstall');
	print(errors.length ? 'FAIL\n' + errors.join('\n') : 'bootstrap OK (uninstall only on real removal)');
}).catch(function (e) { print('FAIL\nexception: ' + e.message); });
