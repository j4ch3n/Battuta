from dataclasses import dataclass, field
from urllib.parse import quote, unquote
from .contracts import Scope, Selector, RememberRequest


def scope_from_projects(projects: list[str]) -> Scope:
    return RememberRequest(content="scope", projects=projects).scope


def projects_from_scope(scope: Scope) -> list[str]:
    return ["global"] if scope.global_ else scope.projects


def project_tag(name: str) -> str:
    # Escape comma-delimited upstream tags without changing existing slug tags.
    return "proj:" + quote(name.lower(), safe="").lower()


def project_from_tag(tag: str) -> str:
    return unquote(tag[5:])


def resolve_scope(scope: Scope) -> list[str]:
    return ["scope:global"] if scope.global_ else [project_tag(p) for p in scope.projects]


@dataclass
class ResolvedSelector:
    tags: list[str] | None
    warnings: list[str] = field(default_factory=list)


def resolve_selector(selector: Selector) -> ResolvedSelector:
    if selector.selector == "all":
        return ResolvedSelector(None)
    if selector.selector == "global":
        return ResolvedSelector(["scope:global"])
    tags = [project_tag(n) for n in selector.projects]
    if selector.include_global:
        tags.append("scope:global")
    return ResolvedSelector(tags)
