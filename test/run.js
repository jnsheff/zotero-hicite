// Runs the export translator outside Zotero with a mock sandbox.
// Usage: osascript -l JavaScript test/run.js   (or any JS engine: see bottom)
function runTranslator(source, items, options) {
	var out = '';
	var queue = items.slice();
	var Zotero = {
		nextItem: function () { return queue.shift() || false; },
		write: function (s) { out += s; },
		getOption: function (k) { return options[k]; },
		Utilities: { strToDate: function (s) {
			var m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(s);
			if (!m) return {};
			var d = { year: m[1] };
			if (m[2]) d.month = parseInt(m[2], 10) - 1;
			if (m[3]) d.day = parseInt(m[3], 10);
			return d;
		} }
	};
	var body = source.replace(/^\s*\{[\s\S]*?\n\}\n/, '');
	(new Function('Zotero', body + '\ndoExport();'))(Zotero);
	return out;
}
