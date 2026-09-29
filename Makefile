.PHONY: xpi test

xpi:
	rm -f hicite-export.xpi
	cd addon && zip -qr ../hicite-export.xpi . -x ".*"

# Key parity, translator output, and a compile against current CTAN hicite.
test:
	sh test/run-all.sh
