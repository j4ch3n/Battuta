#!/usr/bin/env bash
# Build only from the committed tree; never copy local/private checkout state.
set -euo pipefail
tag="${1:?release tag required}"
tool_version="${2:?Python tool version required}"
source /etc/os-release
[[ "$ID" == ol && "${VERSION_ID%%.*}" == 9 && "$(uname -m)" == aarch64 ]]
git config --global --add safe.directory /source/.git
work="$(mktemp -d /tmp/battuta-build-XXXXXXXX)"
git clone --no-hardlinks /source "$work/source"
cd "$work/source"
pnpm install --frozen-lockfile
uv run --project scripts/packaging --locked --python 3.12 battuta-packaging stage-bots \
  --source . --destination "$work/stage" --tag "$tag" --tool-version "$tool_version"
uv run --project scripts/packaging --locked --python 3.12 battuta-packaging build-wheels \
  --source . --output /assets --tag "$tag" --tool-version "$tool_version"
tar -C "$work/stage" -czf "/assets/battuta-$tag-linux-arm64.tar.gz" bots RELEASE.md docs skills-hub .agents memory-service
cd /assets
sha256sum "battuta-$tag-linux-arm64.tar.gz" > "battuta-$tag-linux-arm64.tar.gz.sha256"
