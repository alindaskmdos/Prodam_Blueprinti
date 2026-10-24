#!/usr/bin/env bash
# Usage: run-tests.sh [--regen]   (compile samples/spaghetti, run tests/*.in, compare with tests/*.out)
set -u
cd "$(dirname "$0")"
OUT="${TMPDIR:-/tmp}/spaghetti-classes.$$"
mkdir -p "$OUT"
find src -name '*.java' > "$OUT/sources.txt"
javac -encoding UTF-8 -d "$OUT" @"$OUT/sources.txt" || exit 1
fail=0
for in in tests/*.in; do
  exp="${in%.in}.out"
  act="$OUT/actual.txt"
  java -Dstdout.encoding=UTF-8 -cp "$OUT" SpaghettiCodeExample < "$in" > "$act"
  if [ "${1:-}" = "--regen" ]; then cp "$act" "$exp"; fi
  if cmp -s "$act" "$exp"; then echo "PASS $in"; else echo "FAIL $in"; fail=1; fi
done
rm -rf "$OUT"
exit $fail
