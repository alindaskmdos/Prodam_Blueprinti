#!/usr/bin/env bash
# Usage: run-tests.sh [--regen]
# Каждый *.java компилируется отдельно (javac --release 21), запускается (stdin из X.in, если есть),
# stdout сравнивается побайтово с expected/X.out, код выхода — с expected/X.exit (нет файла = 0).
# stderr не сравнивается (stack trace не входит в правило сравнения). --regen перезаписывает ожидания.
set -u
cd "$(dirname "$0")"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/roundtrip.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
mkdir -p expected
fail=0; total=0; passed=0
for src in *.java; do
  name="${src%.java}"
  total=$((total + 1))
  cls="$TMP/$name"
  mkdir -p "$cls"
  if ! javac --release 21 -encoding UTF-8 -d "$cls" "$src" 2> "$TMP/javac.err"; then
    echo "FAIL $src (compile)"; cat "$TMP/javac.err"; fail=1; continue
  fi
  input=/dev/null
  [ -f "$name.in" ] && input="$name.in"
  act="$TMP/$name.out"
  timeout 10 java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp "$cls" "$name" < "$input" > "$act" 2> "$TMP/$name.err"
  code=$?
  if [ "${1:-}" = "--regen" ]; then
    cp "$act" "expected/$name.out"
    if [ "$code" -ne 0 ]; then echo "$code" > "expected/$name.exit"; else rm -f "expected/$name.exit"; fi
  fi
  want=0
  [ -f "expected/$name.exit" ] && want="$(tr -d '[:space:]' < "expected/$name.exit")"
  if ! cmp -s "$act" "expected/$name.out"; then
    echo "FAIL $src (stdout differs)"; fail=1
  elif [ "$code" != "$want" ]; then
    echo "FAIL $src (exit $code, expected $want)"; fail=1
  else
    echo "PASS $src"; passed=$((passed + 1))
  fi
done
echo "$passed/$total passed"
exit $fail
