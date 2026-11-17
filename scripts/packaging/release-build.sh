#!/usr/bin/env bash
# Build only from the committed tree; never copy local/private checkout state.
set -euo pipefail
platform="${1:?platform required: oracle-ampere or raspberry-pi}"
tag="${2:?release tag required}"
tool_version="${3:?Python tool version required}"
source /etc/os-release
case "$platform" in
  oracle-ampere) [[ "$ID" == ol && "${VERSION_ID%%.*}" == 9 ]] ;;
  raspberry-pi) [[ "$ID" == debian && "${VERSION_ID%%.*}" == 12 ]] ;;
  *) printf 'Unknown platform: %s\n' "$platform" >&2; exit 1 ;;
esac
[[ "$(uname -m)" == aarch64 ]]
git config --global --add safe.directory /source/.git
work="$(mktemp -d /tmp/battuta-build-XXXXXXXX)"
git clone --no-hardlinks /source "$work/source"
cd "$work/source"
pnpm install --frozen-lockfile
uv run --project scripts/packaging --locked --python 3.12 battuta-packaging stage-bots \
  --source . --destination "$work/stage" --tag "$tag" --tool-version "$tool_version"
archive="battuta-$tag-$platform-arm64.tar.gz"
tar -C "$work/stage" -czf "/assets/$archive" bots RELEASE.md docs .agents memory-service
cd /assets
sha256sum "$archive" > "$archive.sha256"
uv run --project "$work/source/scripts/packaging" --locked --python 3.12 battuta-packaging render-instructions \
  --source "$work/source" --platform "$platform" --tag "$tag" --tool-version "$tool_version" \
  --archive "/assets/$archive" --wheels-dir /wheels --output "/assets/battuta-$tag-$platform-arm64-instructions.txt"
