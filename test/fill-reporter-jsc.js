// Tests tools/fill-reporter-from-jurism.js: the Extra parser, then the whole script
// against a mock Zotero (dry-run, backup guard, group/read-only scope, apply, revert).
var src = read('tools/fill-reporter-from-jurism.js');
var errors = [];
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(m + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
function has(s, sub, m) { if (String(s).indexOf(sub) < 0) errors.push(m + ': missing ' + JSON.stringify(sub) + ' in\n' + s); }

// ---- parser
var P = new Function('HICITE_TEST', 'return (async () => {' + src + '})()')(true);
P.then(function (fns) {
	var pj = fns.parseJurism, rf = fns.reporterFor;
	eq(pj('mlzsync1:0103{"extrafields":{"reporter":"U.S."}}\nCitation Key: united').data.extrafields.reporter, 'U.S.', 'block followed by another Extra line');
	eq(pj('note\nmlzsync1:0103{"a":"}{ \\" }","extrafields":{"reporter":"F.3d"}}').data.extrafields.reporter, 'F.3d', 'braces and escaped quotes inside strings');
	eq(pj('Citation Key: x').error, 'no-block', 'no block');
	eq(pj('mlzsync1:0103{"a":').error, 'unterminated', 'unterminated');
	eq(pj('mlzsync1:0103{"a":nope}').error, 'bad-json', 'bad json');
	eq(rf('F.3d', 'mlzsync1:0103{"extrafields":{"reporter":"U.S."}}'), { skip: 'already has a reporter' }, 'existing reporter wins');
	eq(rf('  ', 'mlzsync1:0103{"extrafields":{"reporter":" U.S. "}}'), { reporter: 'U.S.' }, 'blank reporter filled, trimmed');
	eq(rf('', 'mlzsync1:0103{"extrafields":{"jurisdiction":"x"}}'), { skip: 'Juris-M block has no reporter' }, 'block without reporter');
	return runFlow();
}).catch(function (e) { errors.push('exception: ' + e.message + '\n' + e.stack); }).then(function () {
	print(errors.length ? 'FAIL\n' + errors.join('\n') : 'fill-reporter OK (parser, dry-run, guards, scope, apply, revert)');
});

// ---- full flow
function runFlow() {
	var fs = {}, saves = [];
	function mkItem(lib, key, name, reporter, extra) {
		var f = { caseName: name, reporter: reporter || '', extra: extra || '' };
		return { libraryID: lib, key: key, _f: f,
			getField: function (n) { return f[n] || ''; }, setField: function (n, v) { f[n] = v; },
			save: function (o) { saves.push([key, o && o.skipDateModifiedUpdate]); return Promise.resolve(); } };
	}
	var blk = function (r) { return 'mlzsync1:0103{"extrafields":{"reporter":"' + r + '"}}\nCitation Key: k'; };
	var all = [
		mkItem(1, 'P1', 'Personal A', '', blk('F.3d')),
		mkItem(1, 'P2', 'Personal B', '', blk('U.S.')),
		mkItem(1, 'P3', 'Personal has one', 'F.2d', blk('U.S.')),
		mkItem(1, 'P4', 'Personal no block', '', 'just a note'),
		mkItem(1, 'P5', 'Personal broken', '', 'mlzsync1:0103{"x":'),
		mkItem(1, 'P6', 'Personal block no reporter', '', 'mlzsync1:0103{"extrafields":{"court":"x"}}'),
		mkItem(2, 'G1', 'Group A', '', blk('F.Supp.')),
		mkItem(3, 'R1', 'Read-only group', '', blk('U.S.'))
	];
	var libs = [{ libraryID: 1, libraryType: 'user', editable: true, name: 'My Library' },
		{ libraryID: 2, libraryType: 'group', editable: true, name: 'Shared Group' },
		{ libraryID: 3, libraryType: 'group', editable: false, name: 'Read-only Group' }];
	var Zotero = {
		DataDirectory: { dir: '/zdata' },
		Libraries: { getAll: function () { return libs; } },
		Search: function () { var self = this; this.addCondition = function () {}; this.search = function () {
			return Promise.resolve(all.filter(function (i) { return i.libraryID === self.libraryID; }).map(function (i) { return i.key; })); }; },
		Items: { getAsync: function (keys) { return Promise.resolve(all.filter(function (i) { return keys.indexOf(i.key) >= 0; })); },
			getByLibraryAndKeyAsync: function (l, k) { return Promise.resolve(all.filter(function (i) { return i.libraryID === l && i.key === k; })[0] || null); } },
		DB: { executeTransaction: function (fn) { return fn(); } },
		File: { putContentsAsync: function (p, s) { fs[p] = s; return Promise.resolve(); },
			getContentsAsync: function (p) { return Promise.resolve(fs[p]); } }
	};
	var IOUtils = { getChildren: function () { return Promise.resolve(Object.keys(fs)); },
		move: function (a, b) { fs[b] = fs[a]; delete fs[a]; return Promise.resolve(); } };
	var PathUtils = { join: function () { return Array.prototype.join.call(arguments, '/'); }, filename: function (p) { return p.split('/').pop(); } };
	var clock = 0;
	function run(overrides) {
		var stamp = 'new Date(Date.UTC(2026, 8, 29, 12, 0, ' + (++clock) + ')).toISOString()'; // distinct, ordered log names
		var s = src.split('new Date().toISOString()').join(stamp);
		Object.keys(overrides).forEach(function (k) { s = s.replace(new RegExp('const ' + k + ' = [^;]*;'), 'const ' + k + ' = ' + overrides[k] + ';'); });
		return new Function('Zotero', 'IOUtils', 'PathUtils', 'return (async () => {' + s + '})()')(Zotero, IOUtils, PathUtils);
	}
	var rep = function (k) { return all.filter(function (i) { return i.key === k; })[0]._f.reporter; };

	return run({}).then(function (out) {                                   // dry run
		has(out, 'Would fill Reporter on 2 cases', 'dry-run counts personal fills only');
		has(out, '1  Shared Group', 'group items reported as skipped'); has(out, 'DRY RUN: nothing was changed', 'dry-run says so');
		has(out, '1  skipped: read-only library', 'read-only library skipped');
		has(out, '1  already has a reporter', 'existing reporter left'); has(out, '1  no Juris-M block', 'no-block counted');
		has(out, 'unreadable Juris-M block (unterminated)', 'broken block counted'); has(out, 'has no reporter', 'block without reporter counted');
		eq([rep('P1'), rep('P2'), rep('G1')], ['', '', ''], 'dry run changed nothing'); eq(saves.length, 0, 'dry run saved nothing');
		return run({ MODE: "'apply'" });
	}).then(function (out) {                                               // guard
		has(out, 'Refusing to apply', 'apply refused without backup flag'); eq(saves.length, 0, 'guard saved nothing'); eq(Object.keys(fs).length, 0, 'guard wrote no log');
		return run({ MODE: "'apply'", I_HAVE_A_BACKUP: 'true' });
	}).then(function (out) {                                               // apply, personal only
		has(out, 'APPLIED: 2 items changed', 'apply reports count');
		eq([rep('P1'), rep('P2'), rep('P3'), rep('G1'), rep('R1')], ['F.3d', 'U.S.', 'F.2d', '', ''], 'only personal empty-reporter cases filled');
		eq(saves.map(function (s) { return s[1]; }), [true, true], 'Date Modified not bumped');
		var logs = Object.keys(fs); eq(logs.length, 1, 'one log written'); eq(JSON.parse(fs[logs[0]]).changes.length, 2, 'log lists the changes');
		return run({ MODE: "'apply'", I_HAVE_A_BACKUP: 'true', INCLUDE_GROUPS: 'true' });
	}).then(function (out) {                                               // groups opt-in
		eq(rep('G1'), 'F.Supp.', 'group filled when INCLUDE_GROUPS'); eq(rep('R1'), '', 'read-only group never edited');
		all.filter(function (i) { return i.key === 'P2'; })[0]._f.reporter = 'CHANGED'; // user edits one after the fact
		return run({ MODE: "'revert'" });
	}).then(function (out) {                                               // revert #1 undoes the latest apply (groups)
		has(out, 'Reverted 1 items', 'first revert undoes only the latest apply');
		eq([rep('P1'), rep('P2'), rep('G1')], ['F.3d', 'CHANGED', ''], 'group fill undone, personal untouched');
		return run({ MODE: "'revert'" });
	}).then(function (out) {                                               // revert #2 steps back to the first apply
		has(out, 'Reverted 1 items', 'second revert undoes the earlier apply');
		has(out, '1 left alone because their Reporter changed', 'item edited since is left alone');
		eq([rep('P1'), rep('P2'), rep('P3')], ['', 'CHANGED', 'F.2d'], 'only untouched values cleared; pre-existing reporter kept');
		return run({ MODE: "'revert'" });
	}).then(function (out) {
		has(out, 'No log file', 'nothing left to revert');
	});
}
