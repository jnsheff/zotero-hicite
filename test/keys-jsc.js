// Key selection: translator (export side) and plugin (pin side).
// Run with JavaScriptCore's shell from the project root (see Makefile); it drains
// promise callbacks, which osascript/JXA does not.
var dir = '.';
var errors = [];
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(msg + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

// ---- translator side
eval(read(dir + '/test/run.js'));
var out = runTranslator(read(dir + '/addon/translator/hicite.js'), JSON.parse(read(dir + '/test/sample-items.json')), {});
var keys = {}; out.replace(/\\def(\w+)\{([^}]*)\}/g, function (m, t, k) { keys[k] = t; });
function has(k, t, msg) { eq(keys[k], t, msg); }
has('united2012', 'case', 'case with unusable native key "2012" gets first-party key');
eq('2012' in keys, false, 'unusable key "2012" not exported');
has('tiveNativeKey2015', 'book', 'usable native key used');
has('dupkey', 'book', 'first duplicate pinned key kept'); has('dupkeya', 'book', 'second duplicate disambiguated');
has('xtra2018', 'book', 'unusable Extra key "2018" replaced by generated key');

// ---- plugin side (pin)
var saved = 0, saveOpts = [];
var Zotero = { logError: function (e) { errors.push('logError: ' + e.message); },
	Search: function () { this.addCondition = function () {}; this.search = function () { return Promise.resolve([]); }; },
	Items: { getAsync: function () { return Promise.resolve([]); } },
	CreatorTypes: { getPrimaryIDForType: function () { return 1; } } };
var HC = new Function('Zotero', read(dir + '/addon/hicite-export.js') + '; return HiCite;')(Zotero);
function mockItem(type, fields, creators) {
	var f = JSON.parse(JSON.stringify(fields));
	return { id: 1, libraryID: 1, key: 'ABCD', itemType: type, itemTypeID: 1, isFeedItem: false,
		isRegularItem: function () { return true; }, _f: f,
		getField: function (n) {
			if (n === 'year') { var m = /(\d{4})/.exec(f.date || f.dateDecided || ''); return m ? m[1] : ''; }
			if (n === 'date' && type === 'case') return ''; // like Zotero: base field unmapped without includeBaseMapped
			return f[n] || ''; },
		setField: function (n, v) { f[n] = v; },
		getCreators: function () { return creators || []; },
		saveTx: function (o) { saved++; saveOpts.push(o); return Promise.resolve(); } };
}
var alvarez = { caseName: 'United States v. Alvarez', dateDecided: '2012-06-28 June 28, 2012', citationKey: '2012' };
var cases = [
	['case with unusable native key -> generated from first party + year', mockItem('case', alvarez), {}, 'united2012'],
	['usable native key adopted', mockItem('book', { title: 'X', date: '2015', citationKey: 'tiveNativeKey2015' }), {}, 'tiveNativeKey2015'],
	['usable Extra key kept', mockItem('book', { title: 'X', date: '2015', extra: 'Citation Key: mine1', citationKey: 'other' }), {}, 'mine1'],
	['unusable Extra key replaced', mockItem('case', Object.assign({ extra: 'Citation Key: 2012' }, alvarez)), {}, 'united2012'],
	['force regenerates over a usable key', mockItem('case', Object.assign({ extra: 'Citation Key: old' }, alvarez)), { force: true }, 'united2012'],
	['stopword-led case name skipped ("In re")', mockItem('case', { caseName: 'In re Smith', dateDecided: '2013-05-01 May 1, 2013' }), {}, 'smith2013'],
];
var results = [];
Promise.all(cases.map(function (c) {
	return HC.pin(c[1], c[2]).then(function (k) { results.push([c[0], k, c[3], c[1]._f.extra || '']); });
})).then(function () {
	eq(results.length, cases.length, 'all pins completed');
	eq(saveOpts.length > 0 && saveOpts.every(function (o) { return o.skipNotifier === true && o.skipDateModifiedUpdate === true; }), true,
		'pinning saves without notifying other add-ons (Better BibTeX would regenerate keys) and keeps Date Modified');
	results.forEach(function (r) {
		eq(r[1], r[2], r[0]);
		// exactly one key line in Extra, and it is the expected key
		var lines = r[3].split('\n').filter(function (l) { return /^Citation Key:/.test(l); });
		eq(lines, ['Citation Key: ' + r[2]], r[0] + ' (Extra line)');
	});
	print(errors.length ? 'FAIL\n' + errors.join('\n') : 'keys OK (' + cases.length + ' pin cases, translator selection)');
});
