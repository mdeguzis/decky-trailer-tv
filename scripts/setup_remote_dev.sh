#!/usr/bin/env bash
# Configure passwordless sudo on the Steam Deck so `make deploy` / `make reload`
# can write to the root-owned Decky plugins directory without prompting.
#
# Run once per Deck:  make setup-remote-dev DECK_IP=192.168.1.x
# You will be prompted for the Deck sudo password a single time to install the
# sudoers file; after that, deploy/reload are passwordless.
set -euo pipefail

DECK_IP="${DECK_IP:-}"
DECK_USER="${DECK_USER:-deck}"
REMOTE_PLUGIN_DIR="${REMOTE_PLUGIN_DIR:-/home/${DECK_USER}/homebrew/plugins/decky-trailer-tv}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SUDOERS_TEMPLATE="${REPO_ROOT}/config/remote-dev-sudoers.template"
REMOTE_SUDOERS_PATH="/etc/sudoers.d/zz-trailer-tv-remote-dev"

if [[ -z "${DECK_IP}" ]]; then
  echo "setup_remote_dev.sh requires DECK_IP (e.g. make setup-remote-dev DECK_IP=192.168.1.203)."
  exit 1
fi

if [[ ! -f "${SUDOERS_TEMPLATE}" ]]; then
  echo "Missing sudoers template: ${SUDOERS_TEMPLATE}"
  exit 1
fi

sudoers_tmp="$(mktemp)"
trap 'rm -f "${sudoers_tmp}"' EXIT

sed \
  -e "s|@DECK_USER@|${DECK_USER}|g" \
  -e "s|@REMOTE_PLUGIN_DIR@|${REMOTE_PLUGIN_DIR}|g" \
  "${SUDOERS_TEMPLATE}" > "${sudoers_tmp}"

ssh "${DECK_USER}@${DECK_IP}" "mkdir -p /tmp/trailer-tv-remote-dev"
scp "${sudoers_tmp}" "${DECK_USER}@${DECK_IP}:/tmp/trailer-tv-remote-dev/remote-dev.sudoers" >/dev/null

echo "Installing sudoers file on the Deck (you'll be prompted once for the Deck sudo password)..."
ssh -tt "${DECK_USER}@${DECK_IP}" "\
  mkdir -p ~/.steam/steam && \
  touch ~/.steam/steam/.cef-enable-remote-debugging && \
  sudo install -m 440 /tmp/trailer-tv-remote-dev/remote-dev.sudoers ${REMOTE_SUDOERS_PATH} && \
  sudo visudo -cf ${REMOTE_SUDOERS_PATH} && \
  sudo systemctl restart plugin_loader"

echo ""
echo "Remote Deck dev helpers configured on ${DECK_USER}@${DECK_IP}."
echo "Passwordless sudo should now work for: make deploy, make deploy-reload, make reload."
