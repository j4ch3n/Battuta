"""Render platform install instructions with exact release asset links and digests."""

from pathlib import Path
import hashlib

import click
from jinja2 import Environment, FileSystemLoader, StrictUndefined

from .wheel_metadata import REPO_URL

BUNDLES = {
    "oracle-ampere": ("main", "main-release-instructions.txt.j2", ("battuta-project", "battuta-artifacts", "battuta-memory", "battuta-speech", "battuta-doc", "battuta-bot-setup", "battuta-packaging")),
    "raspberry-pi": ("influencer", "influencer-release-instructions.txt.j2", ("battuta-project", "battuta-artifacts", "battuta-bot-setup", "battuta-packaging")),
}


def render_instructions(source: Path, platform: str, *, tag: str, tool_version: str, archive: Path, wheels_dir: Path) -> str:
    deployment, template, packages = BUNDLES[platform]
    digests = {name: digest for digest, name in (line.split() for line in (wheels_dir / "python-tools-SHA256SUMS").read_text().splitlines())}
    release_url = f"{REPO_URL}/releases/download/{tag}"
    wheels = []
    for package in packages:
        filename = f"{package.replace('-', '_')}-{tool_version}-py3-none-any.whl"
        if filename not in digests:
            raise click.ClickException(f"Missing wheel digest: {filename}")
        wheels.append({"package": package, "filename": filename, "url": f"{release_url}/{filename}", "sha256": digests[filename]})
    environment = Environment(loader=FileSystemLoader(source / "scripts/packaging/templates"), undefined=StrictUndefined, keep_trailing_newline=True, autoescape=False)
    return environment.get_template(template).render(
        tag=tag,
        tool_version=tool_version,
        platform=platform,
        deployment=deployment,
        repo_url=REPO_URL,
        release_url=release_url,
        archive_name=archive.name,
        archive_sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),
        wheels=wheels,
    )
