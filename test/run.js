// Runs the export translator outside Zotero with a mock sandbox.
// runTranslator(source, items, options, settings): options = display options ("Include
// publisher"), settings = hidden prefs (unprefixed, e.g. {keySource: 'adopt'}).
var MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function mockStrToDate(s) { // enough of Zotero.Utilities.strToDate for the tests
	s = String(s).trim();
	var m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(s), d = {};
	if (m) {
		d.year = m[1];
		if (m[2]) d.month = parseInt(m[2], 10) - 1;
		if (m[3]) d.day = parseInt(m[3], 10);
		return d;
	}
	m = /^([A-Za-z]+)\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})$/.exec(s); // "January 26, 2024", "May 2014"
	if (m) {
		var mi = MONTH_NAMES.map(function (x) { return x.slice(0, 3); }).indexOf(m[1].slice(0, 3).toLowerCase());
		if (mi >= 0) { d.year = m[3]; d.month = mi; if (m[2]) d.day = parseInt(m[2], 10); return d; }
	}
	m = /(\d{4})/.exec(s);
	return m ? { year: m[1] } : {};
}
function runTranslator(source, items, options, settings) {
	var out = '';
	var queue = items.slice();
	var hidden = settings || {};
	var Zotero = {
		nextItem: function () { return queue.shift() || false; },
		write: function (s) { out += s; },
		getOption: function (k) { return (options || {})[k]; },
		getHiddenPref: function (k) { return hidden[k.replace(/^hicite\./, '')]; },
		Utilities: { strToDate: mockStrToDate }
	};
	var body = source.replace(/^\s*\{[\s\S]*?\n\}\n/, '');
	(new Function('Zotero', body + '\ndoExport();'))(Zotero);
	return out;
}
