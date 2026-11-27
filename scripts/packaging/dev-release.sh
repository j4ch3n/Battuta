#!/usr/bin/env bash
# Build the committed tree (uncommitted edits are not included) and run the release install check in development containers.
set -euo pipefail
cd "$(dirname "$0")"
repo="$(git rev-parse --show-toplevel)"
NODE_VERSION="$(cat "$repo/.node-version")"
PNPM_VERSION="$(sed -nE 's/.*"packageManager": *"pnpm@([^"]+)".*/\1/p' "$repo/package.json")"
export NODE_VERSION PNPM_VERSION
tag=v0.0.0
tool_version="0.0.0+g$(git rev-parse --short HEAD)"
if (($#)); then platforms=("$@"); else platforms=(oracle-ampere raspberry-pi); fi
compose=(docker compose -f compose.yaml)
"${compose[@]}" build
# Wheels are built once on Oracle Linux and shared by both bundles, as in the release workflow.
"${compose[@]}" run --rm -e BATTUTA_RELEASE_URL=file:///assets oracle-ampere bash -c 'find /assets -mindepth 1 -delete && bash /source/scripts/packaging/release-wheels.sh "$0" "$1"' "$tag" "$tool_version"
for platform in "${platforms[@]}"; do
  "${compose[@]}" run --rm "$platform" bash /source/scripts/packaging/release-build.sh "$platform" "$tag" "$tool_version"
  "${compose[@]}" run --rm -e BATTUTA_RELEASE_ASSETS=/assets -e BATTUTA_RELEASE_TAG="$tag" \
    -e BATTUTA_RELEASE_PLATFORM="$platform" "$platform" \
    uv run --no-project --python 3.12 python /source/scripts/packaging/tests/release_install.it.py
done
