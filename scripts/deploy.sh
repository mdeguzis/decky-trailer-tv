#!/usr/bin/env bash
# scripts/deploy.sh
# Packages and releases decky-trailer-tv to GitHub.
#
# Usage: bash scripts/deploy.sh [options]
#
# Options:
#   --skip-build          Reuse existing dist/ instead of rebuilding
#   --github-release      Create a stable GitHub release
#   --github-prerelease   Create a GitHub pre-release
#   --github-dev-release  Refresh the rolling 'developer' tag + release
#   --dry-run             Simulate release actions without live changes (default: true)
#   --no-dry-run          Disable dry-run and apply live changes
#   -h, --help            Show this help

set -euo pipefail

PLUGIN_NAME="decky-trailer-tv"
GITHUB_REPO="mdeguzis/decky-trailer-tv"
SKIP_BUILD=0
GH_RELEASE=""
DRY_RUN="true"

# ── helpers ───────────────────────────────────────────────────────────────────

banner() { echo ""; echo "========================================"; echo "$1"; echo "========================================"; echo ""; }

is_truthy() { [[ "$1" == "true" || "$1" == "1" || "$1" == "yes" ]]; }

edit_release_notes() {
  local notes_file="$1"
  if [[ "${SKIP_NOTES_EDIT:-0}" == "1" ]]; then
    echo "SKIP_NOTES_EDIT=1, using generated notes as-is."
    return 0
  fi
  if [[ ! -t 0 || ! -t 1 ]]; then
    echo "Not a TTY, skipping notes edit."
    return 0
  fi
  local editor="${EDITOR:-vi}"
  echo "Opening release notes in $editor (save and quit to continue)..."
  "$editor" "$notes_file"
}

# ── args ──────────────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)          SKIP_BUILD=1; shift ;;
    --github-release)      GH_RELEASE="release"; shift ;;
    --github-prerelease)   GH_RELEASE="prerelease"; shift ;;
    --github-dev-release)  GH_RELEASE="dev"; shift ;;
    --dry-run)             DRY_RUN="true"; shift ;;
    --no-dry-run)          DRY_RUN="false"; shift ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0 ;;
    *) echo "Unknown arg: $1  (use -h for help)"; exit 1 ;;
  esac
done

# ── version ───────────────────────────────────────────────────────────────────

VERSION=$(tr -d '[:space:]' < VERSION)
RELEASE_TAG="v${VERSION}"
ZIP_NAME="${PLUGIN_NAME}-v${VERSION}.zip"

if [[ "$GH_RELEASE" == "prerelease" ]]; then
  RELEASE_TAG="v${VERSION}-pre-release"
  PRE_ZIP_NAME="${PLUGIN_NAME}-v${VERSION}-pre-release.zip"
fi

# ── validate ──────────────────────────────────────────────────────────────────

validate_release_readiness() {
  echo "Validating release readiness..."
  local pkg_version pyproject_version
  pkg_version="$(node -p "require('./package.json').version" 2>/dev/null)" || pkg_version=""
  pyproject_version="$(sed -n 's/^version = "\(.*\)"/\1/p' pyproject.toml 2>/dev/null)" || pyproject_version=""
  if [[ "$pkg_version" != "$VERSION" || "$pyproject_version" != "$VERSION" ]]; then
    echo "ERROR: Version mismatch -- VERSION=$VERSION package.json=$pkg_version pyproject.toml=$pyproject_version"
    exit 1
  fi
  if ! git diff --quiet HEAD -- . ':!dist' ':!*.zip' 2>/dev/null; then
    echo "ERROR: Uncommitted source changes. Commit before releasing."
    git status --short
    exit 1
  fi
  echo "Release readiness: OK (VERSION=$VERSION)"
}

# ── build ─────────────────────────────────────────────────────────────────────

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  banner "Building"
  pnpm build
fi

# ── package ───────────────────────────────────────────────────────────────────

banner "Packaging ${ZIP_NAME}"

STAGING_DIR="${TMPDIR:-/tmp}/${PLUGIN_NAME}"
rm -rf "$STAGING_DIR"
mkdir -p "${STAGING_DIR}/${PLUGIN_NAME}/dist"

cp dist/index.js                        "${STAGING_DIR}/${PLUGIN_NAME}/dist/"
cp main.py plugin.json package.json     "${STAGING_DIR}/${PLUGIN_NAME}/"
[[ -f README.md ]] && cp README.md      "${STAGING_DIR}/${PLUGIN_NAME}/"
[[ -f LICENSE   ]] && cp LICENSE        "${STAGING_DIR}/${PLUGIN_NAME}/"
cp .build-commit "${STAGING_DIR}/${PLUGIN_NAME}/" 2>/dev/null || true

if [[ -d lib ]]; then
  rsync -a --exclude='__pycache__' lib/ "${STAGING_DIR}/${PLUGIN_NAME}/lib/"
fi

find "${STAGING_DIR}/${PLUGIN_NAME}" -type f -exec chmod 644 {} +
find "${STAGING_DIR}/${PLUGIN_NAME}" -type d -exec chmod 755 {} +

(cd "$STAGING_DIR" && zip -r "$ZIP_NAME" "$PLUGIN_NAME")
mv "${STAGING_DIR}/${ZIP_NAME}" .
echo "Done: ${ZIP_NAME}"

# ── dev release ───────────────────────────────────────────────────────────────

if [[ "$GH_RELEASE" == "dev" ]]; then
  banner "GitHub Dev Release (rolling 'developer' tag)"
  COMMIT_SHA=$(git rev-parse --short HEAD)
  DEV_TAG="developer"
  DEV_TITLE="Developer build (${COMMIT_SHA})"

  DEV_NOTES_FILE="${TMPDIR:-/tmp}/${PLUGIN_NAME}-dev-notes-${COMMIT_SHA}.md"
  {
    echo "Rolling developer build at commit ${COMMIT_SHA}."
    echo ""
    echo "Always tracks origin/main HEAD."
    echo ""
    echo "## Recent commits"
    echo ""
    git log --pretty='format:- %h %s' -5
    echo ""
  } > "$DEV_NOTES_FILE"
  edit_release_notes "$DEV_NOTES_FILE"

  if gh release view "$DEV_TAG" --repo "$GITHUB_REPO" &>/dev/null; then
    echo "Deleting existing dev release + tag..."
    gh release delete "$DEV_TAG" --repo "$GITHUB_REPO" --yes --cleanup-tag
  fi

  DEV_ZIP_NAME="${PLUGIN_NAME}-dev-${COMMIT_SHA}.zip"
  cp "./${ZIP_NAME}" "./${DEV_ZIP_NAME}"

  echo "Creating dev release at ${COMMIT_SHA}..."
  gh release create "$DEV_TAG" "./${DEV_ZIP_NAME}" \
    --repo "$GITHUB_REPO" \
    --title "$DEV_TITLE" \
    --notes-file "$DEV_NOTES_FILE" \
    --target main \
    --prerelease

  echo "Done: https://github.com/${GITHUB_REPO}/releases/tag/${DEV_TAG}"
  exit 0
fi

# ── stable / pre-release ─────────────────────────────────────────────────────

if [[ -n "$GH_RELEASE" ]]; then
  validate_release_readiness

  NOTES_FILE="${TMPDIR:-/tmp}/${PLUGIN_NAME}-release-notes-${VERSION}.md"
  {
    echo "## Trailer TV ${RELEASE_TAG}"
    echo ""
    echo "### Changes"
    echo ""
    git log --pretty='format:- %s' "$(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)"..HEAD 2>/dev/null || git log --pretty='format:- %s' -10
    echo ""
  } > "$NOTES_FILE"
  edit_release_notes "$NOTES_FILE"

  if is_truthy "$DRY_RUN"; then
    echo "DRY_RUN=true: would create/update ${RELEASE_TAG} with ${ZIP_NAME}"
    echo "Pass --no-dry-run to publish."
    exit 0
  fi

  banner "GitHub Release (${GH_RELEASE})"

  UPLOAD_ZIP="$ZIP_NAME"
  if [[ "$GH_RELEASE" == "prerelease" ]]; then
    cp "./${ZIP_NAME}" "./${PRE_ZIP_NAME}"
    UPLOAD_ZIP="$PRE_ZIP_NAME"
  fi

  if gh release view "$RELEASE_TAG" --repo "$GITHUB_REPO" &>/dev/null; then
    echo "Release ${RELEASE_TAG} already exists -- uploading asset only."
    gh release upload "$RELEASE_TAG" "./${UPLOAD_ZIP}" --repo "$GITHUB_REPO" --clobber
  else
    GH_ARGS=(gh release create "$RELEASE_TAG" "./${UPLOAD_ZIP}"
      --repo "$GITHUB_REPO"
      --title "Trailer TV ${RELEASE_TAG}"
      --notes-file "$NOTES_FILE"
    )
    [[ "$GH_RELEASE" == "prerelease" ]] && GH_ARGS+=(--prerelease)
    "${GH_ARGS[@]}"
  fi

  echo "Done: https://github.com/${GITHUB_REPO}/releases/tag/${RELEASE_TAG}"
fi
