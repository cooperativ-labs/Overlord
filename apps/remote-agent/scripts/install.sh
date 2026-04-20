#!/usr/bin/env bash
# Overlord remote helper installer.
#
# Copies the bundled helper to ~/.overlord/remote/ on the target host, generates
# an auth token if one doesn't exist, and prints a machine-parseable summary
# that the Electron installer can ingest to persist the token client-side.
#
# Usage (executed on the remote host — this script is what the desktop app
# pipes through `ssh host 'bash -s' < install.sh`):
#   OVERLORD_REMOTE_BUNDLE_URL=... bash install.sh
set -euo pipefail

REMOTE_DIR="${HOME}/.overlord/remote"
TOKEN_FILE="${REMOTE_DIR}/token"
SERVER_FILE="${REMOTE_DIR}/server.mjs"

mkdir -p "${REMOTE_DIR}"
chmod 700 "${REMOTE_DIR}"

if [ ! -f "${TOKEN_FILE}" ]; then
  # 32 random bytes, base64 encoded, url-safe.
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n' > "${TOKEN_FILE}"
  else
    head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n' > "${TOKEN_FILE}"
  fi
  chmod 600 "${TOKEN_FILE}"
fi

# The server.mjs contents are streamed on stdin after this script, delimited by
# a line matching OVERLORD_BUNDLE_BEGIN.
if [ "${1-}" = "--with-bundle" ]; then
  # Read bundle from stdin between markers.
  awk '/^OVERLORD_BUNDLE_BEGIN$/{flag=1;next}/^OVERLORD_BUNDLE_END$/{flag=0}flag' \
    > "${SERVER_FILE}.tmp"
  mv "${SERVER_FILE}.tmp" "${SERVER_FILE}"
  chmod 644 "${SERVER_FILE}"
fi

NODE_BIN="$(command -v node || true)"
if [ -z "${NODE_BIN}" ]; then
  echo "OVERLORD_REMOTE_INSTALL_ERROR node is not installed on the remote host." >&2
  exit 1
fi

TOKEN="$(cat "${TOKEN_FILE}")"
echo "OVERLORD_REMOTE_INSTALLED"
echo "TOKEN=${TOKEN}"
echo "SERVER_PATH=${SERVER_FILE}"
echo "NODE_BIN=${NODE_BIN}"
