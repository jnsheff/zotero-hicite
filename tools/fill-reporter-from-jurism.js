/*
 * One-off migration for Case items that came from Juris-M (no longer supported).
 *
 * hicite needs, for each case, a reporter (e.g. "F.3d") and a court written in
 * Bluebook abbreviation (e.g. "2d Cir.", "S.D.N.Y."). This add-on reads only
 * Zotero's native Reporter and Court fields. Juris-M stored things differently:
 *
 *   Extra:   mlzsync1:0103{"extrafields":{"reporter":"U.S.","jurisdiction":"005us:c2United States|US|Second Circuit"}}
 *   Court:   an internal ID such as "court.appeals", "district.court" or "supreme.court"
 *
 * This script
 *   1. fills an empty Reporter from the legacy block;
 *   2. optionally infers a reporter when the court makes it near-certain and the
 *      case has a volume and page (Supreme Court -> "U.S.");
 *   3. replaces Juris-M court IDs with Bluebook abbreviations, using the case's
 *      legacy jurisdiction to pick the circuit or district
 *      ("court.appeals" + us:c2 -> "2d Cir."; "district.court" + us:c2:ny.sd -> "S.D.N.Y.");
 *   4. optionally rewrites free-text courts ("United States Court of Appeals,
 *      Federal Circuit" -> "Fed. Cir.").
 *
 * HOW TO RUN (in Zotero 9/10): Tools > Developer > Run JavaScript, paste this
 * whole file, tick "Run as async function", and press Run (Cmd-R).
 *
 *   1. Leave MODE = 'dry-run' and read the report. Nothing is changed.
 *   2. Back up your data: quit Zotero and copy ~/Zotero/zotero.sqlite somewhere
 *      safe. Then set I_HAVE_A_BACKUP = true and MODE = 'apply'.
 *   3. To undo: set MODE = 'revert'. It undoes the most recent apply (using its log
 *      file) and then retires that log; run it again to step back one more apply.
 *
 * Safety:
 *  - Nothing is overwritten with a guess: an existing Reporter is never changed;
 *    a court is only rewritten when it can be translated with certainty, and
 *    everything else is listed in the report as "unresolved".
 *  - The Extra field is left as is.
 *  - Shared GROUP libraries are skipped unless INCLUDE_GROUPS = true, because
 *    editing them changes data for the other members and syncs to them.
 *    Read-only libraries are always skipped.
 *  - A log of every change (old and new values) is written to the Zotero data
 *    directory BEFORE any item is modified, and 'revert' only restores fields that
 *    still hold the value this script set.
 *  - "Date Modified" is not updated.
 */

const MODE = 'dry-run';               // 'dry-run' | 'apply' | 'revert'
const I_HAVE_A_BACKUP = false;        // must be true for MODE = 'apply'
const INCLUDE_GROUPS = false;         // true: also edit shared group libraries
const ONLY_LIBRARY_IDS = null;        // e.g. [1] to restrict to specific libraries

const FILL_REPORTER_FROM_JURISM = true;  // copy the reporter out of the legacy block
const INFER_REPORTER = true;             // Supreme Court + volume + page, no reporter -> "U.S."
const TRANSLATE_COURT_IDS = true;        // "court.appeals" + jurisdiction -> "2d Cir." etc.
const NORMALIZE_TEXT_COURTS = false;     // also rewrite typed-out courts ("... Federal Circuit" -> "Fed. Cir.")

const LOG_PREFIX = 'hicite-reporter-fill-';

// ---------------------------------------------------------------- Juris-M data

// Extract the JSON object of a "mlzsync1:" block from an Extra field.
// Returns { data } on success or { error } (no block / bad JSON / unterminated).
function parseJurism(extra) {
	const m = /mlzsync1:(\d{4})?/.exec(extra || '');
	if (!m) return { error: 'no-block' };
	const start = extra.indexOf('{', m.index + m[0].length);
	if (start < 0) return { error: 'no-json' };
	let depth = 0, inString = false, escaped = false;
	for (let i = start; i < extra.length; i++) {
		const c = extra[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (c === '\\') escaped = true;
			else if (c === '"') inString = false;
		}
		else if (c === '"') inString = true;
		else if (c === '{') depth++;
		else if (c === '}' && --depth === 0) {
			try { return { data: JSON.parse(extra.slice(start, i + 1)) }; }
			catch (e) { return { error: 'bad-json' }; }
		}
	}
	return { error: 'unterminated' };
}

// Juris-M jurisdictions are "<3-digit key length><key><names joined by |>", e.g.
// "011us:c2:ny.sdUnited States|US|Second Circuit|S.D. New York" -> "us:c2:ny.sd".
// A bare key ("us") also occurs.
function jurisdictionKey(j) {
	const s = String(j || '').trim();
	const m = /^(\d{3})(.*)$/s.exec(s);
	if (m) return m[2].slice(0, parseInt(m[1], 10));
	return /^[a-z0-9:.~_-]+$/i.test(s) ? s : '';
}

// -------------------------------------------------------------- Bluebook courts

// state postal code -> [name, Bluebook abbreviation] (Bluebook T10)
const STATES = {
	al: ['Alabama', 'Ala.'], ak: ['Alaska', 'Alaska'], az: ['Arizona', 'Ariz.'], ar: ['Arkansas', 'Ark.'],
	ca: ['California', 'Cal.'], co: ['Colorado', 'Colo.'], ct: ['Connecticut', 'Conn.'], de: ['Delaware', 'Del.'],
	dc: ['District of Columbia', 'D.C.'], fl: ['Florida', 'Fla.'], ga: ['Georgia', 'Ga.'], hi: ['Hawaii', 'Haw.'],
	id: ['Idaho', 'Idaho'], il: ['Illinois', 'Ill.'], in: ['Indiana', 'Ind.'], ia: ['Iowa', 'Iowa'],
	ks: ['Kansas', 'Kan.'], ky: ['Kentucky', 'Ky.'], la: ['Louisiana', 'La.'], me: ['Maine', 'Me.'],
	md: ['Maryland', 'Md.'], ma: ['Massachusetts', 'Mass.'], mi: ['Michigan', 'Mich.'], mn: ['Minnesota', 'Minn.'],
	ms: ['Mississippi', 'Miss.'], mo: ['Missouri', 'Mo.'], mt: ['Montana', 'Mont.'], ne: ['Nebraska', 'Neb.'],
	nv: ['Nevada', 'Nev.'], nh: ['New Hampshire', 'N.H.'], nj: ['New Jersey', 'N.J.'], nm: ['New Mexico', 'N.M.'],
	ny: ['New York', 'N.Y.'], nc: ['North Carolina', 'N.C.'], nd: ['North Dakota', 'N.D.'], oh: ['Ohio', 'Ohio'],
	ok: ['Oklahoma', 'Okla.'], or: ['Oregon', 'Or.'], pa: ['Pennsylvania', 'Pa.'], ri: ['Rhode Island', 'R.I.'],
	sc: ['South Carolina', 'S.C.'], sd: ['South Dakota', 'S.D.'], tn: ['Tennessee', 'Tenn.'], tx: ['Texas', 'Tex.'],
	ut: ['Utah', 'Utah'], vt: ['Vermont', 'Vt.'], va: ['Virginia', 'Va.'], wa: ['Washington', 'Wash.'],
	wv: ['West Virginia', 'W. Va.'], wi: ['Wisconsin', 'Wis.'], wy: ['Wyoming', 'Wyo.'], pr: ['Puerto Rico', 'P.R.'],
};
const STATE_LOOKUP = {}; // "new york" / "n.y." / "ny" / "ny." -> "N.Y."
for (const [code, [name, abbr]] of Object.entries(STATES)) {
	STATE_LOOKUP[name.toLowerCase()] = abbr;
	STATE_LOOKUP[abbr.toLowerCase().replace(/[.\s]/g, '')] = abbr;
	STATE_LOOKUP[code] = abbr;
}
function stateAbbrev(text) {
	const t = String(text || '').toLowerCase().trim().replace(/\.$/, '');
	return STATE_LOOKUP[t] || STATE_LOOKUP[t.replace(/[.\s]/g, '')] || null;
}

const DISTRICT_DESIGNATORS = { d: 'D.', nd: 'N.D.', sd: 'S.D.', ed: 'E.D.', wd: 'W.D.', md: 'M.D.', cd: 'C.D.' };
const SUPREME_REPORTERS = new Set(['U.S.', 'S. Ct.', 'L. Ed.', 'L. Ed. 2d']);

function circuitAbbrev(n) {
	n = Number(n);
	if (!(n >= 1 && n <= 11)) return null;
	return (n === 1 ? '1st' : n === 2 ? '2d' : n === 3 ? '3d' : n + 'th') + ' Cir.';
}

// "S.D." + "N.Y." -> "S.D.N.Y."; "N.D." + "Cal." -> "N.D. Cal." (no space only when the
// state abbreviation is nothing but single capital letters).
function joinDistrict(designator, stateAbbr) {
	return designator + (/^([A-Z]\.)+$/.test(stateAbbr) ? '' : ' ') + stateAbbr;
}

function districtFromKey(key) { // "us:c2:ny.sd" -> "S.D.N.Y."
	const m = /^us:c\d+:([a-z]{2})\.([a-z]{1,2})$/.exec(key);
	if (!m || !STATES[m[1]] || !DISTRICT_DESIGNATORS[m[2]]) return null;
	return joinDistrict(DISTRICT_DESIGNATORS[m[2]], STATES[m[1]][1]);
}

// Translate a Juris-M court ID using the jurisdiction key.
// -> { court, kind } ('supreme' / 'ccpa' are adjusted later using the reporter),
//    or { unresolved: reason }.
function courtFromId(courtId, key) {
	switch (courtId) {
		case 'court.appeals.federal.circuit': return { court: 'Fed. Cir.' };
		case 'court.customs.patent.appeals': return { court: 'C.C.P.A.', kind: 'ccpa' };
		case 'supreme.court':
			return key === 'us' ? { court: 'U.S.', kind: 'supreme' } : { unresolved: 'supreme.court outside the U.S. federal system' };
		case 'court.appeals': {
			// Juris-M numbers the D.C. Circuit "c0" (its district court is us:c0:dc.d) and
			// the Federal Circuit "c".
			if (key === 'us:c0' || key === 'us:cdc') return { court: 'D.C. Cir.' };
			if (key === 'us:c') return { court: 'Fed. Cir.' };
			const m = /^us:c(\d+)$/.exec(key);
			const abbr = m && circuitAbbrev(m[1]);
			return abbr ? { court: abbr } : { unresolved: 'court.appeals without a usable circuit' };
		}
		case 'district.court': {
			const d = districtFromKey(key);
			return d ? { court: d } : { unresolved: 'district.court without a usable district' };
		}
		default:
			return { unresolved: 'unknown court ID' };
	}
}

const ID_LIKE = /^[a-z][a-z0-9]*([.~][a-z0-9]+)*$/;   // Juris-M IDs are lowercase and dotted

const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8,
	ninth: 9, tenth: 10, eleventh: 11 };

// Rewrite a typed-out court in Bluebook form, or null if not recognized.
function normalizeCourtText(text) {
	const s = String(text || '').replace(/\s+/g, ' ').trim();
	const l = s.toLowerCase().replace(/\.$/, '');
	if (!s) return null;
	if (/^(u\.?s\.? )?supreme court( of the united states)?$/.test(l) || l === 'u.s') return { court: 'U.S.', kind: 'supreme' };
	if (/federal circuit/.test(l) || /^fed\. ?cir$/.test(l)) return { court: 'Fed. Cir.' };
	if (/customs and patent appeals/.test(l)) return { court: 'C.C.P.A.', kind: 'ccpa' };
	if (/trademark trial and appeal board/.test(l)) return { court: 'T.T.A.B.' };
	if (/^united states? court of claims$/.test(l)) return { court: 'Ct. Cl.' };
	const ord = '(district of columbia|d\\.? ?c\\.?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|' +
		'\\d{1,2} ?(?:st|nd|rd|th|d))';
	let m = new RegExp('(?:court of appeals[ ,]*(?:for the )?)?\\b' + ord + ' circuit$').exec(l);
	if (m && (/court of appeals/.test(l) || l === m[0])) {
		const w = m[1].replace(/\./g, '').replace(/ /g, '');
		if (w === 'districtofcolumbia' || w === 'dc') return { court: 'D.C. Cir.' };
		const n = ORDINALS[w] || parseInt(w, 10);
		const abbr = circuitAbbrev(n);
		if (abbr) return { court: abbr };
	}
	// "Southern District of New York", "United States District Court, W.D. Wisconsin", "N. D. Cal."
	m = /^(northern|southern|eastern|western|middle|central) district of (.+)$/.exec(l);
	if (m) {
		const desig = { northern: 'N.D.', southern: 'S.D.', eastern: 'E.D.', western: 'W.D.', middle: 'M.D.', central: 'C.D.' }[m[1]];
		const st = stateAbbrev(m[2]);
		return st ? { court: joinDistrict(desig, st) } : null;
	}
	m = /^(?:united states? )?district court,? ([nsewmc])\.? ?d\.? ?(.+)$/.exec(l) || /^([nsewmc])\.? ?d\.? ?(.+)$/.exec(l);
	if (m) {
		const desig = DISTRICT_DESIGNATORS[m[1] + 'd'];
		const st = stateAbbrev(m[2]);
		if (desig && st) return { court: joinDistrict(desig, st) };
	}
	return null;
}

// Court field after taking the reporter into account: a court the reporter already
// identifies is omitted (hicite: "may be omitted if the reporter uniquely identifies the court").
function finalCourt(res, reporter) {
	if (res.kind === 'supreme') return SUPREME_REPORTERS.has(reporter) ? '' : res.court;
	if (res.kind === 'ccpa') return reporter === 'C.C.P.A.' ? '' : res.court;
	return res.court;
}

// Everything the script would change for one case.
//   input: { reporter, court, volume, page, extra }  (Zotero field values)
//   -> { changes: { reporter?: {old,new,how}, court?: {old,new,how} }, notes: [...] }
function planCase(input, options) {
	const o = Object.assign({ fillReporter: true, inferReporter: true, translateIds: true, normalizeText: false }, options);
	const changes = {}, notes = [];
	const { data } = parseJurism(input.extra);
	const ef = (data && data.extrafields) || {};
	const key = jurisdictionKey(ef.jurisdiction);
	const courtOld = String(input.court || '').trim();

	// --- reporter
	let reporter = String(input.reporter || '').trim();
	if (!reporter && o.fillReporter) {
		const r = String(ef.reporter || '').trim();
		if (r) { reporter = r; changes.reporter = { old: input.reporter || '', new: r, how: 'legacy block' }; }
	}
	if (!reporter && o.inferReporter && String(input.volume || '').trim() && String(input.page || '').trim()) {
		const res = courtOld && ID_LIKE.test(courtOld) ? courtFromId(courtOld, key) : (courtOld ? normalizeCourtText(courtOld) : null);
		if (res && res.kind === 'supreme') {
			reporter = 'U.S.';
			changes.reporter = { old: input.reporter || '', new: 'U.S.', how: 'inferred from the Supreme Court' };
		}
	}

	// --- court
	if (courtOld && ID_LIKE.test(courtOld)) {
		if (o.translateIds) {
			const res = courtFromId(courtOld, key);
			if (res.unresolved) notes.push({ unresolved: `${courtOld} [${key || 'no jurisdiction'}]: ${res.unresolved}` });
			else changes.court = { old: input.court, new: finalCourt(res, reporter), how: `${courtOld} [${key}]` };
		}
	}
	else if (courtOld) {
		const res = normalizeCourtText(courtOld);
		if (res) {
			const nc = finalCourt(res, reporter);
			if (nc !== courtOld) {
				if (o.normalizeText) changes.court = { old: input.court, new: nc, how: 'typed-out name' };
				else notes.push({ textCourt: courtOld, suggested: nc });
			}
		}
		else if (courtOld.split(/\s+/).length >= 3 || courtOld.length > 20) notes.push({ textCourtUnrecognized: courtOld });
	}
	return { changes, notes };
}

if (typeof HICITE_TEST !== 'undefined') {
	return { parseJurism, jurisdictionKey, courtFromId, normalizeCourtText, joinDistrict, planCase, finalCourt };
}

// ------------------------------------------------------------------ main

const dataDir = Zotero.DataDirectory.dir;
const OPTIONS = { fillReporter: FILL_REPORTER_FROM_JURISM, inferReporter: INFER_REPORTER,
	translateIds: TRANSLATE_COURT_IDS, normalizeText: NORMALIZE_TEXT_COURTS };

async function latestLog() {
	const files = (await IOUtils.getChildren(dataDir))
		.filter(p => PathUtils.filename(p).startsWith(LOG_PREFIX) && p.endsWith('.json')); // *.reverted are retired
	files.sort();
	return files.length ? files[files.length - 1] : null;
}

if (MODE === 'revert') {
	const logPath = await latestLog();
	if (!logPath) return 'No log file (' + LOG_PREFIX + '*.json) found in ' + dataDir;
	const log = JSON.parse(await Zotero.File.getContentsAsync(logPath));
	let reverted = 0, changedSince = 0, missing = 0;
	await Zotero.DB.executeTransaction(async () => {
		for (const c of log.changes) {
			const item = await Zotero.Items.getByLibraryAndKeyAsync(c.libraryID, c.key);
			if (!item) { missing++; continue; }
			let any = false, skipped = false;
			for (const [field, v] of Object.entries(c.fields)) {
				if (item.getField(field) !== v.new) { skipped = true; continue; }
				item.setField(field, v.old);
				any = true;
			}
			if (skipped) changedSince++;
			if (any) { await item.save({ skipDateModifiedUpdate: true }); reverted++; }
		}
	});
	await IOUtils.move(logPath, logPath + '.reverted'); // so the next revert steps back further
	return `Reverted ${reverted} items from ${PathUtils.filename(logPath)} (${changedSince} left at least one field alone ` +
		`because it changed since; ${missing} no longer exist). That log is now retired; ` +
		`run 'revert' again to undo the apply before it.`;
}

if (MODE !== 'dry-run' && MODE !== 'apply') return "MODE must be 'dry-run', 'apply' or 'revert'";
if (MODE === 'apply' && !I_HAVE_A_BACKUP) {
	return 'Refusing to apply: back up your data first (quit Zotero, copy zotero.sqlite), ' +
		'then set I_HAVE_A_BACKUP = true.';
}

const plan = [];               // { item, changes }
const counts = {};
const skippedGroups = {};
const unresolved = {}, textCourts = {}, textUnrecognized = {}, translations = {};
const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

for (const lib of Zotero.Libraries.getAll()) {
	if (ONLY_LIBRARY_IDS && !ONLY_LIBRARY_IDS.includes(lib.libraryID)) continue;
	const s = new Zotero.Search();
	s.libraryID = lib.libraryID;
	s.addCondition('itemType', 'is', 'case');
	s.addCondition('noChildren', 'true');
	const items = await Zotero.Items.getAsync(await s.search());
	if (!items.length) continue;
	if (!lib.editable) { bump(counts, 'skipped: read-only library', items.length); continue; }
	const isGroup = lib.libraryType === 'group';
	for (const item of items) {
		const { changes, notes } = planCase({
			reporter: item.getField('reporter'), court: item.getField('court'),
			volume: item.getField('reporterVolume'), page: item.getField('firstPage'), extra: item.getField('extra'),
		}, OPTIONS);
		const editable = !(isGroup && !INCLUDE_GROUPS);
		if (!editable) {
			if (Object.keys(changes).length) bump(skippedGroups, lib.name);
			continue; // don't let group items influence the report below
		}
		for (const n of notes) {
			if (n.unresolved) bump(unresolved, n.unresolved);
			else if (n.textCourt) bump(textCourts, `${n.textCourt}  ->  ${n.suggested}`);
			else if (n.textCourtUnrecognized) bump(textUnrecognized, n.textCourtUnrecognized);
		}
		if (!Object.keys(changes).length) { bump(counts, 'nothing to change'); continue; }
		for (const [f, c] of Object.entries(changes)) {
			bump(counts, `${f}: ${c.how.startsWith('inferred') ? 'inferred' : 'set'}`);
			if (f === 'court') bump(translations, `${c.how}  ->  ${c.new || '(omitted: the reporter identifies the court)'}`);
		}
		plan.push({ item, changes, library: lib.name });
	}
}

const lines = (o, indent = '  ') => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${indent}${v}  ${k}`).join('\n');
let out = `MODE: ${MODE}\n\nWould change ${plan.length} cases.\n\nField changes:\n${lines(counts)}`;
if (Object.keys(translations).length) out += '\n\nCourt translations:\n' + lines(translations);
if (Object.keys(unresolved).length) out += '\n\nCourts I could NOT translate (left as they are):\n' + lines(unresolved);
if (Object.keys(textCourts).length) {
	out += '\n\nTyped-out courts that could be rewritten (set NORMALIZE_TEXT_COURTS = true; hicite prints them as typed):\n' +
		lines(textCourts);
}
if (Object.keys(textUnrecognized).length) out += '\n\nTyped-out courts I do not recognize (left as they are):\n' + lines(textUnrecognized);
if (Object.keys(skippedGroups).length) {
	out += '\n\nSkipped because they are in shared GROUP libraries (set INCLUDE_GROUPS = true to include):\n' + lines(skippedGroups);
}

if (MODE === 'dry-run') {
	const preview = plan.slice(0, 10).map(p => `  ${p.item.getField('caseName').slice(0, 45)}: ` +
		Object.entries(p.changes).map(([f, c]) => `${f} "${c.old || ''}" -> "${c.new}"`).join('; '));
	return out + '\n\nFirst items:\n' + preview.join('\n') + '\n\nDRY RUN: nothing was changed.';
}

// MODE === 'apply': write the log first, then change everything in one transaction.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const logPath = PathUtils.join(dataDir, LOG_PREFIX + stamp + '.json');
await Zotero.File.putContentsAsync(logPath, JSON.stringify({
	created: new Date().toISOString(),
	changes: plan.map(p => ({
		libraryID: p.item.libraryID, key: p.item.key,
		fields: Object.fromEntries(Object.entries(p.changes).map(([f, c]) => [f, { old: c.old || '', new: c.new }])),
	})),
}, null, 1));

await Zotero.DB.executeTransaction(async () => {
	for (const p of plan) {
		for (const [f, c] of Object.entries(p.changes)) p.item.setField(f, c.new);
		await p.item.save({ skipDateModifiedUpdate: true });
	}
});
return out + `\n\nAPPLIED: ${plan.length} items changed. Log: ${logPath}\nTo undo, set MODE = 'revert' and run again.`;
