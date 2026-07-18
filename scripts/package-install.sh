#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PATH=${PATH#"$ROOT/node_modules/.bin:"}
ARCHIVE="$ROOT/release-packages/larksuite-openclaw-lark-${npm_package_version}.tgz"

"${OPENCLAW_BIN:-openclaw}" plugins install "$ARCHIVE" --force --dangerously-force-unsafe-install
