/*
 * One-off migration: fill the Reporter field of Case items from the legacy
 * Juris-M data ("mlzsync1:" block) stored in the Extra field.
 *
 * Why: hicite needs a case's reporter (e.g. "F.3d") to format a citation, and
 * this add-on reads only Zotero's native Reporter field. Juris-M, which is no
 * longer supported, kept it in Extra as
 *
 *     mlzsync1:0103{"extrafields":{"reporter":"U.S.","jurisdiction":"..."}}
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
 *  - Only cases whose Reporter field is EMPTY are touched, and only when the
 *    legacy block actually contains a reporter. The Extra field is left as is.
 *  - Shared GROUP libraries are skipped unless INCLUDE_GROUPS = true, because
 *    editing them changes data for the other members and syncs to them.
 *  - Read-only libraries are always skipped.
 *  - A log of every change is written to the Zotero data directory BEFORE any
 *    item is modified, and 'revert' only clears fields that still hold the
 *    value this script set.
 *  - "Date Modified" is not updated.
 */

const MODE = 'dry-run';          // 'dry-run' | 'apply' | 'revert'
const I_HAVE_A_BACKUP = false;   // must be true for MODE = 'apply'
const INCLUDE_GROUPS = false;    // true: also edit shared group libraries
const ONLY_LIBRARY_IDS = null;   // e.g. [1] to restrict to specific libraries

const LOG_PREFIX = 'hicite-reporter-fill-';

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

// The reporter to fill for a case, or {skip: reason}.
function reporterFor(nativeReporter, extra) {
	if ((nativeReporter || '').trim()) return { skip: 'already has a reporter' };
	const { data, error } = parseJurism(extra);
	if (error) return { skip: error === 'no-block' ? 'no Juris-M block' : 'unreadable Juris-M block (' + error + ')' };
	const reporter = String(data?.extrafields?.reporter ?? '').trim();
	return reporter ? { reporter } : { skip: 'Juris-M block has no reporter' };
}

if (typeof HICITE_TEST !== 'undefined') return { parseJurism, reporterFor };

// ------------------------------------------------------------------ main

const dataDir = Zotero.DataDirectory.dir;

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
			if (item.getField('reporter') !== c.reporter) { changedSince++; continue; }
			item.setField('reporter', '');
			await item.save({ skipDateModifiedUpdate: true });
			reverted++;
		}
	});
	await IOUtils.move(logPath, logPath + '.reverted'); // so the next revert steps back further
	return `Reverted ${reverted} items from ${PathUtils.filename(logPath)} (${changedSince} left alone because ` +
		`their Reporter changed since; ${missing} no longer exist). That log is now retired; ` +
		`run 'revert' again to undo the apply before it.`;
}

if (MODE !== 'dry-run' && MODE !== 'apply') return "MODE must be 'dry-run', 'apply' or 'revert'";
if (MODE === 'apply' && !I_HAVE_A_BACKUP) {
	return 'Refusing to apply: back up your data first (quit Zotero, copy zotero.sqlite), ' +
		'then set I_HAVE_A_BACKUP = true.';
}

const plan = [];               // { item, reporter }
const counts = {};
const skippedGroups = {};
const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };

for (const lib of Zotero.Libraries.getAll()) {
	if (ONLY_LIBRARY_IDS && !ONLY_LIBRARY_IDS.includes(lib.libraryID)) continue;
	const s = new Zotero.Search();
	s.libraryID = lib.libraryID;
	s.addCondition('itemType', 'is', 'case');
	s.addCondition('noChildren', 'true');
	const items = await Zotero.Items.getAsync(await s.search());
	if (!items.length) continue;
	if (!lib.editable) { counts['skipped: read-only library'] = (counts['skipped: read-only library'] || 0) + items.length; continue; }
	const isGroup = lib.libraryType === 'group';
	for (const item of items) {
		const r = reporterFor(item.getField('reporter'), item.getField('extra'));
		if (r.skip) { bump(r.skip); continue; }
		if (isGroup && !INCLUDE_GROUPS) {
			skippedGroups[lib.name] = (skippedGroups[lib.name] || 0) + 1;
			continue;
		}
		plan.push({ item, reporter: r.reporter, library: lib.name });
	}
}

const hist = {};
for (const p of plan) hist[p.reporter] = (hist[p.reporter] || 0) + 1;
const preview = plan.slice(0, 12).map(p => `  ${p.item.getField('caseName').slice(0, 55)}  ->  ${p.reporter}`);

let out = `MODE: ${MODE}\n\nWould fill Reporter on ${plan.length} cases`;
out += '\n\nLeft alone:\n' + Object.entries(counts).map(([k, v]) => `  ${v}  ${k}`).join('\n');
if (Object.keys(skippedGroups).length) {
	out += '\n\nSkipped because they are in shared GROUP libraries (set INCLUDE_GROUPS = true to include):\n' +
		Object.entries(skippedGroups).map(([k, v]) => `  ${v}  ${k}`).join('\n');
}
out += '\n\nReporters (' + Object.keys(hist).length + ' distinct): ' +
	Object.entries(hist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(', ');
out += '\n\nFirst items:\n' + preview.join('\n');

if (MODE === 'dry-run') {
	return out + '\n\nDRY RUN: nothing was changed.';
}

// MODE === 'apply': write the log first, then change everything in one transaction.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const logPath = PathUtils.join(dataDir, LOG_PREFIX + stamp + '.json');
await Zotero.File.putContentsAsync(logPath, JSON.stringify({
	created: new Date().toISOString(),
	changes: plan.map(p => ({ libraryID: p.item.libraryID, key: p.item.key, reporter: p.reporter })),
}, null, 1));

await Zotero.DB.executeTransaction(async () => {
	for (const p of plan) {
		p.item.setField('reporter', p.reporter);
		await p.item.save({ skipDateModifiedUpdate: true });
	}
});
return out + `\n\nAPPLIED: ${plan.length} items changed. Log: ${logPath}\nTo undo, set MODE = 'revert' and run again.`;
