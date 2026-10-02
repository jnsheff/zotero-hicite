/* hicite Export for Zotero: main module.
 *
 *  - installs the "hicite" export translator (translator/hicite.js)
 *  - pins a stable "Citation Key: ..." line in Extra for new items (the same
 *    place Better BibTeX uses), with a/b/c disambiguation
 *  - item / collection / Tools menus via Zotero.MenuManager
 *  - auto-export: keeps .tex files up to date as the library changes
 *  - a Settings pane (preferences.xhtml) for the export and key settings
 *
 * Written against the Zotero 8/9 plugin APIs.
 */

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
	SETTINGS: { keySource: 'own', keyStore: 'extra', caseKeys: 'shorttitle', shortTitleInline: true, omitRedundantSite: true, includeUrls: true, maxAuthors: '0' },
	settingObservers: [],

	pref(name) {
		let v = Zotero.Prefs.get('translators.hicite.' + name);
		return v === undefined || v === null ? this.SETTINGS[name] : v;
	},

	// ------------------------------------------------------------- keys
	// Keep baseKey() in sync with translator/hicite.js.

	STOPWORDS: /^(a|an|the|of|on|in|re|and|for|to)$/i,

	// A key hicite can use as a reference nickname: starts with a letter (a
	// leading digit reads as a volume number), no spaces or TeX specials.
	KEY_OK: /^[A-Za-z][A-Za-z0-9-]*$/,

	slug(s) {
		return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
	},

	// Words that mark an institution rather than a person, and name particles. Keep in sync with
	// translator/hicite.js (test/parity-jxa.js compares the two).
	ORG_WORDS: /\b(inc|incorporated|llc|ltd|limited|corp|corporation|company|co|foundation|institute|university|college|commission|committee|council|office|department|dept|agency|center|centre|association|society|group|labs?|team|board|bureau|government|congress|senate|administration|organization|organisation|conference|legislatures?|initiative|project|network|press|news|review|journal|policy|division|ministry|union|alliance|consortium|forum|trust|fund|bank|pbc|ai|hai|gov|technologies|systems|research|library|museum|school|service|services|international|global)\b/i,
	PARTICLES: /^(van|von|de|der|den|di|da|del|della|la|le|du|bin|ibn|al|el|ter|ten)$/i,
	CORP_SUFFIX: /[,\s]+(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|pbc|lp|llp|gmbh|ag|sa)\.?$/i,

	// "First Last [Suffix]" from the forms people are typed in: drops a "[@handle]" and a trailing
	// ";", reads "Hill, Jr." as a suffix and "Last, First" as inverted.
	tidyName(name) {
		name = String(name || '').replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/[;\s]+$/, '').trim();
		let m = /^(.+?),\s*(jr\.?|sr\.?|ii|iii|iv)$/i.exec(name);
		if (m) return m[1] + ' ' + m[2];
		m = /^([^,;]+),\s*([^,;]+)$/.exec(name);
		if (m && !this.ORG_WORDS.test(name) && /^[A-Z\u00C0-\u00DD]/.test(m[1]) && /^[A-Z\u00C0-\u00DD]/.test(m[2])) return m[2] + ' ' + m[1];
		return name;
	},

	// A single-field name (Zotero's fieldMode 1) is a person if it is 2-5 capitalized words with no
	// institution words, digits, commas or all-caps tokens.
	looksLikePerson(name) {
		name = this.tidyName(name);
		let t = name.split(/\s+/);
		if (t.length < 2 || t.length > 5) return false;
		if (/[,;&\d]/.test(name) || this.ORG_WORDS.test(name) || /^the\s/i.test(name)) return false;
		for (let w of t) {
			if (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w) && !/^[A-Z]\.?$/.test(w)) return false;
			if (!(/^[A-Z\u00C0-\u00DD]/.test(w) || this.PARTICLES.test(w) || /^st\.?$/i.test(w))) return false;
		}
		return true;
	},

	splitPerson(name) {
		let t = this.tidyName(name).split(/\s+/), suffix = '';
		if (t.length > 2 && /^(jr|sr|ii|iii|iv)\.?$/i.test(t[t.length - 1])) suffix = t.pop();
		let family = [t.pop()];
		while (t.length > 1 && this.PARTICLES.test(t[t.length - 1])) family.unshift(t.pop());
		return { given: t.join(' '), family: family.join(' '), suffix };
	},

	// The name a key is built from: the family name of a person, the whole name of an institution.
	creatorFamily(c) {
		let single = c.fieldMode === 1 || !c.firstName;
		if (!single) return c.lastName || '';
		let nm = c.lastName || '';
		return this.looksLikePerson(nm) ? this.splitPerson(nm).family : nm;
	},

	firstWord(text) {
		for (let w of String(text).split(/\s+/)) {
			if (!this.STOPWORDS.test(w) && this.slug(w)) return w;
		}
		return '';
	},

	// Cases: the Short Title if there is one, else the first party (without "Inc.", "LLC", ...);
	// or, with the "name and year" setting, the first word of the name plus the year.
	baseKey(item) {
		let name = '';
		if (item.itemType === 'case') {
			let caseName = item.getField('caseName') || item.getField('title') || '';
			if (this.pref('caseKeys') === 'shorttitle') {
				let m = /^(.+?)\s+v\.?\s+.+$/i.exec(caseName.trim());
				let party = m ? m[1] : caseName.trim();
				let key = this.slug(item.getField('shortTitle')) || this.slug(party.replace(this.CORP_SUFFIX, '')) || this.slug(party);
				key = key || 'case';
				return /^[a-z]/.test(key) ? key : 'ref' + key;
			}
			name = this.firstWord(caseName);
		}
		else {
			let creators = item.getCreators();
			let primary = Zotero.CreatorTypes.getPrimaryIDForType(item.itemTypeID);
			let c = creators.find(x => x.creatorTypeID === primary) || creators[0];
			if (c) name = this.creatorFamily(c);
		}
		if (!this.slug(name)) name = this.firstWord(item.getField('title') || '');
		let key = this.slug(name) || 'ref';
		if (!/^[a-z]/.test(key)) key = 'ref' + key;
		// 'year' handles types whose date field has another name (dateDecided, ...)
		let year = item.getField('year');
		if (!/^\d{4}$/.test(year) || year === '0000') year = '';
		return key + (year || '');
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

	// The key hicite uses for an item: a pinned key in Extra; with the key store "Zotero's Citation Key
	// field", the usable key in that field when there is none in Extra (a key left in Extra is hicite's
	// own and wins until "Move Keys to Citation Key Field" has moved it, so switching the setting never
	// changes a key you already use).
	getKey(item) {
		let extra = this.getExtraKey(item);
		if (extra || !this.storeInField()) return extra;
		return this.getNativeKey(item);
	},

	storeInField() {
		return this.pref('keyStore') === 'field';
	},

	// The key in Zotero's native Citation Key field (e.g. from Better BibTeX), if usable.
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

	// Store `key` for the item: in Zotero's Citation Key field (and drop the line from Extra) when that is
	// the key store and the item type has the field, else as a "Citation Key:" line in Extra.
	setKey(item, key) {
		if (this.storeInField() && this.writeNativeKey(item, key)) return;
		this.clearExtraKey(item);
		let extra = item.getField('extra') || '';
		item.setField('extra', (extra ? extra + '\n' : '') + 'Citation Key: ' + key);
	},

	async isTaken(item, key) {
		let conditions = [['extra', 'contains', 'Citation Key: ' + key]];
		if (this.storeInField()) conditions.push(['citationKey', 'is', key]);
		for (let [field, op, value] of conditions) {
			let s = new Zotero.Search();
			s.libraryID = item.libraryID;
			s.addCondition(field, op, value);
			s.addCondition('noChildren', 'true');
			let ids = await s.search();
			for (let other of await Zotero.Items.getAsync(ids)) {
				if (other.id !== item.id && this.getKey(other) === key) return true;
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

	// Pin a citation key in Extra. A usable existing key is kept; otherwise, if the key source
	// setting is "adopt", a usable native key (Better BibTeX's) is adopted so that .bib and hicite
	// keys agree; otherwise one is generated. `force` always generates.
	async pin(item, { force = false } = {}) {
		if (!item.isRegularItem() || item.isFeedItem) return '';
		let existing = this.getKey(item);
		if (existing && !force) return existing;
		// Better BibTeX's key is only adopted when the "adopt" key source is selected.
		let native = !force && this.pref('keySource') === 'adopt' && !this.storeInField() ? this.getNativeKey(item) : '';
		let key = native || await this.uniqueKey(item);
		if (key === existing) return key;
		this.setKey(item, key);
		// skipNotifier: other add-ons must not react to this edit. Better BibTeX, for one, can be
		// set to regenerate an item's key whenever the item changes, which would replace the
		// user's keys just because we pinned one.
		await item.saveTx({ skipDateModifiedUpdate: true, skipNotifier: true });
		return key;
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
				`Regenerate the citation keys of ${count} ${what} in ${where}?\n\nEach key is replaced by one generated ` +
				'from the current settings. Anything that cites the old keys (LaTeX files, exported .tex files) ' +
				'will need updating.');
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
			'hicite keys do not change, so documents that cite them are unaffected. Afterwards hicite stores and reads keys in the ' +
			`Citation Key field (the "Key store" setting is switched). ${n} items will be modified.`);
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
		Zotero.Prefs.set('translators.hicite.keyStore', 'field');
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
			this.settingObservers.push(Zotero.Prefs.registerObserver('translators.hicite.' + name, () => this.schedule(null)));
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
		this.token++; // cancels a pending debounce
		if (this.observerID) Zotero.Notifier.unregisterObserver(this.observerID);
		for (let id of this.menuIDs) Zotero.MenuManager.unregisterMenu(id);
		this.menuIDs = [];
	},
};
