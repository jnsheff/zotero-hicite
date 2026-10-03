/* hicite Export for Zotero: main module.
 *
 *  - installs the "hicite" export translator (translator/hicite.js)
 *  - citation keys: the ones Better BibTeX makes (it is told a formula for legal sources) or, without it,
 *    the same keys made here, kept in Zotero's Citation Key field with a/b/c disambiguation
 *  - item / collection / Tools menus via Zotero.MenuManager
 *  - auto-export: keeps .tex files up to date as the library changes
 *  - a Settings pane (preferences.xhtml) for the export and key settings
 *
 * Written against the Zotero 8/9 plugin APIs.
 */

// The key generator: a copy of the one in translator/hicite.js (which runs in the translator sandbox and
// cannot share code); test/parity-jxa.js checks that the two agree.
var KeyGen = (function () {
// Better BibTeX's default skipWords: left out of title words.
var SKIP_WORDS = {};
'a,ab,aboard,about,above,across,after,against,al,along,amid,among,an,and,anti,around,as,at,before,behind,below,beneath,beside,besides,between,beyond,but,by,d,da,das,de,del,dell,dello,dei,degli,della,dell,delle,dem,den,der,des,despite,die,do,down,du,during,ein,eine,einem,einen,einer,eines,el,en,et,except,for,from,gli,i,il,in,inside,into,is,l,la,las,le,les,like,lo,los,near,nor,of,off,on,onto,or,over,past,per,plus,round,save,since,so,some,sur,than,the,through,to,toward,towards,un,una,unas,under,underneath,une,unlike,uno,unos,until,up,upon,versus,via,von,while,with,within,without,yet,zu,zum'
	.split(',').forEach(function (w) { SKIP_WORDS[w] = 1; });

var CORP_SUFFIX = /,?\s+(?:inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc|pbc|lp|llp|gmbh|ag|sa)[.]?$/i;
// "Complaint: Garcia v. Character Technologies", "Order Granting ..., Bartz v. Anthropic PBC"
var COURT_PAPER_PREFIX = /^(?:(?:first|second|third|amended)\s+)*(?:complaint|answer|counterclaim|motion|brief|order|opinion|declaration|affidavit|memorandum|petition|judgment|transcript|stipulation)\b[^:,]*[:,]\s+/i;
var LEGAL_TYPES = { statute: 1, bill: 1, hearing: 1 };

// Better BibTeX transliterates keys to ASCII ("fold"): accents go, a few letters are spelled out.
function foldAscii(s) {
	return String(s).replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/Æ/g, 'AE').replace(/œ/g, 'oe').replace(/Œ/g, 'OE')
		.replace(/[øđ]/g, function (c) { return c === 'ø' ? 'o' : 'd'; }).replace(/[ØĐ]/g, function (c) { return c === 'Ø' ? 'O' : 'D'; })
		.replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/ı/g, 'i')
		.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Better BibTeX's nopunct: dashes and punctuation removed.
function noPunct(s) {
	return String(s).replace(/[\p{Pd}─－―]/gu, '').replace(/[\p{Pe}\p{Pf}\p{Pi}\p{Po}\p{Ps}]/gu, '');
}

// The significant words of a title (Better BibTeX's titleWords with nopunct): markup and quotes dropped, "/" and
// ":" read as spaces, words made of one character (other than a number) and skip words left out, accents folded.
function titleWords(title) {
	title = String(title || '').replace(/<\/?(?:i|b|sc|nc|code|span[^>]*)>|["]/ig, '').replace(/[/:]/g, ' ');
	return title.split(/\s+/).filter(function (w) { return w && !SKIP_WORDS[w.toLowerCase()]; })
		.map(noPunct).filter(function (w) { return w && !(w.length === 1 && !/^\d+$/.test(w)) && !SKIP_WORDS[w.toLowerCase()]; })
		.map(foldAscii);
}

function shortTitle(title, n, m) { // shorttitle(n, m): the first n words, the first m of them capitalized
	return titleWords(title).slice(0, n).map(function (w, i) { return i < m ? w.charAt(0).toUpperCase() + w.slice(1) : w; }).join('');
}

function firstPartyOf(title) {
	return String(title || '').trim().replace(COURT_PAPER_PREFIX, '').replace(/\s+v(?:s)?[.]?\s.*$/i, '').replace(CORP_SUFFIX, '');
}

// What Better BibTeX would end with: transliterated, unsafe characters (and, for hicite, anything but letters,
// digits and hyphens) removed; a leading digit would read as a volume number, so such a key gets "ref".
function finishKey(key) {
	key = foldAscii(key).replace(/[^A-Za-z0-9-]/g, '');
	return /^[A-Za-z]/.test(key) ? key : 'ref' + key;
}

// info: { type, title, shortTitle, year, creators: [{ kind, name }] } (name = last name, or the whole name of a
// one-field creator; kind = creator type). auth is the first author, else editor, translator, collaborator.
function keyFor(info) {
	var key, year = info.year || '';
	if (info.type === 'case') key = noPunct(firstPartyOf(info.title)).toLowerCase() + year;
	else if (LEGAL_TYPES[info.type] && info.shortTitle) key = noPunct(info.shortTitle).toLowerCase() + year;
	else if (LEGAL_TYPES[info.type]) key = shortTitle(info.title, 1, 0).toLowerCase() + year;
	else {
		var kinds = ['author', 'editor', 'translator', 'collaborator'], auth = '';
		for (var i = 0; i < kinds.length && !auth; i++) {
			var found = (info.creators || []).filter(function (c) { return c.kind === kinds[i]; })[0];
			if (found) auth = found.name || '';
		}
		key = auth.toLowerCase() + shortTitle(info.title, 3, 3) + year;
	}
	return finishKey(key || 'ref');
}
	return { keyFor, titleWords, shortTitle };
})();

HiCite = {
	id: null,
	version: null,
	rootURI: null,
	observerID: null,
	destroyed: false,
	unpatch: null,
	menuIDs: [],
	token: 0, // debounce token
	dirty: new Set(),
	queue: Promise.resolve(),

	TRANSLATOR_ID: 'f7eba8a4-5b7c-4f49-8a80-c04c0e27c0a8',
	TRANSLATOR_FILE: 'hicite.js',
	FTL: 'hicite-export.ftl',
	PREF: 'extensions.hicite-export.autoExports',
	DEBOUNCE_MS: 3000,

	// Settings shared with the export translator (which reads them with Zotero.getHiddenPref,
	// i.e. the prefs extensions.zotero.translators.hicite.*). Defaults also live in prefs.js and
	// in the translator's header; keep the three in step.
	SETTINGS: { bbtFormula: 'on', shortTitleInline: true, omitRedundantSite: true, includeUrls: true, maxAuthors: '0', titleCase: true, longLists: '8', phoenixMode: 'auto', phoenix: 'off' },
	settingObservers: [],

	// citation-phoenix (https://github.com/rischconsulting/citation-phoenix) keeps Juris-M's legal data in Extra and
	// Juris-M court IDs in the Court field. The translator reads that data only when the hidden pref `phoenix` is
	// "on"; this add-on keeps the pref in step with whether citation-phoenix is installed and enabled (setting
	// `phoenixMode` can force it on or off). The translator runs in a sandbox and cannot ask for itself.
	PHOENIX_ID: 'citation-phoenix@michaelrisch.com',
	phoenix: { installed: false, active: false, version: '' },
	addonListener: null,
	AddonManager: null,

	pref(name) {
		let v = Zotero.Prefs.get('translators.hicite.' + name);
		return v === undefined || v === null ? this.SETTINGS[name] : v;
	},

	// ------------------------------------------------------ citation-phoenix

	// Look up citation-phoenix in the add-on manager. Failure to ask counts as "not installed", which is the
	// behaviour of an environment without it.
	async detectPhoenix() {
		let found = { installed: false, active: false, version: '' };
		try {
			if (!this.AddonManager) this.AddonManager = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs').AddonManager;
			let addon = await this.AddonManager.getAddonByID(this.PHOENIX_ID);
			if (addon) found = { installed: true, active: !!addon.isActive, version: String(addon.version || '') };
		}
		catch (e) { Zotero.debug(`hicite: could not look up citation-phoenix: ${e}`); }
		this.phoenix = found;
		return found;
	},

	// "on" or "off": the setting if it says so, else whether citation-phoenix is enabled.
	phoenixEffective() {
		let mode = this.pref('phoenixMode');
		if (mode === 'on' || mode === 'off') return mode;
		return this.phoenix.active ? 'on' : 'off';
	},

	// Publish the mode to the translator. Changing the pref re-runs the auto-exports (see registerSettings).
	syncPhoenixPref() {
		let want = this.phoenixEffective();
		if (Zotero.Prefs.get('translators.hicite.phoenix') !== want) Zotero.Prefs.set('translators.hicite.phoenix', want);
		return want;
	},

	async refreshPhoenix() {
		await this.detectPhoenix();
		return this.syncPhoenixPref();
	},

	// Follow citation-phoenix and Better BibTeX being installed, enabled, disabled or removed while Zotero runs.
	watchPhoenix() {
		if (!this.AddonManager || this.addonListener) return;
		let changed = addon => {
			if (this.destroyed) return;
			if (addon?.id === this.PHOENIX_ID) this.refreshPhoenix().catch(e => Zotero.logError(e));
			else if (addon?.id === this.BBT_ID) this.refreshBBT().catch(e => Zotero.logError(e));
		};
		this.addonListener = {};
		for (let ev of ['onEnabled', 'onDisabled', 'onInstalled', 'onUninstalling', 'onUninstalled', 'onOperationCancelled']) {
			this.addonListener[ev] = changed;
		}
		this.AddonManager.addAddonListener(this.addonListener);
	},

	// ------------------------------------------------------------- keys
	// One set of keys, Better BibTeX's, in Zotero's Citation Key field. With Better BibTeX installed it makes them
	// (this add-on gives it a formula that suits legal sources and otherwise stays out of the way); without it this
	// add-on makes the same keys itself. A "Citation Key:" line in Extra is how earlier versions of this add-on
	// pinned keys: it still wins, because documents cite it, and is moved into the field.

	// A key hicite can use as a reference nickname: starts with a letter (a
	// leading digit reads as a volume number), no spaces or TeX specials.
	KEY_OK: /^[A-Za-z][A-Za-z0-9-]*$/,

	BBT_ID: 'better-bibtex@iris-advies.com',
	// Better BibTeX's formula (its own syntax: "|" tries the next pattern when one does not apply). Cases: the
	// first party's name (a court paper's "Complaint:" and a company's "Inc." dropped) and the year; statutes, bills
	// and hearings: the Short Title, else the first word of the title, and the year; everything else Better BibTeX's
	// default. Keep in step with keyFor() in translator/hicite.js.
	BBT_FORMULA: 'type(\'case\') + Title.replace(/^(?:(?:first|second|third|amended)\\s+)*(?:complaint|answer|counterclaim|motion|brief|order|opinion|declaration|affidavit|memorandum|petition|judgment|transcript|stipulation)\\b[^:,]*[:,]\\s+/i, \'\').replace(/\\s+v(?:s)?[.]?\\s.*$/i, \'\').replace(/,?\\s+(?:inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc|pbc|lp|llp|gmbh|ag|sa)[.]?$/i, \'\').nopunctordash.lower + year'
		+ ' | type(\'statute\', \'bill\', \'hearing\') + ShortTitle.match(/./).nopunctordash.lower + year'
		+ ' | type(\'statute\', \'bill\', \'hearing\') + veryshorttitle(1).lower + year'
		+ ' | auth.lower + shorttitle(3, 3) + year',
	bbt: { installed: false, active: false, version: '' },

	// The key this add-on would make for an item with none (what Better BibTeX's formula gives, or its default).
	baseKey(item) {
		let creators = item.getCreators().map(c => ({ kind: Zotero.CreatorTypes.getName(c.creatorTypeID), name: c.lastName || '' }));
		// 'year' handles types whose date field has another name (dateDecided, ...)
		let year = item.getField('year');
		if (!/^\d{4}$/.test(year) || year === '0000') year = '';
		let field = n => item.getField(n) || '';
		return KeyGen.keyFor({ type: item.itemType, title: field('title') || field('caseName') || field('nameOfAct'), shortTitle: field('shortTitle'), year, creators });
	},

	suffix(n) {
		let s = '';
		while (n > 0) {
			n--;
			s = String.fromCharCode(97 + (n % 26)) + s;
			n = Math.floor(n / 26);
		}
		return s;
	},

	// The usable "Citation Key:" line from Extra, or ''.
	getExtraKey(item) {
		let m = /^\s*Citation Key\s*:\s*(\S+)\s*$/im.exec(item.getField('extra') || '');
		return m && this.KEY_OK.test(m[1]) ? m[1] : '';
	},

	// The key hicite uses for an item: a "Citation Key:" line in Extra if there still is one (documents cite
	// it), else the usable key in the Citation Key field.
	getKey(item) {
		return this.getExtraKey(item) || this.getNativeKey(item);
	},

	// The key in Zotero's native Citation Key field (Better BibTeX's, or one made here), if usable.
	getNativeKey(item) {
		try {
			let key = item.getField('citationKey');
			return this.KEY_OK.test(key) ? key : '';
		}
		catch (e) { return ''; } // item type without the field
	},

	clearExtraKey(item) {
		let lines = (item.getField('extra') || '').split('\n')
			.filter(l => !/^\s*Citation Key\s*:/i.test(l));
		while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
		item.setField('extra', lines.join('\n'));
	},

	// Put `key` in Zotero's Citation Key field and drop the line from Extra; false if the item type has no such field.
	writeNativeKey(item, key) {
		try {
			item.setField('citationKey', key);
			if (item.getField('citationKey') !== key) return false;
		}
		catch (e) { return false; }
		this.clearExtraKey(item);
		return true;
	},

	// Store `key`: in the Citation Key field, or as a "Citation Key:" line in Extra for an item type without one.
	setKey(item, key) {
		if (this.writeNativeKey(item, key)) return;
		this.clearExtraKey(item);
		let extra = item.getField('extra') || '';
		item.setField('extra', (extra ? extra + '\n' : '') + 'Citation Key: ' + key);
	},

	async isTaken(item, key) {
		let conditions = [['extra', 'contains', 'Citation Key: ' + key], ['citationKey', 'is', key]];
		for (let [field, op, value] of conditions) {
			let s = new Zotero.Search();
			s.libraryID = item.libraryID;
			s.addCondition(field, op, value);
			s.addCondition('noChildren', 'true');
			let ids = await s.search();
			for (let other of await Zotero.Items.getAsync(ids)) {
				if (other.id !== item.id && this.getKey(other).toLowerCase() === key.toLowerCase()) return true;
			}
		}
		return false;
	},

	async uniqueKey(item) {
		let base = this.baseKey(item);
		if (!await this.isTaken(item, base)) return base;
		for (let n = 1; n < 10000; n++) {
			let k = base + this.suffix(n);
			if (!await this.isTaken(item, k)) return k;
		}
		return base + item.key.toLowerCase();
	},

	// Make sure an item has its key, and return it.
	//  - a "Citation Key:" line in Extra (an older version of this add-on pinned keys there) is moved into the
	//    Citation Key field, replacing a different key that is already there: the pinned one is what documents cite;
	//  - a key already in the field is kept;
	//  - with Better BibTeX installed, an item with no key is left for it to fill in (nothing is made here, so
	//    there is no second set of keys); otherwise a key is made.
	// `force` replaces the key: Better BibTeX is asked to make a new one (the key is cleared and the item saved so
	// that it notices), or, without it, one is made here.
	async pin(item, { force = false } = {}) {
		if (!item.isRegularItem() || item.isFeedItem) return '';
		let extra = this.getExtraKey(item), native = this.getNativeKey(item);
		if (force && this.bbt.active) {
			try { item.setField('citationKey', ''); } catch (e) { /* item type without the field */ }
			this.clearExtraKey(item);
			await item.saveTx({ skipDateModifiedUpdate: true }); // not quiet: Better BibTeX fills in the empty key
			return '';
		}
		if (!force) {
			if (extra) {
				if (native !== extra && this.writeNativeKey(item, extra)) await item.saveTx({ skipDateModifiedUpdate: true, skipNotifier: true });
				return extra;
			}
			if (native) return native;
			if (this.bbt.active) return '';
		}
		let key = await this.uniqueKey(item);
		if (key === (extra || native)) return key;
		this.setKey(item, key);
		// skipNotifier: other add-ons must not react to this edit (Better BibTeX can be set to regenerate an
		// item's key whenever the item changes, which would replace a key just because we stored one).
		await item.saveTx({ skipDateModifiedUpdate: true, skipNotifier: true });
		return key;
	},

	// ------------------------------------------------------- Better BibTeX

	async detectBBT() {
		let found = { installed: false, active: false, version: '' };
		try {
			if (!this.AddonManager) this.AddonManager = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs').AddonManager;
			let addon = await this.AddonManager.getAddonByID(this.BBT_ID);
			if (addon) found = { installed: true, active: !!addon.isActive, version: String(addon.version || '') };
		}
		catch (e) { Zotero.debug(`hicite: could not look up Better BibTeX: ${e}`); }
		this.bbt = found;
		return found;
	},

	// With Better BibTeX active, give it the formula above (once; the previous formula is kept in the
	// hidden pref translators.hicite.bbtFormulaBackup). Existing keys are not touched: Better BibTeX only
	// uses a formula for items that have no key.
	async syncBBTFormula() {
		if (!this.bbt.active || this.pref('bbtFormula') !== 'on') return false;
		const P = 'translators.better-bibtex.citekeyFormat', E = 'translators.better-bibtex.citekeyFormatEditing';
		if (Zotero.Prefs.get(P) === this.BBT_FORMULA && Zotero.Prefs.get(E) === this.BBT_FORMULA) return false;
		let before = Zotero.Prefs.get(P);
		if (before && before !== this.BBT_FORMULA && !Zotero.Prefs.get('translators.hicite.bbtFormulaBackup')) {
			Zotero.Prefs.set('translators.hicite.bbtFormulaBackup', before);
		}
		Zotero.Prefs.set(P, this.BBT_FORMULA);
		Zotero.Prefs.set(E, this.BBT_FORMULA);
		this.notify('Set the Better BibTeX citation key formula for legal sources (new items only; existing keys are kept)');
		return true;
	},

	async refreshBBT() {
		await this.detectBBT();
		return this.syncBBTFormula();
	},

	// ------------------------------------------------------------ translator

	// Read a file from inside this add-on's package. rootURI is a jar:file:///...xpi!/
	// URL, which Zotero.File.getContentsFromURLAsync cannot fetch (it goes through
	// the HTTP client and fails parsing the URI); getResourceAsync opens a channel.
	async readPackaged(relPath) {
		let url = this.rootURI + relPath;
		try {
			return await Zotero.File.getResourceAsync(url);
		}
		catch (e) {
			Zotero.debug(`hicite: getResourceAsync failed for ${url}, trying fetch(): ${e}`);
			let response = await fetch(url);
			if (!response.ok) throw new Error(`Could not read ${url}: ${response.status}`);
			return await response.text();
		}
	},

	// Write translator/hicite.js into Zotero's translators directory and load it.
	// `force` reloads even if the file is already current.
	async installTranslator({ force = false } = {}) {
		let path = PathUtils.join(Zotero.getTranslatorsDirectory().path, this.TRANSLATOR_FILE);
		let source = await this.readPackaged('translator/hicite.js');
		let current = null;
		try { current = await Zotero.File.getContentsAsync(path); } catch (e) { /* not installed yet */ }
		if (current === source && !force) return;
		if (current !== source) await Zotero.File.putContentsAsync(path, source);
		await Zotero.Translators.reinit();
	},

	// The registered translator, repairing the installation if it has gone missing
	// (e.g. the file was deleted, or an older version's uninstall() removed it).
	async getTranslator() {
		// get() is synchronous and throws "Translators not yet loaded" until the
		// cache is ready (auto-export can fire right after startup); init()
		// resolves immediately once loaded.
		await Zotero.Translators.init();
		let translator = Zotero.Translators.get(this.TRANSLATOR_ID);
		if (!translator) {
			await this.installTranslator({ force: true });
			translator = Zotero.Translators.get(this.TRANSLATOR_ID);
		}
		if (!translator) throw new Error('hicite translator is not installed');
		return translator;
	},

	// ----------------------------------------------------------- auto-export
	// A job is { id, libraryID, collectionKey|null, path, includePublisher }.

	getJobs() {
		try {
			let jobs = JSON.parse(Zotero.Prefs.get(this.PREF, true) || '[]');
			return Array.isArray(jobs) ? jobs : [];
		}
		catch (e) { return []; }
	},

	saveJobs(jobs) {
		Zotero.Prefs.set(this.PREF, JSON.stringify(jobs), true);
	},

	// Row is a collectionTreeRow: a collection or a whole library.
	scopeOf(row) {
		if (row.isCollection()) return { libraryID: row.ref.libraryID, collectionKey: row.ref.key };
		// isLibrary(true) also matches feeds, which have nothing to export
		if (row.isLibrary(true) && !row.isFeed()) return { libraryID: row.ref.libraryID, collectionKey: null };
		return null;
	},

	jobFor(scope) {
		return this.getJobs().find(j => j.libraryID === scope.libraryID
			&& (j.collectionKey || null) === scope.collectionKey);
	},

	notify(message, isError) {
		let pw = new Zotero.ProgressWindow({ closeOnClick: true });
		pw.changeHeadline(isError ? 'hicite export failed' : 'hicite');
		pw.addDescription(message);
		pw.show();
		pw.startCloseTimer(isError ? 8000 : 3000);
	},

	async startAutoExport(win, row) {
		let scope = this.scopeOf(row);
		if (!scope || this.jobFor(scope)) return;
		const { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
		let fp = new FilePicker();
		fp.init(win, 'Auto-export hicite references to…', fp.modeSave);
		fp.defaultString = (row.isCollection() ? row.ref.name : Zotero.Libraries.getName(scope.libraryID)) + '.tex';
		fp.defaultExtension = 'tex';
		fp.appendFilter('hicite (TeX)', '*.tex');
		let rv = await fp.show();
		if (rv !== fp.returnOK && rv !== fp.returnReplace) return;

		await this.addJob(scope, fp.file, {});
	},

	// Create (or replace) the auto-export job for a scope and run it now.
	async addJob(scope, path, opts) {
		let job = Object.assign({
			id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
			path,
			includePublisher: !!opts['Include publisher'],
		}, scope);
		let others = this.getJobs().filter(j => !(j.libraryID === scope.libraryID
			&& (j.collectionKey || null) === scope.collectionKey));
		this.saveJobs([...others, job]);
		await this.enqueue([job.id]);
	},

	stopAutoExport(scope) {
		let job = this.jobFor(scope);
		if (job) this.saveJobs(this.getJobs().filter(j => j.id !== job.id));
	},

	// Regular items in a job's scope (recursive for collections), excluding trash.
	async scopeItems(job) {
		let s = new Zotero.Search();
		s.libraryID = job.libraryID;
		if (job.collectionKey) {
			s.addCondition('collection', 'is', job.collectionKey);
			s.addCondition('recursive', 'true');
		}
		s.addCondition('noChildren', 'true');
		let ids = await s.search();
		return (await Zotero.Items.getAsync(ids)).filter(i => i.isRegularItem());
	},

	async runJob(job) {
		if (job.collectionKey && !Zotero.Collections.getByLibraryAndKey(job.libraryID, job.collectionKey)) {
			// The collection was deleted; stop exporting it.
			this.saveJobs(this.getJobs().filter(j => j.id !== job.id));
			return;
		}
		let items = await this.scopeItems(job);
		// Pin first so keys stay stable as the library grows.
		for (let item of items) await this.pin(item);

		let next;
		if (!items.length) {
			next = '% hicite reference definitions exported from Zotero.\n';
		}
		else {
			let translator = await this.getTranslator();
			let tmp = PathUtils.join(Zotero.getTempDirectory().path, `hicite-${job.id}.tex`);
			let translation = new Zotero.Translate.Export();
			translation.setItems(items);
			translation.setTranslator(translator);
			translation.setDisplayOptions({ 'Include publisher': !!job.includePublisher });
			translation.setLocation(Zotero.File.pathToFile(tmp));
			await new Promise((resolve, reject) => {
				translation.setHandler('done', (obj, worked) => {
					worked ? resolve() : reject(new Error('export translator reported failure'));
				});
				Promise.resolve(translation.translate()).catch(reject);
			});
			next = await IOUtils.readUTF8(tmp);
			await IOUtils.remove(tmp, { ignoreAbsent: true });
		}

		// Only touch the target when the content changes (avoids needless
		// rebuilds in editors and file watchers).
		let prev = null;
		try { prev = await IOUtils.readUTF8(job.path); } catch (e) { /* first export */ }
		if (next !== prev) await IOUtils.writeUTF8(job.path, next);
	},

	// Run the given jobs, one at a time, after any queued work.
	enqueue(jobIDs) {
		this.queue = this.queue.then(async () => {
			for (let id of jobIDs) {
				let job = this.getJobs().find(j => j.id === id);
				if (!job) continue;
				try { await this.runJob(job); }
				catch (e) {
					Zotero.logError(e);
					this.notify(`${PathUtils.filename(job.path)}: ${e.message}`, true);
				}
			}
		});
		return this.queue;
	},

	// Debounced: schedule jobs for the given libraries (null = every job).
	schedule(libraryIDs) {
		for (let job of this.getJobs()) {
			if (!libraryIDs || libraryIDs.has(job.libraryID)) this.dirty.add(job.id);
		}
		if (!this.dirty.size) return;
		let token = ++this.token;
		Zotero.Promise.delay(this.DEBOUNCE_MS).then(() => {
			if (token !== this.token) return;
			let ids = [...this.dirty];
			this.dirty.clear();
			this.enqueue(ids);
		});
	},

	async onNotify(event, type, ids) {
		try {
			if (type === 'item') {
				if (event === 'add') {
					for (let item of await Zotero.Items.getAsync(ids)) {
						if (item.library && !item.library.editable) continue;
						await this.pin(item);
					}
				}
				// Deleted items are gone, so their library is unknown: refresh all.
				let libs = new Set();
				let known = event !== 'delete' && ids.every(id => {
					let item = Zotero.Items.get(id);
					if (item) libs.add(item.libraryID);
					return !!item;
				});
				this.schedule(known ? libs : null);
			}
			else {
				this.schedule(null); // collection / collection-item changes
			}
		}
		catch (e) { Zotero.logError(e); }
	},

	// ------------------------------------------- "Keep updated" in the Export dialog
	// The dialog has a "Keep updated" checkbox (a translator display option). We
	// wrap Zotero.Translate.Export#translate: when a hicite export runs with it
	// ticked, remember the scope and file, and register an auto-export job once
	// the export succeeds.

	patchExport() {
		const proto = Zotero.Translate.Export.prototype;
		const original = proto.translate;
		const self = this;
		const patched = function (...args) {
			if (!self.destroyed) {
				try { self.captureKeepUpdated(this); } catch (e) { Zotero.logError(e); }
			}
			return original.apply(this, args);
		};
		proto.translate = patched;
		this.unpatch = () => { if (proto.translate === patched) proto.translate = original; };
	},

	captureKeepUpdated(translation) {
		let t = translation.translator?.[0];
		if ((typeof t === 'string' ? t : t?.translatorID) !== this.TRANSLATOR_ID) return;
		let opts = translation._displayOptions || {};
		if (!opts['Keep updated']) return;

		let ex = translation._export; // cleared once the export starts
		let path = translation.location?.path;
		if (!ex || !path) return;
		let scope;
		if (ex.type === 'library') {
			scope = { libraryID: ex.id, collectionKey: null };
		}
		else if (ex.type === 'collection') {
			scope = { libraryID: ex.collection.libraryID, collectionKey: ex.collection.key };
		}
		else {
			this.notify('"Keep updated" only works when exporting a whole library or collection, not selected items.', true);
			return;
		}
		translation.setHandler('done', (obj, worked) => {
			if (!worked) return;
			this.addJob(scope, path, opts).then(
				() => this.notify(`Keeping ${PathUtils.filename(path)} updated`),
				e => Zotero.logError(e)
			);
		});
	},

	// -------------------------------------------------------------------- UI

	async pinItems(items, opts) {
		let keys = [];
		for (let item of items.filter(i => i.isRegularItem())) keys.push(await this.pin(item, opts));
		return keys;
	},

	// Ask the user before replacing keys in bulk (anything that cites the old keys must be updated).
	confirmRegenerate(what, count, where) {
		try {
			return Services.prompt.confirm(Zotero.getMainWindow(), 'Regenerate citation keys',
				`Regenerate the citation keys of ${count} ${what} in ${where}?\n\nEach key is replaced by a new one (made by ` +
				'Better BibTeX from its formula if it is installed, otherwise here). Anything that cites the old keys ' +
				'(LaTeX files, exported .tex files) will need updating.');
		}
		catch (e) { return false; } // no way to ask: do nothing
	},

	// Regenerate the keys of every regular item in a library or collection (including sub-collections),
	// or only its cases. `confirm(count)` is asked first; returning false cancels.
	async regenerateKeys(scope, { casesOnly = false, confirm = null } = {}) {
		let items = await this.scopeItems(scope);
		if (casesOnly) items = items.filter(i => i.itemType === 'case');
		if (confirm && items.length && !await confirm(items.length)) return { total: items.length, changed: 0, cancelled: true };
		let changed = 0;
		for (let item of items) {
			let before = this.getKey(item);
			if (await this.pin(item, { force: true }) !== before) changed++;
		}
		this.schedule(new Set([scope.libraryID]));
		return { total: items.length, changed, cancelled: false };
	},

	regenerateCaseKeys(scope, options) {
		return this.regenerateKeys(scope, Object.assign({}, options, { casesOnly: true }));
	},

	async regenerateFromMenu(ctx, scope, casesOnly) {
		let row = ctx.collectionTreeRows[0];
		let where = `"${row.isCollection() ? row.ref.name : Zotero.Libraries.getName(scope.libraryID)}"`;
		let r = await this.regenerateKeys(scope, {
			casesOnly,
			confirm: count => this.confirmRegenerate(casesOnly ? 'cases' : 'items', count, where),
		});
		if (!r.cancelled) this.notify(`Regenerated the keys of ${r.changed} of ${r.total} ${casesOnly ? 'cases' : 'items'}`);
	},

	// ------------------------------------------- moving keys to Zotero's Citation Key field
	// What "Move Keys to Citation Key Field" would do to the items in a scope. A key pinned in Extra moves to
	// the field; where the field already holds a different key (Better BibTeX's, say), the hicite key replaces
	// it, because the hicite key is the one your documents cite.
	async planKeyMove(scope) {
		let plan = { total: 0, move: [], overwrite: [], stored: 0, none: 0 };
		for (let item of await this.scopeItems(scope)) {
			plan.total++;
			let extra = this.getExtraKey(item), native = this.getNativeKey(item);
			if (!extra) { if (native) plan.stored++; else plan.none++; continue; }
			if (native && native !== extra) plan.overwrite.push({ item, key: extra, old: native });
			else plan.move.push({ item, key: extra });
		}
		return plan;
	},

	describeKeyMove(plan, where) {
		let n = plan.move.length + plan.overwrite.length;
		let lines = [`Move hicite citation keys to Zotero's Citation Key field in ${where}?`, '',
			`${plan.move.length} keys move from Extra to the field.`];
		if (plan.overwrite.length) {
			lines.push(`${plan.overwrite.length} keys replace a different key that is already in the field (for example one made by Better BibTeX):`);
			for (let o of plan.overwrite.slice(0, 10)) lines.push(`   ${(o.item.getField('title') || o.item.getField('caseName') || '').slice(0, 50)}: ${o.old} -> ${o.key}`);
			if (plan.overwrite.length > 10) lines.push(`   … and ${plan.overwrite.length - 10} more`);
		}
		lines.push(`${plan.stored} items already have their key in the field only, and ${plan.none} have no key yet; those are left alone.`, '',
			`hicite keys do not change, so documents that cite them are unaffected. ${n} items will be modified.`);
		return lines.join('\n');
	},

	confirmKeyMove(text) {
		try {
			return Services.prompt.confirm(Zotero.getMainWindow(), 'Move citation keys', text);
		}
		catch (e) { return false; } // no way to ask: do nothing
	},

	async moveKeys(scope, { confirm = null } = {}) {
		let plan = await this.planKeyMove(scope);
		let todo = plan.move.concat(plan.overwrite);
		if (confirm && todo.length && !await confirm(plan)) return { moved: 0, failed: 0, plan, cancelled: true };
		let moved = 0, failed = 0;
		for (let { item, key } of todo) {
			if (this.writeNativeKey(item, key)) {
				// skipNotifier: Better BibTeX must not react to this edit by regenerating the key
				await item.saveTx({ skipDateModifiedUpdate: true, skipNotifier: true });
				moved++;
			}
			else failed++;
		}
		this.schedule(new Set([scope.libraryID]));
		return { moved, failed, plan, cancelled: false };
	},

	async moveKeysFromMenu(ctx, scope) {
		let row = ctx.collectionTreeRows[0];
		let where = `"${row.isCollection() ? row.ref.name : Zotero.Libraries.getName(scope.libraryID)}"`;
		let r = await this.moveKeys(scope, { confirm: plan => this.confirmKeyMove(this.describeKeyMove(plan, where)) });
		if (!r.cancelled) this.notify(`Moved ${r.moved} keys to the Citation Key field` + (r.failed ? ` (${r.failed} items cannot hold one)` : ''));
	},

	registerMenus() {
		let reg = (target, menus) => {
			let id = Zotero.MenuManager.registerMenu({
				menuID: 'hicite-export-' + target.replace(/\W+/g, '-'),
				pluginID: this.id,
				target,
				menus,
			});
			// registerMenu returns false (after only a debug warning) when it rejects
			// the definition, e.g. top-level separators on the grouped item and
			// collection targets, so surface that.
			if (id) this.menuIDs.push(id);
			else Zotero.logError(new Error(`hicite: registerMenu rejected the ${target} menu`));
		};
		let regularOnly = (event, ctx) => ctx.setVisible(!!ctx.items?.some(i => i.isRegularItem()));

		reg('main/library/item', [
			{
				menuType: 'menuitem', l10nID: 'hicite-menu-pin', onShowing: regularOnly,
				onCommand: (event, ctx) => this.pinItems(ctx.items),
			},
			{
				menuType: 'menuitem', l10nID: 'hicite-menu-regenerate', onShowing: regularOnly,
				onCommand: (event, ctx) => this.pinItems(ctx.items, { force: true }),
			},
			{
				menuType: 'menuitem', l10nID: 'hicite-menu-copy', onShowing: regularOnly,
				onCommand: async (event, ctx) => {
					let keys = await this.pinItems(ctx.items);
					Zotero.Utilities.Internal.copyTextToClipboard(keys.filter(Boolean).join('; '));
				},
			},
		]);

		let single = ctx => ctx.collectionTreeRows?.length === 1
			? this.scopeOf(ctx.collectionTreeRows[0]) : null;
		reg('main/library/collection', [
			{
				menuType: 'menuitem', l10nID: 'hicite-menu-autoexport-start',
				onShowing: (event, ctx) => { let s = single(ctx); ctx.setVisible(!!s && !this.jobFor(s)); },
				onCommand: (event, ctx) => this.startAutoExport(event.target.ownerGlobal, ctx.collectionTreeRows[0]),
			},
			{
				menuType: 'menuitem', l10nID: 'hicite-menu-autoexport-now',
				onShowing: (event, ctx) => { let s = single(ctx); ctx.setVisible(!!s && !!this.jobFor(s)); },
				onCommand: (event, ctx) => this.enqueue([this.jobFor(single(ctx)).id]),
			},
			{
				menuType: 'menuitem', l10nID: 'hicite-menu-regenerate-cases',
				onShowing: (event, ctx) => ctx.setVisible(!!single(ctx)),
				onCommand: (event, ctx) => this.regenerateFromMenu(ctx, single(ctx), true),
			},
			{
				menuType: 'menuitem', l10nID: 'hicite-menu-regenerate-all',
				onShowing: (event, ctx) => ctx.setVisible(!!single(ctx)),
				onCommand: (event, ctx) => this.regenerateFromMenu(ctx, single(ctx), false),
			},
			{
				menuType: 'menuitem', l10nID: 'hicite-menu-move-keys',
				onShowing: (event, ctx) => ctx.setVisible(!!single(ctx)),
				onCommand: (event, ctx) => this.moveKeysFromMenu(ctx, single(ctx)),
			},
			{
				menuType: 'menuitem', l10nID: 'hicite-menu-autoexport-stop',
				onShowing: (event, ctx) => { let s = single(ctx); ctx.setVisible(!!s && !!this.jobFor(s)); },
				onCommand: (event, ctx) => this.stopAutoExport(single(ctx)),
			},
		]);

		reg('main/menubar/tools', [
			{
				menuType: 'menuitem', l10nID: 'hicite-menu-autoexport-run-all',
				onShowing: (event, ctx) => ctx.setVisible(this.getJobs().length > 0),
				onCommand: () => this.enqueue(this.getJobs().map(j => j.id)),
			},
		]);
	},

	addToWindow(win) {
		win.MozXULElement.insertFTLIfNeeded(this.FTL);
	},

	removeFromWindow(win) {
		win.document.querySelector(`[href="${this.FTL}"]`)?.remove();
	},

	addToAllWindows() {
		for (let win of Zotero.getMainWindows()) this.addToWindow(win);
	},

	removeFromAllWindows() {
		for (let win of Zotero.getMainWindows()) this.removeFromWindow(win);
	},

	// ------------------------------------------------------------ lifecycle

	async init({ id, version, rootURI }) {
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;

		try { await this.installTranslator(); } catch (e) { Zotero.logError(e); }
		try { await this.refreshPhoenix(); } catch (e) { Zotero.logError(e); }
		try { await this.refreshBBT(); } catch (e) { Zotero.logError(e); }
		this.watchPhoenix();

		this.registerMenus();
		this.patchExport();
		this.registerSettings();
		this.observerID = Zotero.Notifier.registerObserver({
			notify: (event, type, ids) => this.onNotify(event, type, ids),
		}, ['item', 'collection', 'collection-item'], 'hicite-export');

		// The library may have changed while Zotero was closed (e.g. by sync).
		Zotero.uiReadyPromise.then(() => this.schedule(null));
	},

	// The Settings pane, and re-running the auto-exports when a setting changes.
	async registerSettings() {
		// one observer per key: Zotero.Prefs observers match an exact pref name
		for (let name of [...Object.keys(this.SETTINGS), 'refresh']) {
			this.settingObservers.push(Zotero.Prefs.registerObserver('translators.hicite.' + name, () => {
				if (name === 'phoenixMode') this.syncPhoenixPref(); // the override changed: recompute what the translator is told
				if (name === 'bbtFormula') this.syncBBTFormula().catch(e => Zotero.logError(e));
				this.schedule(null);
			}));
		}
		try {
			await Zotero.PreferencePanes.register({
				pluginID: this.id,
				src: this.rootURI + 'preferences.xhtml',
				label: 'hicite',
				scripts: [this.rootURI + 'preferences.js'],
			});
		}
		catch (e) { Zotero.logError(e); }
	},

	destroy() {
		this.destroyed = true;
		for (let symbol of this.settingObservers) Zotero.Prefs.unregisterObserver(symbol);
		this.settingObservers = [];
		delete Zotero.HiCitePrefs; // defined by the Settings pane's script
		this.unpatch?.();
		if (this.addonListener) {
			try { this.AddonManager.removeAddonListener(this.addonListener); } catch (e) { /* shutting down */ }
			this.addonListener = null;
		}
		this.token++; // cancels a pending debounce
		if (this.observerID) Zotero.Notifier.unregisterObserver(this.observerID);
		for (let id of this.menuIDs) Zotero.MenuManager.unregisterMenu(id);
		this.menuIDs = [];
	},
};
