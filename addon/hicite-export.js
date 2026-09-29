/* hicite Export for Zotero: main module.
 *
 *  - installs the "hicite" export translator (translator/hicite.js)
 *  - pins a stable "Citation Key: ..." line in Extra for new items (the same
 *    place Better BibTeX uses), with a/b/c disambiguation
 *  - item / collection / Tools menus via Zotero.MenuManager
 *  - auto-export: keeps .tex files up to date as the library changes
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

	// ------------------------------------------------------------- keys
	// Keep baseKey() in sync with translator/hicite.js.

	STOPWORDS: /^(a|an|the|of|on|in|re|and|for|to)$/i,

	slug(s) {
		return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
	},

	baseKey(item) {
		let name = '';
		if (item.itemType === 'case') {
			for (let w of (item.getField('caseName') || item.getField('title') || '').split(/\s+/)) {
				if (!this.STOPWORDS.test(w)) { name = w; break; }
			}
		}
		else {
			let creators = item.getCreators();
			let primary = Zotero.CreatorTypes.getPrimaryIDForType(item.itemTypeID);
			let c = creators.find(x => x.creatorTypeID === primary) || creators[0];
			if (c) name = c.lastName || '';
		}
		if (!this.slug(name)) {
			for (let w of (item.getField('title') || '').split(/\s+/)) {
				if (!this.STOPWORDS.test(w) && this.slug(w)) { name = w; break; }
			}
		}
		let key = this.slug(name) || 'ref';
		if (!/^[a-z]/.test(key)) key = 'ref' + key;
		let year = Zotero.Date.strToDate(item.getField('date') || '').year;
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

	getKey(item) {
		let m = /^\s*Citation Key\s*:\s*(\S+)\s*$/im.exec(item.getField('extra') || '');
		return m ? m[1] : '';
	},

	setKey(item, key) {
		let lines = (item.getField('extra') || '').split('\n')
			.filter(l => !/^\s*Citation Key\s*:/i.test(l));
		while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
		lines.push('Citation Key: ' + key);
		item.setField('extra', lines.join('\n'));
	},

	async isTaken(item, key) {
		let s = new Zotero.Search();
		s.libraryID = item.libraryID;
		s.addCondition('extra', 'contains', 'Citation Key: ' + key);
		s.addCondition('noChildren', 'true');
		let ids = await s.search();
		for (let other of await Zotero.Items.getAsync(ids)) {
			if (other.id !== item.id && this.getKey(other) === key) return true;
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

	async pin(item, { force = false } = {}) {
		if (!item.isRegularItem() || item.isFeedItem) return '';
		let existing = this.getKey(item);
		if (existing && !force) return existing;
		let key = await this.uniqueKey(item);
		if (key === existing) return key;
		this.setKey(item, key);
		await item.saveTx({ skipDateModifiedUpdate: true });
		return key;
	},

	// ------------------------------------------------------------ translator

	async installTranslator() {
		let path = PathUtils.join(Zotero.getTranslatorsDirectory().path, this.TRANSLATOR_FILE);
		let source = await Zotero.File.getContentsFromURLAsync(this.rootURI + 'translator/hicite.js');
		let current = null;
		try { current = await Zotero.File.getContentsAsync(path); } catch (e) { /* not installed yet */ }
		if (current === source) return;
		await Zotero.File.putContentsAsync(path, source);
		await Zotero.Translators.reinit();
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
			let translator = await Zotero.Translators.get(this.TRANSLATOR_ID);
			if (!translator) throw new Error('hicite translator is not installed');
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
		this.observerID = Zotero.Notifier.registerObserver({
			notify: (event, type, ids) => this.onNotify(event, type, ids),
		}, ['item', 'collection', 'collection-item'], 'hicite-export');

		// The library may have changed while Zotero was closed (e.g. by sync).
		Zotero.uiReadyPromise.then(() => this.schedule(null));
	},

	destroy() {
		this.destroyed = true;
		this.unpatch?.();
		this.token++; // cancels a pending debounce
		if (this.observerID) Zotero.Notifier.unregisterObserver(this.observerID);
		for (let id of this.menuIDs) Zotero.MenuManager.unregisterMenu(id);
		this.menuIDs = [];
	},
};
