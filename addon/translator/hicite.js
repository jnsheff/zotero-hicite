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
		"hicite.keyStore": "extra",
		"hicite.caseKeys": "shorttitle",
		"hicite.shortTitleInline": true,
		"hicite.omitRedundantSite": true,
		"hicite.includeUrls": true,
		"hicite.maxAuthors": "0",
		"hicite.titleCase": true,
		"hicite.longLists": "8",
		"hicite.phoenixMode": "auto",
		"hicite.phoenix": "off"
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
	keySource: 'own', keyStore: 'extra', caseKeys: 'shorttitle', shortTitleInline: true, omitRedundantSite: true, includeUrls: true, maxAuthors: '0', titleCase: true, longLists: '8', phoenixMode: 'auto', phoenix: 'off'
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
	// A key pinned in Extra comes first; Zotero's Citation Key field is used when it is the key store
	// or the key source is "adopt".
	var candidates = [m ? m[1] : ''];
	if (setting('keySource') === 'adopt' || setting('keyStore') === 'field') candidates.push(item.citationKey || '');
	for (var i = 0; i < candidates.length; i++) {
		if (usableKey(candidates[i])) return candidates[i];
	}
	return '';
}

// ------------------------------------------------------------ TeX helpers

// TeX accent commands for the combining marks Zotero text can carry. Accented letters are written as
// TeX macros ({\"u}, {\'e}) rather than raw UTF-8: hicite builds control-sequence names out of some
// fields (journal names, institutional authors, case names), and a raw non-ASCII character in one of
// those stops the run with "Missing \endcsname inserted".
var TEX_ACCENTS = { '\u0300': '`', '\u0301': "'", '\u0302': '^', '\u0303': '~', '\u0308': '"', '\u0304': '=', '\u0307': '.',
	'\u0306': 'u', '\u030C': 'v', '\u0327': 'c', '\u030A': 'r', '\u030B': 'H', '\u0328': 'k' };
var TEX_LETTERS = { '\u00DF': '{\\ss}', '\u00E6': '{\\ae}', '\u00C6': '{\\AE}', '\u0153': '{\\oe}', '\u0152': '{\\OE}',
	'\u00F8': '{\\o}', '\u00D8': '{\\O}', '\u0142': '{\\l}', '\u0141': '{\\L}', '\u0131': '{\\i}', '\u0111': 'd', '\u0110': 'D' };

// Typographic punctuation and accented letters to ASCII TeX; pictographs (emoji), which no TeX font
// has, are dropped.
function texUnicode(s) {
	s = s.normalize('NFC').replace(/[\u2018\u2019\u02BC]/g, "'").replace(/\u201C/g, '``').replace(/\u201D/g, "''")
		.replace(/\u2014/g, '---').replace(/[\u2013\u2012]/g, '--').replace(/[\u2010\u2011\u2212]/g, '-')
		.replace(/\u2026/g, '\\ldots{}').replace(/[\u00A0\u2007\u202F\u200B\uFEFF]/g, ' ')
		.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF\uFE0F\u200D]/g, '');
	if (!/[^\x00-\x7F]/.test(s)) return s;
	return s.replace(/[^\x00-\x7F]/g, function (c) {
		if (TEX_LETTERS[c]) return TEX_LETTERS[c];
		var d = c.normalize('NFD');
		if (d.length !== 2 || !/[A-Za-z]/.test(d.charAt(0)) || !TEX_ACCENTS[d.charAt(1)]) return c;
		var accent = TEX_ACCENTS[d.charAt(1)], base = d.charAt(0);
		if (base === 'i' || base === 'j') base = '\\' + base; // a dotless i or j takes the accent
		var arg = /[A-Za-z]/.test(accent) || base.length > 1 ? '{' + base + '}' : base;
		return '{\\' + accent + arg + '}';
	});
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
	return texUnicode(s
		.replace(/\\/g, '\\textbackslash{}')
		.replace(/([&%#_$])/g, '\\$1')
		.replace(/~/g, '\\textasciitilde{}')
		.replace(/\^/g, '\\textasciicircum{}')).replace(/\s+/g, ' ').trim();
}

function firstPage(p) {
	if (!p) return '';
	var f = String(p).split(/\s*[-\u2010-\u2015,]\s*/)[0].trim();
	if (!f || /^0+$/.test(f)) return ''; // "0" is a placeholder, not a page
	return /^\d/.test(f) ? f : '!' + f; // "!" = unformatted page (hicite manual, pages)
}

// "3", "3rd", "3d ed." -> 3 (hicite prints "3d ed."); "Spring 2023" is kept as it is.
function edition(item) {
	var e = pick(item, 'edition');
	if (/^(spring|summer|fall|autumn|winter)\s+\d{4}/i.test(e)) return '';
	var m = /\d+/.exec(e);
	return m ? m[0] : '';
}
// A dated edition ("Spring 2023", Stanford Encyclopedia style) is the container's date.
function datedEdition(item) {
	var m = /^((?:spring|summer|fall|autumn|winter)\s+\d{4})/i.exec(pick(item, 'edition'));
	return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : '';
}

// Bluebook title case (Rule 8 / B8): capitalize every word except articles, conjunctions and
// prepositions of four or fewer letters, but always the first and last word and the first word after a
// colon or other sentence break. Words that already carry a capital after their first letter (iPhone,
// McCarthy, arXiv, GPT-4) and words that start with a digit are left alone, so a title that is already in
// title case comes out unchanged. A title in ALL CAPS is lowered first (except a few common acronyms).
var MINOR_WORDS = /^(a|an|the|and|but|or|nor|for|so|yet|as|at|by|in|of|off|on|per|to|up|via|from|into|onto|over|with|than|upon|near|past|vs\.?|v\.?)$/i;
var ACRONYMS = /^(AI|ML|US|USA|U\.S\.|EU|UK|UN|NBER|SSRN|DNA|RNA|LLMS?|GPT|NLP|IP|FTC|FDA|CAFC|II|III|IV|VI|VII|VIII|IX|XI|XII)$/;

function capWord(w) { // capitalize the first letter, skipping leading punctuation
	var m = /^([^A-Za-z\u00C0-\u024F]*)([A-Za-z\u00C0-\u024F])(.*)$/.exec(w);
	return m ? m[1] + m[2].toUpperCase() + m[3] : w;
}
// English title case does not suit a title in another language: use the item's Language field, or
// recognize two or more common German / French / Spanish / Italian function words.
var FOREIGN_WORDS = /(^|[\s'])(der|die|das|und|\u00FCber|ueber|von|zur|zum|dem|des|les|une|nicht|f\u00FCr|fuer|mit|auf|sur|dans|pour|avec|sont|est|los|las|del|para|por|una|con|della|dei|sulla|nella)(?=[\s',:;]|$)/gi;
var itemLanguage = '';
function foreignTitle(s) {
	if (itemLanguage && !/^en/i.test(itemLanguage.trim())) return true;
	return (s.match(FOREIGN_WORDS) || []).length >= 2;
}
function titleCase(s) {
	s = String(s || '');
	if (!setting('titleCase') || !s || foreignTitle(s)) return s;
	var letters = s.replace(/[^A-Za-z]/g, '');
	var shout = letters.length > 3 && letters === letters.toUpperCase() && s.split(/\s+/).length > 1;
	var words = s.split(/(\s+)/), last = -1, i;
	for (i = 0; i < words.length; i++) if (!/^\s*$/.test(words[i])) last = i;
	var capNext = true;
	for (i = 0; i < words.length; i++) {
		var w = words[i];
		if (/^\s*$/.test(w)) continue;
		var out = w;
		if (shout && !ACRONYMS.test(w.replace(/[^A-Za-z.]/g, ''))) out = w.toLowerCase();
		var core = out.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
		var parts = out.split('-'), pi;
		if (/[A-Z]/.test(core.slice(1)) || /https?:|@|\//.test(out) || /^[^A-Za-z]*\d/.test(out)) {
			// already has internal capitals / URL / number: leave it
		}
		else {
			for (pi = 0; pi < parts.length; pi++) {
				var pc = parts[pi].replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
				var first = pi === 0 && capNext, lastWord = i === last && pi === parts.length - 1;
				if (!pc || /[A-Z]/.test(pc.slice(1))) continue;
				// the first element of a hyphenated word is capitalized even if it is a short preposition (Near-Verbatim)
				var minor = MINOR_WORDS.test(pc) && !(parts.length > 1 && pi === 0);
				if (/^[a-z]/.test(pc) && (first || lastWord || !minor)) parts[pi] = capWord(parts[pi]);
			}
			out = parts.join('-');
		}
		words[i] = out;
		capNext = /[:?!]["')\]]*$/.test(w) || /^[\u2013\u2014-]+$/.test(w);
	}
	return words.join('');
}
// A journal or site name gets the same treatment, so that hicite can recognize a journal by its name
// and abbreviate it ("The bulletin of mathematical biophysics" -> "Bull. Math. Biophysics").
function nameCase(s) { return titleCase(s); }

// ------------------------------------------------------------ field rules

// Short Title -> hicite's short-form name ("inline"), unless it just repeats the title.
function inlineName(item) {
	if (!setting('shortTitleInline')) return '';
	var st = pick(item, 'shortTitle');
	var title = pick(item, 'title', 'caseName');
	return st && slug(st) !== slug(title) ? titleCase(st) : '';
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
		case 'statute': return !(pick(item, 'code') && pick(item, 'section')); // a codified section is cited to the code
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
Def.prototype.title = function (k, v) { return this.set(k, titleCase(v)); };   // a work's title
Def.prototype.pub = function (k, v) { return this.set(k, nameCase(v)); };      // a journal / site name
Def.prototype.flag = function (k) { // a parameter without a value ("noetal,")
	if (this.lines.indexOf('    ' + k + ',') < 0) this.lines.push('    ' + k + ',');
	return this;
};
// Names from a list of creators. With a positive `cap`, at most that many are listed and, when
// some are left out, the last one listed gets " et al." (hicite's syntax for a shortened list).
Def.prototype.namesOf = function (cs, personal, inst, cap) {
	var self = this, n = cs.length;
	// An explicit cap wins. With none (cap 0), a list longer than the "long lists" setting (default 8) is cut to
	// the first two names and "et al." -- a 114-author list is no use in a citation, least of all in a margin.
	var limit = cap > 0 && n > cap ? cap : n;
	if (cap === 0 && longLists() > 0 && n > longLists()) limit = 2;
	// hicite warns about every list of three or more names unless it carries "noetal"
	if (limit >= 3) this.flag('noetal');
	cs.slice(0, limit).forEach(function (c, i) {
		var etal = limit < n && i === limit - 1 ? ' et al.' : '';
		var p = personParts(c);
		if (p) self.raw(personal, tex(p.given) + ' {' + tex(p.family) + (p.suffix ? ' {' + tex(p.suffix) + '}' : '') + '}' + etal);
		else if (c.name || c.lastName) self.raw(inst, tex(c.name || c.lastName) + etal);
	});
	return this;
};
Def.prototype.names = function (item, ctype, personal, inst, cap) {
	return this.namesOf(creatorsOf(item, ctype), personal, inst, cap);
};

// Plain-text name for a parenthetical: "Tom Trans", or an institution's name.
function displayName(c) {
	var p = personParts(c);
	return p ? p.given + ' ' + p.family + (p.suffix ? ' ' + p.suffix : '') : (c.name || c.lastName || '');
}
function joinNames(list) {
	return list.length < 3 ? list.join(' & ') : list.slice(0, -1).join(', ') + ' & ' + list[list.length - 1];
}

// Editors and translators. hicite has one list for both ("editor", with an `edtype` role label):
//  - translators only: they go in that list, labelled "trans."
//  - the same people edited and translated: "ed. & trans." (or "eds. & trans.")
//  - different people: editors as usual, translators in a parenthetical
// (hicite does not support a different editor and translator in one reference; the parenthetical
// is the closest citation form.)
Def.prototype.roles = function (item) {
	var eds = creatorsOf(item, 'editor'), trs = creatorsOf(item, 'translator');
	if (!trs.length) return this.namesOf(eds, 'editor', 'insted');
	var id = function (c) { return slug(displayName(c)); };
	if (!eds.length) return this.namesOf(trs, 'editor', 'insted').set('edtype', 'trans.');
	var same = eds.length === trs.length && eds.every(function (e) { return trs.some(function (t) { return id(t) === id(e); }); });
	this.namesOf(eds, 'editor', 'insted');
	if (same) return this.set('edtype', eds.length > 1 ? 'eds. & trans.' : 'ed. & trans.');
	return this.set('paren', joinNames(trs.map(displayName)) + ' trans.');
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
	return (this.note ? '% hicite: ' + this.note + '\n' : '') + '\\def' + this.type + '{' + this.key + '}{\n' + this.lines.join('\n') + '\n}\n';
};

function includePublisher() { return Zotero.getOption('Include publisher'); }

// Lists longer than this are cut to "First, Second, et al." when no explicit cap is set (0 = never).
function longLists() {
	var n = parseInt(setting('longLists'), 10);
	return n > 0 ? n : 0;
}

// The most authors to list before "et al." (0 = all of them).
function maxAuthors() {
	var n = parseInt(setting('maxAuthors'), 10);
	return n > 0 ? n : 0;
}

function container(item, titleFields, opts) {
	var inner = new Def('book', '');
	inner.names(item, 'bookAuthor', 'author', 'instauth', maxAuthors())
		.roles(item)
		.title('title', pick.apply(null, [item].concat(titleFields)))
		.set('edition', edition(item))
		.set('publisher', includePublisher() ? pick(item, 'publisher') : '');
	if (datedEdition(item)) inner.set('year', datedEdition(item)); // Stanford Encyclopedia: "Spring 2023"
	else if (opts && opts.year) inner.set('year', yearOf(item) || 'nd');
	return inner;
}


// ---------------------------------------------- hicite-only types and parameters
// Zotero has no field for some hicite parameters and no item type for some hicite reference types.
// The hicite Export plugin stores those in the Extra field, one "hicite-<param>: value" per line;
// "hicite-doctype: govdoc" (on a Zotero Document) picks one of the types Zotero lacks. See
// hicite-types.json in the plugin for the catalog.
var RAW_PARAMS = { citation: 1, 'in': 1, prior: 1, subsequent: 1 }; // hicite syntax, not TeX-escaped
var FLAG_PARAMS = { slip: 1, inlinedefendant: 1, enbanc: 1, mem: 1, percuriam: 1, useissue: 1, forthcoming: 1 };

function extraParams(item) {
	var out = [], re = /^\s*hicite-([a-z]+)\s*:\s*(.*?)\s*$/gim, m;
	while ((m = re.exec(item.extra || ''))) {
		if (m[1] !== 'doctype' && m[2] !== '') out.push({ p: m[1], v: m[2] });
	}
	return out;
}
function docType(item) {
	var m = /^\s*hicite-doctype\s*:\s*([a-z]+)\s*$/im.exec(item.extra || '');
	return m ? m[1] : '';
}
// Add the Extra parameters to a definition; they replace a parameter of the same name.
function withExtras(item, d) {
	extraParams(item).forEach(function (e) {
		var prefix = '    ' + e.p + '=';
		d.lines = d.lines.filter(function (l) { return l.indexOf(prefix) !== 0 && l !== '    ' + e.p + ','; });
		if (FLAG_PARAMS[e.p]) {
			if (/^(1|y|yes|true|on)$/i.test(e.v)) d.lines.push('    ' + e.p + ',');
		}
		else d.raw(e.p, RAW_PARAMS[e.p] ? e.v : tex(e.v));
	});
	return d;
}

// ------------------------------------------------ citation-phoenix (Juris-M data)
// The citation-phoenix add-on keeps Juris-M's legal data in an "mlzsync1:" block in Extra and puts Juris-M court
// IDs ("court.appeals") in the Court field. When it is in use the hicite add-on sets the hidden pref hicite.phoenix to
// "on" (it detects the add-on; see hicite-export.js), and the code below reads that data. When the pref is "off",
// none of it runs and items export exactly as they did before. Keep the court tables in step with
// tools/fill-reporter-from-jurism.js (test/phoenix-jsc.js compares the two).

function phoenixOn() { return setting('phoenix') === 'on'; }

// The JSON object of an "mlzsync1:" block (optionally preceded by a 4-digit length), or null. Text may follow the
// closing brace on the same line, so the end is found by matching braces.
function parseJurism(extra) {
	extra = String(extra || '');
	var m = /mlzsync1:(\d{4})?/.exec(extra);
	if (!m) return null;
	var start = extra.indexOf('{', m.index + m[0].length);
	if (start < 0) return null;
	var depth = 0, inString = false, escaped = false;
	for (var i = start; i < extra.length; i++) {
		var c = extra[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (c === '\\') escaped = true;
			else if (c === '"') inString = false;
		}
		else if (c === '"') inString = true;
		else if (c === '{') depth++;
		else if (c === '}' && --depth === 0) {
			try { return JSON.parse(extra.slice(start, i + 1)); }
			catch (e) { return null; }
		}
	}
	return null;
}

// "<3-digit key length><key><names joined by |>", e.g. "005us:c2United States|US|Second Circuit" -> "us:c2"; a bare key also occurs.
function jurisdictionKey(j) {
	var s = String(j || '').trim(), m = /^(\d{3})([\s\S]*)$/.exec(s);
	if (m) return m[2].slice(0, parseInt(m[1], 10));
	return /^[a-z0-9:.~_-]+$/i.test(s) ? s : '';
}

// { xtype, key, ef }: the item type phoenix recorded, the jurisdiction key, and its extra fields.
function legalOf(item) {
	var data = parseJurism(item.extra) || {}, ef = data.extrafields || {};
	return { xtype: String(data.xtype || ef.xtype || ''), key: jurisdictionKey(ef.jurisdiction), ef: ef };
}

var STATES = {
	al: ['Alabama', 'Ala.'], ak: ['Alaska', 'Alaska'], az: ['Arizona', 'Ariz.'], ar: ['Arkansas', 'Ark.'],
	ca: ['California', 'Cal.'], co: ['Colorado', 'Colo.'], ct: ['Connecticut', 'Conn.'], de: ['Delaware', 'Del.'],
	dc: ['District of Columbia', 'D.C.'], fl: ['Florida', 'Fla.'], ga: ['Georgia', 'Ga.'], hi: ['Hawaii', 'Haw.'],
	id: ['Idaho', 'Idaho'], il: ['Illinois', 'Ill.'], 'in': ['Indiana', 'Ind.'], ia: ['Iowa', 'Iowa'],
	ks: ['Kansas', 'Kan.'], ky: ['Kentucky', 'Ky.'], la: ['Louisiana', 'La.'], me: ['Maine', 'Me.'],
	md: ['Maryland', 'Md.'], ma: ['Massachusetts', 'Mass.'], mi: ['Michigan', 'Mich.'], mn: ['Minnesota', 'Minn.'],
	ms: ['Mississippi', 'Miss.'], mo: ['Missouri', 'Mo.'], mt: ['Montana', 'Mont.'], ne: ['Nebraska', 'Neb.'],
	nv: ['Nevada', 'Nev.'], nh: ['New Hampshire', 'N.H.'], nj: ['New Jersey', 'N.J.'], nm: ['New Mexico', 'N.M.'],
	ny: ['New York', 'N.Y.'], nc: ['North Carolina', 'N.C.'], nd: ['North Dakota', 'N.D.'], oh: ['Ohio', 'Ohio'],
	ok: ['Oklahoma', 'Okla.'], or: ['Oregon', 'Or.'], pa: ['Pennsylvania', 'Pa.'], ri: ['Rhode Island', 'R.I.'],
	sc: ['South Carolina', 'S.C.'], sd: ['South Dakota', 'S.D.'], tn: ['Tennessee', 'Tenn.'], tx: ['Texas', 'Tex.'],
	ut: ['Utah', 'Utah'], vt: ['Vermont', 'Vt.'], va: ['Virginia', 'Va.'], wa: ['Washington', 'Wash.'],
	wv: ['West Virginia', 'W. Va.'], wi: ['Wisconsin', 'Wis.'], wy: ['Wyoming', 'Wyo.'], pr: ['Puerto Rico', 'P.R.']
};
// The court a state's own official reporter covers (Bluebook 10.4(b) omits the court then), compared ignoring dots, spaces and case.
var OFFICIAL_HIGH_COURT_REPORTER = {
	ny: /^ny(2d|3d)?$/, ca: /^cal(2d|3d|4th|5th)?$/, ma: /^mass$/, nj: /^nj$/, pa: /^pa$/, il: /^ill(2d)?$/, wa: /^wash(2d)?$/, md: /^md$/
};
var DISTRICT_DESIGNATORS = { d: 'D.', nd: 'N.D.', sd: 'S.D.', ed: 'E.D.', wd: 'W.D.', md: 'M.D.', cd: 'C.D.' };
var SUPREME_REPORTERS = { us: 1, sct: 1, led: 1, led2d: 1 };
function squash(r) { return String(r || '').toLowerCase().replace(/[.\s]/g, ''); }
function isSupremeReporter(r) { return !!SUPREME_REPORTERS[squash(r)]; }

function circuitAbbrev(n) {
	n = Number(n);
	if (!(n >= 1 && n <= 11)) return null;
	return (n === 1 ? '1st' : n === 2 ? '2d' : n === 3 ? '3d' : n + 'th') + ' Cir.';
}
function joinDistrict(designator, stateAbbr) { // "S.D." + "N.Y." -> "S.D.N.Y."; "N.D." + "Cal." -> "N.D. Cal."
	return designator + (/^([A-Z]\.)+$/.test(stateAbbr) ? '' : ' ') + stateAbbr;
}
function districtFromKey(key) { // "us:c2:ny.sd" -> "S.D.N.Y."
	var m = /^us:c\d+:([a-z]{2})\.([a-z]{1,2})$/.exec(key);
	if (!m || !STATES[m[1]] || !DISTRICT_DESIGNATORS[m[2]]) return null;
	return joinDistrict(DISTRICT_DESIGNATORS[m[2]], STATES[m[1]][1]);
}
function stateHighCourt(code) {
	return STATES[code] ? { court: STATES[code][1], kind: 'state-high', state: code } : null;
}

// Translate a Juris-M court ID using the jurisdiction key: { court, kind } or { unresolved: reason }.
function courtFromId(courtId, key) {
	var m;
	switch (courtId) {
		case 'court.appeals.federal.circuit': return { court: 'Fed. Cir.' };
		case 'court.customs.patent.appeals': return { court: 'C.C.P.A.', kind: 'ccpa' };
		case 'supreme.court':
			if (key === 'us') return { court: 'U.S.', kind: 'supreme' };
			m = /^us:([a-z]{2})$/.exec(key);
			if (m && m[1] === 'ny') return { unresolved: "New York's Supreme Court is a trial court, not its highest court" };
			if (m && stateHighCourt(m[1])) return stateHighCourt(m[1]);
			return { unresolved: 'supreme.court outside the U.S. federal system' };
		case 'court.appeals':
			if (key === 'us:c0' || key === 'us:cdc') return { court: 'D.C. Cir.' };
			if (key === 'us:c') return { court: 'Fed. Cir.' };
			if (key === 'us:ny' || key === 'us:md') return stateHighCourt(key.slice(3));
			m = /^us:c(\d+)$/.exec(key);
			if (m && circuitAbbrev(m[1])) return { court: circuitAbbrev(m[1]) };
			return /^us:[a-z]{2}$/.test(key)
				? { unresolved: 'court.appeals in a state other than NY/MD is an intermediate court, not the highest' }
				: { unresolved: 'court.appeals without a usable circuit' };
		case 'district.court':
			var d = districtFromKey(key);
			return d ? { court: d } : { unresolved: 'district.court without a usable district' };
		default:
			return { unresolved: 'unknown court ID' };
	}
}

// Juris-M court IDs are lowercase and dotted ("court.appeals", "ecj~chamber.1"); typed courts ("2d Cir.") never match.
var COURT_ID = /^[a-z][a-z0-9]*([.~][a-z0-9]+)+$/;

// A court the reporter already identifies is omitted (hicite: "may be omitted if the reporter uniquely identifies the court").
function finalCourt(res, reporter) {
	if (res.kind === 'supreme') return isSupremeReporter(reporter) ? '' : res.court;
	if (res.kind === 'state-high') {
		var official = OFFICIAL_HIGH_COURT_REPORTER[res.state];
		return official && official.test(squash(reporter)) ? '' : res.court;
	}
	if (res.kind === 'ccpa') return squash(reporter) === 'ccpa' ? '' : res.court;
	return res.court;
}

// The reporter: Zotero's field, else (with phoenix) the one in the Juris-M block.
function reporterOf(item) {
	var r = pick(item, 'reporter');
	if (r || !phoenixOn()) return r;
	return String(legalOf(item).ef.reporter || '').trim();
}

// { court, note }: the court as Bluebook abbreviation. Without phoenix this is the Court field untouched.
// With it, a Juris-M court ID (in the field, or in the block when the field is empty) is translated using the
// case's jurisdiction; an ID that cannot be translated with certainty is left out and noted in the output.
function courtOf(item, reporter) {
	var c = pick(item, 'court');
	if (!phoenixOn()) return { court: c, note: '' };
	var legal = legalOf(item), id = c || String(legal.ef.court || '').trim();
	if (!id || !COURT_ID.test(id)) return { court: c, note: '' };
	var res = courtFromId(id, legal.key);
	if (res.unresolved) return { court: '', note: 'court ' + id + ' [' + (legal.key || 'no jurisdiction') + '] not translated: ' + res.unresolved };
	return { court: finalCourt(res, reporter), note: '' };
}

// A treaty kept as a Zotero Document with phoenix's "treaty" type. Its treaty-specific data lives in the block.
function treatyDef(item, key) {
	var ef = legalOf(item).ef, d = new Def('treaty', key);
	var when = String(ef.signingDate || ef.adoptionDate || ef.openingDate || '').trim() || pick(item, 'date');
	d.title('name', pick(item, 'title'))
		.set('year', when ? dateOf({ date: when }) : '')
		.set('vol', String(ef.volume || '').trim()).set('rep', String(ef.reporter || '').trim())
		.set('page', firstPage(String(ef.pages || '').trim()))
		.inline(item).url(item);
	return d;
}

// A regulation is a statute with phoenix's "regulation" type; in a code it is a hicite regcode (same parameters as statcode).
function codeType(item) {
	return phoenixOn() && legalOf(item).xtype === 'regulation' ? 'regcode' : 'statcode';
}

function emitBase(item, key) {
	var t = item.itemType;
	var d;

	switch (t) {
		case 'journalArticle':
			// \defjrnart needs a journal. Zotero journal articles without a publication title (working
			// papers, memos, interviews, reference entries filed as articles) and web-native articles with
			// neither volume nor pages (Lawfare, blogs) are cited like web pages instead.
			if (!pick(item, 'publicationTitle')) return webpage(item, key, 'journal article with no publication title, cited as a web page');
			if (!pick(item, 'pages') && !pick(item, 'volume') && pick(item, 'url') && !/forthcoming|in press/i.test(item.extra || '')) return webpage(item, key);
			d = new Def('jrnart', key);
			d.names(item, 'author', 'author', 'instauth', maxAuthors())
				.title('title', pick(item, 'title'))
				.set('vol', pick(item, 'volume'))
				.pub('rep', pick(item, 'publicationTitle'))
				.set('page', firstPage(pick(item, 'pages')) || 'forthcoming')
				.set('year', yearOf(item) || 'nd')
				.inline(item).url(item);
			return [d];

		case 'book':
			d = new Def('book', key);
			d.names(item, 'author', 'author', 'instauth', maxAuthors())
				.roles(item)
				.title('title', pick(item, 'title'))
				.set('vol', pick(item, 'volume'))
				.set('edition', edition(item))
				.set('publisher', includePublisher() ? pick(item, 'publisher') : '')
				.set('year', yearOf(item) || 'nd')
				.inline(item).url(item);
			return [d];

		case 'bookSection':
			d = new Def('citecontainer', key);
			d.names(item, 'author', 'author', 'instauth', maxAuthors())
				.title('name', pick(item, 'title'))
				.set('year', yearOf(item) || 'nd')
				.set('page', firstPage(pick(item, 'pages')))
				.ref('in', 'book', container(item, ['bookTitle']))
				.inline(item).url(item);
			return [d];

		case 'conferencePaper':
			d = new Def('citecontainer', key);
			d.names(item, 'author', 'author', 'instauth', maxAuthors())
				.title('name', pick(item, 'title'))
				.set('year', yearOf(item) || 'nd')
				.set('page', firstPage(pick(item, 'pages')))
				.ref('in', 'book', container(item, ['proceedingsTitle', 'publicationTitle', 'conferenceName']))
				.inline(item).url(item);
			return [d];

		case 'encyclopediaArticle':
			d = new Def('citecontainer', key);
			d.names(item, 'author', 'author', 'instauth', maxAuthors())
				.title('name', pick(item, 'title'))
				.set('page', firstPage(pick(item, 'pages')))
				.ref('in', 'book', container(item, ['encyclopediaTitle', 'publicationTitle', 'bookTitle'], { year: true }))
				.inline(item).url(item);
			return [d];

		case 'magazineArticle':
		case 'newspaperArticle':
			d = new Def('magart', key);
			d.names(item, 'author', 'author', 'instauth', maxAuthors())
				.title('title', pick(item, 'title'))
				.pub('journal', pick(item, 'publicationTitle'))
				.set('page', firstPage(pick(item, 'pages')))
				.set('date', dateOf(item))
				.inline(item).url(item);
			return [d];

		case 'preprint':
			var number = preprintNumber(item);
			if (number) {
				d = new Def('workingpaper', key);
				d.names(item, 'author', 'author', 'instauth', maxAuthors())
					.title('title', pick(item, 'title'))
					.set('publisher', preprintPublisher(item))
					.set('number', number)
					.set('date', dateOf(item))
					.inline(item).url(item);
				return [d];
			}
			// no identifier to number it by: cite it like a web page
			return webpage(item, key);

		case 'letter':
			var senders = creatorsOf(item, 'author'), recips = creatorsOf(item, 'recipient');
			if (senders.length || recips.length) {
				// hicite has a letter type: "Letter from <sender> to <recipient>, <title> (<date>)"
				d = new Def('letter', key);
				d.names(item, 'author', 'author', 'instauth', maxAuthors());
				recips.forEach(function (c) {
					if (personParts(c)) d.set('to', displayName(c)); else d.set('instto', displayName(c));
				});
				d.title('name', pick(item, 'title')).set('type', pick(item, 'letterType'))
					.set('date', dateOf(item)).inline(item).url(item);
				return [d];
			}
			// falls through: a letter with neither sender nor recipient is just an unpublished manuscript
		case 'thesis':
		case 'manuscript':
			d = new Def('manuscript', key);
			d.names(item, 'author', 'author', 'instauth', maxAuthors())
				.title('title', pick(item, 'title'))
				.set('type', pick(item, 'thesisType', 'manuscriptType', 'letterType') || (t === 'letter' ? 'letter' : ''))
				.set('date', dateOf(item))
				.inline(item).url(item);
			return [d];

		case 'report':
			if (!pick(item, 'reportNumber')) {
				// \defworkingpaper requires a number; unnumbered reports are cited like books
				d = new Def('book', key);
				d.names(item, 'author', 'author', 'instauth', maxAuthors())
					.roles(item)
					.title('title', pick(item, 'title'))
					.set('publisher', includePublisher() ? pick(item, 'institution', 'publisher') : '')
					.set('year', yearOf(item) || 'nd')
					.inline(item).url(item);
				return [d];
			}
			d = new Def('workingpaper', key);
			d.names(item, 'author', 'author', 'instauth', maxAuthors())
				.title('title', pick(item, 'title'))
				.set('type', pick(item, 'reportType'))
				.set('publisher', pick(item, 'institution', 'publisher'))
				.set('number', pick(item, 'reportNumber'))
				.set('year', yearOf(item) || 'nd')
				.inline(item).url(item);
			return [d];

		case 'case':
			return caseDefs(item, key);

		case 'statute':
			return statuteDefs(item, key);

		default:
			return webpage(item, key);
	}
}


// ---------------------------------------------------------------- cases

// Court papers are kept in Zotero as cases named for the paper and the case ("Complaint: Garcia v.
// Character Technologies", "Order Granting ..., Bartz v. Anthropic PBC"), or as a case whose Short Title
// is the kind of paper. hicite cites them with \defcasedoc: "Complaint, Garcia v. Character Techs., No.
// ... (M.D. Fla. Oct. 22, 2024)".
var COURT_PAPER = /^((?:(?:first|second|third|amended)\s+)*(?:complaint|answer|counterclaim|motion|brief|order|opinion|declaration|affidavit|memorandum|petition|judgment|transcript|stipulation|subpoena|indictment|response|reply|opposition|application)\b[^:,]*?)\s*[:,]\s+(.+)$/i;
var COURT_PAPER_WORD = /^(?:(?:first|second|third|amended)\s+)*(complaint|answer|counterclaim|motion|brief|order|opinion|declaration|affidavit|memorandum|petition|judgment|transcript|stipulation)$/i;

function caseParties(def, name) {
	var m = /^(.+?)\s+v\.?\s+(.+)$/i.exec(name);
	if (m) def.set('p', m[1]).set('d', m[2]);
	else def.set('name', name);
	return def;
}

function caseDefs(item, key) {
	var name = pick(item, 'caseName', 'title'), st = pick(item, 'shortTitle');
	var paper = '', m = COURT_PAPER.exec(name);
	if (m) { paper = m[1]; name = m[2]; }
	else if (COURT_PAPER_WORD.test(st) && /\sv\.?\s/i.test(name)) paper = st;
	var reporter = reporterOf(item), vol = pick(item, 'reporterVolume'), page = firstPage(pick(item, 'firstPage', 'pages'));
	var courtInfo = courtOf(item, reporter);
	var d;
	if (paper) {
		var inner = new Def('case', '');
		caseParties(inner, name).set('docket', pick(item, 'docketNumber')).set('court', courtInfo.court);
		d = new Def('casedoc', key);
		d.ref('citation', 'case', inner).set('name', titleCase(paper)).set('year', dateOf(item)).url(item);
		if (courtInfo.note) d.note = courtInfo.note;
		return [d];
	}
	d = new Def('case', key);
	if (courtInfo.note) d.note = courtInfo.note;
	caseParties(d, name);
	var slip = /^slip\s*op/i.test(reporter);
	if (slip) d.flag('slip');
	else d.set('vol', vol).set('rep', reporter).set('page', page);
	// A reported case is dated by its year alone ("(2d Cir. 2015)"); the full date is for slip opinions
	// and other unreported decisions.
	var reported = !slip && reporter && vol && page;
	d.set('docket', pick(item, 'docketNumber')).set('court', courtInfo.court)
		.set('year', reported ? yearOf(item) || 'nd' : dateOf(item)).inline(item).url(item);
	return [d];
}

// ------------------------------------------------------------- statutes

var ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100 };
function fromRoman(r) {
	var n = 0, prev = 0;
	r.toUpperCase().split('').reverse().forEach(function (c) { var v = ROMAN[c] || 0; n += v < prev ? -v : v; prev = Math.max(prev, v); });
	return n;
}

function statuteDefs(item, key) {
	var code = pick(item, 'code'), sect = pick(item, 'section'), num = pick(item, 'codeNumber', 'volume');
	var name = pick(item, 'nameOfAct', 'title'), pages = pick(item, 'pages');
	var d, m;
	// The Federal Register (executive orders, agency notices and guidance) is entered as a statute in Zotero
	// but is a government document to hicite: "Exec. Order No. 14110, Safe, Secure, ..., 88 Fed. Reg. 75191".
	// (An item filed under "C.F.R." that also has a first page is the same thing: C.F.R. sections have no
	// page numbers, Federal Register notices do.)
	var fedreg = /^fed(?:eral|\.)?\s*reg(?:ister|\.)?$/i.test(code.trim()), cfrNotice = /^c\.?\s*f\.?\s*r\.?$/i.test(code.trim()) && !!pages && !!num;
	if (fedreg || cfrNotice) {
		d = new Def('govdoc', key);
		if (cfrNotice) d.note = 'filed as a C.F.R. section but has a page: cited as a Federal Register document';
		var eo = /^(?:executive\s+order|exec\.\s*order)\s*(?:no\.?\s*)?(\d+)[^:]*:\s*(.+)$/i.exec(name);
		d.set('number', eo ? 'Exec. Order No. ' + eo[1] : pick(item, 'publicLawNumber'))
			.title('name', eo ? eo[2] : name)
			.names(item, 'author', 'author', 'instauth', maxAuthors())
			.set('vol', num).set('rep', 'Fed. Reg.').set('page', firstPage(pages || sect))
			.set('year', dateOf(item)).inline(item).url(item);
		return [d];
	}
	if (code && sect) {
		// An act with a name of its own ("... Act") or a Short Title is given in keyword form, so that the name,
		// short form and year are kept; a bare section ("17 U.S.C. S 102") is hicite's one-line form, which
		// parses "S" as the section sign.
		var actLike = /\b(act|code|law|statutes?|amendments?)\b/i.test(name) && !/^section\b/i.test(name);
		if (actLike || pick(item, 'shortTitle')) {
			d = new Def(codeType(item), key);
			return [d.title('name', name).set('vol', num).set('rep', code).set('page', sect.replace(/^(?:S|\u00A7+)\s*/, ''))
				.set('year', yearOf(item)).inline(item).url(item)];
		}
		return [{ toString: function () {
			return '\\def' + codeType(item) + '{' + key + '}{' + tex((num ? num + ' ' : '') + code + ' S ' + sect) + '}\n';
		} }];
	}
	// The Constitution: "U.S. Const. Art. I, §8, cl. 8", "U.S. Const. amend. I"
	if ((m = /^U\.?\s?S\.?\s+Const(?:itution|\.)?\s*(.*)$/i.exec(name)) && !code) {
		var rest = m[1].trim(), am = /^amend(?:ment|\.)?\s+([IVXLC]+|\d+)/i.exec(rest), art = /^art(?:icle|\.)?\s*([IVXLC]+|\d+)/i.exec(rest);
		if (am) {
			d = new Def('constamend', key);
			return [d.set('number', /^\d+$/.test(am[1]) ? am[1] : String(fromRoman(am[1]))).inline(item).url(item)];
		}
		if (art) {
			d = new Def('const', key);
			var pin = rest.replace(/art(?:icle|\.)?\s*/i, 'article ').replace(/\u00A7+\s*/g, 'S ').replace(/\bcl(?:ause|\.)?\s*/gi, 'clause ').replace(/\s+/g, ' ');
			return [d.set('name', 'Article ' + art[1].toUpperCase()).set('page', pin).inline(item).url(item)];
		}
	}
	return webpage(item, key);
}

// The hicite-only types, all kept in a Zotero Document (see hicite-types.json).
function emitVirtual(item, key, type) {
	var d = new Def(type, key), name = pick(item, 'title');
	switch (type) {
		case 'govdoc':
			d.title('name', name).names(item, 'author', 'author', 'instauth', maxAuthors()).set('year', dateOf(item));
			break;
		case 'casedoc':
			d.set('name', name).set('year', dateOf(item));
			break;
		case 'congrec':
			d.set('year', dateOf(item));
			break;
		case 'const':
			d.set('name', name).set('year', dateOf(item));
			break;
		case 'modelcode':
			d.set('name', name).names(item, 'author', 'author', 'instauth', maxAuthors()).set('year', dateOf(item));
			break;
		case 'constamend':
			break;
		default:
			return null;
	}
	d.inline(item).url(item);
	return withExtras(item, d);
}

// hicite needs the Congress a bill was introduced in: the Session field, else "119th Congress" in the
// URL or text, else the Congress in session on the bill's date.
function congressOf(item) {
	var m = /\d+/.exec(pick(item, 'session'));
	if (m) return m[0];
	m = /(\d+)(?:st|nd|rd|th)[- ]congress/i.exec([pick(item, 'url'), pick(item, 'shortTitle'), pick(item, 'title'), pick(item, 'abstractNote'), item.extra || ''].join(' '));
	if (m) return m[1];
	var y = parseInt(yearOf(item), 10);
	return y >= 1789 ? String(Math.floor((y - 1789) / 2) + 1) : '';
}

function emit(item, key) {
	var t = item.itemType, dt = docType(item), d;
	if (t === 'document' && dt && (d = emitVirtual(item, key, dt))) return [d];

	if (t === 'statute' && dt === 'statsess') {
		d = new Def('statsess', key);
		d.set('name', pick(item, 'nameOfAct', 'title')).set('number', pick(item, 'publicLawNumber'))
			.set('vol', pick(item, 'codeNumber', 'volume')).set('rep', pick(item, 'code'))
			.set('page', firstPage(pick(item, 'pages'))).set('year', pick(item, 'dateEnacted', 'date'))
			.inline(item).url(item);
		return [withExtras(item, d)];
	}
	if (t === 'bill') {
		var congress = congressOf(item);
		if (!congress) return [withExtras(item, webpage(item, key, 'bill without a Congress number (fill in Session), cited as a web page')[0])];
		d = new Def('bill', key);
		d.title('name', pick(item, 'title')).set('number', pick(item, 'billNumber'))
			.set('congress', congress).set('year', dateOf(item)).inline(item).url(item);
		return [withExtras(item, d)];
	}
	if (t === 'statute' && (dt === 'statcode' || extraParams(item).length) && pick(item, 'code') && pick(item, 'section')) {
		// keyword form, so that origsect / year / name can be given
		d = new Def(codeType(item), key);
		d.set('name', pick(item, 'nameOfAct')).set('vol', pick(item, 'codeNumber', 'volume'))
			.set('rep', pick(item, 'code')).set('page', pick(item, 'section')).inline(item);
		return [withExtras(item, d)];
	}

	if (t === 'document' && !dt && phoenixOn() && legalOf(item).xtype === 'treaty') return [withExtras(item, treatyDef(item, key))];

	var defs = emitBase(item, key);
	// the Extra parameters go on the ordinary definitions too (case, jrnart, book, ...)
	if (extraParams(item).length && defs.length === 1 && defs[0] instanceof Def) withExtras(item, defs[0]);
	return defs;
}

// Web pages, and the catch-all for types without a better hicite equivalent.
function webpage(item, key, note) {
	var d = new Def('website', key);
	if (note) d.note = note;
	var site = pick(item, 'websiteTitle', 'publicationTitle', 'blogTitle', 'forumTitle', 'programTitle', 'publisher');
	d.names(item, 'author', 'author', 'instauth', maxAuthors())
		.title('title', pick(item, 'title', 'nameOfAct', 'caseName'))
		.set('title', pick(item, 'title', 'nameOfAct', 'caseName') ? '' : pick(item, 'url')) // hicite needs a title: an untitled page is cited by its address
		.pub('journal', siteRepeatsAuthor(item, site) ? '' : site)
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
		itemLanguage = String(it.language || '');
		var title = pick(it, 'title', 'caseName', 'nameOfAct').replace(/\s+/g, ' ');
		if (!title && !pick(it, 'url') && !(it.creators || []).length) { // an empty item: nothing hicite could cite
			Zotero.write('% hicite: skipped ' + keys[i] + ' (the item has no title, creators or URL)\n\n');
			return;
		}
		Zotero.write('% ' + title + '\n');
		emit(it, keys[i]).forEach(function (def) { Zotero.write(def.toString() + '\n'); });
	});
}
