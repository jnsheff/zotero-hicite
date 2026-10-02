#!/bin/sh
# Runs every test and fails unless each prints its success marker (osascript and
# jsc exit 0 even when a test reports failure).
cd "$(dirname "$0")/.." || exit 1
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
fail=0
run() { # marker command...
	marker=$1; shift
	out=$("$@" 2>&1)
	echo "$out" | grep -v '^ok ' | tail -4
	echo "$out" | grep -q "$marker" || { echo "  ^^^ FAILED: expected '$marker' from: $*"; fail=1; }
}
run '^manifest OK'          python3 test/check-manifest.py 9.0.6
run '^manifest OK'          python3 test/check-manifest.py 10.0.4
run '^menus OK'             osascript -l JavaScript test/menus-jxa.js
run '^hook OK'              osascript -l JavaScript test/hook-jxa.js
run '^publisher option OK'  osascript -l JavaScript test/publisher-jxa.js
run '^translator OK'        "$JSC" test/translator-jsc.js
run '^types OK'              "$JSC" test/types-jsc.js
run '^settings OK'          "$JSC" test/settings-jsc.js
run '^pane OK'              "$JSC" test/pane-jsc.js
run '^keys OK'              "$JSC" test/keys-jsc.js
run '^keystore OK'          "$JSC" test/keystore-jsc.js
run '^bootstrap OK'         "$JSC" test/bootstrap-jsc.js
run '^fill-reporter OK'     "$JSC" test/fill-reporter-jsc.js
run '^runjob OK'            "$JSC" test/runjob-jsc.js
run '^all keys match'       osascript -l JavaScript test/parity-jxa.js
osascript -l JavaScript test/run-jxa.js >/dev/null || fail=1
run '^compiled OK against CTAN hicite' sh test/compile.sh
[ $fail -eq 0 ] && echo "ALL TESTS PASSED" || echo "TESTS FAILED"
exit $fail
