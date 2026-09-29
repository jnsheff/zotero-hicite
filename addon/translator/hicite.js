{
	"translatorID": "f7eba8a4-5b7c-4f49-8a80-c04c0e27c0a8",
	"translatorType": 2,
	"label": "hicite",
	"creator": "hicite Export for Zotero",
	"target": "tex",
	"minVersion": "5.0.0",
	"maxVersion": "",
	"priority": 100,
	"inRepository": false,
	"configOptions": {},
	"displayOptions": {
		"Include publisher": false,
		"Keep updated": false
	},
	"lastUpdated": "2026-09-29 12:00:00"
}

/*
 * Export translator producing reference definitions for the hicite LaTeX
 * package (https://github.com/charlesduan/hicite), e.g.
 *
 *   \defjrnart{smith2020}{
 *     author={Jane {Smith}},
 *     title={An Article},
 *     ...
 *   }
 *
 * Display options: "Include publisher" is handled here. "Keep updated" is
 * handled by the add-on (hicite-export.js), which turns the export into an
 * auto-export job; the translator itself ignores it.
 *
 * Citation keys are read from the item ("Citation Key: ..." line in Extra, as
 * pinned by the add-on or by Better BibTeX). Items without one get a generated
 * key using the same algorithm as the add-on (keep baseKey() in sync with
 * addon/bootstrap.js).
 */

var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
var STOPWORDS = /^(a|an|the|of|on|in|re|and|for|to)$/i;
var SKIP_TYPES = { note: 1, attachment: 1, annotation: 1 };

// ---------------------------------------------------------------- helpers

// First defined, non-empty value among the given field names. Export items can
// carry either base or type-specific names (date vs dateDecided, etc.).
function pick(item) {
	for (var i = 1; i < arguments.length; i++) {
		var v = item[arguments[i]];
		if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
	}
	return '';
}

function slug(s) {
	return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isInstitution(c) {
	return !!(c.name || c.fieldMode === 1 || !c.firstName);
}

function creatorsOf(item, type) {
	return (item.creators || []).filter(function (c) { return c.creatorType === type; });
}

function yearOf(item) {
	var d = pick(item, 'date', 'dateDecided', 'dateEnacted');
	if (!d) return '';
	var p = Zotero.Utilities.strToDate(d);
	return p && p.year ? String(p.year) : '';
}

// Date in hicite's input syntax ("jan 1 2016", "may 2014", "2014", "nd").
function dateOf(item) {
	var d = pick(item, 'date', 'dateDecided', 'dateEnacted');
	if (!d) return 'nd';
	var p = Zotero.Utilities.strToDate(d);
	if (!p || !p.year) return 'nd';
	var out = '';
	if (p.month !== undefined && p.month !== null && p.month >= 0) {
		out = MONTHS[p.month] + ' ';
		if (p.day) out += p.day + ' ';
	}
	return out + p.year;
}

function baseKey(item) {
	var name = '';
	if (item.itemType === 'case') {
		var words = pick(item, 'caseName', 'title').split(/\s+/);
		for (var i = 0; i < words.length && !name; i++) {
			if (!STOPWORDS.test(words[i])) name = words[i];
		}
	}
	else {
		var cs = creatorsOf(item, 'author');
		if (!cs.length && item.creators && item.creators.length) cs = [item.creators[0]];
		if (cs.length) name = cs[0].name || cs[0].lastName || '';
	}
	if (!slug(name) && item.title) {
		var tw = String(item.title).split(/\s+/);
		for (var j = 0; j < tw.length && !slug(name); j++) {
			if (!STOPWORDS.test(tw[j])) name = tw[j];
		}
	}
	var key = slug(name) || 'ref';
	if (!/^[a-z]/.test(key)) key = 'ref' + key; // nicknames must not start like a number
	return key + yearOf(item);
}

function suffix(n) { // 1 -> a, 26 -> z, 27 -> aa
	var s = '';
	while (n > 0) {
		n--;
		s = String.fromCharCode(97 + (n % 26)) + s;
		n = Math.floor(n / 26);
	}
	return s;
}

function pinnedKey(item) {
	if (item.citationKey) return item.citationKey;
	var m = /^\s*Citation Key\s*:\s*(\S+)\s*$/im.exec(item.extra || '');
	return m ? m[1] : '';
}

// Escape plain text for TeX and keep braces balanced (keyval requires it).
function tex(s) {
	s = String(s).replace(/\s+/g, ' ').trim();
	var depth = 0, ok = true;
	for (var i = 0; i < s.length; i++) {
		if (s[i] === '{') depth++;
		else if (s[i] === '}' && --depth < 0) { ok = false; break; }
	}
	if (depth !== 0) ok = false;
	if (!ok) s = s.replace(/[{}]/g, '');
	return s
		.replace(/\\/g, '\\textbackslash{}')
		.replace(/([&%#_$])/g, '\\$1')
		.replace(/~/g, '\\textasciitilde{}')
		.replace(/\^/g, '\\textasciicircum{}');
}

function firstPage(p) {
	if (!p) return '';
	var f = String(p).split(/\s*[-‐-―,]\s*/)[0].trim();
	if (!f) return '';
	return /^\d/.test(f) ? f : '!' + f; // "!" = unformatted page (hicite manual, pages)
}

function edition(item) {
	var m = /\d+/.exec(pick(item, 'edition'));
	return m ? m[0] : '';
}

// ------------------------------------------------------------- emitters

function Def(type, key) {
	this.type = type;
	this.key = key;
	this.lines = [];
}
Def.prototype.raw = function (k, v) {
	if (v !== '' && v !== undefined && v !== null) this.lines.push('    ' + k + '={' + v + '},');
	return this;
};
Def.prototype.set = function (k, v) {
	if (v !== '' && v !== undefined && v !== null) this.raw(k, tex(v));
	return this;
};
Def.prototype.names = function (item, ctype, personal, inst) {
	var self = this;
	creatorsOf(item, ctype).forEach(function (c) {
		if (isInstitution(c)) self.set(inst, c.name || c.lastName);
		else self.raw(personal, tex(c.firstName) + ' {' + tex(c.lastName) + '}');
	});
	return this;
};
Def.prototype.toString = function () {
	return '\\def' + this.type + '{' + this.key + '}{\n' + this.lines.join('\n') + '\n}\n';
};

function emit(item, key) {
	var t = item.itemType;
	var pub = pick(item, 'publisher');
	var d;

	switch (t) {
		case 'journalArticle':
			d = new Def('jrnart', key);
			d.names(item, 'author', 'author', 'instauth')
				.set('title', pick(item, 'title'))
				.set('vol', pick(item, 'volume'))
				.set('rep', pick(item, 'publicationTitle'))
				.set('page', firstPage(pick(item, 'pages')) || 'forthcoming')
				.set('year', yearOf(item) || 'nd');
			return [d];

		case 'book':
			d = new Def('book', key);
			d.names(item, 'author', 'author', 'instauth')
				.names(item, 'editor', 'editor', 'insted')
				.set('title', pick(item, 'title'))
				.set('vol', pick(item, 'volume'))
				.set('edition', edition(item))
				.set('publisher', Zotero.getOption('Include publisher') ? pub : '')
				.set('year', yearOf(item) || 'nd');
			return [d];

		case 'bookSection':
			var container = new Def('book', key + '-book');
			container.names(item, 'bookAuthor', 'author', 'instauth')
				.names(item, 'editor', 'editor', 'insted')
				.set('title', pick(item, 'bookTitle'))
				.set('vol', pick(item, 'volume'))
				.set('edition', edition(item))
				.set('publisher', Zotero.getOption('Include publisher') ? pub : '')
				.set('year', yearOf(item) || 'nd');
			d = new Def('citecontainer', key);
			d.names(item, 'author', 'author', 'instauth')
				.set('name', pick(item, 'title'))
				.set('year', yearOf(item) || 'nd')
				.set('in', key + '-book')
				.set('page', firstPage(pick(item, 'pages')));
			return [container, d];

		case 'magazineArticle':
		case 'newspaperArticle':
			d = new Def('magart', key);
			d.names(item, 'author', 'author', 'instauth')
				.set('title', pick(item, 'title'))
				.set('journal', pick(item, 'publicationTitle'))
				.set('page', firstPage(pick(item, 'pages')))
				.set('date', dateOf(item));
			return [d];

		case 'conferencePaper':
			d = new Def('procart', key);
			d.names(item, 'author', 'author', 'instauth')
				.set('title', pick(item, 'title'))
				.set('rep', pick(item, 'proceedingsTitle', 'publicationTitle'))
				.set('page', firstPage(pick(item, 'pages')))
				.set('year', yearOf(item) || 'nd');
			return [d];

		case 'thesis':
		case 'manuscript':
		case 'letter':
			d = new Def('manuscript', key);
			d.names(item, 'author', 'author', 'instauth')
				.set('title', pick(item, 'title'))
				.set('type', pick(item, 'thesisType', 'manuscriptType', 'letterType') || (t === 'letter' ? 'letter' : ''))
				.set('date', dateOf(item));
			return [d];

		case 'report':
			if (!pick(item, 'reportNumber')) {
				// \defworkingpaper requires a number; unnumbered reports are cited like books
				d = new Def('book', key);
				d.names(item, 'author', 'author', 'instauth')
					.names(item, 'editor', 'editor', 'insted')
					.set('title', pick(item, 'title'))
					.set('publisher', Zotero.getOption('Include publisher') ? pick(item, 'institution', 'publisher') : '')
					.set('year', yearOf(item) || 'nd');
				return [d];
			}
			d = new Def('workingpaper', key);
			d.names(item, 'author', 'author', 'instauth')
				.set('title', pick(item, 'title'))
				.set('type', pick(item, 'reportType'))
				.set('publisher', pick(item, 'institution', 'publisher'))
				.set('number', pick(item, 'reportNumber'))
				.set('year', yearOf(item) || 'nd');
			return [d];

		case 'case':
			d = new Def('case', key);
			d.set('parties', pick(item, 'caseName', 'title'))
				.set('vol', pick(item, 'reporterVolume'))
				.set('rep', pick(item, 'reporter'))
				.set('page', firstPage(pick(item, 'firstPage', 'pages')))
				.set('docket', pick(item, 'docketNumber'))
				.set('court', pick(item, 'court'))
				.set('year', dateOf(item));
			return [d];

		case 'statute':
			var code = pick(item, 'code'), sect = pick(item, 'section');
			if (code && sect) {
				// hicite parses "35 U.S.C. S 101" ("S" stands for the section sign)
				var num = pick(item, 'codeNumber', 'volume');
				return [{ toString: function () {
					return '\\defstatcode{' + key + '}{' + tex((num ? num + ' ' : '') + code + ' S ' + sect) + '}\n';
				} }];
			}
			// fall through to the generic form
		default:
			d = new Def('website', key);
			d.names(item, 'author', 'author', 'instauth')
				.set('title', pick(item, 'title', 'nameOfAct', 'caseName'))
				.set('journal', pick(item, 'websiteTitle', 'publicationTitle', 'blogTitle', 'forumTitle', 'programTitle', 'publisher'))
				.set('date', dateOf(item));
			var url = pick(item, 'url');
			if (url) d.raw('url', url.replace(/%/g, '\\%')); // hicite: escape % only
			return [d];
	}
}

// ----------------------------------------------------------------- driver

function doExport() {
	var items = [];
	var item;
	while ((item = Zotero.nextItem())) {
		if (!SKIP_TYPES[item.itemType]) items.push(item);
	}

	// Pinned keys are authoritative: reserve them first, then disambiguate
	// generated keys around them.
	var used = {};
	var keys = items.map(function (it) {
		var k = pinnedKey(it);
		if (k) used[k] = (used[k] || 0) + 1;
		return k;
	});
	items.forEach(function (it, i) {
		if (keys[i]) return;
		var base = baseKey(it), key = base, n = 0;
		while (used[key]) key = base + suffix(++n);
		used[key] = 1;
		keys[i] = key;
	});

	Zotero.write('% hicite reference definitions exported from Zotero.\n');
	Zotero.write('% Load after \\usepackage{hicite} and before the first citation.\n\n');
	items.forEach(function (it, i) {
		var title = pick(it, 'title', 'caseName', 'nameOfAct').replace(/\s+/g, ' ');
		Zotero.write('% ' + title + '\n');
		emit(it, keys[i]).forEach(function (def) { Zotero.write(def.toString() + '\n'); });
	});
}
