#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
STAGE=$(mktemp -d)
OUT="$ROOT/release-packages"

trap 'rm -rf "$STAGE"' EXIT

cd "$ROOT"
pnpm build
mkdir -p "$OUT"
cp package.json openclaw.plugin.json README.md README.zh.md LICENSE "$STAGE/"
cp -R bin dist skills "$STAGE/"

(
  cd "$STAGE"
  npm pkg delete devDependencies
  npm pack --ignore-scripts --pack-destination "$OUT"
)
