// The plugin side of the hicite types: Extra parsing, which type an item is, the item-pane rows
// (shown only where they apply, edits saved to Extra), and the menus.
var errors = [], rows = {}, menus = {}, saved = 0, alerts = [];
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(m + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
var Zotero = {
	logError: function (e) { errors.push('logError: ' + e.message); },
	alert: function (w, t, m) { alerts.push(m); },
	ItemPaneManager: {
		registerInfoRow: function (o) { rows[o.rowID] = o; return o.rowID; },
		unregisterInfoRow: function (id) { delete rows[id]; },
	},
	MenuManager: {
		registerMenu: function (o) { menus[o.menuID] = o; return o.menuID; },
		unregisterMenu: function (id) { delete menus[id]; },
	},
	ItemTypes: { getID: function (n) { return 'id:' + n; } },
};
var T = new Function('Zotero', read('addon/hicite-types.js') + '; return HiCiteTypes;')(Zotero);
T.load(read('addon/hicite-types.json'));
T.init('hicite-export@zotero.local');

function item(type, extra) {
	var it = { itemType: type, f: { extra: extra || '' },
		getField: function (n) { return this.f[n] || ''; }, setField: function (n, v) { this.f[n] = v; },
		saveTx: function () { saved++; return Promise.resolve(); } };
	return it;
}
function enabled(row, it) { var on; rows[row].onItemChange({ item: it, setEnabled: function (b) { on = b; } }); return on; }

// one row per Extra-only parameter plus the type row; nothing for parameters Zotero has
eq(rows['hicite-doctype'] !== undefined && rows['hicite-origsect'] !== undefined && rows['hicite-dbid'] !== undefined, true, 'rows registered');
eq(rows['hicite-title'], undefined, 'no row for a field Zotero already has');
Object.keys(rows).forEach(function (id) { eq(typeof rows[id].label.l10nID, 'string', id + ' label'); });

// Extra lines
var ex = 'Citation Key: x\nhicite-vol: 90\nhicite-doctype: govdoc\nnote here';
eq(T.getLine(item('document', ex), 'vol'), '90', 'getLine');
eq(T.getLine(item('document', ex), 'rep'), '', 'missing line');
eq(T.withLine(ex, 'vol', '91'), 'Citation Key: x\nhicite-doctype: govdoc\nnote here\nhicite-vol: 91', 'replace keeps the other lines');
eq(T.withLine(ex, 'vol', ''), 'Citation Key: x\nhicite-doctype: govdoc\nnote here', 'empty removes the line');
eq(T.withLine('', 'vol', ' 1\n2 '), 'hicite-vol: 1 2', 'newlines collapsed');
eq(T.withLine('hicite-vol: 1', 'vo', 'x'), 'hicite-vol: 1\nhicite-vo: x', 'a name that is a prefix of another is a different line');

// which type
eq(T.typeOf(item('document', ex)).id, 'govdoc', 'document + hicite-doctype');
eq(T.typeOf(item('document', '')), null, 'plain document is not a hicite type');
eq(T.typeOf(item('document', 'hicite-doctype: case')), null, 'a non-virtual id does not turn a document into a case');
eq(T.typeOf(item('statute', '')).id, 'statcode', 'statute defaults to statcode');
eq(T.typeOf(item('statute', 'hicite-doctype: statsess')).id, 'statsess', 'statute session law');
eq(T.typeOf(item('case', '')).id, 'case', 'case'); eq(T.typeOf(item('journalArticle', '')).id, 'jrnart', 'jrnart');
eq(T.typeOf(item('bill', '')).id, 'bill', 'bill'); eq(T.typeOf(item('webpage', '')).id, 'website', 'website');
eq(T.typeOf(item('note', '')), null, 'other Zotero types are none');

// row visibility
eq(enabled('hicite-doctype', item('document')), true, 'type row on documents'); eq(enabled('hicite-doctype', item('statute')), true, 'type row on statutes');
eq(enabled('hicite-doctype', item('book')), false, 'type row off elsewhere');
eq(enabled('hicite-origsect', item('statute')), true, 'origsect on a statute'); eq(enabled('hicite-origsect', item('book')), false, 'origsect not on a book');
eq(enabled('hicite-dbid', item('case')), true, 'dbid on a case'); eq(enabled('hicite-dbid', item('document', 'hicite-doctype: govdoc')), false, 'dbid not on a govdoc');
eq(enabled('hicite-agency', item('document', 'hicite-doctype: govdoc')), true, 'agency on a govdoc'); eq(enabled('hicite-agency', item('document')), false, 'not on a plain document');
eq(enabled('hicite-slip', item('statute', 'hicite-doctype: statsess')), true, 'slip on a session law'); eq(enabled('hicite-slip', item('statute')), false, 'slip not on a code statute');

// editing
var g = item('document', 'Citation Key: x'), done;
rows['hicite-doctype'].onSetData({ item: g, value: 'GovDoc' }).then(function () {
	eq(g.f.extra, 'Citation Key: x\nhicite-doctype: govdoc', 'type row writes Extra'); eq(saved, 1, 'saved');
	return rows['hicite-doctype'].onSetData({ item: g, value: 'statsess' });
}).then(function () {
	eq(g.f.extra, 'Citation Key: x\nhicite-doctype: govdoc', 'a type not valid for the item is refused'); eq(alerts.length, 1, 'user told');
	return rows['hicite-docket'].onSetData({ item: g, value: 'D-1' });
}).then(function () {
	eq(g.f.extra, 'Citation Key: x\nhicite-doctype: govdoc\nhicite-docket: D-1', 'parameter row writes Extra');
	return rows['hicite-docket'].onSetData({ item: g, value: 'D-1' });
}).then(function () {
	eq(saved, 2, 'no save when nothing changed');
	// menus
	var setType = menus['hicite-types-item'].menus[0], byId = {};
	setType.menus.forEach(function (m) { byId[m.l10nID] = m; });
	var vis; var ctx = function (items) { return { items: items, setVisible: function (b) { vis = b; } }; };
	setType.onShowing({}, ctx([item('book')])); eq(vis, false, 'submenu hidden for a book');
	setType.onShowing({}, ctx([g])); eq(vis, true, 'submenu shown for a document');
	byId['hicite-type-statsess'].onShowing({}, ctx([g])); eq(vis, false, 'statsess not offered for a document');
	byId['hicite-type-const'].onShowing({}, ctx([g])); eq(vis, true, 'const offered for a document');
	return byId['hicite-type-const'].onCommand({}, ctx([g]));
}).then(function () {
	eq(T.typeOf(g).id, 'const', 'menu switches the type');
	var created;
	var win = { ZoteroPane: { newItem: function (tid, data) { created = [tid, data]; return Promise.resolve(); } } };
	var news = menus['hicite-types-new'].menus[0].menus;
	eq(news.map(function (m) { return m.l10nID; }), ['hicite-type-govdoc', 'hicite-type-casedoc', 'hicite-type-congrec', 'hicite-type-const', 'hicite-type-constamend', 'hicite-type-modelcode', 'hicite-type-statsess'], 'new-item menu');
	return news[0].onCommand({ target: { ownerGlobal: win } }).then(function () {
		eq(created, ['id:document', { extra: 'hicite-doctype: govdoc' }], 'new item is a Document with the type');
		return news[6].onCommand({ target: { ownerGlobal: win } });
	}).then(function () { eq(created, ['id:statute', { extra: 'hicite-doctype: statsess' }], 'new session law is a Statute'); });
}).then(function () {
	// every l10n id used exists in the .ftl
	var ftl = read('addon/locale/en-US/hicite-export.ftl'), ids = [];
	Object.keys(rows).forEach(function (r) { ids.push(rows[r].label.l10nID); });
	(function walk(ms) { ms.forEach(function (m) { if (m.l10nID) ids.push(m.l10nID); if (m.menus) walk(m.menus); }); })([].concat(menus['hicite-types-item'].menus, menus['hicite-types-new'].menus));
	ids.forEach(function (id) { if (ftl.indexOf('\n' + id + ' =') < 0 && ftl.indexOf(id + ' =') !== 0) errors.push('missing in .ftl: ' + id); });
	T.destroy();
	eq(Object.keys(rows).length + Object.keys(menus).length, 0, 'destroy unregisters everything');
	print(errors.length ? 'TYPES-PLUGIN FAILED\n' + errors.join('\n') : 'types plugin OK (rows, Extra edits, menus, l10n, teardown)');
}).catch(function (e) { print('TYPES-PLUGIN FAILED\nexception: ' + e.message + '\n' + e.stack); });
