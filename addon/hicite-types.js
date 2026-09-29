/* hicite reference types and fields that Zotero lacks (hicite-types.json).
 *
 * Zotero cannot be given real new item types or fields by a plugin, so:
 *  - a hicite type Zotero has no item type for (govdoc, casedoc, congrec, const, constamend,
 *    modelcode) is a Zotero Document whose Extra field has "hicite-doctype: <type>";
 *  - a hicite parameter with no Zotero field is an Extra line "hicite-<param>: value";
 *  - both are edited as ordinary rows in the item pane, shown only where they apply.
 * The export translator reads the same Extra lines. Assigned to the HiCiteTypes global. */
var HiCiteTypes = {
	rowIDs: [],
	menuIDs: [],

	load(json) {
		this.catalog = JSON.parse(json);
		this.byID = {};
		for (let t of this.catalog.types) this.byID[t.id] = t;
		// Extra-only parameters, once each, with the first label they were given
		this.params = {};
		for (let t of this.catalog.types) {
			for (let f of t.fields) if (!f.z && !this.params[f.p]) this.params[f.p] = f;
		}
	},

	// ---- Extra field lines
	getLine(item, name) {
		let m = new RegExp('^\\s*hicite-' + name + '\\s*:\\s*(.*?)\\s*$', 'im').exec(item.getField('extra') || '');
		return m ? m[1] : '';
	},
	// The Extra text with the line for `name` set (or removed, for an empty value)
	withLine(extra, name, value) {
		let re = new RegExp('^[ \\t]*hicite-' + name + '[ \\t]*:.*(?:\\r?\\n|$)', 'im');
		let lines = (extra || '').replace(re, '');
		value = String(value ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
		if (!value) return lines.replace(/\s+$/, '');
		let base = lines.replace(/\s+$/, '');
		return (base ? base + '\n' : '') + 'hicite-' + name + ': ' + value;
	},

	// ---- what hicite type is this item?
	// Types Zotero has no item type for live in a Document; statutes are a code or session law.
	typeOf(item) {
		if (!item || !item.itemType) return null;
		let id = this.getLine(item, 'doctype');
		if (item.itemType === 'document') return this.byID[id]?.virtual ? this.byID[id] : null;
		if (item.itemType === 'statute') return this.byID[id === 'statsess' ? 'statsess' : 'statcode'];
		return this.catalog.types.find(t => !t.virtual && t.base === item.itemType && t.id !== 'statcode' && t.id !== 'statsess') || null;
	},
	// the types an item can be switched between
	choices(item) {
		if (item.itemType === 'document') return this.catalog.types.filter(t => t.virtual);
		if (item.itemType === 'statute') return ['statcode', 'statsess'].map(id => this.byID[id]);
		return [];
	},
	// Names the type ids for messages and the prompt
	describeChoices(item) {
		return this.choices(item).map(t => t.id).join(', ');
	},

	// ---- item pane rows
	registerRows() {
		let reg = (opts) => {
			let rowID = Zotero.ItemPaneManager.registerInfoRow(Object.assign({
				pluginID: this.pluginID, position: 'afterCreators', editable: true,
			}, opts));
			if (rowID) this.rowIDs.push(rowID);
			else Zotero.logError(new Error('hicite: registerInfoRow rejected ' + opts.rowID));
		};

		reg({
			rowID: 'hicite-doctype',
			label: { l10nID: 'hicite-field-doctype' },
			onGetData: ({ item }) => this.typeOf(item)?.id || '',
			onItemChange: ({ item, setEnabled }) => setEnabled(this.choices(item).length > 0),
			onSetData: async ({ item, value }) => {
				value = String(value || '').trim().toLowerCase();
				let ok = !value || this.choices(item).some(t => t.id === value);
				if (!ok) {
					Zotero.alert(null, 'hicite', `Unknown hicite type "${value}". Use one of: ${this.describeChoices(item)}.`);
					return;
				}
				await this.setLine(item, 'doctype', value);
			},
		});

		for (let p of Object.keys(this.params)) {
			reg({
				rowID: 'hicite-' + p,
				label: { l10nID: 'hicite-field-' + p },
				onGetData: ({ item }) => this.getLine(item, p),
				onItemChange: ({ item, setEnabled }) => setEnabled(!!this.typeOf(item)?.fields.some(f => f.p === p && !f.z)),
				onSetData: ({ item, value }) => this.setLine(item, p, value),
			});
		}
	},

	async setLine(item, name, value) {
		let now = this.withLine(item.getField('extra'), name, value);
		if (now === (item.getField('extra') || '')) return;
		item.setField('extra', now);
		await item.saveTx();
	},

	// ---- menus
	// The item and File menus have room for one entry each per type, so the types are
	// submenus.
	registerMenus() {
		let virtual = this.catalog.types.filter(t => t.virtual);
		let itemIsSwitchable = (event, ctx) => ctx.setVisible(!!ctx.items?.length && ctx.items.every(i => this.choices(i).length));
		let reg = (menuID, target, menus) => {
			let id = Zotero.MenuManager.registerMenu({ menuID, pluginID: this.pluginID, target, menus });
			if (id) this.menuIDs.push(id);
			else Zotero.logError(new Error('hicite: registerMenu rejected ' + menuID));
		};

		reg('hicite-types-item', 'main/library/item', [{
			menuType: 'submenu', l10nID: 'hicite-menu-settype', onShowing: itemIsSwitchable,
			menus: [...virtual, this.byID.statcode, this.byID.statsess].map(t => ({
				menuType: 'menuitem', l10nID: 'hicite-type-' + t.id,
				onShowing: (event, ctx) => ctx.setVisible(!!ctx.items?.length && ctx.items.every(i => this.choices(i).some(c => c.id === t.id))),
				onCommand: async (event, ctx) => {
					for (let item of ctx.items) await this.setLine(item, 'doctype', t.id);
				},
			})),
		}]);

		reg('hicite-types-new', 'main/menubar/file', [{
			menuType: 'submenu', l10nID: 'hicite-menu-newitem',
			menus: [...virtual, this.byID.statsess].map(t => ({
				menuType: 'menuitem', l10nID: 'hicite-type-' + t.id,
				onCommand: (event) => this.newItem(event.target.ownerGlobal, t),
			})),
		}]);
	},

	async newItem(win, type) {
		let pane = win.ZoteroPane;
		let typeID = Zotero.ItemTypes.getID(type.base);
		let data = { extra: 'hicite-doctype: ' + type.id };
		await pane.newItem(typeID, data);
	},

	init(pluginID) {
		this.pluginID = pluginID;
		this.registerRows();
		this.registerMenus();
	},

	destroy() {
		for (let id of this.rowIDs) Zotero.ItemPaneManager.unregisterInfoRow(id);
		this.rowIDs = [];
		for (let id of this.menuIDs) Zotero.MenuManager.unregisterMenu(id);
		this.menuIDs = [];
	},
};
