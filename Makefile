.PHONY: xpi test

xpi:
	rm -f hicite-export.xpi
	cd addon && zip -qr ../hicite-export.xpi . -x ".*"

# Key parity, translator output, and a compile against current CTAN hicite.
test:
	python3 test/check-manifest.py 9.0.6
	python3 test/check-manifest.py 10.0.4
	osascript -l JavaScript test/menus-jxa.js
	osascript -l JavaScript test/hook-jxa.js
	osascript -l JavaScript test/publisher-jxa.js
	osascript -l JavaScript test/parity-jxa.js
	osascript -l JavaScript test/run-jxa.js >/dev/null
	sh test/compile.sh
