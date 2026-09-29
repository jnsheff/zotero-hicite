// The Settings pane script against a minimal fake DOM: job rows, the per-job "Include publisher"
// checkbox, Stop, and that changes reach the add-on (the TOUCH pref, which it observes).
var errors = [], prefs = {};
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(m + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
function El(tag) {
	var self = this; this.tag = tag; this.attrs = {}; this.children = []; this.listeners = {}; this.style = {}; this.checked = false;
	this.setAttribute = function (k, v) { self.attrs[k] = v; };
	this.append = function () { for (var i = 0; i < arguments.length; i++) { arguments[i].parent = self; self.children.push(arguments[i]); } };
	this.addEventListener = function (t, fn) { self.listeners[t] = fn; };
	this.remove = function () { if (self.parent) self.parent.children.splice(self.parent.children.indexOf(self), 1); };
	Object.defineProperty(this, 'firstChild', { get: function () { return self.children[0] || null; } });
}
function all(el, pred, out) { out = out || []; if (pred(el)) out.push(el); el.children.forEach(function (c) { all(c, pred, out); }); return out; }
var box = new El('vbox');
var document = { createXULElement: function (t) { return new El(t); }, getElementById: function (id) { return id === 'hicite-jobs' ? box : null; } };
var Zotero = { Prefs: { get: function (k) { return prefs[k]; }, set: function (k, v) { prefs[k] = v; } },
	Libraries: { getName: function (id) { return { 1: 'My Library', 7: 'GenAI Research' }[id]; } },
	Collections: { getByLibraryAndKey: function (l, k) { return k === 'GONE' ? null : { name: 'Cases' }; } } };
new Function('Zotero', 'document', read('addon/preferences.js'))(Zotero, document);
var P = Zotero.HiCitePrefs, JOBS = P.JOBS;

// no jobs
P.init(); eq(all(box, function (e) { return e.tag === 'label'; }).map(function (e) { return e.attrs.value; }), ['No auto-exports yet.'], 'empty state');

// two jobs
prefs[JOBS] = JSON.stringify([{ id: 'a', libraryID: 7, collectionKey: null, path: '/d/GenAI Research.tex', includePublisher: true },
	{ id: 'b', libraryID: 1, collectionKey: 'C1', path: '/d/cases.tex', includePublisher: false }]);
P.render();
var rows = box.children; eq(rows.length, 2, 'one row per job');
var labels = all(box, function (e) { return e.tag === 'label'; }).map(function (e) { return e.attrs.value; });
eq(labels, ['/d/GenAI Research.tex', 'Library "GenAI Research"', '/d/cases.tex', 'Collection "Cases" in My Library'], 'paths and scopes shown');
var boxes = all(box, function (e) { return e.tag === 'checkbox'; }); eq(boxes.map(function (b) { return b.checked; }), [true, false], 'checkbox reflects includePublisher');

// toggling "Include publisher" saves the job and pokes the add-on
boxes[0].checked = false; boxes[0].listeners.command();
eq(JSON.parse(prefs[JOBS]).map(function (j) { return [j.id, j.includePublisher]; }), [['a', false], ['b', false]], 'includePublisher saved');
eq(!!prefs[P.TOUCH], true, 'add-on is told (TOUCH pref changed) so it re-runs the job');
var t1 = prefs[P.TOUCH]; boxes[0].listeners.command(); eq(prefs[P.TOUCH], t1, 'no change, no re-run');

// Stop removes the job and re-renders
all(box, function (e) { return e.tag === 'button'; })[0].listeners.command();
eq(JSON.parse(prefs[JOBS]).map(function (j) { return j.id; }), ['b'], 'Stop removes that job only'); eq(box.children.length, 1, 'row removed');

// robustness: a deleted collection, junk in the pref
prefs[JOBS] = JSON.stringify([{ id: 'c', libraryID: 1, collectionKey: 'GONE', path: '/d/x.tex' }]); P.render();
eq(all(box, function (e) { return e.tag === 'label'; })[1].attrs.value, 'Collection "(deleted)" in My Library', 'deleted collection');
prefs[JOBS] = 'not json'; P.render(); eq(box.children.length, 1, 'corrupt pref renders the empty state');
print(errors.length ? 'FAIL\n' + errors.join('\n') : 'pane OK (job rows, include-publisher toggle, stop, re-run signal)');
