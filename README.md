# hicite Export for Zotero

A **Zotero 9 and 10** add-on that works like Better BibTeX, but targets the
[hicite](https://ctan.org/pkg/hicite) legal-citation LaTeX package. hicite does
not read BibTeX; its native input is its own reference definitions
(`\defjrnart{key}{author=..., title=...}`), which is what this exports.

* **Stable citation keys.** Keys are pinned in *Extra* as `Citation Key: haigh2024` (or, with the *Key store*
  setting, in Zotero's own Citation Key field; see below) the first time they are needed, so they never change under you. By default the add-on generates its own
  (family name + year, disambiguated with `a`, `b`, ...); people stored in Zotero as a single name
  ("Thomas Haigh") are recognized and keyed on the family name, institutions on their whole name
  (`anthropicpbc2025`). **Cases** are keyed by their Short Title, or else the first party without
  "Inc."/"LLC" (`grokster`, `garcia`). Alternatively a Settings choice adopts Better BibTeX's key when
  hicite can use it. Keys are built from **last names only** (`amodei2016`, not `darioamodei2016`): Zotero's single-field names are
  read as "First Last", "Last, First", "Name, Jr." and "Name [@handle]", and institutions keep their whole
  name (`anthropicpbc2025`). A key that is already pinned never changes on its own, so keys pinned by an older
  version (or adopted from Better BibTeX) keep their old form until you regenerate them.
  hicite can use a key that starts with a letter and contains only letters, digits and
  hyphens; anything else (for example `2012`) is ignored.
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
* **Settings.** Zotero > Settings > **hicite**: key source and case-key style, how many authors to list
  before "et al.", whether Short Titles become short-form names, whether a website's title is dropped when
  it repeats the author, URLs, and your auto-exports (each with its own *Include publisher* checkbox and a *Stop* button).
* **Item menu.** *hicite: Pin / Regenerate / Copy Citation Keys*; on a library or collection,
  *hicite: Regenerate Case Keys*, *hicite: Regenerate All Citation Keys…* and *hicite: Move Keys to Citation Key Field…*
  (all ask for confirmation). Copy yields
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
| Journal Article | `jrnart`; with no publication title (or, for a web-native piece, no volume and pages) it is cited like a web page instead, with a `% hicite:` note in the file |
| Book | `book` |
| Book Section, Conference Paper, Encyclopedia Article | `citecontainer`, with the container written inline as `in=book: {...}` |
| Magazine / Newspaper Article | `magart` |
| Preprint (arXiv, SSRN, ...) | `workingpaper` (`number` from the Archive ID, or read from the URL/DOI; `publisher` = repository); a preprint with no identifier is cited like a web page |
| Thesis / Manuscript | `manuscript` |
| Letter | `letter` (sender, recipient as `to`) when it has a sender or recipient, else `manuscript` |
| Report | `workingpaper` (if it has a report number) else `book` |
| Case | `case` (`p`/`d` split at "v."; Short Title as `inline`; a reported case is dated by its year, an unreported one by its full date; reporter "Slip Op." becomes the `slip` flag) |
| Case named for a court paper ("Complaint: Garcia v. Character Technologies", "Order Granting ..., Bartz v. Anthropic PBC") or with the Short Title "Complaint" | `casedoc`, the case as an anonymous reference |
| Statute (code + section) | `statcode`: the one-line form (`17 U.S.C. S 102`) for a bare section; the keyword form (name, short form, year kept) for an act with a name or a Short Title |
| Statute filed under "Federal Register" (executive orders, agency guidance; also "C.F.R." with a page) | `govdoc` (`Exec. Order No. 14110, Title, 88 Fed. Reg. 75191`) |
| Statute "U.S. Const. Art. I, §8, cl. 8" / "U.S. Const. amend. I" | `const` / `constamend` |
| Bill | `bill`; hicite needs the Congress, taken from Session, else "119th Congress" in the URL or text, else the date |
| Web Page, Blog Post and everything else | `website` |

Editors and translators (books and containers): hicite keeps them in one `editor` list with an `edtype` role
label. Translators alone are listed with `edtype={trans.}`; the same people who edited and translated get
`ed. & trans.` (`eds. & trans.` for several); a translator who is not the editor goes in a parenthetical, since
hicite cannot label two different roles in one reference.

Text conventions, matching a hand-coded hicite file: accented letters, curly quotes and dashes are written as TeX
(`G{\"o}del`, `---`), because hicite builds control-sequence names from journal names, institutions and case names
and stops on a raw non-ASCII character there (emoji are dropped); a list of three or more names carries `noetal`
(hicite warns without it; the output is unchanged); titles and journal names get Bluebook title case
(*Finding structure in time* becomes *Finding Structure in Time*; words with capitals inside, such as *iPhone*, titles in
another language, and titles already in title case are left alone; turn it off in Settings); a Stanford-Encyclopedia
style edition ("Spring 2023") becomes the container's date; a page of "0" is ignored. An empty item is skipped with a comment.

Other export rules: with an *Authors listed* limit set, a longer author list is cut off and the last name kept
gets hicite's " et al." (`author={Cy {Gamma} et al.}`); editors are never cut. A Short Title becomes the short-form name (`inline`); single-field names that look
like people are exported as people (with particles and suffixes: `Bart {van Merrienboer}`,
`Dean {Edmonds {Jr.}}`); a website's title is left out when it repeats the author; URLs are kept for web
sources and for cases without a reporter, and dropped for books, chapters and articles that have a print
citation (a journal article keeps its URL only if volume or pages are missing).

Export option **Include publisher** (off by default) adds publishers to books,
since Bluebook/Indigo Book style normally omits them. Each auto-export job keeps its own choice; change it in Settings > hicite.

## Types and parameters Zotero lacks

The exporter also reads hicite-only data kept in Extra: `hicite-doctype: <type>` on a Zotero Document
(`govdoc`, `casedoc`, `congrec`, `const`, `constamend`, `modelcode`) or Statute (`statsess`), and
`hicite-<param>: value` lines for parameters with no Zotero field (`origsect`, `slip`, `dbid`, `enbanc`, ...).
Flags take `yes`/`no`; `citation`, `in`, `prior`, `subsequent` are written as hicite syntax; unknown `hicite-*`
lines are exported as parameters of the same name. The companion plugin
[zotero-legal](https://github.com/jnsheff/zotero-legal) adds the item-pane rows and menus for editing them;
`test/legal-types.json` is a copy of its catalog.

## citation-phoenix (Juris-M data)

[citation-phoenix](https://github.com/rischconsulting/citation-phoenix) brings Juris-M's legal features to Zotero 8-10. It keeps
Juris-M's data in an `mlzsync1:` block in Extra, and it keeps Juris-M court IDs (`court.appeals`, `district.court`) in the Court
field, which a hicite file cannot use as written. This add-on notices whether citation-phoenix is installed and enabled
(Zotero's add-on manager, re-checked whenever it is enabled, disabled, installed or removed) and behaves accordingly:

| | without citation-phoenix | with citation-phoenix |
|---|---|---|
| Court | the Court field, as typed | a court ID is translated using the case's jurisdiction (`court.appeals` + Second Circuit = `2d Cir.`, `district.court` + S.D. New York = `S.D.N.Y.`). A court the reporter already identifies is left out (`N.Y.2d`, `U.S.`). An ID it cannot translate with certainty is left out and noted in the `.tex` file (`% hicite: court ecj~chamber.1 [eu.int:cjeu] not translated`). A typed court (`2d Cir.`) is never touched. |
| Reporter | Zotero's Reporter field | the field, else the reporter in the Juris-M data |
| Regulations | statutes export as `statcode` | a statute citation-phoenix marks as a regulation exports as `regcode`; one filed under "Federal Register" is still a `govdoc` |
| Treaties | a Document is a web page | a Document citation-phoenix marks as a treaty exports as `treaty` (name, signing date, reporter, volume, page) |
| Migration script | usable | refuses to run (it would replace the court IDs citation-phoenix keeps) |

Everything in the right-hand column is off when citation-phoenix is absent, so an environment without it exports exactly as before.
Settings > hicite > **Legal data** shows what was found and lets you choose *Automatically* (the default), *Always* or *Never*.
Technically the add-on sets the hidden pref `translators.hicite.phoenix` to `on` or `off`, because the export translator runs in a
sandbox and cannot look at add-ons itself; changing the pref re-runs your auto-exports.

What it does not do (yet): foreign courts and foreign-law types (`eucase`, `frcase`, `engstat`, ...), citation-phoenix's gazette,
legal-commentary and classic types, and parallel citations are exported as ordinary Zotero items.

## Migrating from Juris-M

If you use citation-phoenix, skip this section: the add-on reads its data directly (see above), and the script below refuses to
run while citation-phoenix is enabled.

Juris-M kept a case's reporter (e.g. `F.3d`) in Extra as an `mlzsync1:` block and its court as
an internal ID (`court.appeals`, `district.court`, `supreme.court`), neither of which this
add-on reads. `tools/fill-reporter-from-jurism.js` copies the reporter into Zotero's Reporter
field and turns the court IDs into the Bluebook abbreviations hicite expects, using each case's
legacy jurisdiction to pick the circuit or district (`court.appeals` + Second Circuit becomes
`2d Cir.`; `district.court` + S.D. New York becomes `S.D.N.Y.`). A Supreme Court court is left
blank when the reporter (`U.S.`, `S. Ct.`, ...) already identifies it. A state's highest court is
written as the state's Bluebook abbreviation (`Tex.`, `Cal.`, `Mass.`), and left blank when the
state's own official reporter identifies it (`N.Y.2d`); New York's Supreme Court, a trial court, is
not mistaken for its highest. Intermediate state courts and foreign courts it cannot translate with
certainty are listed, not guessed. Typed-out courts ("United States
Court of Appeals, Federal Circuit") are only rewritten if you opt in.

It is meant to be pasted into Tools > Developer > Run JavaScript. It defaults to a dry run, skips
shared group libraries unless told otherwise, refuses to apply without a backup confirmation,
and can be reverted step by step. Read the comment at the top of the file first.

## Key store: Extra or Zotero's Citation Key field

Settings > *Key store* chooses where new keys are written: a `Citation Key:` line in **Extra** (the default) or
Zotero's own **Citation Key field**, the one Better BibTeX also uses. Reading is the same either way: a key in
Extra comes first, then (with the field store, or *Use Better BibTeX's key*) the field, so switching the setting
never changes a key you already cite. The export translator reads keys the same way.

To move existing keys, right-click a collection or library and choose *hicite: Move Keys to Citation Key
Field…*. The confirmation lists what will happen before anything is changed: how many keys move, which keys
replace a *different* key already in the field (the hicite key wins, since it is the one your documents cite),
and how many items are left alone. Items are saved quietly (no change to Date Modified, no notification to other
add-ons), the `Citation Key:` line is removed from Extra, and the setting is switched to the field. Item types
without the field keep their key in Extra.

If Better BibTeX also writes that field, turn off its automatic key generation, or it can overwrite hicite's keys
when an item changes. Items that have only a Better BibTeX key keep it until you regenerate them.

## Better BibTeX

Better BibTeX 9 keeps citation keys in Zotero's native Citation Key field, and (depending on its
"reset key on change" setting) regenerates a key whenever an item is saved. Saving an item from an
add-on or script therefore silently replaces its key. This add-on's key pinning and the Juris-M
migration script both save with `skipNotifier`, so Better BibTeX never sees those edits and your keys
stay put. If you write your own scripts that edit items, do the same.

## Layout

```
addon/
  manifest.json          plugin manifest (Zotero 9-10)
  bootstrap.js           lifecycle shim
  hicite-export.js       keys, menus (Zotero.MenuManager), auto-export, settings wiring
  preferences.xhtml/.js  the Settings pane
  translator/hicite.js   the export translator
tools/                   release helper and the one-off Juris-M migration script (installed into Zotero's translators dir)
  locale/en-US/*.ftl     menu labels
  prefs.js               default prefs (settings are the hidden prefs translators.hicite.*)
test/                    see below
```

## Tests

`make test` runs, without Zotero (each test must print its success marker, or the
run fails):

1. auto-export job execution against mocks (startup ordering, write-if-changed,
   deleted collections, failure isolation), key selection (usable vs. unusable keys, Better BibTeX keys, duplicates, cases),
   menu registration against Zotero's menu rules, the manifest rules, the
   Export-dialog hook, and the publisher option;
2. citation-phoenix support: detection and the pref the translator reads, the translator with that mode on and off (off must
   export exactly as before), the court tables against `tools/fill-reporter-from-jurism.js`, and that script's guard; the
   phoenix-mode output is also in the compile below;
3. key-generator parity between the plugin and the translator (the algorithm
   is duplicated because translators run in a sandbox);
4. the translator on `test/sample-items.json` (including TeX special
   characters, `#`/`%` in URLs, unbalanced braces, pinned-key priority);
5. a compile of that output against the **current CTAN release of hicite**
   (`test/fetch-ctan-hicite.sh` downloads and builds it into `test/ctan-hicite/`;
   any hicite installed elsewhere is masked). Last run: hicite 1.1.0, no errors.

The key test needs macOS's `jsc` (JavaScriptCore shell); the others use `osascript`.

## Limitations

* **Not run inside Zotero.** `bootstrap.js` and `hicite-export.js` are
  syntax-checked, and their Zotero API usage was checked against Zotero's
  current source (MenuManager, Translate.Export, Search, FilePicker,
  translators directory), but not executed. Expect to debug a first run.
* Keys follow fixed patterns (family name + year; cases by Short Title or first party), with the choices
  in Settings; there is no free-form key formula. Existing keys are pinned, so a changed setting applies to
  items without a key: use *Regenerate* to re-key existing ones.
* The Settings pane could only be checked against Zotero's source and a fake DOM, not run in Zotero.
* Legal types beyond the table (hearings, ...) fall back to
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
