// The hicite-only types and Extra parameters: what the translator emits, and that the catalog
// (addon/hicite-types.json) matches both the translator and the Zotero schema.
load('test/run.js');
var src = read('addon/translator/hicite.js'), items = JSON.parse(read('test/sample-items.json')), errors = [];
var out = runTranslator(src, items, {}, {});
function entry(key) { var m = new RegExp('\\\\def[a-z]+\\{' + key + '\\}\\{[\\s\\S]*?\\n\\}\\n').exec(out); return m ? m[0] : ''; }
function has(s, sub, m) { if (s.indexOf(sub) < 0) errors.push(m + ': missing ' + JSON.stringify(sub) + ' in ' + JSON.stringify(s)); }
function hasNot(s, sub, m) { if (s.indexOf(sub) >= 0) errors.push(m + ': unexpected ' + JSON.stringify(sub)); }

var e = entry('trumpeo');
has(e, '\\defgovdoc{trumpeo}', 'govdoc'); has(e, 'name={Ensuring a National Policy Framework}', 'name'); has(e, 'instauth={The White House}', 'institution author');
has(e, 'vol={90}', 'vol from Extra'); has(e, 'rep={Fed. Reg.}', 'rep'); has(e, 'number={Exec. Order No. 14365}', 'number'); has(e, 'year={', 'date -> year');
e = entry('angwincomplaint'); has(e, '\\defcasedoc{', 'casedoc'); has(e, 'citation={case: {parties=', 'citation is raw hicite'); has(e, 'name={Complaint}', 'name');
has(entry('aimoratorium'), '\\defcongrec{aimoratorium}', 'congrec'); has(entry('aimoratorium'), 'page={S4066}', 'congrec page');
has(entry('progressclause'), '\\defconst{progressclause}', 'const'); has(entry('firstamend'), '\\defconstamend{firstamend}', 'constamend'); has(entry('firstamend'), 'number={1}', 'constamend number');
e = entry('utsa'); has(e, '\\defmodelcode{utsa}', 'modelcode'); has(e, 'instauth={Uniform Law Commission}', 'modelcode instauth');
e = entry('naiia'); has(e, '\\defstatsess{naiia}', 'statsess'); has(e, 'number={116-283}', 'publicLawNumber'); has(e, 'vol={134}', 'volume'); has(e, 'rep={Stat.}', 'session laws'); has(e, 'page={4523}', 'pages'); has(e, '    slip,', 'flag'); has(e, 'type={Pub. L. No.}', 'type');
e = entry('cda230'); has(e, '\\defstatcode{cda230}', 'statcode keyword form'); has(e, 'page={230}', 'section'); has(e, 'origsect={509}', 'origsect'); has(e, 'year={2018}', 'year');
e = entry('nofakes'); has(e, '\\defbill{nofakes}', 'bill'); has(e, 'number={S. 1367}', 'number'); has(e, 'congress={119}', 'congress'); has(e, 'status={introduced}', 'status');
e = entry('doeroe'); has(e, '\\defcase{doeroe}', 'case'); has(e, '    enbanc,', 'enbanc flag'); hasNot(e, 'percuriam', 'flag "no" omitted'); has(e, 'dbid={2024 WL 1}', 'dbid');
has(entry('gordon1982'), 'type={Note}', 'jrnart type'); has(entry('skinner2020'), 'number={2}', 'book number');
hasNot(out, 'hicite-', 'no Extra line leaks into the output');

// The catalog: every field that names a Zotero field exists in that Zotero type (both schemas)
var cat = JSON.parse(read('test/legal-types.json'));
['schema9', 'schema10'].forEach(function (n) {
	var path = 'test/' + n + '.json';
	var schema; try { schema = JSON.parse(read(path)); } catch (x) { return; } // schemas are fetched by test/fetch-schema.sh
	var T = {}; schema.itemTypes.forEach(function (t) { T[t.itemType] = t; });
	cat.types.forEach(function (t) {
		if (!T[t.base]) return errors.push(n + ': no Zotero type ' + t.base);
		t.fields.forEach(function (f) {
			if (!f.z) return;
			var m = /^creator:(.+)$/.exec(f.z);
			var ok = m ? T[t.base].creatorTypes.some(function (c) { return c.creatorType === m[1]; }) : T[t.base].fields.some(function (x) { return x.field === f.z; });
			if (!ok) errors.push(n + ': ' + t.id + '.' + f.p + ' -> ' + f.z + ' is not in Zotero ' + t.base);
		});
	});
});
// ... and each virtual type has a translator branch, each Extra parameter is exported
cat.types.forEach(function (t) {
	var id = 'zz' + t.id, extra = 'hicite-doctype: ' + t.id + '\n', item = { itemType: t.base, title: 'T ' + t.id, extra: '' };
	t.fields.forEach(function (f) { if (!f.z) extra += 'hicite-' + f.p + ': ' + (f.flag ? 'yes' : 'v_' + f.p) + '\n'; });
	item.extra = (t.virtual || t.id === 'statsess' ? extra : extra.replace(/hicite-doctype:.*\n/, '')) + 'Citation Key: ' + id;
	if (t.base === 'statute') { item.code = 'U.S.C.'; item.section = '1'; item.codeNumber = '1'; }
	var o = runTranslator(src, [item], {}, {});
	var m = /\\def([a-z]+)\{/.exec(o);
	if (!m || (t.id !== 'website' && t.id !== 'magart' && m[1] !== t.id)) errors.push(t.id + ': exported as \\def' + (m && m[1]));
	t.fields.forEach(function (f) { if (!f.z && o.indexOf(f.p + (f.flag ? ',' : '={')) < 0) errors.push(t.id + ': Extra param ' + f.p + ' not exported'); });
});
print(errors.length ? 'TYPES FAILED\n' + errors.join('\n') : 'types OK');
