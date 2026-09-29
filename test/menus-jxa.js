// Runs HiCite.registerMenus() against a mock of Zotero.MenuManager that enforces
// the validation rules from Zotero's menuManager.js, and checks l10n IDs exist.
ObjC.import('Foundation');
function read(p) { return ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null)); }
var dir = $.NSFileManager.defaultManager.currentDirectoryPath.js;
var VALID = ['main/menubar/file','main/menubar/edit','main/menubar/view','main/menubar/go','main/menubar/tools',
	'main/menubar/help','main/library/item','main/library/collection','main/library/addAttachment',
	'main/library/addNote','main/tab','itemPane/info/row','sidenav/locate'];
var GROUPED = ['main/library/item', 'main/library/collection'];
var ftl = read(dir + '/addon/locale/en-US/hicite-export.ftl');
var errors = [], registered = [];

function checkMenu(m, path) {
	if (['menuitem', 'separator', 'submenu'].indexOf(m.menuType) < 0) errors.push(path + ': bad menuType');
	if (m.menuType === 'menuitem') {
		if (!m.l10nID) errors.push(path + ': no l10nID');
		else if (ftl.indexOf(m.l10nID + ' =') < 0) errors.push(path + ': l10nID ' + m.l10nID + ' not in .ftl');
		if (typeof m.onCommand !== 'function') errors.push(path + ': no onCommand');
	}
	if (m.menuType === 'submenu') (m.menus || []).forEach(function (c, i) { checkMenu(c, path + '.menus[' + i + ']'); });
}
var Zotero = {
	logError: function (e) { errors.push('logError: ' + e.message); },
	MenuManager: { registerMenu: function (o) {
		var bad = false;
		if (VALID.indexOf(o.target) < 0) { errors.push('invalid target ' + o.target); bad = true; }
		if (!o.menus || !o.menus.length) { errors.push(o.target + ': empty menus'); bad = true; }
		if (GROUPED.indexOf(o.target) >= 0 && o.menus.some(function (m) { return m.menuType === 'separator'; })) {
			errors.push(o.target + ': top-level separators are not allowed'); bad = true; }
		o.menus.forEach(function (m, i) { checkMenu(m, o.target + '.menus[' + i + ']'); });
		if (bad) return false;
		registered.push(o.target); return o.menuID;
	} }
};
var HC = new Function('Zotero', read(dir + '/addon/hicite-export.js') + '; return HiCite;')(Zotero);
HC.id = 'x'; HC.registerMenus();
var want = ['main/library/item', 'main/library/collection', 'main/menubar/tools'];
want.forEach(function (t) { if (registered.indexOf(t) < 0) errors.push('not registered: ' + t); });
errors.length ? 'FAIL\n' + errors.join('\n') : 'menus OK: ' + registered.join(', ');
