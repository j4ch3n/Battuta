"""Validate skill selection metadata against the canonical catalog."""

from pathlib import Path
import re
import stat
import subprocess
from os.path import relpath

import click
from .manifest import parse_manifest


def _selection(text: str, manifest: Path) -> list[str]:
    return parse_manifest(text, manifest).skills.include


def load_selection(manifest: Path, catalog: Path) -> list[str]:
    try:
        hub = catalog.resolve(strict=True)
        names = _selection(manifest.read_text(), manifest)
        for name in names:
            entry = hub / name / "SKILL.md"
            if not entry.resolve(strict=True).is_relative_to(hub) or not stat.S_ISREG(entry.lstat().st_mode):
                raise click.ClickException(f"Missing skill or invalid entry point: {entry}")
        return names
    except OSError as error:
        raise click.ClickException(f"Missing skill manifest or entry point: {error.filename}") from error


def check_manifests(root: Path, *, staged: bool = False) -> None:
    if not staged:
        manifests = sorted((root / "bots").glob("*/bot.toml"))
        if not manifests:
            raise click.ClickException("Missing skill manifests")
        for manifest in manifests:
            load_selection(manifest, root / "skills-hub")
        return
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=root, text=True)
    entries = {}
    for row in filter(None, git("ls-files", "--stage", "-z").split("\0")):
        header, path = row.split("\t", 1)
        mode, oid, stage = header.split()
        if stage != "0":
            raise click.ClickException(f"Unresolved conflict in skill index: {path}")
        entries[path] = (mode, oid)
    manifests = [path for path in entries if re.fullmatch(r"bots/[^/]+/bot\.toml", path)]
    if not manifests:
        raise click.ClickException("Missing skill manifests in Git index")
    for manifest in manifests:
        mode, oid = entries[manifest]
        if mode not in {"100644", "100755"}:
            raise click.ClickException(f"Invalid skill manifest file: {manifest}")
        for name in _selection(git("cat-file", "blob", oid), Path(manifest)):
            entry = entries.get(f"skills-hub/{name}/SKILL.md")
            if not entry or entry[0] not in {"100644", "100755"}:
                raise click.ClickException(f"Missing skill entry point in Git index: {name}")


def link_selected_skills(bot_dir: Path, catalog: Path, names: list[str]) -> None:
    """Reconcile only same-name relative catalog links in a local workspace."""
    skills = bot_dir / ".pi/skills"
    if skills.is_symlink() or (skills.exists() and not skills.is_dir()):
        raise click.ClickException(f"Expected a local skills directory: {skills}")
    targets = {name: Path(relpath(catalog / name, skills)) for name in names}
    for name, target in targets.items():
        entry = skills / name
        if entry.is_symlink():
            if entry.readlink() != target:
                raise click.ClickException(f"Refusing to replace custom skill link: {entry}")
        elif entry.exists():
            raise click.ClickException(f"Refusing to replace custom skill content: {entry}")
    skills.mkdir(parents=True, exist_ok=True)
    for entry in skills.iterdir():
        if entry.name not in targets and entry.is_symlink() and entry.readlink() == Path(relpath(catalog / entry.name, skills)):
            entry.unlink()
    for name, target in targets.items():
        if not (skills / name).is_symlink():
            (skills / name).symlink_to(target, target_is_directory=True)
