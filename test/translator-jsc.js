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

print(errors.length ? 'FAIL\n' + errors.join('\n') : 'translator OK (preprints, containers, names, urls, cases, keys, each setting)');
