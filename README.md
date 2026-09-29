# hicite Export for Zotero

A **Zotero 9 and 10** add-on that works like Better BibTeX, but targets the
[hicite](https://ctan.org/pkg/hicite) legal-citation LaTeX package. hicite does
not read BibTeX; its native input is its own reference definitions
(`\defjrnart{key}{author=..., title=...}`), which is what this exports.

* **Stable citation keys.** New items get a `Citation Key: smith2020` line in
  *Extra* (the same place Better BibTeX pins keys). Collisions get `a`, `b`, ...
  suffixes. Cases with no author use the first party's name (`wheaton1834`).
  Zotero itself does not generate keys; if Better BibTeX is installed, its key
  is adopted when hicite can use it, so your `.bib` and hicite keys agree.
  hicite can use a key that starts with a letter and contains only letters,
  digits and hyphens. Otherwise (for example `2012`, which Better BibTeX's
  `auth.lower + year` produces for a case with no author) the add-on generates
  its own key and pins it in Extra, and the export ignores the unusable one.
* **Export translator.** File > Export Library, or right-click a collection >
  Export, then choose **hicite**. Writes a `.tex` file of definitions.
* **Keep updated (in the Export dialog).** Tick **Keep updated** when exporting
  a whole library or collection with the **hicite** format and the export
  becomes an auto-export job for that file, exactly as if you had set it up from
  the menu below (selected-items exports can't be kept updated). Zotero
  remembers the last-used checkbox settings, so untick it again if you don't
  want every hicite export to become a job.
* **Auto-export.** Right-click a collection (or a library) > *hicite:
  Auto-Export to File...* and pick a `.tex` file. It is rewritten a few seconds
  after any change to the library or collection (including sub-collections),
  after sync, and at startup. The file is only written when its content
  changes. Right-click again for *Export Now* / *Stop Auto-Export*; *Tools >
  hicite: Run All Auto-Exports Now* re-runs every job. Missing citation keys in
  the exported scope are pinned before each run so keys never shift as the
  library grows.
* **Item menu.** *hicite: Pin / Regenerate / Copy Citation Keys*. Copy yields
  `key1; key2`, ready to paste into `\sentence{...}`.

## Install

Download `hicite-export.xpi` from the
[latest release](https://github.com/jnsheff/zotero-hicite/releases/latest), then in
Zotero: Tools > Plugins > gear > *Install Plugin From File...* and choose it.
Requires Zotero 9 or 10 (`strict_min_version 8.999`, `strict_max_version 10.0.*`).
From 0.4.0 on, Zotero checks `updates.json` in this repository and updates the
plugin automatically. (Versions before 0.4.0 had a placeholder update URL, so
install 0.4.0 manually once.)

To build it yourself: `make xpi`.

## Use

```latex
\usepackage{hicite}
\input{refs.tex}      % the exported / auto-exported file
...
\sentence{smith2020 at 45}.
```

## Type mapping

| Zotero | hicite |
|---|---|
| Journal Article | `jrnart` |
| Book | `book` |
| Book Section | `book` (container, `key-book`) + `citecontainer` |
| Magazine / Newspaper Article | `magart` |
| Conference Paper | `procart` |
| Thesis / Manuscript / Letter | `manuscript` |
| Report | `workingpaper` (if it has a report number) else `book` |
| Case | `case` |
| Statute (code + section) | `statcode` |
| Web Page and everything else | `website` |

Export option **Include publisher** (off by default) adds publishers to books,
since Bluebook/Indigo Book style normally omits them. Jobs made from the Export
dialog keep that choice (`includePublisher` in the job JSON in the
`extensions.hicite-export.autoExports` preference).

## Layout

```
addon/
  manifest.json          plugin manifest (Zotero 9-10)
  bootstrap.js           lifecycle shim
  hicite-export.js       keys, menus (Zotero.MenuManager), auto-export
  translator/hicite.js   the export translator (installed into Zotero's translators dir)
  locale/en-US/*.ftl     menu labels
  prefs.js               default prefs
test/                    see below
```

## Tests

`make test` runs, without Zotero (each test must print its success marker, or the
run fails):

1. auto-export job execution against mocks (startup ordering, write-if-changed,
   deleted collections, failure isolation), key selection (usable vs. unusable keys, Better BibTeX keys, duplicates, cases),
   menu registration against Zotero's menu rules, the manifest rules, the
   Export-dialog hook, and the publisher option;
2. key-generator parity between the plugin and the translator (the algorithm
   is duplicated because translators run in a sandbox);
3. the translator on `test/sample-items.json` (including TeX special
   characters, `#`/`%` in URLs, unbalanced braces, pinned-key priority);
4. a compile of that output against the **current CTAN release of hicite**
   (`test/fetch-ctan-hicite.sh` downloads and builds it into `test/ctan-hicite/`;
   any hicite installed elsewhere is masked). Last run: hicite 1.1.0, no errors.

The key test needs macOS's `jsc` (JavaScriptCore shell); the others use `osascript`.

## Limitations

* **Not run inside Zotero.** `bootstrap.js` and `hicite-export.js` are
  syntax-checked, and their Zotero API usage was checked against Zotero's
  current source (MenuManager, Translate.Export, Search, FilePicker,
  translators directory), but not executed. Expect to debug a first run.
* No key-pattern preferences: keys are `lastname` + year (cases: first party +
  year). No preferences UI; jobs made from the menu default to no publisher (edit `includePublisher` in the pref).
* Legal types beyond the table (bills, hearings, regulations, ...) fall back to
  `website`; extend `emit()` in `addon/translator/hicite.js`.
* Journal names are exported unabbreviated; hicite abbreviates them itself.
* `update_url` is a placeholder (`https://localhost/...`): Zotero refuses manifests without
  one, but there is no update server, so updates are manual. Replace it if you host the plugin.

## Releasing (maintainers)

1. Bump `version` in `addon/manifest.json`; run `make test`.
2. `make xpi`, then `python3 tools/make-updates.py` (adds the new version and the
   package's SHA-256 to `updates.json`; earlier versions are kept).
3. Commit and push, then publish that exact `.xpi` (do not rebuild it, the hash would
   change): `gh release create vX.Y.Z hicite-export.xpi --title vX.Y.Z --notes ...`

## License

[MIT](LICENSE). The add-on generates input for the
[hicite](https://ctan.org/pkg/hicite) package (GPL-3.0) but contains none of its code.
