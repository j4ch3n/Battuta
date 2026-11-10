"""Generate self-describing release wheels from existing project locks."""

from email import message_from_bytes
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib
import zipfile

import click
from packaging.markers import default_environment
from packaging.requirements import InvalidRequirement, Requirement
from packaging.utils import canonicalize_name
from packaging.version import InvalidVersion, Version

PROJECTS = {
    "battuta-project": "project-context-cli",
    "battuta-bot-setup": "scripts/bot_setup",
    "battuta-artifacts": "artifact-service",
    "battuta-memory": "memory-service",
    "battuta-packaging": "scripts/packaging",
}


def release_requirements(export: str, *, release_url: str, tool_version: str) -> list[str]:
    result = []
    for line in export.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        try:
            requirement = Requirement(line)
            name = canonicalize_name(requirement.name)
            if name in PROJECTS:
                requirement = Requirement(f"{name} @ {release_url}/{name.replace('-', '_')}-{tool_version}-py3-none-any.whl" + (f" ; {requirement.marker}" if requirement.marker else ""))
            else:
                specs = list(requirement.specifier)
                if requirement.url or len(specs) != 1 or specs[0].operator != "==":
                    raise ValueError("unpinned runtime dependency")
                Version(specs[0].version)
            result.append(str(requirement))
        except (InvalidRequirement, InvalidVersion, ValueError) as error:
            raise click.ClickException("Release dependencies must be exact versions or same-release Battuta wheels") from error
    return sorted(set(result))


def _toml(data: dict, prefix: tuple[str, ...] = ()) -> str:
    text = "[" + ".".join(json.dumps(part) for part in prefix) + "]\n" if prefix else ""
    for key, value in data.items():
        if not isinstance(value, dict):
            text += json.dumps(key) + " = " + json.dumps(value) + "\n"
    for key, value in data.items():
        if isinstance(value, dict):
            text += "\n" + _toml(value, (*prefix, key))
    return text


def stage_wheel_project(source: Path, destination: Path, *, requirements: list[str], tool_version: str) -> None:
    original = tomllib.loads((source / "pyproject.toml").read_text())
    project = original["project"].copy()
    project.pop("dependencies", None)
    project["version"] = str(Version(tool_version))
    project["dynamic"] = [name for name in project.get("dynamic", []) if name not in {"version", "dependencies"}] + ["dependencies"]
    hatch = {"build": original["tool"]["hatch"]["build"], "metadata": {"allow-direct-references": True, "hooks": {"custom": {"path": "release-metadata-hook.py"}}}}
    destination.mkdir(parents=True)
    shutil.copytree(source / "src", destination / "src", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for name in ("LICENSE", "LICENSE.txt", "NOTICE", "README.md"):
        if (source / name).is_file():
            shutil.copy2(source / name, destination / name)
    hook = Path(__file__).resolve().parents[2] / "release-metadata-hook.py"
    shutil.copy2(hook, destination / hook.name)
    (destination / "release-requirements.json").write_text(json.dumps(requirements))
    (destination / "pyproject.toml").write_text(_toml({"project": project, "build-system": original["build-system"], "tool": {"hatch": hatch}}))


def check_internal_pins(requirements_by_project: dict[str, list[str]]) -> None:
    environment = {**default_environment(), "sys_platform": "linux", "platform_system": "Linux", "platform_machine": "aarch64", "os_name": "posix"}
    for requirements in requirements_by_project.values():
        pins = {canonicalize_name(req.name): str(req.specifier) for req in map(Requirement, requirements) if not req.url and (not req.marker or req.marker.evaluate(environment))}
        for req in map(Requirement, requirements):
            if canonicalize_name(req.name) in requirements_by_project:
                for internal in map(Requirement, requirements_by_project[canonicalize_name(req.name)]):
                    if not internal.url and (not internal.marker or internal.marker.evaluate(environment)) and pins.get(canonicalize_name(internal.name)) != str(internal.specifier):
                        raise click.ClickException("Internal wheel lockfiles disagree; align source locks before releasing")


def build_wheels(source: Path, output: Path, *, tag: str, tool_version: str) -> None:
    if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", tag) or not tool_version.startswith(tag[1:] + "+g"):
        raise click.ClickException("Release tag and tool version must match")
    if sys.version_info[:2] != (3, 12):
        raise click.ClickException("Build release wheels using managed Python 3.12")
    release_url = f"https://github.com/j4ch3n/Battuta/releases/download/{tag}"
    requirements_by_project = {}
    for name, relative in PROJECTS.items():
        project = source / relative
        subprocess.run(["uv", "lock", "--check", "--project", str(project)], check=True)
        command = ["uv", "export", "--project", str(project), "--locked", "--no-dev", "--no-emit-project", "--no-hashes", "--format", "requirements-txt"]
        for internal in PROJECTS:
            command.extend(["--no-emit-package", internal])
        exported = subprocess.check_output(command, text=True)
        metadata = tomllib.loads((project / "pyproject.toml").read_text())
        roots = [Requirement(value) for value in metadata["project"]["dependencies"]]
        exported += "\n" + "\n".join(str(value) for value in roots if canonicalize_name(value.name) in PROJECTS)
        pins = release_requirements(exported, release_url=release_url, tool_version=tool_version)
        extras = {canonicalize_name(req.name): req.extras for req in roots if req.extras}
        parsed = [Requirement(pin) for pin in pins]
        for req in parsed:
            req.extras |= extras.get(canonicalize_name(req.name), set())
        requirements_by_project[name] = [str(req) for req in parsed]
    check_internal_pins(requirements_by_project)
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="battuta-wheels-", dir="/tmp") as temporary:
        for name, relative in PROJECTS.items():
            stage = Path(temporary) / name
            requirements = requirements_by_project[name]
            stage_wheel_project(source / relative, stage, requirements=requirements, tool_version=tool_version)
            if name == "battuta-bot-setup":
                shutil.copy2(source / ".env.example", stage / "src/bot_setup/env.example")
            subprocess.run(["uv", "build", str(stage), "--wheel", "--out-dir", str(output.resolve())], check=True)
            wheel = output / f"{name.replace('-', '_')}-{tool_version}-py3-none-any.whl"
            with zipfile.ZipFile(wheel) as contents:
                info = message_from_bytes(contents.read(next(path for path in contents.namelist() if path.endswith("/METADATA"))))
                actual = {str(Requirement(value)) for value in info.get_all("Requires-Dist", [])}
                if actual != set(requirements) or info["Version"] != tool_version:
                    raise click.ClickException(f"Built wheel metadata does not match release requirements: {name}")
    (output / "python-tools-version.txt").write_text(tool_version + "\n")
    assets = [output / f"{name.replace('-', '_')}-{tool_version}-py3-none-any.whl" for name in PROJECTS] + [output / "python-tools-version.txt"]
    (output / "python-tools-SHA256SUMS").write_text("".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n" for path in assets))
