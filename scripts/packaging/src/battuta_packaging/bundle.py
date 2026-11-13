"""Assemble disposable bot code; private state never enters this tree."""

import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile

import click
from bot_setup.skills import load_selection
from bot_setup.files import prepare_files
from bot_setup.manifest import load_profile
from bot_setup.subagents import render_worker_agents
from bot_setup.extensions import profile_settings, source_extension_links

PROFILES = ("cos-bot", "manager-bot", "worker")
SHARED = ("memory-client",)
ENTRY_OUTPUTS = (
    "bots/_shared/memory-client/dist/configure-scheduler.js", "bots/_shared/memory-client/dist/configure-dream.js",
)


def extract_bundle(archive: Path, destination: Path) -> None:
    if destination.is_symlink() or (destination.exists() and (not destination.is_dir() or any(destination.iterdir()))):
        raise click.ClickException("Extraction destination must be an empty regular directory")
    try:
        with tarfile.open(archive, "r:gz") as contents:
            members = contents.getmembers()
            for member in members:
                parts = PurePosixPath(member.name).parts
                if (not parts or parts[0] not in {"bots", "docs", ".agents", "memory-service", "RELEASE.md"}
                        or ".." in parts or member.name.startswith("/")
                        or not (member.isfile() or member.isdir())):
                    raise click.ClickException("Archive contains an unsafe or unexpected member")
            destination.mkdir(parents=True, exist_ok=True)
            contents.extractall(destination, members=[member for member in members if PurePosixPath(member.name).parts[0] == "bots"], filter="data")
    except (OSError, tarfile.TarError) as error:
        raise click.ClickException("Cannot extract bot archive; stop and inspect the verified input") from error
    validate_bundle(destination)


def compile_bots(source: Path, destination: Path) -> None:
    subprocess.run(["node", str(source / "scripts/packaging/build-bots.mjs"), str(source), str(destination)], check=True)


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2) + "\n")


def stage_bots(source: Path, destination: Path, *, tag: str, tool_version: str) -> None:
    if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", tag) or not tool_version.startswith(tag[1:] + "+g"):
        raise click.ClickException("Release tag and Python tool version must match")
    if destination.is_symlink() or (destination.exists() and (not destination.is_dir() or any(destination.iterdir()))):
        raise click.ClickException("Release destination must be an empty regular directory")
    selections = {profile: load_selection(source / "bots" / profile / "bot.toml", source / "skills-hub") for profile in PROFILES}
    manifests = {profile: load_profile(source / "bots" / profile / "bot.toml", profile.removesuffix("-bot")) for profile in PROFILES}
    for profile, manifest in manifests.items():
        source_extension_links(source, destination / "bots" / profile, manifest.extensions)
        for extension in manifest.extensions:
            owner = source / Path(extension.source).parent
            for name in ("package.json", "pnpm-lock.yaml"):
                path = owner / name
                if path.is_symlink() or not path.is_file():
                    raise click.ClickException(f"Missing regular extension package file: {path}")
    worker_agents = render_worker_agents(source / "bots/worker", manifests["worker"])
    for names in selections.values():
        for name in names:
            skill = source / "skills-hub" / name
            if any(path.is_symlink() for path in [skill, *skill.rglob("*")]):
                raise click.ClickException(f"Skill resources must not be symlinks: {name}")
    for relative in ("docs", "RELEASE.md",
                     ".agents/skills/battuta-setup/references/development.md",
                     ".agents/skills/battuta-verify/references/checks.md", "memory-service/DESIGN.md"):
        path = source / relative
        if any(item.is_symlink() for item in [path, *path.rglob("*")]):
            raise click.ClickException(f"Documentation must not contain symlinks: {relative}")
    for relative in ("RELEASE.md", ".agents/skills/battuta-setup/references/development.md",
                     ".agents/skills/battuta-verify/references/checks.md", "memory-service/DESIGN.md"):
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / relative, target)
    shutil.copytree(source / "docs", destination / "docs", ignore=shutil.ignore_patterns("superpowers"))
    node_version = (source / ".node-version").read_text().strip()
    package_manager = json.loads((source / "package.json").read_text())["packageManager"]
    for component in SHARED:
        package = destination / "bots/_shared" / component
        package.mkdir(parents=True)
        for name in ("package.json", "pnpm-lock.yaml"):
            shutil.copy2(source / component / name, package / name)
        (package / "dist").mkdir()
    packages = {profile: manifest.packages.pi.copy() for profile, manifest in manifests.items()}
    for profile in PROFILES:
        bot = destination / "bots" / profile
        (bot / ".pi/extensions").mkdir(parents=True)
        original = source / "bots" / profile
        runtime = source / "assignment-worker" if profile == "worker" else original
        for name in ("package.json", "pnpm-lock.yaml"):
            shutil.copy2(runtime / name, bot / name)
        manifest = json.loads((bot / "package.json").read_text())
        manifest["type"] = "module"
        write_json(bot / "package.json", manifest)
        shutil.copy2(original / "bot.toml", bot / "bot.toml")
        prepare_files(source, bot, bot, [rule for rule in manifests[profile].files if rule.destination == "profile"], source_profile=original, context="release")
        for name in selections[profile]:
            shutil.copytree(source / "skills-hub" / name, bot / ".pi/skills" / name)
        (bot / ".pi/skills").mkdir(exist_ok=True)
        for extension in manifests[profile].extensions:
            entry = Path(extension.source)
            owner = source / entry.parent
            if entry.is_absolute() or ".." in entry.parts or not (source / entry).resolve().is_relative_to(source.resolve()) or not (source / entry).is_file():
                raise click.ClickException(f"Invalid extension source: {extension.source}")
            package = bot / ".pi/extensions" / extension.name
            package.mkdir()
            for name in ("package.json", "pnpm-lock.yaml"):
                shutil.copy2(owner / name, package / name)
            metadata = json.loads((package / "package.json").read_text())
            metadata["type"] = "module"
            metadata["pi"] = {"extensions": ["dist/index.js"]}
            write_json(package / "package.json", metadata)
        write_json(bot / ".pi/extension-build.json", [entry.model_dump() for entry in manifests[profile].extensions])
        if profile == "worker":
            agents = bot / ".pi/agents"
            agents.mkdir()
            for name, content in worker_agents.items():
                (agents / name).write_bytes(content)
        settings = profile_settings(manifests[profile], browser=profile != "manager-bot")
        write_json(bot / ".pi/settings.json", settings)
        shutil.copy2(original / ".pi/web-search.json", bot / ".pi/web-search.json")
    for relative in ENTRY_OUTPUTS:
        (destination / relative).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source / "LICENSE", destination / "bots/LICENSE")
    compile_bots(source, destination)
    for profile in PROFILES:
        (destination / "bots" / profile / ".pi/extension-build.json").unlink()
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
    write_json(destination / "bots/release.json", {"tag": tag, "commit": commit, "toolVersion": tool_version, "node": node_version, "packageManager": package_manager, "skills": selections, "packages": packages})
    validate_bundle(destination)


def validate_bundle(root: Path) -> dict:
    try:
        metadata = json.loads((root / "bots/release.json").read_text())
        if set(metadata["skills"]) != set(PROFILES):
            raise ValueError("profiles")
        for relative in ENTRY_OUTPUTS:
            path = root / relative
            if path.is_symlink() or not path.is_file():
                raise ValueError(relative)
        for profile in PROFILES:
            bot = root / "bots" / profile
            manifest = load_profile(bot / "bot.toml", profile.removesuffix("-bot"))
            for extension in manifest.extensions:
                package = bot / ".pi/extensions" / extension.name
                for name in ("dist/index.js", "package.json", "pnpm-lock.yaml"):
                    path = package / name
                    if path.is_symlink() or not path.is_file():
                        raise ValueError(f"extension: {path}")
            if not (bot / "AGENTS.md").is_file():
                raise ValueError(profile)
            selected = bot / ".pi/skills"
            if {p.name for p in selected.iterdir()} != set(metadata["skills"][profile]):
                raise ValueError("skills")
            for name in metadata["skills"][profile]:
                if not (selected / name / "SKILL.md").is_file():
                    raise ValueError("skill entry")
        return metadata
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise click.ClickException(f"Invalid or incomplete bot bundle at {root}") from error
