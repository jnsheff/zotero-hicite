// Exercises the "Keep updated" export hook and job storage with mock Zotero objects.
ObjC.import('Foundation');
function read(p) { return ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null)); }
var dir = $.NSFileManager.defaultManager.currentDirectoryPath.js;
var errors = [], notes = [], prefs = {}, ran = [];
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(msg + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

function ProgressWindow() {}
ProgressWindow.prototype = { changeHeadline: function (h) { this.h = h; }, addDescription: function (d) { notes.push(d); },
	show: function () {}, startCloseTimer: function () {} };
function Export() {}
Export.prototype.translate = function () { this.translated = true; return 'orig'; };

var Zotero = {
	logError: function (e) { errors.push('logError: ' + e.message); },
	Prefs: { get: function (k) { return prefs[k]; }, set: function (k, v) { prefs[k] = v; } },
	ProgressWindow: ProgressWindow,
	Translate: { Export: Export }
};
var PathUtils = { filename: function (p) { return p.split('/').pop(); } };
var HC = new Function('Zotero', 'PathUtils', 'var HiCiteTypes = { load: function () {}, init: function () {}, destroy: function () {} };' + read(dir + '/addon/hicite-export.js') + '; return HiCite;')(Zotero, PathUtils);
HC.enqueue = function (ids) { ran.push(ids); return Promise.resolve(); }; // don't run real exports

function makeTranslation(o) {
	var t = new Export();
	t.translator = [o.translator === undefined ? { translatorID: HC.TRANSLATOR_ID } : o.translator];
	t._displayOptions = o.opts; t._export = o.export; t.location = { path: '/tmp/refs.tex' };
	t.handlers = [];
	t.setHandler = function (type, fn) { this.handlers.push([type, fn]); };
	return t;
}
function finish(t, worked) { t.handlers.forEach(function (h) { if (h[0] === 'done') h[1](t, worked); }); }
function jobs() { return HC.getJobs(); }

HC.patchExport();
var orig = Export.prototype.translate;

// 1. library export with Keep updated + Include publisher
var t = makeTranslation({ opts: { 'Keep updated': true, 'Include publisher': true }, export: { type: 'library', id: 1 } });
eq(t.translate(), 'orig', 'original translate still runs'); eq(t.translated, true, 'original called');
eq(jobs().length, 0, 'no job before export finishes');
finish(t, false); eq(jobs().length, 0, 'no job when export fails');
finish(t, true);
eq(jobs().length, 1, 'job after success');
eq([jobs()[0].libraryID, jobs()[0].collectionKey, jobs()[0].path, jobs()[0].includePublisher], [1, null, '/tmp/refs.tex', true], 'library job');
eq(ran.length, 1, 'job run once immediately');

// 2. collection export, string translator id, replaces the job for the same scope
t = makeTranslation({ translator: HC.TRANSLATOR_ID, opts: { 'Keep updated': true },
	export: { type: 'collection', collection: { libraryID: 1, key: 'ABCD1234' } } });
t.translate(); finish(t, true);
eq(jobs().length, 2, 'collection job added');
t = makeTranslation({ opts: { 'Keep updated': true }, export: { type: 'collection', collection: { libraryID: 1, key: 'ABCD1234' } } });
t.translate(); finish(t, true);
eq(jobs().length, 2, 'same scope replaced, not duplicated');

// 3. not requested / other translator / items / no-op cases
[makeTranslation({ opts: { 'Keep updated': false }, export: { type: 'library', id: 2 } }),
 makeTranslation({ translator: { translatorID: 'other' }, opts: { 'Keep updated': true }, export: { type: 'library', id: 3 } })
].forEach(function (x) { x.translate(); finish(x, true); });
eq(jobs().length, 2, 'unchecked / other translator ignored');
t = makeTranslation({ opts: { 'Keep updated': true }, export: { type: 'items', items: [] } });
t.translate(); finish(t, true);
eq(jobs().length, 2, 'selected-items export creates no job'); eq(notes.length, 1, 'user told why');

// 4. destroy restores the original and stops hooking
HC.destroy();
eq(Export.prototype.translate, orig, 'destroy restores translate');

errors.length ? 'FAIL\n' + errors.join('\n') : 'hook OK';
