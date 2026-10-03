// Assertions about what the export translator emits (rules learned from a real hand-coded
// hicite file), including that each setting switches its rule off.
load('test/run.js');
var src = read('addon/translator/hicite.js'), items = JSON.parse(read('test/sample-items.json')), errors = [];
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(m + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
function has(s, sub, m) { if (String(s).indexOf(sub) < 0) errors.push(m + ': missing ' + JSON.stringify(sub)); }
function hasNot(s, sub, m) { if (String(s).indexOf(sub) >= 0) errors.push(m + ': unexpected ' + JSON.stringify(sub)); }
function run(settings, opts, subset) { return runTranslator(src, subset || items, opts || {}, settings || {}); }
function entry(out, key) { var m = new RegExp('\\\\def[a-z]+\\{' + key + '\\}\\{[\\s\\S]*?\\n\\}\\n').exec(out); return m ? m[0] : ''; }
function one(pred, settings) { return run(settings, {}, items.filter(pred)); }
var out = run();

// preprints -> workingpaper
var e = entry(out, 'vaswani2023');
has(e, '\\defworkingpaper{vaswani2023}', 'preprint is a workingpaper'); has(e, 'number={1706.03762}', 'number = Archive ID without "arXiv:"'); has(e, 'publisher={arXiv}', 'publisher = repository');
has(e, 'date={aug 2 2023}', 'full date'); has(e, 'url={http://arxiv.org/abs/1706.03762}', 'preprint keeps its URL'); has(e, 'inline={Attention}', 'Short Title -> inline');
has(entry(out, 'author2019'), 'number={1909.01285}', 'arXiv id taken from the URL (version stripped)');
has(entry(out, 'bednar2026'), 'number={6525800}', 'SSRN id taken from the URL');
has(entry(out, 'wen2020'), '\\defwebsite{wen2020}', 'preprint with no identifier falls back to a web page');

// conference paper / encyclopedia / book section -> citecontainer with an inline container
e = entry(out, 'brants2007');
has(e, '\\defcitecontainer{brants2007}', 'conference paper is a citecontainer'); has(e, 'in=book: {', 'inline container reference'); has(e, 'title={Proceedings of EMNLP-CoNLL}', 'container title = proceedings');
has(e, 'editor={Jason {Eisner}}', 'editors go in the container'); has(e, 'year={2007}', 'year on the paper'); hasNot(e, 'url=', 'URL dropped when the paper has pages');
has(entry(out, 'talk2001'), 'url={http://proceedings.mlr.press/r3/x.html}', 'URL kept when there are no pages');
e = entry(out, 'graham2023'); has(e, 'year={2023}', 'encyclopedia year in the container'); eq(/\n    year=/.test(e), false, 'no year on the encyclopedia article itself');
hasNot(out, '-book}', 'no separate "-book" definitions any more');

// people vs institutions among single-field names
has(entry(out, 'haigh2024'), 'author={Thomas {Haigh}}', 'single-field person parsed as a person'); has(entry(out, 'openai2024'), 'instauth={OpenAI}', 'single word = institution');
has(entry(out, 'anthropicpbc2025'), 'instauth={Anthropic PBC}', 'PBC = institution'); has(entry(out, 'centerforaisafety2023'), 'instauth={Center for AI Safety}', 'institution words');
e = entry(out, 'vanmerrienboer2018'); has(e, 'author={Bart {van Merrienboer}}', 'particle joins the family name'); has(e, 'author={Dean {Edmonds {Jr.}}}', 'suffix kept with the family name');

// website title omitted when it repeats the author
hasNot(entry(out, 'openai2024'), 'journal=', 'site title equal to the author is omitted'); hasNot(entry(out, 'anthropicpbc2025'), 'journal=', 'site title contained in the author is omitted');
has(entry(out, 'centerforaisafety2023'), 'journal={Something Else}', 'a different site title is kept'); has(entry(out, 'haigh2024'), 'journal={Communications of the ACM}', 'site title kept');

// URL rules
has(entry(out, 'line2024'), 'url=', 'journal article without volume/pages keeps its URL'); hasNot(entry(out, 'er2001'), 'url=', 'journal article with volume and pages drops it');

// cases
e = entry(out, 'grokster'); has(e, 'p={Metro-Goldwyn-Mayer Studios Inc.}', 'first party'); has(e, 'd={Grokster, Ltd.}', 'second party'); has(e, 'inline={Grokster}', 'Short Title -> inline'); hasNot(e, 'court=', 'no court for U.S. Reports');
has(entry(out, 'garcia'), 'd={Character Technologies Inc.}', '"v" without a period splits too'); hasNot(entry(out, 'garcia'), 'url=', 'case with a reporter has no URL');
has(entry(out, 'doe'), 'url=', 'case without a reporter keeps its URL'); has(entry(out, 'doe'), 'docket={24-7700}', 'docket');
has(entry(out, 'inrenimitztechnologies'), 'name={In re Nimitz Technologies LLC}', 'no " v. ": a single name');
eq(/\\defcase\{(grokster|garcia|doe|inrenimitztechnologies)\}/g.test(out), true, 'case keys: Short Title / first party, no year');

// keys
eq(/\\def[a-z]+\{(wheaton|griswold1934|nimmer2014)\}/.test(out), true, 'author+year keys for other types');

// settings switch each rule off
has(one(function (i) { return i.title === 'Attention Is All You Need'; }, { shortTitleInline: false }), 'title={Attention Is All You Need}', 'sanity');
hasNot(one(function (i) { return i.title === 'Attention Is All You Need'; }, { shortTitleInline: false }), 'inline=', 'shortTitleInline off');
hasNot(one(function (i) { return i.title === 'Attention Is All You Need'; }, { includeUrls: false }), 'url=', 'includeUrls off');
has(one(function (i) { return i.title === 'Memory and New Controls'; }, { omitRedundantSite: false }), 'journal={OpenAI}', 'omitRedundantSite off keeps the site title');
has(one(function (i) { return i.caseName === 'Metro-Goldwyn-Mayer Studios Inc. v. Grokster, Ltd.'; }, { caseKeys: 'nameyear' }), '\\defcase{metrogoldwynmayer2005}', 'caseKeys "nameyear": first word + year');
has(one(function (i) { return i.caseName === 'Garcia v Character Technologies Inc.'; }), '\\defcase{garcia}', 'caseKeys default');

// key source: own vs adopt Better BibTeX's native key
var withNative = [{ itemType: 'book', title: 'A Book', creators: [{ creatorType: 'author', name: 'Thomas Haigh', fieldMode: 1, lastName: 'Thomas Haigh', firstName: '' }], date: '2020', citationKey: 'thomashaigh2020' }];
has(run({}, {}, withNative), '\\defbook{haigh2020}', 'own: generates lastname+year, ignores the native key');
has(run({ keySource: 'adopt' }, {}, withNative), '\\defbook{thomashaigh2020}', 'adopt: uses the native key when hicite can use it');
has(run({ keySource: 'adopt' }, {}, [Object.assign({}, withNative[0], { citationKey: '2020' })]), '\\defbook{haigh2020}', 'adopt: an unusable native key ("2020") is ignored');
has(run({}, {}, [Object.assign({}, withNative[0], { extra: 'Citation Key: pinned1' })]), '\\defbook{pinned1}', 'an Extra pin always wins');

// publisher option still works
has(run({}, { 'Include publisher': true }, items.filter(function (i) { return i.title === 'Nimmer on Copyright & Related Things'; })), 'publisher={LexisNexis}', 'Include publisher');

// author cap
var many = function (t) { return items.filter(function (i) { return i.title === t; }); };
var e6 = entry(run({}, {}, many('Many authors')), 'alpha2020');
eq((e6.match(/    author=/g) || []).length, 6, 'default lists every author'); hasNot(e6, 'et al.', 'no "et al." by default');
var c3 = entry(run({ maxAuthors: '3' }, {}, many('Many authors')), 'alpha2020');
eq((c3.match(/    author=/g) || []).length, 3, 'cap 3 lists three authors'); has(c3, 'author={Cy {Gamma} et al.},', 'the last listed author gets " et al."'); hasNot(c3, 'Delta', 'the rest are left out');
var c1 = entry(run({ maxAuthors: '1' }, {}, many('Many authors')), 'alpha2020'); has(c1, 'author={Ada {Alpha} et al.},', 'cap 1 = first author et al.');
hasNot(entry(run({ maxAuthors: '3' }, {}, many('Two authors only')), 'one2019'), 'et al.', 'fewer authors than the cap: no "et al."');
has(entry(run({ maxAuthors: '2' }, {}, many('Institutional authors')), 'alphacommittee2020'), 'instauth={Beta Office et al.},', 'institutions get "et al." appended to the name');
var ed = entry(run({ maxAuthors: '1' }, {}, many('An edited volume')), 'writer2018'); eq((ed.match(/    editor=/g) || []).length, 4, 'editors are never capped'); hasNot(ed, 'et al.', 'a single author is not shortened');
has(entry(run({ maxAuthors: 'banana' }, {}, many('Many authors')), 'alpha2020'), 'author={Flo {Zeta}},', 'an invalid cap means "all"');
var pre = items.filter(function (i) { return i.title === 'Attention Is All You Need'; });
has(run({ maxAuthors: '1' }, {}, pre), 'author={Ashish {Vaswani} et al.}', 'the cap applies to preprints too'); hasNot(run({ maxAuthors: '2' }, {}, pre), 'et al.', 'exactly as many authors as the cap: no "et al."');

// name forms
e = entry(out, 'dzieza2021');
has(e, 'author={Josh {Dzieza}}', '"Last, First" read as inverted'); has(e, 'author={Thomas E. {Hill {Jr.}}}', '"Name, Jr." keeps the suffix'); has(e, 'author={Ruairi {Robinson}}', '[@handle] dropped');
has(e, 'author={Meredith Filak {Rose}}', 'trailing ";" dropped, multi-word given name');
has(entry(out, 'universityofcaliforniasandiego2022'), 'instauth={University of California, San Diego}', 'an institution with a comma stays an institution');

// translators (hicite files them under "editor", labelled with edtype)
e = entry(out, 'barthes1977');
has(e, 'editor={Stephen {Heath}},', 'translator listed in the container'); has(e, 'edtype={trans.},', 'labelled "trans."'); hasNot(e, 'paren=', 'no parenthetical needed');
e = entry(out, 'chekhov1977'); has(e, 'editor={Eugene K. {Bristow}},', 'editor who also translated: listed once'); has(e, 'edtype={ed. \\& trans.},', 'labelled "ed. & trans."'); eq((e.match(/editor=/g) || []).length, 1, 'the same person is not listed twice');
e = entry(out, 'author2001'); eq((e.match(/    editor=/g) || []).length, 2, 'two editors, listed once each'); has(e, 'edtype={eds. \\& trans.},', 'plural label when several edited and translated');
e = entry(out, 'writer1999'); has(e, 'editor={Ed {One}},', 'the editor'); has(e, 'paren={Tom Trans \\& Sue Two trans.},', 'a different translator goes in a parenthetical'); hasNot(e, 'edtype=', 'no role label needed');
e = entry(out, 'scribe1990'); has(e, 'editor={Tom {Trans}},', 'translator of a book'); has(e, 'edtype={trans.},', 'labelled "trans." in a book');
e = entry(out, 'composer1995'); has(e, 'editor={Ed {Reviser}},', 'editor of a book'); has(e, 'paren={Tom Renderer trans.},', 'a book\'s different translator in a parenthetical');
e = entry(out, 'brants2007'); hasNot(e, 'edtype=', 'editors alone need no label'); hasNot(e, 'paren=', 'and no parenthetical');
e = entry(run({ maxAuthors: '1' }, {}, items.filter(function (i) { return i.title === 'Editor and different translators'; })), 'writer1999'); has(e, 'Sue Two trans.', 'the author cap does not shorten translators');


// ---- rules learned from migrating a hand-coded hicite file (ai-refs.tex) to the generated library
function mk(o) { o.creators = o.creators || []; return o; }
function person(f, l, t) { return { creatorType: t || 'author', firstName: f, lastName: l }; }
function gen(item, settings, opts) { return run(settings, opts, [mk(item)]); }

// accents become TeX macros (hicite builds control sequences from journal names, institutions, case names)
e = gen({ itemType: 'journalArticle', title: 'Über formal unentscheidbare Sätze der Principia Mathematica und verwandter Systeme I', publicationTitle: 'Monatshefte für Mathematik und Physik',
	volume: '38', pages: '173-198', date: '1931', creators: [person('Kurt', 'Gödel')], extra: 'Citation Key: godel1931' });
has(e, 'rep={Monatshefte f{\\"u}r Mathematik und Physik}', 'accented journal name as a TeX macro'); has(e, 'author={Kurt {G{\\"o}del}}', 'accented author as a TeX macro');
has(e, 'title={{\\"U}ber formal unentscheidbare', 'a German title is not given English title case');
has(gen({ itemType: 'case', caseName: 'In re Théâtre D’opéra Spatial', extra: 'Citation Key: theatre' }), 'name={In re Th{\\\'e}{\\^a}tre D\'op{\\\'e}ra Spatial}', 'accents and curly apostrophe in a case name');
has(gen({ itemType: 'book', title: 'It’s “quoted” — a dash', date: '2000', extra: 'Citation Key: q' }), "title={It's ``Quoted'' --- A Dash}", 'curly quotes and dashes become TeX ligatures');
e = gen({ itemType: 'conferencePaper', title: 'Stochastic Parrots 🦜', proceedingsTitle: 'Proc.', date: '2021', extra: 'Citation Key: parrots' });
has(e, 'name={Stochastic Parrots},', 'emoji dropped, no trailing space');

// three or more names carry "noetal" (hicite warns without it); fewer do not
e = entry(run({}, {}, many('Many authors')), 'alpha2020'); has(e, '    noetal,', 'noetal with 3+ authors');
hasNot(entry(run({}, {}, many('Two authors only')), 'one2019'), 'noetal', 'no noetal with two authors');

// Bluebook title case; mixed-case words and an already title-cased title are left alone
function title(t, settings) { var m = /title=\{([^}]*(?:\{[^}]*\}[^}]*)*)\},/.exec(gen({ itemType: 'book', title: t, date: '2000', extra: 'Citation Key: t' }, settings)); return m ? m[1] : ''; }
eq(title('Finding structure in time'), 'Finding Structure in Time', 'sentence case becomes title case');
eq(title('Learning long-term dependencies with gradient descent is difficult'), 'Learning Long-Term Dependencies with Gradient Descent Is Difficult', 'hyphenated words, "is" capitalized');
eq(title('Why do humans reason? arguments for an argumentative theory'), 'Why Do Humans Reason? Arguments for an Argumentative Theory', 'first word after a question mark');
eq(title('The iPhone and arXiv: a GPT-4 study'), 'The iPhone and arXiv: A GPT-4 Study', 'mixed-case words and the word after a colon');
eq(title('LAWBREAKING AS A METHOD OF COMPETITION'), 'Lawbreaking as a Method of Competition', 'all capitals');
eq(title('Attention Is All You Need'), 'Attention Is All You Need', 'already title case');
eq(title('Finding structure in time', { titleCase: false }), 'Finding structure in time', 'titleCase off');
has(gen({ itemType: 'journalArticle', title: 'T', publicationTitle: 'the bulletin of mathematical biophysics', volume: '5', pages: '115', date: '1943', extra: 'Citation Key: b' }), 'rep={The Bulletin of Mathematical Biophysics}', 'journal names get title case too');

// court papers are \defcasedoc; a reported case is dated by its year alone; a slip opinion gets "slip"
e = gen({ itemType: 'case', caseName: 'Complaint: Carrier v. OpenAI Foundation', docketNumber: 'CGC26637791', court: 'Cal.', dateDecided: '2026-06-11', extra: 'Citation Key: carrier' });
has(e, '\\defcasedoc{carrier}', 'a complaint is a casedoc'); has(e, 'citation=case: {', 'with the case as an anonymous reference'); has(e, 'p={Carrier},', 'parties'); has(e, 'name={Complaint},', 'document name'); has(e, 'year={jun 11 2026},', 'document date');
e = gen({ itemType: 'case', caseName: 'Order Granting Final Approval of Class Action Settlement, Bartz v. Anthropic PBC', docketNumber: '24-cv-05417', court: 'N.D. Cal.', dateDecided: '2026-07-20', extra: 'Citation Key: bartzorder' });
has(e, 'name={Order Granting Final Approval of Class Action Settlement},', 'the paper name is everything before the comma'); has(e, 'd={Anthropic PBC},', 'party');
e = gen({ itemType: 'case', caseName: 'Apple, Inc. v. Liu', shortTitle: 'Complaint', docketNumber: '26-cv-07078', court: 'N.D. Cal.', extra: 'Citation Key: liu' });
has(e, '\\defcasedoc{liu}', 'Short Title "Complaint" makes a casedoc'); hasNot(e, 'inline=', 'and is not also the short form');
has(gen({ itemType: 'case', caseName: 'Order of Railroad Telegraphers v. Railway Express Agency', reporterVolume: '321', reporter: 'U.S.', firstPage: '342', dateDecided: '1944-01-01', extra: 'Citation Key: ort' }), '\\defcase{ort}', 'a case that merely starts with "Order" is still a case');
e = gen({ itemType: 'case', caseName: 'Metro-Goldwyn-Mayer Studios Inc. v. Grokster, Ltd.', reporterVolume: '545', reporter: 'U.S.', firstPage: '913', dateDecided: '2005-06-27', extra: 'Citation Key: g' });
has(e, 'year={2005},', 'a reported case is dated by year only');
e = gen({ itemType: 'case', caseName: 'Thompson v. Ross', reporter: 'Slip Op.', docketNumber: '25-2153', court: '3d Cir.', dateDecided: '2026-09-29', extra: 'Citation Key: slip' });
has(e, '    slip,', 'slip opinion flag'); hasNot(e, 'rep=', 'no reporter for a slip opinion'); has(e, 'year={sep 29 2026},', 'a slip opinion keeps its full date');
has(gen({ itemType: 'case', caseName: 'Doe v. Github', docketNumber: '24-7700', court: '9th Cir.', dateDecided: '2026-09-16', extra: 'Citation Key: doe2' }), 'year={sep 16 2026},', 'an unreported case keeps its full date');

// bills need a Congress: Session, else the URL / text, else the date
has(gen({ itemType: 'bill', title: 'NO FAKES Act', billNumber: 'S.1367', date: '2025-04-09', url: 'https://www.congress.gov/bill/119th-congress/senate-bill/1367/text', extra: 'Citation Key: nf' }), 'congress={119},', 'Congress from the URL');
has(gen({ itemType: 'bill', title: 'A Bill', billNumber: 'H.R. 1', date: '2021-03-01', extra: 'Citation Key: hr1' }), 'congress={117},', 'Congress from the date');
has(gen({ itemType: 'bill', title: 'A Bill', billNumber: 'H.R. 1', session: '116', date: '2021-03-01', extra: 'Citation Key: hr2' }), 'congress={116},', 'the Session field wins');
has(gen({ itemType: 'bill', title: 'A Bill', billNumber: 'H.R. 1', extra: 'Citation Key: hr3' }), '\\defwebsite{hr3}', 'no way to tell the Congress: a web page');

// journal articles hicite cannot cite as articles
e = gen({ itemType: 'journalArticle', title: 'Improving Language Understanding by Generative Pre-Training', creators: [person('Alec', 'Radford')], extra: 'Citation Key: radford' });
has(e, '\\defwebsite{radford}', 'no publication title: a web page'); has(e, '% hicite: journal article with no publication title', 'with a note');
has(gen({ itemType: 'journalArticle', title: 'A Blog Post', publicationTitle: 'Lawfare', url: 'https://x.org/a', date: '2025-01-28', extra: 'Citation Key: lf' }), '\\defwebsite{lf}', 'web article without volume or pages');
has(gen({ itemType: 'journalArticle', title: 'Coming Soon', publicationTitle: 'Yale Law Journal', url: 'https://x.org/a', date: '2026', extra: 'Status: forthcoming\nCitation Key: ylj' }), 'page={forthcoming}', 'forthcoming article stays an article');


// a very long author list is cut to the first two names and "et al." unless the setting says never
var longList = { itemType: 'preprint', title: 'A Paper With Many Authors', archiveID: 'arXiv:1234.56789', date: '2020', extra: 'Citation Key: lots', creators: [] };
'ABCDEFGHIJ'.split('').forEach(function (c) { longList.creators.push(person('F' + c, 'L' + c)); });
e = gen(longList);
eq((e.match(/    author=/g) || []).length, 2, 'ten authors: two listed by default'); has(e, 'author={FB {LB} et al.},', 'the second gets "et al."'); hasNot(e, 'noetal', 'no noetal for a shortened list of two');
eq((gen(longList, { longLists: '0' }).match(/    author=/g) || []).length, 10, 'longLists 0 = never shorten');
eq((gen(longList, { longLists: '10' }).match(/    author=/g) || []).length, 10, 'a list no longer than the limit is kept whole');
eq((gen(longList, { maxAuthors: '4' }).match(/    author=/g) || []).length, 4, 'an explicit cap wins');


// <i> in a title or in an Extra value becomes \emph; never in names or journal names
e = gen({ itemType: 'journalArticle', title: 'Review of <i>Verbal Behavior</i> &amp; More', publicationTitle: 'Journal of <i>X</i>', volume: '1', pages: '2', date: '1959', creators: [person('N', 'Chomsky')], extra: 'hicite-hereinafter: Chomsky, Review of <i>Verbal Behavior</i>\nCitation Key: ital' });
has(e, 'title={Review of \\emph{Verbal Behavior} \\& More},', 'italics in a title'); has(e, 'rep={Journal of X},', 'no markup in a journal name'); has(e, 'hereinafter={Chomsky, Review of \\emph{Verbal Behavior}},', 'italics in an Extra parameter');
has(gen({ itemType: 'book', title: 'A <b>bold</b> <span class="x">word</span>', date: '2000', extra: 'Citation Key: tags' }), 'title={A Bold Word},', 'other tags are dropped');

// letters
e = gen({ itemType: 'letter', title: 'Re: Zarya of the Dawn', date: '2023-02-21', creators: [{ creatorType: 'author', name: 'United States Copyright Office', fieldMode: 1, lastName: 'United States Copyright Office' }, { creatorType: 'recipient', firstName: 'Van', lastName: 'Lindberg' }], extra: 'Citation Key: zarya' });
has(e, '\\defletter{zarya}', 'letter with a sender and recipient'); has(e, 'instauth={United States Copyright Office}', 'institutional sender'); has(e, 'to={Van Lindberg}', 'recipient');
has(gen({ itemType: 'letter', title: 'Anonymous', extra: 'Citation Key: anon' }), '\\defmanuscript{anon}', 'a letter with no sender or recipient stays a manuscript');

// Federal Register entries filed as statutes; the Constitution
e = gen({ itemType: 'statute', nameOfAct: 'Executive Order No. 14110 of Oct. 30, 2023: Safe, Secure, and Trustworthy Development and Use of Artificial Intelligence', code: 'Federal Register', codeNumber: '88', pages: '75191', dateEnacted: '2023-11-01', extra: 'Citation Key: eo' });
has(e, '\\defgovdoc{eo}', 'executive order is a govdoc'); has(e, 'number={Exec. Order No. 14110},', 'order number'); has(e, 'name={Safe, Secure, and Trustworthy Development and Use of Artificial Intelligence},', 'name without the order number'); has(e, 'rep={Fed. Reg.},', 'reporter'); has(e, 'vol={88},', 'volume'); has(e, 'page={75191},', 'page');
has(gen({ itemType: 'statute', nameOfAct: 'U.S. Const. Art. I, §8, cl. 8', extra: 'Citation Key: c1' }), 'page={article I, S 8, clause 8},', 'constitutional provision');
has(gen({ itemType: 'statute', nameOfAct: 'U.S. Const. amend. XIV', extra: 'Citation Key: c2' }), 'number={14},', 'amendment number from Roman numerals');
has(gen({ itemType: 'statute', nameOfAct: 'Subject matter of copyright: In general', code: 'U.S.C.', codeNumber: '17', section: '102', url: 'https://x.org/s', extra: 'Citation Key: s102' }), '\\defstatcode{s102}{17 U.S.C. S 102}', 'a bare section is hicite\'s one-line form');
e = gen({ itemType: 'statute', nameOfAct: 'Ensuring Likeness, Voice, and Image Security Act', shortTitle: 'ELVIS Act', code: 'Tenn. C.', codeNumber: '47', section: '1-101', dateEnacted: '2024', url: 'https://x.org/s', extra: 'Citation Key: elvis' });
has(e, 'name={Ensuring Likeness, Voice, and Image Security Act},', 'a named act keeps its name'); has(e, 'rep={Tenn. C.},', 'code'); has(e, 'vol={47},', 'title'); has(e, 'page={S 1-101},', 'section, with the section sign'); has(e, 'inline={ELVIS Act},', 'short form'); has(e, 'year={2024},', 'year'); hasNot(e, 'url=', 'a codified section drops its URL');
has(gen({ itemType: 'statute', nameOfAct: 'Copyright Registration Guidance', code: 'C.F.R.', codeNumber: '88', section: '16190', pages: '16190', dateEnacted: '2023-03-16', extra: 'Citation Key: crg' }), 'rep={Fed. Reg.},', 'a C.F.R. item with a page is a Federal Register document');

has(run({}, {}, [mk({ itemType: 'webpage', extra: 'Citation Key: empty1' })]), '% hicite: skipped empty1', 'an empty item is skipped, not exported as an invalid definition');

has(gen({ itemType: 'webpage', url: 'https://x.org/photo?id=1', extra: 'Citation Key: bare' }), 'title={https://x.org/photo?id=1},', 'an untitled web page is cited by its URL');

// editions, placeholder pages
e = gen({ itemType: 'bookSection', title: 'Hilbert’s Program', bookTitle: 'The Stanford Encyclopedia of Philosophy', edition: 'Spring 2023', date: '2023', creators: [person('Richard', 'Zach'), person('Edward N.', 'Zalta', 'editor')], extra: 'Citation Key: zach' });
has(e, 'year={Spring 2023},', 'a seasonal edition is the container date'); hasNot(e, 'edition=', 'and not an edition number');
hasNot(gen({ itemType: 'bookSection', title: 'T', bookTitle: 'B', pages: '0', date: '2013', creators: [person('A', 'B')], extra: 'Citation Key: p0' }), 'page=', 'page "0" is ignored');

print(errors.length ? 'FAIL\n' + errors.join('\n') : 'translator OK (preprints, containers, names, urls, cases, keys, each setting)');
