// Checks that the plugin's key generator (addon/hicite-export.js) and the
// translator's (addon/translator/hicite.js) agree on every sample item.
ObjC.import('Foundation');
function read(p) { return ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null)); }
var dir = $.NSFileManager.defaultManager.currentDirectoryPath.js;
var strToDate = function (s) {
	var m = /^(\d{4})/.exec(s); return m ? { year: m[1] } : {};
};
var Zotero = { Utilities: { strToDate: strToDate }, Date: { strToDate: strToDate },
	CreatorTypes: { getPrimaryIDForType: function () { return 1; } } };
var trBody = read(dir + '/addon/translator/hicite.js').replace(/^\s*\{[\s\S]*?\n\}\n/, '');
var trKey = new Function('Zotero', trBody + '; return baseKey;')(Zotero);
var HC = new Function('Zotero', read(dir + '/addon/hicite-export.js') + '; return HiCite;')(Zotero);

var items = JSON.parse(read(dir + '/test/sample-items.json'));
var bad = 0, lines = [];
items.forEach(function (it) {
	var mock = {
		itemType: it.itemType, itemTypeID: 1,
		getField: function (f) { return it[f] || ''; },
		getCreators: function () { return (it.creators || []).map(function (c) {
			return { creatorTypeID: c.creatorType === 'author' ? 1 : 2, lastName: c.name || c.lastName, firstName: c.firstName }; }); }
	};
	var a = trKey(it), b = HC.baseKey(mock);
	if (a !== b) bad++;
	lines.push((a === b ? 'ok   ' : 'DIFF ') + a + (a === b ? '' : ' vs ' + b));
});
lines.join('\n') + '\n' + (bad ? bad + ' MISMATCHES' : 'all keys match');
