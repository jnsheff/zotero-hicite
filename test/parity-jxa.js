// Checks that the plugin's key generator (addon/hicite-export.js) and the translator's
// (addon/translator/hicite.js) agree on every sample item, under each key-related setting.
ObjC.import('Foundation');
function read(p) { return ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null)); }
var dir = $.NSFileManager.defaultManager.currentDirectoryPath.js;
var strToDate = function (s) { var m = /(\d{4})/.exec(String(s)); return m ? { year: m[1] } : {}; };
var settings = {};
var Zotero = { Utilities: { strToDate: strToDate }, Date: { strToDate: strToDate },
	getHiddenPref: function (k) { return settings[k.replace(/^hicite\./, '')]; },
	Prefs: { get: function (k) { return settings[k.replace(/^translators\.hicite\./, '')]; } },
	CreatorTypes: { getPrimaryIDForType: function () { return 1; }, getName: function (id) { return ['', 'author', 'editor', 'translator', 'sponsor'][id] || 'contributor'; } } };
var trBody = read(dir + '/addon/translator/hicite.js').replace(/^\s*\{[\s\S]*?\n\}\n/, '');
var trKey = new Function('Zotero', trBody + '; return baseKey;')(Zotero);
var HC = new Function('Zotero', read(dir + '/addon/hicite-export.js') + '; return HiCite;')(Zotero);

var items = JSON.parse(read(dir + '/test/sample-items.json')).concat(JSON.parse(read(dir + '/test/key-items.json')));
var bad = 0, n = 0, lines = [];
items.forEach(function (it) {
	var mock = {
		itemType: it.itemType, itemTypeID: 1,
		getField: function (f) {
			if (f === 'year') { var m = /(\d{4})/.exec(it.date || it.dateDecided || it.dateEnacted || ''); return m ? m[1] : ''; }
			return it[f] || ''; },
		getCreators: function () { return (it.creators || []).map(function (c) {
			var single = !!(c.name || c.fieldMode === 1);
			return { creatorTypeID: { author: 1, editor: 2, translator: 3, sponsor: 4 }[c.creatorType] || 5, lastName: c.name || c.lastName, firstName: single ? '' : (c.firstName || ''), fieldMode: single ? 1 : 0 }; }); }
	};
	var a = trKey(it), b = HC.baseKey(mock); n++;
	if (a !== b) { bad++; lines.push('DIFF translator=' + a + ' plugin=' + b + ' (' + it.itemType + ': ' + (it.title || it.caseName || it.nameOfAct) + ')'); }
});
(bad ? lines.join('\n') + '\n' + bad + ' MISMATCHES' : 'all keys match (' + n + ' comparisons)');
