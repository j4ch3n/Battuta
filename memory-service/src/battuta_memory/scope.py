import json
from dataclasses import dataclass, field
from pathlib import Path
import yaml
from .contracts import Scope, Selector, project_names


def registered(name: str, root: Path):
    project_names([name])
    folder = root / name
    config = folder / "project.yaml"
    if any(p.is_symlink() for p in (root.parent, root, folder, config, folder / "code")):
        raise ValueError("Symlink project registrations are unsupported")
    try:
        data = yaml.safe_load(config.read_text())
        if data["version"] != 1 or data["project"]["name"] != name or data["project"]["path"] != str(folder / "code") or not (folder / "code").is_dir():
            raise ValueError("Invalid project registration")
    except (OSError, KeyError, TypeError, yaml.YAMLError) as error:
        raise ValueError("Unknown or invalid project registration") from error


def resolve_scope(scope: Scope, registry_root: Path) -> list[str]:
    if scope.global_:
        return ["scope:global"]
    for name in scope.projects:
        registered(name, registry_root)
    return [f"proj:{p}" for p in scope.projects]


@dataclass
class ResolvedSelector:
    tags: list[str] | None
    warnings: list[str] = field(default_factory=list)


def resolve_selector(selector: Selector, registry_root: Path) -> ResolvedSelector:
    if selector.selector == "all":
        return ResolvedSelector(None)
    if selector.selector == "global":
        return ResolvedSelector(["scope:global"])
    names = selector.projects
    warnings = []
    if selector.selector == "current":
        state = registry_root / ".config.json"
        if state.is_symlink():
            raise ValueError("Symlink registry state is unsupported")
        try:
            data = json.loads(state.read_text())
            if not isinstance(data, dict):
                raise ValueError("Invalid project registry state")
            name = data.get("currentProject")
        except FileNotFoundError:
            name = None
        if name is None:
            warnings = ["No selected project: global-only recall"]
            return ResolvedSelector(["scope:global"], warnings)
        names = [name]
    for name in names:
        registered(name, registry_root)
    tags = [f"proj:{n}" for n in names]
    if selector.include_global:
        tags.append("scope:global")
    return ResolvedSelector(tags, warnings)
