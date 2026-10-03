/* Script for the hicite Settings pane (preferences.xhtml). Loaded into the pane's scope before
 * the markup is inserted; Zotero fires the fragment's `load` event once it is in the document,
 * which calls Zotero.HiCitePrefs.init(). The settings themselves are bound to preferences by the
 * `preference` attributes; this only renders the auto-export jobs, which live in one pref as JSON. */

Zotero.HiCitePrefs = {
	JOBS: 'extensions.hicite-export.autoExports',
	TOUCH: 'extensions.zotero.translators.hicite.refresh', // changing it makes the add-on re-run the jobs

	jobs() {
		try {
			let jobs = JSON.parse(Zotero.Prefs.get(this.JOBS, true) || '[]');
			return Array.isArray(jobs) ? jobs : [];
		}
		catch (e) { return []; }
	},

	save(jobs) {
		Zotero.Prefs.set(this.JOBS, JSON.stringify(jobs), true);
		Zotero.Prefs.set(this.TOUCH, String(Date.now()), true);
	},

	scopeName(job) {
		if (job.collectionKey) {
			let c = Zotero.Collections.getByLibraryAndKey(job.libraryID, job.collectionKey);
			return `Collection "${c ? c.name : '(deleted)'}" in ${Zotero.Libraries.getName(job.libraryID)}`;
		}
		return `Library "${Zotero.Libraries.getName(job.libraryID)}"`;
	},

	setPublisher(id, on) {
		let jobs = this.jobs();
		let job = jobs.find(j => j.id === id);
		if (!job || !!job.includePublisher === !!on) return;
		job.includePublisher = !!on;
		this.save(jobs);
	},

	remove(id) {
		this.save(this.jobs().filter(j => j.id !== id));
		this.render();
	},

	render() {
		let box = document.getElementById('hicite-jobs');
		if (!box) return;
		while (box.firstChild) box.firstChild.remove();
		let jobs = this.jobs();
		if (!jobs.length) {
			let none = document.createXULElement('label');
			none.setAttribute('value', 'No auto-exports yet.');
			box.append(none);
			return;
		}
		for (let job of jobs) {
			let row = document.createXULElement('hbox');
			row.setAttribute('align', 'center');

			let text = document.createXULElement('vbox');
			text.setAttribute('flex', '1');
			let path = document.createXULElement('label');
			path.setAttribute('value', job.path);
			path.setAttribute('crop', 'start');
			path.style.fontWeight = 'bold';
			let scope = document.createXULElement('label');
			scope.setAttribute('value', this.scopeName(job));
			text.append(path, scope);

			let publisher = document.createXULElement('checkbox');
			publisher.setAttribute('label', 'Include publisher');
			publisher.checked = !!job.includePublisher;
			publisher.addEventListener('command', () => this.setPublisher(job.id, publisher.checked));

			let stop = document.createXULElement('button');
			stop.setAttribute('label', 'Stop');
			stop.addEventListener('command', () => this.remove(job.id));

			row.append(text, publisher, stop);
			box.append(row);
		}
	},

	// The line saying whether citation-phoenix was found. Asks the add-on manager itself (this script runs in the
	// pane, not in the add-on's scope); the add-on does the same to decide what to tell the translator.
	async renderPhoenix() {
		let label = document.getElementById('hicite-phoenix-status');
		if (!label) return;
		let text = 'citation-phoenix: not installed';
		try {
			let { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
			let addon = await AddonManager.getAddonByID('citation-phoenix@michaelrisch.com');
			if (addon) text = `citation-phoenix ${addon.version}: ${addon.isActive ? 'installed and enabled' : 'installed but disabled'}`;
		}
		catch (e) { text = 'citation-phoenix: could not check'; }
		label.setAttribute('value', text);
	},

	init() {
		this.render();
		this.renderPhoenix();
	},
};
