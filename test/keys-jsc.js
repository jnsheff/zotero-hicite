// Key selection: translator (export side) and plugin (pin side).
// Run with JavaScriptCore's shell from the project root (see Makefile); it drains
// promise callbacks, which osascript/JXA does not.
var dir = '.';
var errors = [];
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(msg + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

// ---- translator side
eval(read(dir + '/test/run.js'));
var out = runTranslator(read(dir + '/addon/translator/hicite.js'), JSON.parse(read(dir + '/test/sample-items.json')), {}, { keySource: 'adopt' });
var keys = {}; out.replace(/\\def(\w+)\{([^}]*)\}/g, function (m, t, k) { keys[k] = t; });
function has(k, t, msg) { eq(keys[k], t, msg); }
has('unitedstates', 'case', 'case with unusable native key "2012" gets a first-party key');
eq('2012' in keys, false, 'unusable key "2012" not exported');
has('tiveNativeKey2015', 'book', 'usable native key used');
has('dupkey', 'book', 'first duplicate pinned key kept'); has('dupkeya', 'book', 'second duplicate disambiguated');
has('xtra2018', 'book', 'unusable Extra key "2018" replaced by generated key');

// ---- plugin side (pin)
var saved = 0, saveOpts = [];
var prefs = {};
var Zotero = { Prefs: { get: function (k) { return prefs[k]; } }, logError: function (e) { errors.push('logError: ' + e.message); },
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
var single = function (n) { return { creatorTypeID: 1, lastName: n, firstName: '', fieldMode: 1 }; };
var cases = [
	['case, no Short Title -> first party (no year)', mockItem('case', alvarez), {}, 'unitedstates'],
	['case with a Short Title -> the Short Title', mockItem('case', { caseName: 'Metro-Goldwyn-Mayer Studios Inc. v. Grokster, Ltd.', shortTitle: 'Grokster', dateDecided: '2005' }), {}, 'grokster'],
	['first party loses "Inc.", "LLC" ...', mockItem('case', { caseName: 'Cox Communications, Inc. v. Sony Music Entertainment', dateDecided: '2026' }), {}, 'coxcommunications'],
	['"v" without a period splits too', mockItem('case', { caseName: 'Garcia v Character Technologies Inc.', dateDecided: '2025' }), {}, 'garcia'],
	['no "v": the whole name (In re ...)', mockItem('case', { caseName: 'In re Smith', dateDecided: '2013-05-01' }), {}, 'inresmith'],
	['case keys "nameyear" -> first word + year', mockItem('case', alvarez), {}, 'united2012', { caseKeys: 'nameyear' }],
	['single-field person -> family name + year', mockItem('webpage', { title: 'X', date: '2024' }, [single('Thomas Haigh')]), {}, 'haigh2024'],
	['single-field institution -> whole name + year', mockItem('webpage', { title: 'X', date: '2025' }, [single('Anthropic PBC')]), {}, 'anthropicpbc2025'],
	['person with particle', mockItem('journalArticle', { title: 'X', date: '2014' }, [single('Bart van Merrienboer')]), {}, 'vanmerrienboer2014'],
	['two-field creator -> last name + year', mockItem('book', { title: 'X', date: '1979' }, [{ creatorTypeID: 1, lastName: 'Chomsky', firstName: 'Noam', fieldMode: 0 }]), {}, 'chomsky1979'],
	['own (default): the native key is ignored', mockItem('webpage', { title: 'X', date: '2024', citationKey: 'thomashaigh2024' }, [single('Thomas Haigh')]), {}, 'haigh2024'],
	['adopt: usable native key adopted', mockItem('book', { title: 'X', date: '2015', citationKey: 'tiveNativeKey2015' }), {}, 'tiveNativeKey2015', { keySource: 'adopt' }],
	['adopt: unusable native key ("2012") -> generated', mockItem('case', alvarez), {}, 'unitedstates', { keySource: 'adopt' }],
	['usable Extra key kept', mockItem('book', { title: 'X', date: '2015', extra: 'Citation Key: mine1', citationKey: 'other' }), {}, 'mine1'],
	['unusable Extra key replaced', mockItem('case', Object.assign({ extra: 'Citation Key: 2012' }, alvarez)), {}, 'unitedstates'],
	['force regenerates over a usable key', mockItem('case', Object.assign({ extra: 'Citation Key: old' }, alvarez)), { force: true }, 'unitedstates'],
	['force ignores the native key even when adopting', mockItem('book', { title: 'X', date: '2015', citationKey: 'natv2015' }, [{ creatorTypeID: 1, lastName: 'Smith', firstName: 'Ann', fieldMode: 0 }]), { force: true }, 'smith2015', { keySource: 'adopt' }],
];
var results = [];
cases.reduce(function (chain, c) {
	return chain.then(function () {
		prefs = {}; Object.keys(c[4] || {}).forEach(function (k) { prefs['translators.hicite.' + k] = c[4][k]; });
		return HC.pin(c[1], c[2]).then(function (k) { results.push([c[0], k, c[3], c[1]._f.extra || '']); });
	});
}, Promise.resolve()).then(function () {
	eq(results.length, cases.length, 'all pins completed');
	eq(saveOpts.length > 0 && saveOpts.every(function (o) { return o.skipNotifier === true && o.skipDateModifiedUpdate === true; }), true,
		'pinning saves without notifying other add-ons (Better BibTeX would regenerate keys) and keeps Date Modified');
	results.forEach(function (r) {
		eq(r[1], r[2], r[0]);
		// exactly one key line in Extra, and it is the expected key
		var lines = r[3].split('\n').filter(function (l) { return /^Citation Key:/.test(l); });
		eq(lines, ['Citation Key: ' + r[2]], r[0] + ' (Extra line)');
	});
	print(errors.length ? 'FAIL\n' + errors.join('\n') : 'keys OK (' + cases.length + ' pin cases: cases, people, key source)');
});
