// The "Key store" setting (Extra vs Zotero's Citation Key field) and "Move Keys to Citation Key Field".
var errors = [], saves = [], prefs = {}, scheduled = [], notified = [], prompts = [];
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(m + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
var library = [];
function Search() {
	var conds = [];
	this.addCondition = function (f, op, v) { conds.push([f, op, v]); };
	this.search = function () {
		return Promise.resolve(library.filter(function (it) {
			return conds.every(function (c) {
				if (c[0] === 'extra') return it.getField('extra').indexOf(c[2]) >= 0;
				if (c[0] === 'citationKey') return it.getField('citationKey') === c[2];
				return true;
			});
		}).map(function (it) { return it.id; }));
	};
}
var Zotero = { Prefs: { get: function (k) { return prefs[k]; }, set: function (k, v) { prefs[k] = v; } },
	logError: function (e) { errors.push('logError: ' + e.message); },
	Search: Search, Items: { getAsync: function (ids) { return Promise.resolve(library.filter(function (i) { return ids.indexOf(i.id) >= 0; })); } },
	CreatorTypes: { getPrimaryIDForType: function () { return 1; } },
	getMainWindow: function () { return {}; }, Libraries: { getName: function () { return 'My Library'; } } };
var Services = { prompt: { confirm: function (w, t, text) { prompts.push(text); return prompts.answer !== false; } } };
var HC = new Function('Zotero', 'Services', read('addon/hicite-export.js') + '; return HiCite;')(Zotero, Services);
HC.schedule = function (libs) { scheduled.push(Array.from(libs)); };
HC.notify = function (m) { notified.push(m); };

var nextID = 1;
// type 'note'-like items cannot hold a Citation Key: setField throws, as Zotero does for a field the type lacks
function mock(fields, opts) {
	opts = opts || {};
	var f = JSON.parse(JSON.stringify(fields)), id = nextID++;
	var it = { id: id, libraryID: 1, key: 'K' + id, itemType: opts.type || 'book', itemTypeID: 1, isFeedItem: false, _f: f,
		isRegularItem: function () { return true; },
		getField: function (n) {
			if (n === 'year') { var m = /(\d{4})/.exec(f.date || ''); return m ? m[1] : ''; }
			return f[n] || '';
		},
		setField: function (n, v) { if (n === 'citationKey' && opts.noKeyField) throw new Error("'citationKey' is not a valid field for type " + it.itemType); f[n] = v; return true; },
		getCreators: function () { return [{ creatorTypeID: 1, lastName: fields._last || 'Smith', firstName: 'Ann', fieldMode: 0 }]; },
		saveTx: function (o) { saves.push([id, o]); return Promise.resolve(); } };
	library.push(it);
	return it;
}
function extraKeyLines(it) { return it.getField('extra').split('\n').filter(function (l) { return /^Citation Key:/.test(l); }); }

var A;
Promise.resolve().then(function () {
	// ---- default: Extra
	prefs = {};
	A = mock({ title: 'T', date: '2020' });
	return HC.pin(A).then(function (k) {
		eq(k, 'smith2020', 'default store: generated key'); eq(extraKeyLines(A), ['Citation Key: smith2020'], 'default store writes Extra'); eq(A.getField('citationKey'), '', 'and leaves the field alone');
		// ---- field store
		prefs = { 'translators.hicite.keyStore': 'field' };
		var B = mock({ title: 'T', date: '2021', extra: 'note\nCitation Key: stale' });
		return HC.pin(B, { force: true }).then(function (k2) {
			eq(k2, 'smith2021', 'field store: forced key'); eq(B.getField('citationKey'), 'smith2021', 'written to the Citation Key field'); eq(extraKeyLines(B), [], 'and removed from Extra'); eq(B.getField('extra'), 'note', 'other Extra lines survive');
			eq(saves[saves.length - 1][1], { skipDateModifiedUpdate: true, skipNotifier: true }, 'saved without notifying Better BibTeX or touching Date Modified');
			var C = mock({ title: 'T', date: '2022' });
			return HC.pin(C).then(function (k3) { eq([k3, C.getField('citationKey'), extraKeyLines(C)], ['smith2022', 'smith2022', []], 'field store: new item keyed in the field'); });
		});
	});
}).then(function () {
	// ---- existing keys are kept
	var n = saves.length;
	var legacy = mock({ title: 'T', date: '2019', extra: 'Citation Key: mine1', citationKey: 'bbt2019' });
	var bbt = mock({ title: 'T', date: '2018', citationKey: 'bbtkey2018' });
	return HC.pin(legacy).then(function (a) { return HC.pin(bbt).then(function (b) {
		eq([a, b], ['mine1', 'bbtkey2018'], 'field store: a key in Extra wins over the field; with no Extra key the field key is kept');
		eq(saves.length, n, 'neither is rewritten');
	}); });
}).then(function () {
	// ---- uniqueness looks at both places
	library.length = 0;
	mock({ title: 'T', date: '2020', citationKey: 'smith2020' });          // BBT-style key in the field
	mock({ title: 'T', date: '2020', extra: 'Citation Key: smith2020a' }); // legacy key in Extra
	var D = mock({ title: 'T', date: '2020' });
	return HC.pin(D).then(function (k) { eq(k, 'smith2020b', 'field store: taken keys in the field and in Extra are both avoided'); });
}).then(function () {
	// ---- an item type without the field falls back to Extra
	var E = mock({ title: 'T', date: '2017' }, { noKeyField: true, type: 'oddType' });
	return HC.pin(E).then(function (k) { eq([k, extraKeyLines(E), E.getField('citationKey')], ['smith2017', ['Citation Key: smith2017'], ''], 'no Citation Key field for the type: Extra'); });
}).then(function () {
	// ---- moving keys
	library.length = 0; saves.length = 0; prefs = {}; scheduled.length = 0;
	HC.scopeItems = function () { return Promise.resolve(library.slice()); };
	var m1 = mock({ title: 'Moves', date: '2020', extra: 'x: y\nCitation Key: a1' });
	var m2 = mock({ title: 'Replaces', date: '2020', extra: 'Citation Key: b1', citationKey: 'bbtb' });
	var m3 = mock({ title: 'Same', date: '2020', extra: 'Citation Key: c1', citationKey: 'c1' });
	var m4 = mock({ title: 'Field only', date: '2020', citationKey: 'd1' });
	var m5 = mock({ title: 'None', date: '2020' });
	var m6 = mock({ title: 'Cannot', date: '2020', extra: 'Citation Key: f1' }, { noKeyField: true });
	return HC.planKeyMove({ libraryID: 1 }).then(function (plan) {
		eq([plan.total, plan.move.length, plan.overwrite.length, plan.stored, plan.none], [6, 3, 1, 1, 1], 'plan counts');
		var text = HC.describeKeyMove(plan, '"My Library"');
		eq(/3 keys move/.test(text) && /1 keys replace/.test(text) && /Replaces: bbtb -> b1/.test(text) && /1 items already/.test(text) && /1 have no key/.test(text), true, 'the report names the replaced key');
		eq(saves.length, 0, 'planning changes nothing');
		prompts.answer = false;
		return HC.moveKeys({ libraryID: 1 }, { confirm: function (p) { return HC.confirmKeyMove(HC.describeKeyMove(p, '"My Library"')); } });
	}).then(function (r) {
		eq([r.cancelled, saves.length, prefs['translators.hicite.keyStore']], [true, 0, undefined], 'declined: nothing saved, setting not switched');
		eq([m1.getField('citationKey'), extraKeyLines(m1)], ['', ['Citation Key: a1']], 'declined: items untouched');
		prompts.answer = true;
		return HC.moveKeys({ libraryID: 1 }, { confirm: function () { return true; } });
	}).then(function (r) {
		eq([r.cancelled, r.moved, r.failed], [false, 3, 1], 'confirmed: 3 moved/replaced, 1 item type cannot hold the key');
		eq([m1.getField('citationKey'), extraKeyLines(m1), m1.getField('extra')], ['a1', [], 'x: y'], 'moved; other Extra lines stay');
		eq([m2.getField('citationKey'), extraKeyLines(m2)], ['b1', []], 'the hicite key replaced the other one');
		eq([m3.getField('citationKey'), extraKeyLines(m3)], ['c1', []], 'identical key: Extra line just removed');
		eq([m4.getField('citationKey'), m5.getField('citationKey')], ['d1', ''], 'items without an Extra key untouched');
		eq(extraKeyLines(m6), ['Citation Key: f1'], 'the item that cannot hold the field keeps its Extra key');
		eq(saves.length, 3, 'only changed items saved'); eq(saves.every(function (s) { return s[1].skipNotifier === true && s[1].skipDateModifiedUpdate === true; }), true, 'saved quietly');
		eq(prefs['translators.hicite.keyStore'], 'field', 'the key store setting is switched'); eq(scheduled, [[1]], 'auto-exports re-run');
		// afterwards the keys are found where they now live
		eq([HC.getKey(m1), HC.getKey(m2), HC.getKey(m4), HC.getKey(m6)], ['a1', 'b1', 'd1', 'f1'], 'getKey finds them');
	});
}).then(function () {
	// ---- translator side
	eval(read('test/run.js'));
	function exported(settings, items) { var out = runTranslator(read('addon/translator/hicite.js'), items, {}, settings), keys = {}; out.replace(/\\def(\w+)\{([^}]*)\}/g, function (m, t, k) { keys[k] = t; }); return Object.keys(keys); }
	var book = function (extra) { return Object.assign({ itemType: 'book', title: 'T', date: '2020', creators: [{ creatorType: 'author', firstName: 'Ann', lastName: 'Smith' }] }, extra); };
	eq(exported({ keyStore: 'field' }, [book({ citationKey: 'fieldkey1' })]), ['fieldkey1'], 'export, field store: the Citation Key field is used');
	eq(exported({ keyStore: 'field' }, [book({ citationKey: 'fieldkey1', extra: 'Citation Key: extrakey1' })]), ['extrakey1'], 'export: a key in Extra wins over the field');
	eq(exported({ keyStore: 'extra' }, [book({ citationKey: 'fieldkey1' })]), ['smith2020'], 'export, Extra store (own): the field is ignored');
	eq(exported({ keyStore: 'field' }, [book({ citationKey: '2012' })]), ['smith2020'], 'export, field store: an unusable key is replaced');
}).catch(function (e) { errors.push('exception ' + e.message + '\n' + e.stack); }).then(function () {
	print(errors.length ? 'KEYSTORE FAILED\n' + errors.join('\n') : 'keystore OK (field vs Extra, kept keys, uniqueness, fallback, move with dry-run report, export)');
});
