// Runs the real HiCite.runJob()/enqueue() against in-memory mocks of Zotero,
// including a translator registry that throws until init() completes.
var dir = '.';
var errors = [], files = {}, notices = [], exportsRun = 0, savedItems = 0, initCalls = 0;
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(msg + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

var translatorsReady = false;
function mockItem(id, fields, creators) {
	var f = JSON.parse(JSON.stringify(fields));
	return { id: id, libraryID: 1, key: 'K' + id, itemType: 'book', itemTypeID: 1, isFeedItem: false,
		isRegularItem: function () { return true; },
		getField: function (n) { if (n === 'year') { var m = /(\d{4})/.exec(f.date || ''); return m ? m[1] : ''; } return f[n] || ''; },
		setField: function (n, v) { f[n] = v; }, getCreators: function () { return creators || []; },
		saveTx: function () { savedItems++; return Promise.resolve(); } };
}
var items = { 1: mockItem(1, { title: 'One', date: '2001' }, [{ creatorTypeID: 1, lastName: 'Alpha' }]),
              2: mockItem(2, { title: 'Two', date: '2002', extra: 'Citation Key: beta2002' }, [{ creatorTypeID: 1, lastName: 'Beta' }]) };
var collectionExists = true, scopeIDs = [1, 2], prefs = {};

function Export() { this.handlers = {}; }
Export.prototype = {
	setItems: function (i) { this.items = i; }, setTranslator: function (t) { this.t = t; }, setDisplayOptions: function (o) { this.o = o; },
	setLocation: function (l) { this.loc = l; }, setHandler: function (n, fn) { this.handlers[n] = fn; },
	translate: function () {
		var self = this; exportsRun++;
		return Promise.resolve().then(function () {
			files[self.loc.path] = self.items.map(function (i) { return '\\defbook{' + i.getField('extra').replace('Citation Key: ', '') + '}'; }).join('\n') + '\n';
			self.handlers.done(self, true);
		});
	}
};
var Zotero = {
	logError: function (e) { errors.push('logError: ' + e.message); },
	Prefs: { get: function (k) { return prefs[k]; }, set: function (k, v) { prefs[k] = v; } },
	ProgressWindow: function () { this.changeHeadline = function () {}; this.addDescription = function (d) { notices.push(d); }; this.show = function () {}; this.startCloseTimer = function () {}; },
	Search: function () { this.addCondition = function () {}; this.search = function () { return Promise.resolve(scopeIDs.slice()); }; },
	Items: { getAsync: function (ids) { return Promise.resolve(ids.map(function (i) { return items[i]; }).filter(Boolean)); } },
	Collections: { getByLibraryAndKey: function () { return collectionExists ? {} : false; } },
	CreatorTypes: { getPrimaryIDForType: function () { return 1; } },
	Translators: {
		init: function () { initCalls++; return new Promise(function (r) { setTimeout ? setTimeout(function () { translatorsReady = true; r(); }, 0) : (translatorsReady = true, r()); }); },
		get: function (id) { if (!translatorsReady) throw new Error('Translators not yet loaded'); return { translatorID: id }; }
	},
	Translate: { Export: Export },
	File: { pathToFile: function (p) { return { path: p }; } },
	getTempDirectory: function () { return { path: '/tmp' }; }
};
var PathUtils = { join: function () { return Array.prototype.join.call(arguments, '/'); }, filename: function (p) { return p.split('/').pop(); } };
var IOUtils = {
	readUTF8: function (p) { return p in files ? Promise.resolve(files[p]) : Promise.reject(new Error('NotFound')); },
	writeUTF8: function (p, s) { files[p] = s; IOUtils.writes.push(p); return Promise.resolve(); },
	remove: function (p) { delete files[p]; return Promise.resolve(); }, writes: []
};
if (typeof setTimeout === 'undefined') this.setTimeout = function (fn) { fn(); };
var HC = new Function('Zotero', 'PathUtils', 'IOUtils', read(dir + '/addon/hicite-export.js') + '; return HiCite;')(Zotero, PathUtils, IOUtils);

var job = { id: 'j1', libraryID: 1, collectionKey: null, path: '/out/refs.tex', includePublisher: false };
prefs[HC.PREF] = JSON.stringify([job]);

HC.enqueue(['j1']).then(function () {
	eq(initCalls >= 1, true, 'Translators.init() awaited before get()');
	eq(exportsRun, 1, 'exported once');
	eq(Object.keys(files).indexOf('/tmp/hicite-j1.tex'), -1, 'temp file removed');
	eq(files['/out/refs.tex'], '\\defbook{alpha2001}\n\\defbook{beta2002}\n', 'target written with pinned keys (item 1 pinned first)');
	eq(savedItems, 1, 'only the unpinned item was saved');
	eq(notices, [], 'no error notices');
	// second run, nothing changed: no rewrite
	IOUtils.writes = [];
	return HC.enqueue(['j1']);
}).then(function () {
	eq(IOUtils.writes, [], 'unchanged content is not rewritten');
	// collection deleted: job dropped, nothing exported
	collectionExists = false;
	prefs[HC.PREF] = JSON.stringify([Object.assign({}, job, { id: 'j2', collectionKey: 'GONE' })]);
	var before = exportsRun;
	return HC.enqueue(['j2']).then(function () {
		eq(exportsRun, before, 'deleted collection is not exported');
		eq(JSON.parse(prefs[HC.PREF]), [], 'job for deleted collection removed');
	});
}).then(function () {
	// a failing job reports an error but does not stop the queue
	collectionExists = true; scopeIDs = [1, 2];
	prefs[HC.PREF] = JSON.stringify([Object.assign({}, job, { id: 'bad' }), Object.assign({}, job, { id: 'good', path: '/out/good.tex' })]);
	delete files['/out/refs.tex']; // so the 'bad' job actually attempts a write
	var oldWrite = IOUtils.writeUTF8;
	IOUtils.writeUTF8 = function (p, s) { if (p === '/out/refs.tex') return Promise.reject(new Error('disk full')); return oldWrite(p, s); };
	errors_before = errors.length;
	return HC.enqueue(['bad', 'good']).then(function () {
		eq(!!files['/out/good.tex'], true, 'later job still runs after an earlier failure');
		eq(notices.length, 1, 'failure reported to the user');
		// logError is expected for the injected failure; drop it
		errors.splice(errors_before, errors.length - errors_before, ...errors.slice(errors_before).filter(function (e) { return e.indexOf('disk full') < 0; }));
	});
}).then(function () {
	print(errors.length ? 'FAIL\n' + errors.join('\n') : 'runjob OK (startup ordering, write-if-changed, deleted collection, failure isolation)');
}).catch(function (e) { print('FAIL\nexception: ' + e.message + '\n' + (e.stack || '')); });
var errors_before = 0;
