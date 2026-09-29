/* hicite Export for Zotero (Zotero 9). The implementation lives in
 * hicite-export.js, which assigns the HiCite global declared here. */

var HiCite;

async function startup({ id, version, rootURI }) {
	await Zotero.initializationPromise;
	Services.scriptloader.loadSubScript(rootURI + 'hicite-export.js');
	await HiCite.init({ id, version, rootURI });
	HiCite.addToAllWindows();
}

function shutdown() {
	if (!HiCite) return;
	HiCite.removeFromAllWindows();
	HiCite.destroy();
	HiCite = undefined;
}

function install() {}

async function uninstall() {
	await Zotero.initializationPromise;
	// The script is not loaded when Zotero uninstalls a disabled plugin.
	try {
		let dir = Zotero.getTranslatorsDirectory().path;
		await IOUtils.remove(PathUtils.join(dir, 'hicite.js'), { ignoreAbsent: true });
		await Zotero.Translators.reinit();
	} catch (e) { Zotero.logError(e); }
}

function onMainWindowLoad({ window }) { HiCite?.addToWindow(window); }
function onMainWindowUnload({ window }) { HiCite?.removeFromWindow(window); }
