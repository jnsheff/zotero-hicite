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
	CreatorTypes: { getPrimaryIDForType: function () { return 1; } } };
var trBody = read(dir + '/addon/translator/hicite.js').replace(/^\s*\{[\s\S]*?\n\}\n/, '');
var trKey = new Function('Zotero', trBody + '; return baseKey;')(Zotero);
var HC = new Function('Zotero', read(dir + '/addon/hicite-export.js') + '; return HiCite;')(Zotero);

var items = JSON.parse(read(dir + '/test/sample-items.json'));
var bad = 0, n = 0, lines = [];
[{}, { caseKeys: 'nameyear' }, { caseKeys: 'shorttitle' }].forEach(function (cfg) {
	settings = cfg;
	items.forEach(function (it) {
		var mock = {
			itemType: it.itemType, itemTypeID: 1,
			getField: function (f) {
				if (f === 'year') { var m = /(\d{4})/.exec(it.date || it.dateDecided || it.dateEnacted || ''); return m ? m[1] : ''; }
				return it[f] || ''; },
			getCreators: function () { return (it.creators || []).map(function (c) {
				var single = !!(c.name || c.fieldMode === 1);
				return { creatorTypeID: c.creatorType === 'author' ? 1 : 2, lastName: c.name || c.lastName, firstName: single ? '' : (c.firstName || ''), fieldMode: single ? 1 : 0 }; }); }
		};
		var a = trKey(it), b = HC.baseKey(mock); n++;
		if (a !== b) { bad++; lines.push('DIFF ' + JSON.stringify(cfg) + ' translator=' + a + ' plugin=' + b + ' (' + it.itemType + ')'); }
	});
});
var names = ['Thomas Haigh', 'Patrick R Goold', 'OpenAI', 'Anthropic PBC', 'Stanford HAI', 'The White House', 'Center for AI Safety', 'European Commission', 'NVIDIA', 'Karen Sparck Jones',
	'Bart van Merrienboer', 'Dean Edmonds Jr.', 'A. Feder Cooper', 'Copyright Division, Agency for Cultural Affairs, Japan', 'ashwinbalaji699', 'Uniform Law Commission', 'Mark A. Lemley', 'Multi State',
	'Dzieza, Josh', 'Thomas E. Hill, Jr.', 'Ruairi Robinson [@RuairiRobinson]', 'Rose, Meredith Filak;', 'University of California, San Diego',
	'Library of Congress, Copyright Office', 'Congress of the United States, Office of Technology Assessment', 'Jeremy', 'Aristotle', 'Van Der Berg, Hans'];
names.forEach(function (nm) {
	var a = new Function('Zotero', trBody + '; return [looksLikePerson(arguments[1]), looksLikePerson(arguments[1]) ? splitPerson(arguments[1]) : null];')(Zotero, nm);
	var p = [HC.looksLikePerson(nm), HC.looksLikePerson(nm) ? HC.splitPerson(nm) : null]; n++;
	if (JSON.stringify(a) !== JSON.stringify(p)) { bad++; lines.push('DIFF person parsing of ' + nm + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(p)); }
});
(bad ? lines.join('\n') + '\n' + bad + ' MISMATCHES' : 'all keys match (' + n + ' comparisons)');
