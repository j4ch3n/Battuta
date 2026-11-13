"""Assemble disposable bot code; private state never enters this tree."""

import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile

import click
from bot_setup.browser import browser_defaults
from bot_setup.skills import load_selection
from bot_setup.install import TELEGRAM_PACKAGE, SCHEDULE_PACKAGE
from bot_setup.subagents import WEB_PACKAGE, WORKER_SUBAGENT_PACKAGE

PROFILES = ("cos-bot", "manager-bot", "worker")
SHARED = ("agent-mail", "project-spec", "memory-client")
ENTRY_OUTPUTS = (
    "bots/_shared/agent-mail/dist/index.js", "bots/_shared/project-spec/dist/index.js",
    "bots/_shared/memory-client/dist/index.js", "bots/_shared/memory-client/dist/dream-extension.js",
    "bots/_shared/memory-client/dist/configure-scheduler.js", "bots/_shared/memory-client/dist/configure-dream.js",
    "bots/cos-bot/.pi/extensions/index.js", "bots/worker/.pi/extensions/index.js",
)


def extract_bundle(archive: Path, destination: Path) -> None:
    if destination.is_symlink() or (destination.exists() and (not destination.is_dir() or any(destination.iterdir()))):
        raise click.ClickException("Extraction destination must be an empty regular directory")
    try:
        with tarfile.open(archive, "r:gz") as contents:
            members = contents.getmembers()
            for member in members:
                parts = PurePosixPath(member.name).parts
                if not parts or parts[0] != "bots" or ".." in parts or not (member.isfile() or member.isdir()):
                    raise click.ClickException("Archive must contain only regular files/directories below bots/")
            destination.mkdir(parents=True, exist_ok=True)
            contents.extractall(destination, members=members, filter="data")
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
    selections = {profile: load_selection(source / "bots" / profile / "skills.json", source / "skills-hub") for profile in PROFILES}
    for names in selections.values():
        for name in names:
            skill = source / "skills-hub" / name
            if any(path.is_symlink() for path in [skill, *skill.rglob("*")]):
                raise click.ClickException(f"Skill resources must not be symlinks: {name}")
    node_version = (source / ".node-version").read_text().strip()
    package_manager = json.loads((source / "package.json").read_text())["packageManager"]
    for component in SHARED:
        package = destination / "bots/_shared" / component
        package.mkdir(parents=True)
        for name in ("package.json", "pnpm-lock.yaml"):
            shutil.copy2(source / component / name, package / name)
        (package / "dist").mkdir()
    packages = {
        "cos-bot": [TELEGRAM_PACKAGE, WEB_PACKAGE, SCHEDULE_PACKAGE],
        "manager-bot": [WEB_PACKAGE],
        "worker": [WEB_PACKAGE, WORKER_SUBAGENT_PACKAGE],
    }
    for profile in PROFILES:
        bot = destination / "bots" / profile
        (bot / ".pi/extensions").mkdir(parents=True)
        original = source / "bots" / profile
        runtime = original / "extension/assignment-worker" if profile == "worker" else original
        for name in ("package.json", "pnpm-lock.yaml"):
            shutil.copy2(runtime / name, bot / name)
        manifest = json.loads((bot / "package.json").read_text())
        manifest["type"] = "module"
        write_json(bot / "package.json", manifest)
        (bot / "AGENTS.md").write_text("\n".join(path.read_text() for path in (source / "bots/AGENTS_shared.md", original / "AGENTS_dedicated.md")))
        for name in selections[profile]:
            shutil.copytree(source / "skills-hub" / name, bot / ".pi/skills" / name)
        (bot / ".pi/skills").mkdir(exist_ok=True)
        extensions = ["../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/index.js", "../node_modules/@earendil-works/pi-coding-agent/dist/extensions/codemode/index.js"]
        if profile in {"cos-bot", "manager-bot"}:
            extensions += [f"../../_shared/{name}/dist/index.js" for name in ("agent-mail", "project-spec")]
        if profile == "cos-bot":
            extensions += ["../../_shared/memory-client/dist/index.js", "extensions/index.js"]
        if profile == "worker":
            extensions += ["extensions/index.js"]
            shutil.copytree(original / "agents", bot / ".pi/agents")
        settings = {"packages": packages[profile], "extensions": extensions, "battutaMemoryCapture": {"enabled": profile == "cos-bot"}}
        if profile != "manager-bot":
            browser_defaults(settings)
            packages[profile] = settings["packages"]
        write_json(bot / ".pi/settings.json", settings)
        shutil.copy2(original / ".pi/web-search.json", bot / ".pi/web-search.json")
    for relative in ENTRY_OUTPUTS:
        (destination / relative).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source / "LICENSE", destination / "bots/LICENSE")
    compile_bots(source, destination)
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
