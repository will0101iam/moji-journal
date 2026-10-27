#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TARGET_DIR=${1:-/Users/bytedance/Downloads}
HTML_NAME=${2:-记账.html}

mkdir -p "$TARGET_DIR"
cp "$ROOT/index.html" "$TARGET_DIR/$HTML_NAME"

for asset in apple-touch-icon.png icon-192.png icon-512.png manifest.webmanifest; do
  cp "$ROOT/$asset" "$TARGET_DIR/$asset"
done

for required in "$TARGET_DIR/$HTML_NAME" \
  "$TARGET_DIR/apple-touch-icon.png" \
  "$TARGET_DIR/icon-192.png" \
  "$TARGET_DIR/icon-512.png" \
  "$TARGET_DIR/manifest.webmanifest"; do
  test -f "$required"
done

printf 'MOJI standalone bundle exported to %s\n' "$TARGET_DIR"
