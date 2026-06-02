# decky-trailer-tv -- Makefile
#
# Remote vs local mode:
#   When DECK_IP is set, device targets (deploy, logs, etc.) run
#   against the remote Deck over SSH. When unset, they run locally.
#
# Setting DECK_IP (pick one):
#   DECK_IP=192.168.1.x make deploy      (one-off)
#   echo '192.168.1.x' > ~/.deckip       (persistent via file)
#   export DECK_IP=192.168.1.x           (persistent via shell env)
#
# Switching back to local mode:
#   unset DECK_IP                         (current shell)
#   rm ~/.deckip                          (remove persistent file)
#   DECK_IP=local make <target>           (force local for one command)

ifneq ($(wildcard $(HOME)/.deckip),)
  DECK_IP ?= $(shell cat $(HOME)/.deckip)
endif

DECK_IP   ?= steamdeck
DECK_USER ?= deck

# DECK_IP=local is a shortcut to force local mode
ifeq ($(DECK_IP),local)
  override DECK_IP :=
endif

DECK_HOST  ?= $(DECK_IP)
PLUGIN_NAME := decky-trailer-tv
TARGET     ?= stable
SCREENSHOT_DIR ?= $(HOME)/storage/screenshots
# find pnpm: check mise path, then PATH, then npx fallback
PNPM ?= $(shell command -v pnpm 2>/dev/null || echo "npx pnpm")

# On old-glibc systems (e.g. AL2 with glibc 2.26), official Node 24 binaries
# require glibc >= 2.28. When Linuxbrew's node@24 is present, prepend it to
# PATH so every recipe shell picks it up automatically.
BREW_NODE := /home/linuxbrew/.linuxbrew/opt/node@24/bin
ifneq ($(wildcard $(BREW_NODE)/node),)
  export PATH := $(BREW_NODE):$(PATH)
  PNPM := $(shell command -v pnpm 2>/dev/null || echo "npx pnpm")
endif

IS_TERMUX := $(if $(findstring com.termux,$(PREFIX)),1,)
ifeq ($(IS_TERMUX),1)
UV_CACHE_DIR ?= $(if $(TMPDIR),$(TMPDIR)/uv-cache,$(HOME)/.cache/uv)
UV_PYTHON_PREFERENCE ?= system
export UV_PYTHON_PREFERENCE
else
UV_CACHE_DIR ?= /tmp/uv-cache
endif
export UV_CACHE_DIR

.PHONY: default help build watch test test-ts test-py typecheck package \
        deploy deploy-reload clean logs get-cef-capture take-screenshot reload

default: build

help:
	@echo "================ usage ================ "
	@echo "Usage: make <target>"
	@echo "       DECK_IP=192.168.1.x make deploy     (remote Deck)"
	@echo ""
	@echo "DECK_IP controls remote vs local mode."
	@echo "When set, device targets run against the remote Deck over SSH."
	@echo ""
	@echo "Set DECK_IP persistently (pick one):"
	@echo "  echo '192.168.1.x' > ~/.deckip"
	@echo "  export DECK_IP=192.168.1.x"
	@echo ""
	@echo "Switch back to local: unset DECK_IP, rm ~/.deckip, or pass DECK_IP=local"
	@echo ""
	@echo "============= main targets ============= "
	@printf "  %-27s %s\n" "build" "Build frontend (pnpm build)"
	@printf "  %-27s %s\n" "watch" "Watch frontend for changes (pnpm watch)"
	@printf "  %-27s %s\n" "test" "Run all tests (ts + py)"
	@printf "  %-27s %s\n" "test-ts" "Run TypeScript tests only (vitest)"
	@printf "  %-27s %s\n" "test-py" "Run Python tests only (pytest)"
	@printf "  %-27s %s\n" "typecheck" "Run tsc --noEmit"
	@printf "  %-27s %s\n" "package" "Build and create release zip"
	@printf "  %-27s %s\n" "deploy" "Build and deploy to Steam Deck (requires DECK_IP)"
	@printf "  %-27s %s\n" "deploy-reload" "Deploy then restart plugin_loader"
	@printf "  %-27s %s\n" "clean" "Remove build output (dist/) and release archives"
	@echo ""
	@echo "============= device targets ============= "
	@printf "  %-27s %s\n" "logs" "Follow plugin log in real time"
	@printf "  %-27s %s\n" "get-cef-capture" "Save a local CEF debug snapshot from port 8081"
	@printf "  %-27s %s\n" "take-screenshot" "Capture the current Steam UI into \$$HOME/storage/screenshots/"
	@printf "  %-27s %s\n" "reload" "Restart plugin_loader locally or on the Deck"

build:
	@COMMIT=$$(git rev-parse --short HEAD 2>/dev/null || echo "unknown"); \
	UNCOMMITTED=$$(git diff --quiet 2>/dev/null && git diff --cached --quiet 2>/dev/null || echo "+uncommitted"); \
	echo "$${COMMIT}$${UNCOMMITTED}" > .build-commit
	$(PNPM) build

watch:
	$(PNPM) watch

# One-time bootstrap: install node deps and sync the Python env (incl. aiohttp,
# used by the CEF screenshot script).
setup:
	@mkdir -p "$(UV_CACHE_DIR)"
	@echo "Using UV_CACHE_DIR=$(UV_CACHE_DIR)"
	$(PNPM) i
	UV_CACHE_DIR=$(UV_CACHE_DIR) uv sync --group dev

node_modules: package.json
	CI=true $(PNPM) i

test: test-ts test-py

test-ts: node_modules
	$(PNPM) test

test-py:
	UV_CACHE_DIR=$(UV_CACHE_DIR) uv run --group dev python -m pytest tests/ -v

typecheck:
	$(PNPM) typecheck

package: build
	@VERSION=$$(cat VERSION); \
	ZIP="$(PLUGIN_NAME)-v$${VERSION}.zip"; \
	echo "Packaging $$ZIP ..."; \
	zip -r "$$ZIP" dist/ main.py plugin.json package.json lib/ -x "lib/__pycache__/*"; \
	echo "Created $$ZIP"

# ─── On-device helpers ─────────────────────────────────────────────────────────

define require_deck_ip
	$(if $(DECK_IP),,$(error DECK_IP is required: DECK_IP=192.168.1.x make $@))
endef

define show_mode
	@if [ -n "$(DECK_IP)" ]; then \
		echo "[remote] DECK_IP=$(DECK_IP) DECK_USER=$(DECK_USER)"; \
	else \
		echo "[local] no DECK_IP set, running locally (pass DECK_IP=x.x.x.x for remote)"; \
	fi
endef

REMOTE_SSH     = ssh $(DECK_USER)@$(DECK_IP)
REMOTE_SSH_TTY = ssh -tt $(DECK_USER)@$(DECK_IP)
REMOTE_PLUGIN_DIR = /home/$(DECK_USER)/homebrew/plugins/$(PLUGIN_NAME)

# Configure passwordless sudo on the Deck so deploy/reload can write to the
# root-owned plugins dir. Run once per Deck.
setup-remote-dev:
	$(call require_deck_ip)
	@DECK_IP="$(DECK_IP)" DECK_USER="$(DECK_USER)" REMOTE_PLUGIN_DIR="$(REMOTE_PLUGIN_DIR)" bash scripts/setup_remote_dev.sh

# Decky's plugins dir is owned by root (the loader runs as root), so we write
# as root via passwordless sudo configured by `make setup-remote-dev`.
RSYNC_SUDO = rsync -rlptz --omit-dir-times --chown=root:root --rsync-path="sudo -n rsync"

deploy: build
	$(call require_deck_ip)
	$(call show_mode)
	@echo "Deploying $(PLUGIN_NAME) to $(DECK_USER)@$(DECK_IP):$(REMOTE_PLUGIN_DIR)"
	@if ! $(REMOTE_SSH) "sudo -n /usr/bin/mkdir -p $(REMOTE_PLUGIN_DIR)" 2>/dev/null; then \
		echo ""; \
		echo "ERROR: passwordless sudo is not configured on the Deck."; \
		echo "The Decky plugins dir ($(REMOTE_PLUGIN_DIR)) is root-owned, so deploy needs it."; \
		echo "Run this once, then re-run deploy:"; \
		echo "  make setup-remote-dev DECK_IP=$(DECK_IP)"; \
		exit 1; \
	fi
	$(RSYNC_SUDO) --delete dist/ $(DECK_USER)@$(DECK_IP):$(REMOTE_PLUGIN_DIR)/dist/
	@if [ -d lib ]; then \
		$(RSYNC_SUDO) --delete --exclude='__pycache__' lib/ $(DECK_USER)@$(DECK_IP):$(REMOTE_PLUGIN_DIR)/lib/; \
	fi
	@for f in main.py plugin.json package.json; do \
		if [ -f $$f ]; then \
			$(RSYNC_SUDO) $$f $(DECK_USER)@$(DECK_IP):$(REMOTE_PLUGIN_DIR)/; \
		fi; \
	done
	@echo "Deploy complete."

deploy-reload: deploy reload

clean:
	rm -rf dist/
	rm -f ./*.zip ./*.tar.gz .build-commit

logs:
	$(call show_mode)
	@if [ -n "$(DECK_IP)" ]; then \
		$(REMOTE_SSH) "tail -f ~/homebrew/logs/$(PLUGIN_NAME)/plugin.log"; \
	else \
		tail -f $$HOME/homebrew/logs/$(PLUGIN_NAME)/plugin.log; \
	fi

# Pull the plugin's log directory into ../logs/<plugin> and prune to the 20 newest.
LOGS_DIR := $(abspath ../logs/$(PLUGIN_NAME))
get-logs:
	$(call show_mode)
	@mkdir -p $(LOGS_DIR)
	@if [ -n "$(DECK_IP)" ]; then \
		rsync -rav $(DECK_USER)@$(DECK_HOST):~/homebrew/logs/$(PLUGIN_NAME)/ $(LOGS_DIR)/; \
	else \
		rsync -rav $$HOME/homebrew/logs/$(PLUGIN_NAME)/ $(LOGS_DIR)/; \
	fi
	@cd $(LOGS_DIR) && ls -1t *.log 2>/dev/null | grep -v '^plugin-debug\.log$$' | tail -n +20 | xargs -r rm -f
	@echo ""
	@echo "Logs synced to: $(LOGS_DIR)"
	@ls -1t $(LOGS_DIR)/*.log 2>/dev/null | head -5 | sed 's/^/  /' || true

# Interactive JS console against the Deck's Game Mode UI (SharedJSContext).
#   make steam-console DECK_IP=192.168.1.x              (REPL)
#   make steam-console DECK_IP=192.168.1.x JS='<expr>'  (one-shot)
steam-console:
	$(call require_deck_ip)
	@UV_CACHE_DIR=$(UV_CACHE_DIR) uv run python scripts/steam_console.py --deck-ip $(DECK_IP) --deck-user $(DECK_USER) --port 8081 $(if $(JS),--eval "$(JS)",)

# Follow the Decky loader's systemd journal (backend stdout/exceptions).
logs-loader:
	@if [ -n "$(DECK_IP)" ]; then \
		$(REMOTE_SSH) "journalctl -u plugin_loader -f"; \
	else \
		journalctl -u plugin_loader -f; \
	fi

get-cef-capture:
	$(call show_mode)
	@mkdir -p ../cef-captures
	@python3 scripts/get_cef_capture.py $(if $(DECK_IP),--deck-ip $(DECK_IP),) --output-dir ../cef-captures

take-screenshot:
	@echo "Capturing the current Steam UI via CEF remote debugging..."
	@echo "This may include private on-screen content visible on the Steam UI."
	@mkdir -p $(SCREENSHOT_DIR)
	UV_CACHE_DIR=$(UV_CACHE_DIR) uv run python scripts/take_cef_screenshot.py $(if $(DECK_IP),--deck-ip $(DECK_IP) --deck-user $(DECK_USER),) --output-dir $(SCREENSHOT_DIR) $(if $(SCREENSHOT_LANGUAGE),--language $(SCREENSHOT_LANGUAGE),) $(if $(SCREENSHOT_BASE),--filename-base $(SCREENSHOT_BASE),) $(if $(SCREENSHOT_GROUP),--group $(SCREENSHOT_GROUP),) $(if $(SCREENSHOT_KEY),--shot-key $(SCREENSHOT_KEY),) $(if $(SCREENSHOT_TITLE),--title "$(SCREENSHOT_TITLE)",) $(if $(SCREENSHOT_CAPTION),--caption "$(SCREENSHOT_CAPTION)",) $(if $(STORE_URL),--store-url "$(STORE_URL)",$(if $(WEB_URL),--prepare-action-json "{\"webUrl\": \"$(WEB_URL)\"}",$(if $(PAGE),--prepare-action-json "{\"steamRoute\": \"$(PAGE)\"}",))) $(if $(DPAD),--dpad-sequence "$(DPAD)",)

reload:
	$(call show_mode)
	@echo "Reloading Decky plugin service..."
	@sleep 2
	@if [ -n "$(DECK_IP)" ]; then \
		echo "Reloading remote plugin_loader on $(DECK_USER)@$(DECK_IP)"; \
		if $(REMOTE_SSH_TTY) "sudo -n /usr/bin/systemctl restart plugin_loader"; then \
			echo "Remote plugin_loader restarted."; \
		else \
			echo "Remote sudo is not passwordless for plugin_loader restart."; \
			echo "Recommended Deck sudoers entry:"; \
			echo "  $(DECK_USER) ALL=(root) NOPASSWD: /usr/bin/systemctl restart plugin_loader, /usr/bin/systemctl status plugin_loader"; \
			echo "Or restart plugin_loader manually on the Deck."; \
			exit 1; \
		fi; \
	elif systemctl list-unit-files plugin_loader.service >/dev/null 2>&1; then \
		echo "Reloading local plugin_loader service"; \
		if systemctl restart plugin_loader.service >/dev/null 2>&1; then \
			echo "Local plugin_loader restarted."; \
		elif command -v sudo >/dev/null 2>&1; then \
			sudo systemctl restart plugin_loader.service; \
			echo "Local plugin_loader restarted with sudo."; \
		else \
			echo "plugin_loader.service requires elevated permissions."; \
			exit 1; \
		fi; \
	else \
		echo "No local plugin_loader.service found and DECK_IP is not set."; \
		echo "Use make reload DECK_IP=192.168.1.x for a remote Deck reload."; \
		exit 1; \
	fi
