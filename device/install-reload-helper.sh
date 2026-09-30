#!/bin/sh
# Run on the cabinet (RetroPie / Debian with systemd), from this folder:
#
#   sudo ./install-reload-helper.sh [rgba-folder] [syncthing-user]
#
# Installs a systemd path unit that restarts RGBcommander whenever files in its
# rgba folder change, because the daemon only reads animations at startup.
# With a user name, it also hands the folder to that user so Syncthing (which
# normally runs as "pi", not root) can write into it. RGBcommander runs as root
# and can still read everything.
#
# Remove with: sudo systemctl disable --now rgbcommander-reload.path
#              sudo rm /etc/systemd/system/rgbcommander-reload.*
set -eu

RGBA_DIR="${1:-/usr/sbin/rgbcommander/rgba}"
SYNC_USER="${2:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run with sudo." >&2
  exit 1
fi
if [ ! -d "$RGBA_DIR" ]; then
  echo "No such folder: $RGBA_DIR (is RGBcommander installed?)" >&2
  exit 1
fi
if ! systemctl cat rgbcommander >/dev/null 2>&1; then
  echo "Warning: no rgbcommander systemd service found; the helper restarts 'rgbcommander'." >&2
fi

sed "s#^PathChanged=.*#PathChanged=$RGBA_DIR#" "$HERE/rgbcommander-reload.path" > /etc/systemd/system/rgbcommander-reload.path
cp "$HERE/rgbcommander-reload.service" /etc/systemd/system/rgbcommander-reload.service
systemctl daemon-reload
systemctl enable --now rgbcommander-reload.path
echo "Watching $RGBA_DIR; RGBcommander restarts about 10 s after files change."

if [ -n "$SYNC_USER" ]; then
  chown -R "$SYNC_USER" "$RGBA_DIR"
  echo "$RGBA_DIR now belongs to $SYNC_USER, so Syncthing can write to it."
fi
