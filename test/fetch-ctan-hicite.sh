#!/bin/sh
# Fetch the current CTAN release of hicite and build it into test/ctan-hicite/
# (sty + tex files only). Usage: sh test/fetch-ctan-hicite.sh
set -e
cd "$(dirname "$0")"
rm -rf .ctan-build ctan-hicite
mkdir .ctan-build ctan-hicite
# ctan.org redirects to a random mirror, and some have broken certificates:
# retry (with certificate checking on) until a valid zip arrives.
ok=
for i in 1 2 3 4 5 6 7 8; do
	if curl -fsSL -m 90 -o .ctan-build/hicite.zip https://ctan.org/tex-archive/macros/latex/contrib/hicite.zip \
		&& unzip -tq .ctan-build/hicite.zip >/dev/null 2>&1; then ok=1; break; fi
	echo "download attempt $i failed, retrying..." >&2
done
[ -n "$ok" ] || { echo "could not download hicite from CTAN" >&2; exit 1; }
unzip -q .ctan-build/hicite.zip -d .ctan-build
(cd .ctan-build/hicite && make package >/dev/null 2>&1 || true)
cp .ctan-build/hicite/*.sty .ctan-build/hicite/tex/* ctan-hicite/
echo "hicite $(cat .ctan-build/hicite/VERSION) built into test/ctan-hicite"
rm -rf .ctan-build
