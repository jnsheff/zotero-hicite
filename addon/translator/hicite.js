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
	"hiddenPrefs": {
		"hicite.keySource": "own",
		"hicite.caseKeys": "shorttitle",
		"hicite.shortTitleInline": true,
		"hicite.omitRedundantSite": true,
		"hicite.includeUrls": true,
		"hicite.maxAuthors": "0"
	},
	"lastUpdated": "2026-09-29 18:00:00"
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
 * Settings (Zotero Settings > hicite) are read with Zotero.getHiddenPref; the
 * defaults above apply when nothing has been set. Display options: "Include
 * publisher" is handled here; "Keep updated" is handled by the add-on
 * (hicite-export.js), which turns the export into an auto-export job.
 *
 * Citation keys are read from the item ("Citation Key: ..." line in Extra, as
 * pinned by the add-on). Items without one get a generated key using the same
 * algorithm as the add-on (keep baseKey(), looksLikePerson() and splitPerson()
 * in sync with addon/hicite-export.js; test/parity-jxa.js checks it).
 */

var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
var STOPWORDS = /^(a|an|the|of|on|in|re|and|for|to)$/i;
var SKIP_TYPES = { note: 1, attachment: 1, annotation: 1 };

// ---------------------------------------------------------------- settings

var DEFAULTS = {
	keySource: 'own', caseKeys: 'shorttitle', shortTitleInline: true, omitRedundantSite: true, includeUrls: true, maxAuthors: '0'
};

function setting(name) {
	try {
		var v = Zotero.getHiddenPref('hicite.' + name);
		if (v !== undefined && v !== null) return v;
	}
	catch (e) { /* fall through to the default */ }
	return DEFAULTS[name];
}

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

function creatorsOf(item, type) {
	return (item.creators || []).filter(function (c) { return c.creatorType === type; });
}

// Words that mark an institution rather than a person.
var ORG_WORDS = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|company|co|foundation|institute|university|college|commission|committee|council|office|department|dept|agency|center|centre|association|society|group|labs?|team|board|bureau|government|congress|senate|administration|organization|organisation|conference|legislatures?|initiative|project|network|press|news|review|journal|policy|division|ministry|union|alliance|consortium|forum|trust|fund|bank|pbc|ai|hai|gov|technologies|systems|research|library|museum|school|service|services|international|global)\b/i;
var PARTICLES = /^(van|von|de|der|den|di|da|del|della|la|le|du|bin|ibn|al|el|ter|ten)$/i;

// Bring the single-field forms people are typed in to "First Last [Suffix]": drop a "[@handle]",
// trailing ";", read "Hill, Jr." as a suffix and "Last, First" as inverted.
function tidyName(name) {
	name = String(name || '').replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/[;\s]+$/, '').trim();
	var m = /^(.+?),\s*(jr\.?|sr\.?|ii|iii|iv)$/i.exec(name);
	if (m) return m[1] + ' ' + m[2];
	m = /^([^,;]+),\s*([^,;]+)$/.exec(name);
	if (m && !ORG_WORDS.test(name) && /^[A-Z\u00C0-\u00DD]/.test(m[1]) && /^[A-Z\u00C0-\u00DD]/.test(m[2])) return m[2] + ' ' + m[1];
	return name;
}

// Zotero stores many people as a single "name" field (fieldMode 1), which hicite must not
// treat as an institution. A single-field name is a person if it is 2-5 capitalized words
// with no institution words, digits, commas or all-caps tokens.
function looksLikePerson(name) {
	name = tidyName(name);
	var t = name.split(/\s+/);
	if (t.length < 2 || t.length > 5) return false;
	if (/[,;&\d]/.test(name) || ORG_WORDS.test(name) || /^the\s/i.test(name)) return false;
	for (var i = 0; i < t.length; i++) {
		if (t[i].length > 1 && t[i] === t[i].toUpperCase() && /[A-Z]/.test(t[i]) && !/^[A-Z]\.?$/.test(t[i])) return false; // NVIDIA, HAI
		if (!(/^[A-Z\u00C0-\u00DD]/.test(t[i]) || PARTICLES.test(t[i]) || /^st\.?$/i.test(t[i]))) return false;
	}
	return true;
}

function splitPerson(name) {
	var t = tidyName(name).split(/\s+/), suffix = '';
	if (t.length > 2 && /^(jr|sr|ii|iii|iv)\.?$/i.test(t[t.length - 1])) suffix = t.pop();
	var family = [t.pop()];
	while (t.length > 1 && PARTICLES.test(t[t.length - 1])) family.unshift(t.pop());
	return { given: t.join(' '), family: family.join(' '), suffix: suffix };
}

// {given, family, suffix} for a person, or null for an institution.
function personParts(c) {
	if (!(c.name || c.fieldMode === 1 || !c.firstName)) return { given: c.firstName, family: c.lastName, suffix: '' };
	var nm = c.name || c.lastName || '';
	return looksLikePerson(nm) ? splitPerson(nm) : null;
}

function creatorFamily(c) {
	var p = personParts(c);
	return p ? p.family : (c.name || c.lastName || '');
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

// ------------------------------------------------------------------- keys

var CORP_SUFFIX = /[,\s]+(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|pbc|lp|llp|gmbh|ag|sa)\.?$/i;

function firstParty(caseName) {
	var m = /^(.+?)\s+v\.?\s+.+$/i.exec(String(caseName).trim());
	return m ? m[1] : String(caseName).trim();
}

function firstWord(text) {
	var words = String(text).split(/\s+/);
	for (var i = 0; i < words.length; i++) {
		if (!STOPWORDS.test(words[i]) && slug(words[i])) return words[i];
	}
	return '';
}

// A key must start with a letter (a leading digit reads as a volume number).
function finish(key) {
	return /^[a-z]/.test(key) ? key : 'ref' + key;
}

function baseKey(item) {
	var name = '';
	if (item.itemType === 'case') {
		if (setting('caseKeys') === 'shorttitle') {
			// The Short Title if there is one, else the first party (without "Inc.", "LLC", ...)
			var st = pick(item, 'shortTitle');
			var party = firstParty(pick(item, 'caseName', 'title'));
			var key = slug(st) || slug(party.replace(CORP_SUFFIX, '')) || slug(party);
			return finish(key || 'case');
		}
		name = firstWord(pick(item, 'caseName', 'title'));
	}
	else {
		var cs = creatorsOf(item, 'author');
		if (!cs.length && item.creators && item.creators.length) cs = [item.creators[0]];
		if (cs.length) name = creatorFamily(cs[0]);
	}
	if (!slug(name) && item.title) name = firstWord(item.title);
	return finish(slug(name) || 'ref') + yearOf(item);
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

// A key hicite can use as a nickname: starts with a letter (a leading digit
// reads as a volume number); letters, digits and hyphens only.
function usableKey(k) {
	return /^[A-Za-z][A-Za-z0-9-]*$/.test(k || '');
}

// The first usable key among the Extra "Citation Key:" line (pinned by this add-on) and, only
// when the key source setting is "adopt", the native Citation Key field (Better BibTeX).
function pinnedKey(item) {
	var m = /^\s*Citation Key\s*:\s*(\S+)\s*$/im.exec(item.extra || '');
	var candidates = [m ? m[1] : ''];
	if (setting('keySource') === 'adopt') candidates.push(item.citationKey || '');
	for (var i = 0; i < candidates.length; i++) {
		if (usableKey(candidates[i])) return candidates[i];
	}
	return '';
}

// ------------------------------------------------------------ TeX helpers

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

// ------------------------------------------------------------ field rules

// Short Title -> hicite's short-form name ("inline"), unless it just repeats the title.
function inlineName(item) {
	if (!setting('shortTitleInline')) return '';
	var st = pick(item, 'shortTitle');
	var title = pick(item, 'title', 'caseName');
	return st && slug(st) !== slug(title) ? st : '';
}

// Whether to give the URL. Web-native works keep it; works with a print citation drop it (a
// journal article is cited to its volume and pages, so its URL is kept only when either is missing).
function wantUrl(item) {
	if (!setting('includeUrls') || !pick(item, 'url')) return false;
	switch (item.itemType) {
		case 'journalArticle': return !(pick(item, 'volume') && pick(item, 'pages'));
		case 'conferencePaper': return !pick(item, 'pages');
		case 'book': case 'bookSection': case 'encyclopediaArticle': return false;
		case 'case': return !pick(item, 'reporter', 'reporterVolume', 'firstPage');
		default: return true;
	}
}

// Whether a website's title repeats its author (then it is left out of the citation).
function siteRepeatsAuthor(item, site) {
	if (!setting('omitRedundantSite')) return false;
	var s = slug(site);
	if (s.length < 3) return false;
	return creatorsOf(item, 'author').some(function (c) {
		var a = slug(c.name || ((c.firstName ? c.firstName + ' ' : '') + (c.lastName || '')));
		return a.length >= 3 && (a === s || a.indexOf(s) >= 0 || s.indexOf(a) >= 0);
	});
}

// arXiv / SSRN identifier for a preprint: Archive ID without its "arXiv:" prefix, else read from
// the URL or DOI.
function preprintNumber(item) {
	var a = pick(item, 'archiveID');
	if (a) return a.replace(/^[A-Za-z]+\s*:\s*/, '').trim();
	var url = pick(item, 'url'), doi = pick(item, 'DOI');
	var m = /arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5}|[a-z\-]+(?:\.[A-Za-z]{2})?\/[0-9]{7})/i.exec(url) ||
		/10\.48550\/arXiv\.([0-9]{4}\.[0-9]{4,5})/i.exec(doi);
	if (m) return m[1];
	m = /abstract(?:_id)?=(\d+)/i.exec(url);
	return m ? m[1] : '';
}

function preprintPublisher(item) {
	var r = pick(item, 'repository');
	if (r) return r;
	var url = pick(item, 'url');
	return /arxiv\.org/i.test(url) ? 'arXiv' : /ssrn\.com/i.test(url) ? 'SSRN' : '';
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
// Names of one kind of creator. With a positive `cap`, at most that many are listed and, when
// some are left out, the last one listed gets " et al." (hicite's syntax for a shortened list).
Def.prototype.names = function (item, ctype, personal, inst, cap) {
	var self = this, cs = creatorsOf(item, ctype), n = cs.length;
	var limit = cap > 0 && n > cap ? cap : n;
	cs.slice(0, limit).forEach(function (c, i) {
		var etal = limit < n && i === limit - 1 ? ' et al.' : '';
		var p = personParts(c);
		if (p) self.raw(personal, tex(p.given) + ' {' + tex(p.family) + (p.suffix ? ' {' + tex(p.suffix) + '}' : '') + '}' + etal);
		else if (c.name || c.lastName) self.raw(inst, tex(c.name || c.lastName) + etal);
	});
	return this;
};
Def.prototype.inline = function (item) {
	return this.set('inline', inlineName(item));
};
Def.prototype.url = function (item) {
	if (wantUrl(item)) this.raw('url', pick(item, 'url').replace(/%/g, '\\%')); // hicite: escape % only
	return this;
};
// An anonymous reference, as in  in=book: { title={...}, editor={...}, },
Def.prototype.ref = function (k, type, inner) {
	if (!inner.lines.length) return this;
	this.lines.push('    ' + k + '=' + type + ': {\n' + inner.lines.map(function (l) { return '    ' + l; }).join('\n') + '\n    },');
	return this;
};
Def.prototype.toString = function () {
	return '\\def' + this.type + '{' + this.key + '}{\n' + this.lines.join('\n') + '\n}\n';
};

function includePublisher() { return Zotero.getOption('Include publisher'); }

// The most authors to list before "et al." (0 = all of them).
function maxAuthors() {
	var n = parseInt(setting('maxAuthors'), 10);
	return n > 0 ? n : 0;
}

function container(item, titleFields, opts) {
	var inner = new Def('book', '');
	inner.names(item, 'bookAuthor', 'author', 'instauth', maxAuthors())
		.names(item, 'editor', 'editor', 'insted')
		.set('title', pick.apply(null, [item].concat(titleFields)))
		.set('edition', edition(item))
		.set('publisher', includePublisher() ? pick(item, 'publisher') : '');
	if (opts && opts.year) inner.set('year', yearOf(item) || 'nd');
	return inner;
}

function emit(item, key) {
	var t = item.itemType;
	var d;

	switch (t) {
		case 'journalArticle':
			d = new Def('jrnart', key);
			d.names(item, 'author', 'author', 'instauth', maxAuthors())
				.set('title', pick(item, 'title'))
				.set('vol', pick(item, 'volume'))
				.set('rep', pick(item, 'publicationTitle'))
				.set('page', firstPage(pick(item, 'pages')) || 'forthcoming')
				.set('year', yearOf(item) || 'nd')
				.inline(item).url(item);
			return [d];

		case 'book':
			d = new Def('book', key);
			d.names(item, 'author', 'author', 'instauth', maxAuthors())
				.names(item, 'editor', 'editor', 'insted')
				.set('title', pick(item, 'title'))
				.set('vol', pick(item, 'volume'))
				.set('edition', edition(item))
				.set('publisher', includePublisher() ? pick(item, 'publisher') : '')
				.set('year', yearOf(item) || 'nd')
				.inline(item).url(item);
			return [d];

		case 'bookSection':
			d = new Def('citecontainer', key);
			d.names(item, 'author', 'author', 'instauth', maxAuthors())
				.set('name', pick(item, 'title'))
				.set('year', yearOf(item) || 'nd')
				.set('page', firstPage(pick(item, 'pages')))
				.ref('in', 'book', container(item, ['bookTitle']))
				.inline(item).url(item);
			return [d];

		case 'conferencePaper':
			d = new Def('citecontainer', key);
			d.names(item, 'author', 'author', 'instauth', maxAuthors())
				.set('name', pick(item, 'title'))
				.set('year', yearOf(item) || 'nd')
				.set('page', firstPage(pick(item, 'pages')))
				.ref('in', 'book', container(item, ['proceedingsTitle', 'publicationTitle', 'conferenceName']))
				.inline(item).url(item);
			return [d];

		case 'encyclopediaArticle':
			d = new Def('citecontainer', key);
			d.names(item, 'author', 'author', 'instauth', maxAuthors())
				.set('name', pick(item, 'title'))
				.set('page', firstPage(pick(item, 'pages')))
				.ref('in', 'book', container(item, ['encyclopediaTitle', 'publicationTitle', 'bookTitle'], { year: true }))
				.inline(item).url(item);
			return [d];

		case 'magazineArticle':
		case 'newspaperArticle':
			d = new Def('magart', key);
			d.names(item, 'author', 'author', 'instauth', maxAuthors())
				.set('title', pick(item, 'title'))
				.set('journal', pick(item, 'publicationTitle'))
				.set('page', firstPage(pick(item, 'pages')))
				.set('date', dateOf(item))
				.inline(item).url(item);
			return [d];

		case 'preprint':
			var number = preprintNumber(item);
			if (number) {
				d = new Def('workingpaper', key);
				d.names(item, 'author', 'author', 'instauth', maxAuthors())
					.set('title', pick(item, 'title'))
					.set('publisher', preprintPublisher(item))
					.set('number', number)
					.set('date', dateOf(item))
					.inline(item).url(item);
				return [d];
			}
			// no identifier to number it by: cite it like a web page
			return webpage(item, key);

		case 'thesis':
		case 'manuscript':
		case 'letter':
			d = new Def('manuscript', key);
			d.names(item, 'author', 'author', 'instauth', maxAuthors())
				.set('title', pick(item, 'title'))
				.set('type', pick(item, 'thesisType', 'manuscriptType', 'letterType') || (t === 'letter' ? 'letter' : ''))
				.set('date', dateOf(item))
				.inline(item).url(item);
			return [d];

		case 'report':
			if (!pick(item, 'reportNumber')) {
				// \defworkingpaper requires a number; unnumbered reports are cited like books
				d = new Def('book', key);
				d.names(item, 'author', 'author', 'instauth', maxAuthors())
					.names(item, 'editor', 'editor', 'insted')
					.set('title', pick(item, 'title'))
					.set('publisher', includePublisher() ? pick(item, 'institution', 'publisher') : '')
					.set('year', yearOf(item) || 'nd')
					.inline(item).url(item);
				return [d];
			}
			d = new Def('workingpaper', key);
			d.names(item, 'author', 'author', 'instauth', maxAuthors())
				.set('title', pick(item, 'title'))
				.set('type', pick(item, 'reportType'))
				.set('publisher', pick(item, 'institution', 'publisher'))
				.set('number', pick(item, 'reportNumber'))
				.set('year', yearOf(item) || 'nd')
				.inline(item).url(item);
			return [d];

		case 'case':
			d = new Def('case', key);
			var name = pick(item, 'caseName', 'title');
			var m = /^(.+?)\s+v\.?\s+(.+)$/i.exec(name);
			if (m) d.set('p', m[1]).set('d', m[2]);
			else d.set('name', name);
			d.set('vol', pick(item, 'reporterVolume'))
				.set('rep', pick(item, 'reporter'))
				.set('page', firstPage(pick(item, 'firstPage', 'pages')))
				.set('docket', pick(item, 'docketNumber'))
				.set('court', pick(item, 'court'))
				.set('year', dateOf(item))
				.inline(item).url(item);
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
			return webpage(item, key);

		default:
			return webpage(item, key);
	}
}

// Web pages, and the catch-all for types without a better hicite equivalent.
function webpage(item, key) {
	var d = new Def('website', key);
	var site = pick(item, 'websiteTitle', 'publicationTitle', 'blogTitle', 'forumTitle', 'programTitle', 'publisher');
	d.names(item, 'author', 'author', 'instauth', maxAuthors())
		.set('title', pick(item, 'title', 'nameOfAct', 'caseName'))
		.set('journal', siteRepeatsAuthor(item, site) ? '' : site)
		.set('date', dateOf(item))
		.inline(item).url(item);
	return [d];
}

// ----------------------------------------------------------------- driver

function doExport() {
	var items = [];
	var item;
	while ((item = Zotero.nextItem())) {
		if (!SKIP_TYPES[item.itemType]) items.push(item);
	}

	// Pinned keys are authoritative: reserve them first (disambiguating any
	// duplicates among themselves), then generate the rest around them.
	var used = {};
	var keys = items.map(function (it) {
		var k = pinnedKey(it), n = 0, base = k;
		if (!k) return '';
		while (used[k]) k = base + suffix(++n);
		used[k] = 1;
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
