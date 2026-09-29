// Tests tools/fill-reporter-from-jurism.js: the pure translation functions, then the
// whole script against a mock Zotero (dry-run, guards, scope, apply, stepwise revert).
var src = read('tools/fill-reporter-from-jurism.js');
var errors = [];
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(m + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
function has(s, sub, m) { if (String(s).indexOf(sub) < 0) errors.push(m + ': missing ' + JSON.stringify(sub) + ' in\n' + s); }
function hasNot(s, sub, m) { if (String(s).indexOf(sub) >= 0) errors.push(m + ': unexpected ' + JSON.stringify(sub)); }
var blk = function (r, jur) { return 'mlzsync1:0103{"extrafields":{' + (r ? '"reporter":"' + r + '",' : '') + '"jurisdiction":"' + (jur || '002usUnited States|US') + '"}}\nCitation Key: k'; };

new Function('HICITE_TEST', 'return (async () => {' + src + '})()')(true).then(function (F) {
	// ---- parsing
	eq(F.parseJurism('mlzsync1:0103{"a":"}{ \\" }","extrafields":{"reporter":"F.3d"}}').data.extrafields.reporter, 'F.3d', 'braces/escapes inside strings');
	eq(F.parseJurism('Citation Key: x').error, 'no-block', 'no block'); eq(F.parseJurism('mlzsync1:0103{"a":').error, 'unterminated', 'unterminated');
	eq(F.parseJurism('mlzsync1:0103{"a":nope}').error, 'bad-json', 'bad json');
	eq([F.jurisdictionKey('011us:c2:ny.sdUnited States|US|Second Circuit|S.D. New York'), F.jurisdictionKey('005us:c2United States|US|Second Circuit'),
		F.jurisdictionKey('us'), F.jurisdictionKey(''), F.jurisdictionKey(undefined)], ['us:c2:ny.sd', 'us:c2', 'us', '', ''], 'jurisdictionKey');

	// ---- ID translation
	var id = function (c, k) { var r = F.courtFromId(c, k); return r.unresolved ? 'UNRESOLVED' : r.court; };
	eq([id('court.appeals', 'us:c1'), id('court.appeals', 'us:c2'), id('court.appeals', 'us:c3'), id('court.appeals', 'us:c9'), id('court.appeals', 'us:c11')],
		['1st Cir.', '2d Cir.', '3d Cir.', '9th Cir.', '11th Cir.'], 'circuits (1st, 2d, 3d, nth)');
	eq([id('court.appeals', 'us:c0'), id('court.appeals', 'us:c'), id('district.court', 'us:c0:dc.d')], ['D.C. Cir.', 'Fed. Cir.', 'D.D.C.'], "Juris-M's c0 = D.C. Circuit, c = Federal Circuit");
	eq([id('court.appeals', 'us:tx'), id('court.appeals', ''), id('court.appeals', 'us:c12'), id('court.appeals', 'us')], ['UNRESOLVED', 'UNRESOLVED', 'UNRESOLVED', 'UNRESOLVED'], 'unusable circuits stay unresolved');
	eq([id('district.court', 'us:c2:ny.sd'), id('district.court', 'us:c2:ny.ed'), id('district.court', 'us:c9:ca.cd'), id('district.court', 'us:c9:ca.nd'),
		id('district.court', 'us:c3:pa.ed'), id('district.court', 'us:c3:nj.d'), id('district.court', 'us:c4:md.d'), id('district.court', 'us:c4:nc.md'),
		id('district.court', 'us:c7:il.nd'), id('district.court', 'us:c8:mn.d'), id('district.court', 'us:c10:co.d'), id('district.court', 'us:c4:va.ed'), id('district.court', 'us:c2:vt.d')],
		['S.D.N.Y.', 'E.D.N.Y.', 'C.D. Cal.', 'N.D. Cal.', 'E.D. Pa.', 'D.N.J.', 'D. Md.', 'M.D.N.C.', 'N.D. Ill.', 'D. Minn.', 'D. Colo.', 'E.D. Va.', 'D. Vt.'], 'district abbreviations (spacing rule)');
	eq([id('district.court', 'us:nj'), id('district.court', 'us:c2:zz.sd'), id('appellate.court', 'us:il'), id('ecj~chamber.1', 'eu.int:cjeu'), id('supreme.court', 'us:tx')],
		['UNRESOLVED', 'UNRESOLVED', 'UNRESOLVED', 'UNRESOLVED', 'UNRESOLVED'], 'state courts / foreign courts not guessed');
	eq([id('court.appeals.federal.circuit', 'us:c'), id('court.customs.patent.appeals', 'us:c'), id('supreme.court', 'us')], ['Fed. Cir.', 'C.C.P.A.', 'U.S.'], 'fixed-court IDs');
	eq([F.finalCourt({ court: 'U.S.', kind: 'supreme' }, 'U.S.'), F.finalCourt({ court: 'U.S.', kind: 'supreme' }, 'S. Ct.'), F.finalCourt({ court: 'U.S.', kind: 'supreme' }, ''),
		F.finalCourt({ court: 'C.C.P.A.', kind: 'ccpa' }, 'C.C.P.A.'), F.finalCourt({ court: 'C.C.P.A.', kind: 'ccpa' }, 'F.2d')],
		['', '', 'U.S.', '', 'C.C.P.A.'], 'court omitted when the reporter identifies it');
	eq(['US', 'U.S.', 'u.s.', 'S.Ct.', 'S. Ct.', 'L. Ed. 2d', 'LEd2d'].map(function (r) { return F.finalCourt({ court: 'U.S.', kind: 'supreme' }, r); }),
		['', '', '', '', '', '', ''], 'Supreme Court reporter recognized however it is spelled ("US" in real libraries)');
	eq(['F.3d', 'S.W.3d', 'N.E.3d', ''].map(function (r) { return F.finalCourt({ court: 'U.S.', kind: 'supreme' }, r); }),
		['U.S.', 'U.S.', 'U.S.', 'U.S.'], 'other reporters keep the court');
	eq(F.finalCourt({ court: 'C.C.P.A.', kind: 'ccpa' }, 'CCPA'), '', 'CCPA reporter spelled without dots');

	// ---- typed-out courts (values seen in real libraries, typos included)
	var tx = function (t) { var r = F.normalizeCourtText(t); return r ? r.court : null; };
	eq([tx('United States Court of Appeals, Federal Circuit'), tx('Court of Appeals, Federal Circuit'), tx('United Staes Court of Customs and Patent Appeals'),
		tx('United States Court of Appeals, District of Columbia Circuit'), tx('United State Court of Appeals, Third Circuit'), tx('Court of Appeals, 8th Circuit'),
		tx('Court of Appeals, 2nd Circuit'), tx('9th Circuit'), tx('Trademark Trial and Appeal Board'), tx('United States Court of Claims'), tx('U.S. Supreme Court')],
		['Fed. Cir.', 'Fed. Cir.', 'C.C.P.A.', 'D.C. Cir.', '3d Cir.', '8th Cir.', '2d Cir.', '9th Cir.', 'T.T.A.B.', 'Ct. Cl.', 'U.S.'], 'long-form courts');
	eq([tx('United States District Court, E.D.N.Y.'), tx('United States District Court, W.D. New York.'), tx('United States District Court, W.D. Wisconsin'),
		tx('Southern District of New York'), tx('N. D. Cal.'), tx('N.D. Cal.'), tx('M.D. Fla.')],
		['E.D.N.Y.', 'W.D.N.Y.', 'W.D. Wis.', 'S.D.N.Y.', 'N.D. Cal.', 'N.D. Cal.', 'M.D. Fla.'], 'district names');
	eq([tx('Cook Cty. Cir. Ct. Ill.'), tx('Cir. Ct. 10th Cir., Fla.'), tx('Court of Appeals'), tx('D.C. Cir.'), tx('2d Cir.'), tx('T.T.A.B.'), tx('')],
		[null, null, null, null, null, null, null], 'not rewritten: state courts, ambiguous, already abbreviated');

	// ---- per-case plans
	var plan = function (o, opts) { return F.planCase(Object.assign({ reporter: '', court: '', volume: '', page: '', extra: '' }, o), opts); };
	var ch = function (r) { var o = {}; Object.keys(r.changes).forEach(function (k) { o[k] = r.changes[k].new; }); return o; };
	eq(ch(plan({ court: 'supreme.court', extra: blk('U.S.', '002usUnited States|US') })), { reporter: 'U.S.', court: '' }, 'Alvarez: reporter from block, court omitted');
	eq(ch(plan({ court: 'court.appeals', extra: blk('F.3d', '005us:c2United States|US|Second Circuit') })), { reporter: 'F.3d', court: '2d Cir.' }, 'circuit case');
	eq(ch(plan({ court: 'district.court', extra: blk('F. Supp. 2d', '011us:c2:ny.sdUnited States|US|Second Circuit|S.D. New York') })), { reporter: 'F. Supp. 2d', court: 'S.D.N.Y.' }, 'district case');
	eq(ch(plan({ reporter: 'F.2d', court: 'court.customs.patent.appeals', extra: blk('C.C.P.A.', '004us:cUnited States|US|Federal Circuit') })), { court: 'C.C.P.A.' }, 'existing reporter F.2d kept; CCPA court stays');
	eq(ch(plan({ reporter: 'C.C.P.A.', court: 'court.customs.patent.appeals', extra: blk('', '004us:c') })), { court: '' }, 'CCPA reporter identifies the court');
	eq(ch(plan({ reporter: 'F.3d', court: 'court.appeals', extra: blk('U.S.', '005us:c9') })), { court: '9th Cir.' }, 'never overwrites an existing reporter');
	eq(ch(plan({ court: 'supreme.court', volume: '567', page: '709', extra: blk('', '002us') })), { reporter: 'U.S.', court: '' }, 'reporter inferred from Supreme Court + volume + page');
	eq(plan({ court: 'supreme.court', volume: '567', page: '709', extra: blk('', '002us') }).changes.reporter.how, 'inferred from the Supreme Court', 'inference is labelled');
	eq(ch(plan({ court: 'supreme.court', volume: '567', extra: blk('', '002us') })), { court: 'U.S.' }, 'no page -> no inference; court kept as U.S.');
	eq(ch(plan({ court: 'supreme.court', volume: '567', page: '709', extra: blk('', '002us') }, { inferReporter: false })), { court: 'U.S.' }, 'inference can be turned off');
	eq(ch(plan({ court: 'court.appeals', volume: '1', page: '2', extra: blk('', '005us:c2') })), { court: '2d Cir.' }, 'no inference for circuits (reporter ambiguous)');
	eq(plan({ court: 'ecj', extra: blk('', 'eu.int:cjeu') }).notes[0].unresolved.indexOf('ecj') === 0, true, 'unresolved court reported, not changed');
	eq(ch(plan({ reporter: 'US', court: 'Supreme Court', volume: '347', page: '483' }, { normalizeText: true })), { court: '' }, 'typed "Supreme Court" + reporter "US": court omitted, reporter left as typed');
	var amb = plan({ reporter: 'S.W.3d', court: 'Supreme Court', volume: '1', page: '2' }, { normalizeText: true });
	eq(ch(amb), {}, 'typed "Supreme Court" with a state reporter is NOT rewritten to U.S.');
	eq(/ambiguous/.test(amb.notes[0].textCourtUnrecognized), true, 'ambiguous "Supreme Court" is reported');
	eq(ch(plan({ court: 'Supreme Court', extra: blk('', '002us') }, { normalizeText: true })), { court: 'U.S.' }, 'typed "Supreme Court" confirmed by a us jurisdiction with no reporter');
	eq(ch(plan({ court: 'Supreme Court' }, { normalizeText: true })), {}, 'typed "Supreme Court" with nothing to confirm it is left alone');
	eq(ch(plan({ court: 'United States Court of Appeals, Federal Circuit' })), {}, 'typed-out court untouched by default');
	eq(plan({ court: 'United States Court of Appeals, Federal Circuit' }).notes[0].suggested, 'Fed. Cir.', 'suggestion reported');
	eq(ch(plan({ court: 'United States Court of Appeals, Federal Circuit' }, { normalizeText: true })), { court: 'Fed. Cir.' }, 'typed-out court rewritten when enabled');
	eq(ch(plan({ court: '9th Cir.' }, { normalizeText: true })), {}, 'already-abbreviated court left alone');
	eq(ch(plan({ court: 'court.appeals', extra: blk('F.3d', '005us:c2') }, { translateIds: false, fillReporter: false })), {}, 'switches turn each part off');
	eq(ch(plan({})), {}, 'empty case: nothing to do');
	return runFlow();
}).catch(function (e) { errors.push('exception: ' + e.message + '\n' + e.stack); }).then(function () {
	print(errors.length ? 'FAIL\n' + errors.join('\n') : 'fill-reporter OK (translation tables, plans, dry-run, guards, scope, apply, revert)');
});

// ---- full flow against a mock Zotero
function runFlow() {
	var fs = {};
	function mkItem(lib, key, name, f) {
		var fields = Object.assign({ caseName: name, reporter: '', court: '', reporterVolume: '', firstPage: '', extra: '' }, f);
		return { libraryID: lib, key: key, _f: fields, saves: 0,
			getField: function (n) { return fields[n] || ''; }, setField: function (n, v) { fields[n] = v; },
			save: function (o) { this.saves++; this.lastOpts = o; return Promise.resolve(); } };
	}
	var all = [
		mkItem(1, 'P1', 'Circuit', { court: 'court.appeals', extra: blk('F.3d', '005us:c2') }),
		mkItem(1, 'P2', 'Supreme', { court: 'supreme.court', extra: blk('U.S.', '002us') }),
		mkItem(1, 'P3', 'Already done', { reporter: 'F.2d', court: '9th Cir.', extra: blk('U.S.', '005us:c9') }),
		mkItem(1, 'P4', 'Nothing', {}),
		mkItem(1, 'P5', 'Unresolvable', { court: 'ecj', extra: blk('', 'eu.int:cjeu') }),
		mkItem(2, 'G1', 'Group', { court: 'district.court', extra: blk('F. Supp.', '011us:c2:ny.sd') }),
		mkItem(3, 'R1', 'Read-only group', { court: 'court.appeals', extra: blk('F.3d', '005us:c2') })
	];
	var libs = [{ libraryID: 1, libraryType: 'user', editable: true, name: 'My Library' },
		{ libraryID: 2, libraryType: 'group', editable: true, name: 'Shared Group' },
		{ libraryID: 3, libraryType: 'group', editable: false, name: 'Read-only Group' }];
	var Zotero = {
		DataDirectory: { dir: '/zdata' }, Libraries: { getAll: function () { return libs; } },
		Search: function () { var self = this; this.addCondition = function () {}; this.search = function () {
			return Promise.resolve(all.filter(function (i) { return i.libraryID === self.libraryID; }).map(function (i) { return i.key; })); }; },
		Items: { getAsync: function (keys) { return Promise.resolve(all.filter(function (i) { return keys.indexOf(i.key) >= 0; })); },
			getByLibraryAndKeyAsync: function (l, k) { return Promise.resolve(all.filter(function (i) { return i.libraryID === l && i.key === k; })[0] || null); } },
		DB: { executeTransaction: function (fn) { return fn(); } },
		File: { putContentsAsync: function (p, s) { fs[p] = s; return Promise.resolve(); }, getContentsAsync: function (p) { return Promise.resolve(fs[p]); } }
	};
	var IOUtils = { getChildren: function () { return Promise.resolve(Object.keys(fs)); }, move: function (a, b) { fs[b] = fs[a]; delete fs[a]; return Promise.resolve(); } };
	var PathUtils = { join: function () { return Array.prototype.join.call(arguments, '/'); }, filename: function (p) { return p.split('/').pop(); } };
	var clock = 0;
	function run(overrides) {
		var stamp = 'new Date(Date.UTC(2026, 8, 29, 12, 0, ' + (++clock) + ')).toISOString()'; // distinct, ordered log names
		var s = src.split('new Date().toISOString()').join(stamp);
		Object.keys(overrides).forEach(function (k) { s = s.replace(new RegExp('const ' + k + ' = [^;]*;'), 'const ' + k + ' = ' + overrides[k] + ';'); });
		return new Function('Zotero', 'IOUtils', 'PathUtils', 'return (async () => {' + s + '})()')(Zotero, IOUtils, PathUtils);
	}
	var f = function (k) { return all.filter(function (i) { return i.key === k; })[0]._f; };
	var snap = function () { return all.map(function (i) { return JSON.stringify(i._f); }).join('|'); };
	var before = snap();

	return run({}).then(function (out) {                                   // dry run
		has(out, 'Would change 2 cases', 'dry-run: only the personal cases that need changes');
		has(out, 'court.appeals [us:c2]  ->  2d Cir.', 'translation table shown'); has(out, 'supreme.court [us]  ->  (omitted: the reporter identifies the court)', 'omission shown');
		has(out, 'ecj [eu.int:cjeu]: unknown court ID', 'unresolved court listed'); has(out, '1  Shared Group', 'group skipped and reported');
		has(out, 'DRY RUN: nothing was changed', 'dry-run says so'); eq(snap(), before, 'dry run changed nothing');
		eq(all.reduce(function (n, i) { return n + i.saves; }, 0), 0, 'dry run saved nothing');
		return run({ MODE: "'apply'" });
	}).then(function (out) {
		has(out, 'Refusing to apply', 'apply refused without the backup flag'); eq(snap(), before, 'guard changed nothing'); eq(Object.keys(fs).length, 0, 'guard wrote no log');
		return run({ MODE: "'apply'", I_HAVE_A_BACKUP: 'true' });
	}).then(function (out) {                                               // apply: personal library only
		has(out, 'APPLIED: 2 items changed', 'apply count');
		eq([f('P1').reporter, f('P1').court, f('P2').reporter, f('P2').court], ['F.3d', '2d Cir.', 'U.S.', ''], 'reporter and court set');
		eq([f('P3').reporter, f('P3').court, f('P4').court, f('P5').court], ['F.2d', '9th Cir.', '', 'ecj'], 'existing / unresolved / empty left alone');
		eq([f('G1').court, f('R1').court], ['district.court', 'court.appeals'], 'group + read-only untouched');
		eq(all.filter(function (i) { return i.lastOpts; }).every(function (i) { return i.lastOpts.skipDateModifiedUpdate === true; }), true, 'Date Modified not bumped');
		eq(f('P1').extra.indexOf('mlzsync1') === 0, true, 'Extra left as is');
		var logs = Object.keys(fs); eq(logs.length, 1, 'one log'); eq(JSON.parse(fs[logs[0]]).changes.length, 2, 'log lists both items');
		eq(JSON.parse(fs[logs[0]]).changes[0].fields.court, { old: 'court.appeals', new: '2d Cir.' }, 'log records old and new values');
		return run({ MODE: "'apply'", I_HAVE_A_BACKUP: 'true', INCLUDE_GROUPS: 'true' });
	}).then(function () {                                                  // groups are opt-in
		eq([f('G1').reporter, f('G1').court, f('R1').court], ['F. Supp.', 'S.D.N.Y.', 'court.appeals'], 'group filled only with INCLUDE_GROUPS; read-only never');
		f('P1').court = '3d Cir.'; // the user edits one field after the first apply
		return run({ MODE: "'revert'" });
	}).then(function (out) {                                               // revert 1 = the group apply
		has(out, 'Reverted 1 items', 'first revert undoes only the latest apply');
		eq([f('G1').reporter, f('G1').court], ['', 'district.court'], 'group values restored');
		return run({ MODE: "'revert'" });
	}).then(function (out) {                                               // revert 2 = first apply
		has(out, 'Reverted 2 items', 'second revert undoes the earlier apply');
		has(out, '1 left at least one field alone because it changed since', 'edited field is left alone');
		eq([f('P1').court, f('P1').reporter], ['3d Cir.', ''], 'user-edited court kept; untouched reporter restored');
		eq([f('P2').reporter, f('P2').court], ['', 'supreme.court'], 'other item fully restored');
		return run({ MODE: "'revert'" });
	}).then(function (out) { has(out, 'No log file', 'nothing left to revert'); });
}
