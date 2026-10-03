// Citation keys: one set, Better BibTeX's, in Zotero's Citation Key field. Without Better BibTeX the add-on makes
// the keys; with it the add-on leaves that to Better BibTeX and only gives it a formula for legal sources.
// Also: moving old "Citation Key:" lines from Extra into the field.
var errors = [], saves = [], prefs = {}, scheduled = [], notified = [], prompts = [];
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(m + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
var library = [];
function Search() {
	var conds = [];
	this.addCondition = function (f, op, v) { conds.push([f, op, v]); };
	this.search = function () {
		return Promise.resolve(library.filter(function (it) {
			return conds.every(function (c) {
				if (c[0] === 'extra') return it.getField('extra').toLowerCase().indexOf(c[2].toLowerCase()) >= 0;
				if (c[0] === 'citationKey') { try { return it.getField('citationKey').toLowerCase() === c[2].toLowerCase(); } catch (e) { return false; } }
				return true;
			});
		}).map(function (it) { return it.id; }));
	};
}
var Zotero = { Prefs: { get: function (k) { return prefs[k]; }, set: function (k, v) { prefs[k] = v; } },
	logError: function (e) { errors.push('logError: ' + e.message); }, debug: function () {},
	Search: Search, Items: { getAsync: function (ids) { return Promise.resolve(library.filter(function (i) { return ids.indexOf(i.id) >= 0; })); } },
	CreatorTypes: { getPrimaryIDForType: function () { return 1; }, getName: function () { return 'author'; } },
	getMainWindow: function () { return {}; }, Libraries: { getName: function () { return 'My Library'; } } };
var Services = { prompt: { confirm: function (w, t, text) { prompts.push(text); return prompts.answer !== false; } } };
var HC = new Function('Zotero', 'Services', read('addon/hicite-export.js') + '; return HiCite;')(Zotero, Services);
HC.schedule = function (libs) { scheduled.push(Array.from(libs)); };
HC.notify = function (m) { notified.push(m); };

var nextID = 1;
// an item type without the Citation Key field: setField throws, as Zotero does for a field the type lacks
function mock(fields, opts) {
	opts = opts || {};
	var f = JSON.parse(JSON.stringify(fields)), id = nextID++;
	var it = { id: id, libraryID: 1, key: 'K' + id, itemType: opts.type || 'book', itemTypeID: 1, isFeedItem: false, _f: f,
		isRegularItem: function () { return true; },
		getField: function (n) {
			if (n === 'year') { var m = /(\d{4})/.exec(f.date || ''); return m ? m[1] : ''; }
			if (n === 'citationKey' && opts.noKeyField) throw new Error("'citationKey' is not a valid field for type " + it.itemType);
			return f[n] || '';
		},
		setField: function (n, v) { if (n === 'citationKey' && opts.noKeyField) throw new Error("'citationKey' is not a valid field for type " + it.itemType); f[n] = v; return true; },
		getCreators: function () { return [{ creatorTypeID: 1, lastName: fields._last || 'Smith', firstName: 'Ann', fieldMode: 0 }]; },
		saveTx: function (o) { saves.push([id, o]); return Promise.resolve(); } };
	library.push(it);
	return it;
}
function extraKeyLines(it) { return it.getField('extra').split('\n').filter(function (l) { return /^Citation Key:/.test(l); }); }
var QUIET = { skipDateModifiedUpdate: true, skipNotifier: true };

var A;
Promise.resolve().then(function () {
	// ---- without Better BibTeX: the add-on makes Better BibTeX's keys, in the field
	prefs = {};
	A = mock({ title: 'The Words Here', date: '2020' });
	return HC.pin(A).then(function (k) {
		eq([k, A.getField('citationKey'), extraKeyLines(A)], ['smithWordsHere2020', 'smithWordsHere2020', []], 'a new item is keyed like Better BibTeX does, in the field, not in Extra');
		eq(saves[saves.length - 1][1], QUIET, 'saved without notifying Better BibTeX or touching Date Modified');
		// a legacy "Citation Key:" line is moved into the field (and wins over a different key there)
		var B = mock({ title: 'T', date: '2021', extra: 'note\nCitation Key: old1', citationKey: 'other2021' });
		return HC.pin(B).then(function (k2) {
			eq([k2, B.getField('citationKey'), B.getField('extra')], ['old1', 'old1', 'note'], 'an Extra key moves to the field, replacing a different one; other Extra lines stay');
			eq(saves[saves.length - 1][1], QUIET, 'moved quietly');
			var n = saves.length, C = mock({ title: 'T', date: '2019', citationKey: 'bbtkey2019' });
			return HC.pin(C).then(function (k3) { eq([k3, saves.length], ['bbtkey2019', n], 'a key in the field is kept, and the item not rewritten'); });
		});
	});
}).then(function () {
	// ---- forced: a new key is made here, replacing the old (Extra line and field)
	var D = mock({ title: 'Other Words', date: '2022', extra: 'Citation Key: stale', citationKey: 'staler' });
	return HC.pin(D, { force: true }).then(function (k) { eq([k, D.getField('citationKey'), extraKeyLines(D)], ['smithOtherWords2022', 'smithOtherWords2022', []], 'force: regenerated'); });
}).then(function () {
	// ---- uniqueness: a/b suffixes, looking at the field and at Extra, ignoring case
	library.length = 0;
	mock({ title: 'Same Title', date: '2020', citationKey: 'smithSameTitle2020' });
	mock({ title: 'Same Title', date: '2020', extra: 'Citation Key: SMITHSAMETITLE2020a' });
	var D = mock({ title: 'Same Title', date: '2020' });
	return HC.pin(D).then(function (k) { eq(k, 'smithSameTitle2020b', 'taken keys, in the field or in Extra, in any case, are avoided'); });
}).then(function () {
	// ---- an item type without the field falls back to Extra
	var E = mock({ title: 'Odd Type', date: '2017' }, { noKeyField: true, type: 'oddType' });
	return HC.pin(E).then(function (k) { eq([k, extraKeyLines(E)], ['smithOddType2017', ['Citation Key: smithOddType2017']], 'no Citation Key field for the type: Extra'); });
}).then(function () {
	// ---- with Better BibTeX: it makes the keys
	HC.bbt = { installed: true, active: true, version: '9.0.68' };
	library.length = 0; saves.length = 0;
	var F = mock({ title: 'Nothing Yet', date: '2023' });
	return HC.pin(F).then(function (k) {
		eq([k, saves.length, F.getField('citationKey')], ['', 0, ''], 'an item without a key is left for Better BibTeX to fill in: nothing made, nothing saved');
		var G = mock({ title: 'T', date: '2018', citationKey: 'bbtkey2018' }), H = mock({ title: 'T', date: '2019', extra: 'Citation Key: mine1', citationKey: 'bbt2019' });
		return HC.pin(G).then(function (a) { return HC.pin(H).then(function (b) {
			eq([a, b], ['bbtkey2018', 'mine1'], 'its key is kept; an Extra key still wins');
			eq([H.getField('citationKey'), extraKeyLines(H)], ['mine1', []], 'and is moved into the field, so there is one set of keys');
			eq(saves.length, 1, 'only the moved one was saved'); eq(saves[0][1], QUIET, 'quietly');
		}); });
	});
}).then(function () {
	var I = mock({ title: 'T', date: '2018', citationKey: 'old2018', extra: 'Citation Key: older' });
	saves.length = 0;
	return HC.pin(I, { force: true }).then(function (k) {
		eq([k, I.getField('citationKey'), extraKeyLines(I)], ['', '', []], 'force: the key is cleared for Better BibTeX to make again');
		eq(saves.length, 1, 'saved'); eq(saves[0][1], { skipDateModifiedUpdate: true }, 'not quietly: Better BibTeX has to notice the empty key');
	});
}).then(function () {
	// ---- the formula given to Better BibTeX
	var P = 'translators.better-bibtex.citekeyFormat', E = P + 'Editing';
	prefs = { 'translators.hicite.bbtFormula': 'on' }; notified.length = 0;
	prefs[P] = 'auth.lower + shorttitle(3, 3) + year'; prefs[E] = 'auth.lower + shorttitle(3,3) + year';
	HC.bbt = { installed: false, active: false, version: '' };
	return HC.syncBBTFormula().then(function (changed) {
		eq([changed, prefs[P]], [false, 'auth.lower + shorttitle(3, 3) + year'], 'no Better BibTeX: its preferences are not touched');
		HC.bbt = { installed: true, active: true, version: '9.0.68' };
		return HC.syncBBTFormula();
	}).then(function (changed) {
		eq([changed, prefs[P] === HC.BBT_FORMULA, prefs[E] === HC.BBT_FORMULA], [true, true, true], 'with Better BibTeX: both formula preferences are set');
		eq(prefs['translators.hicite.bbtFormulaBackup'], 'auth.lower + shorttitle(3, 3) + year', 'the previous formula is kept');
		eq(notified.length, 1, 'the user is told');
		return HC.syncBBTFormula();
	}).then(function (changed) {
		eq([changed, notified.length], [false, 1], 'nothing to do the second time');
		prefs[P] = 'something + else'; prefs[E] = 'something + else';
		return HC.syncBBTFormula();
	}).then(function (changed) {
		eq([changed, prefs[P] === HC.BBT_FORMULA, prefs['translators.hicite.bbtFormulaBackup']], [true, true, 'auth.lower + shorttitle(3, 3) + year'], 'a formula changed since is replaced; the first backup is not overwritten');
		prefs['translators.hicite.bbtFormula'] = 'off'; prefs[P] = 'mine'; prefs[E] = 'mine';
		return HC.syncBBTFormula();
	}).then(function (changed) {
		eq([changed, prefs[P]], [false, 'mine'], 'the setting off: the formula is left alone');
		// formula sanity: Better BibTeX patterns separated by "|", balanced, one line
		var f = HC.BBT_FORMULA;
		eq([f.indexOf('\n') < 0, f.split(' | ').length, (f.match(/\(/g) || []).length === (f.match(/\)/g) || []).length], [true, 4, true], 'formula: one line, four patterns, balanced parentheses');
		// the whole formula is also valid JavaScript (Better BibTeX parses formulas with a JavaScript parser), apart from
		// the unquoted words it reads as method names, so it must not contain a reserved word as an argument
		eq((function () { try { new Function('return ' + f); return true; } catch (e) { return e.message; } })(), true, 'formula parses as JavaScript');
		eq(/type\(\s*(case|statute|bill|hearing)\b/.test(f), false, 'item types are quoted (case is a reserved word)');
		eq(/type\('case'\)/.test(f) && /type\('statute', 'bill', 'hearing'\)/.test(f) && /auth\.lower \+ shorttitle\(3, 3\) \+ year$/.test(f), true, 'formula: cases, statutes/bills/hearings, then Better BibTeX\'s default');
	});
}).then(function () {
	// ---- detecting Better BibTeX
	HC.AddonManager = { getAddonByID: function (id) { return Promise.resolve(id === HC.BBT_ID ? { isActive: true, version: '9.0.68' } : null); } };
	return HC.detectBBT().then(function (found) {
		eq(found, { installed: true, active: true, version: '9.0.68' }, 'installed and enabled');
		HC.AddonManager = { getAddonByID: function () { return Promise.resolve({ isActive: false, version: '9.0.68' }); } };
		return HC.detectBBT();
	}).then(function (found) {
		eq([found.installed, found.active], [true, false], 'installed but disabled counts as not active');
		HC.AddonManager = { getAddonByID: function () { return Promise.resolve(null); } };
		return HC.detectBBT();
	}).then(function (found) {
		eq([found.installed, found.active], [false, false], 'not installed');
		HC.AddonManager = { getAddonByID: function () { return Promise.reject(new Error('no add-on manager')); } };
		return HC.detectBBT();
	}).then(function (found) { eq([found.installed, found.active], [false, false], 'failure to ask counts as not installed'); });
}).then(function () {
	// ---- moving keys (with or without Better BibTeX)
	HC.bbt = { installed: false, active: false, version: '' };
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
		eq([r.cancelled, saves.length], [true, 0], 'declined: nothing saved');
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
		eq(scheduled, [[1]], 'auto-exports re-run');
		eq([HC.getKey(m1), HC.getKey(m2), HC.getKey(m4), HC.getKey(m6)], ['a1', 'b1', 'd1', 'f1'], 'getKey finds them');
	});
}).catch(function (e) { errors.push('exception ' + e.message + '\n' + e.stack); }).then(function () {
	print(errors.length ? 'KEYSTORE FAILED\n' + errors.join('\n') : 'keystore OK (Better BibTeX keys in the field, with and without Better BibTeX, formula, detection, move)');
});
