#!/usr/bin/env bash
# Builds a self-contained AppImage: Node.js plus the app in one executable file.
#
#   scripts/build-appimage.sh                  # for this machine (x86_64 or aarch64)
#   ARCH=aarch64 scripts/build-appimage.sh     # 64-bit ARM, e.g. Raspberry Pi OS 64-bit
#
# Writes dist/RGB_Commander_Studio-<version>-<arch>.AppImage. Downloads are
# pinned, checked against their published SHA-256 sums and cached between runs.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
ARCH="${ARCH:-$(uname -m)}"
HOST_ARCH="$(uname -m)"
NODE_VERSION="${NODE_VERSION:-24.21.0}"
APPIMAGETOOL_VERSION=1.9.1
RUNTIME_VERSION=20251108

case "$ARCH" in
  x86_64) NODE_ARCH=x64; RUNTIME_SHA=2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d ;;
  aarch64) NODE_ARCH=arm64; RUNTIME_SHA=00cbdfcf917cc6c0ff6d3347d59e0ca1f7f45a6df1a428a0d6d8a78664d87444 ;;
  *) echo "Unsupported ARCH '$ARCH': use x86_64 or aarch64." >&2; exit 1 ;;
esac
case "$HOST_ARCH" in
  x86_64) TOOL_SHA=ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0 ;;
  aarch64) TOOL_SHA=f0837e7448a0c1e4e650a93bb3e85802546e60654ef287576f46c71c126a9158 ;;
  *) echo "Can't build on $HOST_ARCH: appimagetool needs an x86_64 or aarch64 machine." >&2; exit 1 ;;
esac

VERSION="$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' package.json)"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/rgb-commander-studio-build"
WORK="$ROOT/build/appimage-$ARCH"
APPDIR="$WORK/AppDir"
LIB="$APPDIR/usr/lib/rgb-commander-studio"
TARGET="$ROOT/dist/RGB_Commander_Studio-$VERSION-$ARCH.AppImage"
mkdir -p "$CACHE" "$ROOT/dist"

# fetch URL FILE SHA256: download unless cached, then verify.
fetch() {
  local url=$1 file=$2 sha=$3
  if ! echo "$sha  $file" | sha256sum --check --status 2>/dev/null; then
    echo "Downloading $url"
    curl --fail --silent --show-error --location --output "$file.part" "$url"
    mv "$file.part" "$file"
  fi
  if ! echo "$sha  $file" | sha256sum --check --status; then
    rm -f "$file"
    echo "Checksum mismatch for $url" >&2
    exit 1
  fi
}

NODE_DIR="node-v$NODE_VERSION-linux-$NODE_ARCH"
NODE_SHA="$(curl --fail --silent --show-error --location "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" | awk -v f="$NODE_DIR.tar.xz" '$2 == f { print $1 }')"
[ -n "$NODE_SHA" ] || { echo "nodejs.org lists no $NODE_DIR.tar.xz" >&2; exit 1; }
fetch "https://nodejs.org/dist/v$NODE_VERSION/$NODE_DIR.tar.xz" "$CACHE/$NODE_DIR.tar.xz" "$NODE_SHA"
TOOL="$CACHE/appimagetool-$APPIMAGETOOL_VERSION-$HOST_ARCH.AppImage"
fetch "https://github.com/AppImage/appimagetool/releases/download/$APPIMAGETOOL_VERSION/appimagetool-$HOST_ARCH.AppImage" "$TOOL" "$TOOL_SHA"
chmod +x "$TOOL"
RUNTIME="$CACHE/runtime-$RUNTIME_VERSION-$ARCH"
fetch "https://github.com/AppImage/type2-runtime/releases/download/$RUNTIME_VERSION/runtime-$ARCH" "$RUNTIME" "$RUNTIME_SHA"

echo "Assembling $APPDIR"
rm -rf "$WORK"
mkdir -p "$APPDIR/usr/bin" "$LIB"
tar --extract --xz --file "$CACHE/$NODE_DIR.tar.xz" --directory "$WORK" "$NODE_DIR/bin/node" "$NODE_DIR/LICENSE"
cp "$WORK/$NODE_DIR/bin/node" "$APPDIR/usr/bin/node"
cp "$WORK/$NODE_DIR/LICENSE" "$LIB/NODE-LICENSE"
cp -r package.json server public "$LIB/"
cp packaging/appimage/AppRun "$APPDIR/AppRun"
chmod +x "$APPDIR/AppRun"
cp packaging/appimage/rgb-commander-studio.desktop "$APPDIR/"
cp public/icon-256.png "$APPDIR/rgb-commander-studio.png"
ln -s rgb-commander-studio.png "$APPDIR/.DirIcon"

# APPIMAGE_EXTRACT_AND_RUN lets appimagetool itself run without FUSE (CI containers).
ARCH="$ARCH" APPIMAGE_EXTRACT_AND_RUN=1 "$TOOL" --no-appstream --runtime-file "$RUNTIME" "$APPDIR" "$TARGET"
echo "Built $TARGET ($(du -h "$TARGET" | cut -f1))"
