#!/bin/sh
# Compile test/doc.tex against the CTAN hicite tree only (any other installed
# hicite is masked by pointing TEXMFHOME away). Fails on any TeX error.
cd "$(dirname "$0")"
[ -d ctan-hicite ] || sh fetch-ctan-hicite.sh || exit 1
export TEXMFHOME=/nonexistent TEXINPUTS="$PWD/ctan-hicite:"
pdflatex -interaction=nonstopmode -halt-on-error doc.tex >log.txt 2>&1 && \
pdflatex -interaction=nonstopmode -halt-on-error doc.tex >log.txt 2>&1
status=$?
tr -d "\n" < log.txt | grep -q "ctan-hicite/histrings.sty" || { echo "WARNING: did not load CTAN hicite"; status=1; }
grep -n "^!" -A4 log.txt | head -30
[ $status -eq 0 ] && echo "compiled OK against CTAN hicite" || echo "FAILED (see test/log.txt)"
exit $status
