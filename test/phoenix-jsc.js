// citation-phoenix support. (1) The add-on finds citation-phoenix and tells the translator through the hidden pref.
// (2) The translator uses Juris-M data only when told to, and exports exactly as before when not. (3) Its court tables
// agree with tools/fill-reporter-from-jurism.js. (4) That tool refuses to run beside citation-phoenix.
load('test/run.js');
var errors = [];
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(m + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
function has(s, sub, m) { if (String(s).indexOf(sub) < 0) errors.push(m + ': missing ' + JSON.stringify(sub) + ' in\n' + s); }
function hasNot(s, sub, m) { if (String(s).indexOf(sub) >= 0) errors.push(m + ': unexpected ' + JSON.stringify(sub)); }
var src = read('addon/translator/hicite.js'), items = JSON.parse(read('test/sample-phoenix-items.json')), plain = JSON.parse(read('test/sample-items.json'));
function run(settings, subset) { return runTranslator(src, subset || items, {}, settings || {}); }
function entry(out, key) { var m = new RegExp('(?:% hicite:[^\\n]*\\n)?\\\\def[a-z]+\\{' + key + '\\}\\{[\\s\\S]*?\\n(?:\\}\\n|(?=\\n))').exec(out); return m ? m[0] : ''; }
var on = run({ phoenix: 'on' }), off = run({ phoenix: 'off' }), dflt = run({});

// ---- (2) the translator
eq(dflt, off, 'no setting at all behaves as "off"');
eq(run({ phoenix: 'on' }, plain), run({ phoenix: 'off' }, plain), 'items without Juris-M data export identically in both modes');
// courts
has(entry(on, 'abercrombie'), 'court={2d Cir.}', 'on: court.appeals + us:c2 -> 2d Cir.'); has(entry(off, 'abercrombie'), 'court={court.appeals}', 'off: the Court field is passed through as before');
hasNot(entry(on, 'boomer'), 'court=', "on: NY's highest court is omitted when N.Y.2d identifies it"); has(entry(on, 'boomer'), 'rep={N.Y.2d}', 'on: reporter kept');
has(entry(on, 'lane'), 'court={S.D.N.Y.}', 'on: district.court + us:c2:ny.sd -> S.D.N.Y.');
hasNot(entry(on, 'sony'), 'court=', 'on: supreme.court is omitted when the reporter is U.S.'); has(entry(on, 'sony'), 'rep={U.S.}', 'on: reporter taken from the Juris-M block when the field is empty');
hasNot(entry(off, 'sony'), 'rep=', 'off: the Juris-M block is ignored'); has(entry(off, 'sony'), 'court={supreme.court}', 'off: raw court');
hasNot(entry(on, 'loreal'), 'court=', 'on: an untranslatable court ID is left out'); has(on, '% hicite: court ecj~chamber.1 [eu.int:cjeu] not translated', 'on: and noted in the file');
has(entry(off, 'loreal'), 'court={ecj\\textasciitilde{}chamber.1}', 'off: raw court, as before (TeX-escaped)');
has(entry(on, 'arnstein'), 'court={2d Cir.}', 'on: a typed court is left alone'); has(entry(off, 'arnstein'), 'court={2d Cir.}', 'off: same');
// regulations
has(entry(on, 'tmrules'), '\\defregcode{tmrules}{37 C.F.R. S 2.1}', 'on: a bare regulation section is the one-line regcode'); has(entry(off, 'tmrules'), '\\defstatcode{tmrules}{37 C.F.R. S 2.1}', 'off: statcode as before');
e = entry(on, 'tmaregs'); has(e, '\\defregcode{tmaregs}', 'on: a named regulation is a keyword-form regcode'); has(e, 'rep={C.F.R.}', 'regcode keeps the code'); has(entry(off, 'tmaregs'), '\\defstatcode{tmaregs}', 'off: statcode');
has(entry(on, 'tmafedreg'), '\\defgovdoc{tmafedreg}', 'on: a Federal Register regulation stays a govdoc'); eq(entry(on, 'tmafedreg'), entry(off, 'tmafedreg'), 'and is identical in both modes');
// treaties
var e = entry(on, 'nice'); has(e, '\\deftreaty{nice}', 'on: a phoenix treaty is a hicite treaty'); has(e, 'rep={WIPO Doc}', 'treaty reporter from the block'); has(e, 'year={sep 28 1979}', 'treaty date = signing date'); has(e, 'name={Nice Agreement', 'treaty name');
has(entry(off, 'nice'), '\\defwebsite{nice}', 'off: a Document is a web page, as before');
eq(entry(on, 'somereport'), entry(off, 'somereport'), 'an ordinary Document is untouched');

// ---- (1) detection and the pref the translator reads
function mkZotero(prefs, sets) {
	return { debug: function () {}, logError: function (e) { errors.push('logError: ' + e.message); },
		Prefs: { get: function (k) { return prefs[k]; }, set: function (k, v) { prefs[k] = v; sets.push([k, v]); } } };
}
function mkAM(state, listeners) {
	return { getAddonByID: function (id) { if (state.throws) return Promise.reject(new Error('boom')); return Promise.resolve(id === 'citation-phoenix@michaelrisch.com' ? state.addon || null : null); },
		addAddonListener: function (l) { listeners.push(l); }, removeAddonListener: function (l) { listeners.splice(listeners.indexOf(l), 1); } };
}
function mkHC(prefs, sets, state, listeners) {
	var HC = new Function('Zotero', read('addon/hicite-export.js') + '; return HiCite;')(mkZotero(prefs, sets));
	HC.AddonManager = mkAM(state, listeners);
	return HC;
}
var prefs = {}, sets = [], state = {}, listeners = [], HC = mkHC(prefs, sets, state, listeners), tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

HC.refreshPhoenix().then(function (mode) {
	eq([mode, HC.phoenix.installed, prefs['translators.hicite.phoenix']], ['off', false, 'off'], 'not installed: off');
	state.addon = { isActive: true, version: '0.8.4' }; sets.length = 0; prefs['translators.hicite.phoenix'] = undefined;
	return HC.refreshPhoenix();
}).then(function (mode) {
	eq([mode, HC.phoenix, prefs['translators.hicite.phoenix']], ['on', { installed: true, active: true, version: '0.8.4' }, 'on'], 'installed and enabled: on');
	sets.length = 0; return HC.refreshPhoenix();
}).then(function () {
	eq(sets, [], 'the pref is only written when it changes (a write re-runs the auto-exports)');
	state.addon = { isActive: false, version: '0.8.4' }; return HC.refreshPhoenix();
}).then(function (mode) {
	eq([mode, HC.phoenix.installed, HC.phoenix.active], ['off', true, false], 'installed but disabled: off');
	prefs['translators.hicite.phoenixMode'] = 'on'; return HC.refreshPhoenix();
}).then(function (mode) {
	eq(mode, 'on', 'setting "Always" forces it on even when disabled');
	state.addon = { isActive: true, version: '0.8.4' }; prefs['translators.hicite.phoenixMode'] = 'off'; return HC.refreshPhoenix();
}).then(function (mode) {
	eq(mode, 'off', 'setting "Never" forces it off even when enabled');
	prefs['translators.hicite.phoenixMode'] = 'auto'; state.throws = true; return HC.refreshPhoenix();
}).then(function (mode) {
	eq([mode, HC.phoenix.installed], ['off', false], 'if the add-on manager cannot be asked, behave as without it');
	state.throws = false; state.addon = { isActive: false, version: '0.8.4' }; return HC.refreshPhoenix();
}).then(function () {
	// follows the add-on being enabled and disabled while Zotero runs
	HC.watchPhoenix(); eq(listeners.length, 1, 'one add-on listener'); HC.watchPhoenix(); eq(listeners.length, 1, 'registered once');
	state.addon = { isActive: true, version: '0.8.4' }; listeners[0].onEnabled({ id: 'citation-phoenix@michaelrisch.com' });
	return tick().then(tick);
}).then(function () {
	eq(prefs['translators.hicite.phoenix'], 'on', 'enabling citation-phoenix switches the mode on');
	state.addon = { isActive: false, version: '0.8.4' }; listeners[0].onDisabled({ id: 'some-other-addon@example.com' });
	return tick().then(tick);
}).then(function () {
	eq(prefs['translators.hicite.phoenix'], 'on', "another add-on's events are ignored");
	listeners[0].onDisabled({ id: 'citation-phoenix@michaelrisch.com' }); return tick().then(tick);
}).then(function () {
	eq(prefs['translators.hicite.phoenix'], 'off', 'disabling it switches the mode off');
	state.addon = null; listeners[0].onUninstalled({ id: 'citation-phoenix@michaelrisch.com' }); return tick().then(tick);
}).then(function () {
	eq([HC.phoenix.installed, prefs['translators.hicite.phoenix']], [false, 'off'], 'uninstalling it: off');
	HC.destroy(); eq(listeners.length, 0, 'destroy removes the listener');
	// defaults of the two new settings agree everywhere
	['phoenixMode', 'phoenix'].forEach(function (k) {
		var v = HC.SETTINGS[k];
		if (read('addon/prefs.js').indexOf('translators.hicite.' + k + '", "' + v + '")') < 0) errors.push('prefs.js default differs for ' + k);
		if (read('addon/translator/hicite.js').indexOf('"hicite.' + k + '": "' + v + '"') < 0) errors.push('translator header default differs for ' + k);
	});
	return null;
}).then(function () {
	// ---- (3) parity with the migration tool
	var body = src.replace(/^\s*\{[\s\S]*?\n\}\n/, '');
	var T = new Function('Zotero', body + '\nreturn { courtFromId: courtFromId, finalCourt: finalCourt, parseJurism: parseJurism, jurisdictionKey: jurisdictionKey, COURT_ID: COURT_ID };')({ getHiddenPref: function () {}, Utilities: {} });
	return new Function('HICITE_TEST', 'return (async () => {' + read('tools/fill-reporter-from-jurism.js') + '})()')(true).then(function (F) {
		var ids = ['court.appeals', 'district.court', 'supreme.court', 'court.appeals.federal.circuit', 'court.customs.patent.appeals', 'ecj~chamber.1', 'unknown.court'];
		var keys = ['us', 'us:c0', 'us:c', 'us:c1', 'us:c2', 'us:c9', 'us:c11', 'us:c12', 'us:ny', 'us:md', 'us:tx', 'us:ca', 'us:c2:ny.sd', 'us:c9:ca.nd', 'us:c3:pa.ed', 'us:c0:dc.d', 'us:c4:nc.md', 'us:nj', 'eu.int:cjeu', ''];
		var n = 0, reporters = ['', 'U.S.', 'S. Ct.', 'F.2d', 'N.Y.2d', 'Cal. 3d', 'Mass.', 'CCPA'];
		ids.forEach(function (id) { keys.forEach(function (k) {
			var a = T.courtFromId(id, k), b = F.courtFromId(id, k); n++;
			eq(a, b, 'courtFromId parity ' + id + ' ' + k);
			if (!a.unresolved) reporters.forEach(function (r) { eq(T.finalCourt(a, r), F.finalCourt(b, r), 'finalCourt parity ' + id + ' ' + k + ' ' + r); });
		}); });
		['011us:c2:ny.sdUnited States|US|Second Circuit|S.D. New York', '005us:c2United States', 'us', '', 'weird value'].forEach(function (j) { eq(T.jurisdictionKey(j), F.jurisdictionKey(j), 'jurisdictionKey parity ' + j); });
		['mlzsync1:0103{"a":"}{ \\" }","extrafields":{"reporter":"F.3d"}}', 'mlzsync1:{"extrafields":{"x":1}}tail text\nCitation Key: k', 'nothing', 'mlzsync1:0103{"a":'].forEach(function (x) {
			var a = T.parseJurism(x), b = F.parseJurism(x); eq(a, b.data || null, 'parseJurism parity ' + x);
		});
		eq(['court.appeals', 'ecj~chamber.1', 'supreme.court'].every(function (x) { return T.COURT_ID.test(x); }), true, 'Juris-M IDs match COURT_ID');
		eq(['2d Cir.', 'Cal.', 'S.D.N.Y.', 'Fed. Cir.', 'N.D. Cal.', 'tex', ''].some(function (x) { return T.COURT_ID.test(x); }), false, 'typed courts never match COURT_ID');
		return n;
	});
}).then(function (n) {
	// ---- (4) the migration tool refuses to run beside citation-phoenix
	var tool = read('tools/fill-reporter-from-jurism.js');
	function runTool(active, allow) {
		var CU = { importESModule: function () { return { AddonManager: { getAddonByID: function () { return Promise.resolve({ isActive: active }); } } }; } };
		var s = allow ? tool.replace('const ALLOW_WITH_PHOENIX = false;', 'const ALLOW_WITH_PHOENIX = true;') : tool;
		return new Function('ChromeUtils', 'Zotero', 'return (async () => {' + s + '})()')(CU, undefined).catch(function (e) { return 'ran past the guard: ' + e.message; });
	}
	return runTool(true, false).then(function (out) {
		has(out, 'STOPPED, nothing was changed', 'enabled citation-phoenix stops the tool');
		return runTool(false, false);
	}).then(function (out) {
		hasNot(out, 'STOPPED', 'a disabled citation-phoenix does not stop it');
		return runTool(true, true);
	}).then(function (out) { hasNot(out, 'STOPPED', 'ALLOW_WITH_PHOENIX lets it run'); });
}).catch(function (e) { errors.push('exception ' + e.message + '\n' + e.stack); }).then(function () {
	print(errors.length ? 'FAIL\n' + errors.join('\n') : 'phoenix OK (detection, pref sync, translator on/off, court-table parity, tool guard)');
});
