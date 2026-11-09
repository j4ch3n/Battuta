"""Generate a minimal, vendor-selected HTML starter in an explicitly owned project."""

import json
import os
import shutil
from pathlib import Path

from battuta_project.registry import ProjectRegistry
from jinja2 import Environment, StrictUndefined
from markupsafe import Markup
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator

from .files import open_source
from .models import Metadata, assemble_files, relative_path
from .registry import ArtifactError, Conflict
from .vendors import Vendor, import_map, select_vendors


class BundleFile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str
    purpose: str = Field(min_length=1)
    serve: StrictBool

    @field_validator("path")
    @classmethod
    def safe_path(cls, value):
        if value == "file-meta.json":
            raise ValueError("The package descriptor is not an artifact file.")
        return relative_path(value)

    @field_validator("purpose")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("File purpose must not be blank.")
        return value


class Bundle(BaseModel):
    model_config = ConfigDict(extra="forbid")
    entry: str
    files: list[BundleFile] = Field(min_length=1)


def _resource(root: Path, path: str) -> bytes:
    try:
        with open_source(str(root.absolute()), path) as source:
            return source.read()
    except OSError as exc:
        raise ArtifactError(f"Starter resource is unavailable: {path}") from exc


def _style(vendor: Vendor) -> bytes:
    root = Path(__file__).parent / "authoring"
    imports = "".join(f'@import url("{url}");\n' for url in vendor.stylesheets)
    return (imports + ("\n" if imports else "")).encode() + _resource(root, vendor.style)


def _notice(vendors: tuple[Vendor, ...]) -> bytes:
    root = Path(__file__).parent / "authoring"
    sections = ["Third-party dependencies\n"]
    included = set()
    for vendor in vendors:
        sections.append(f"{vendor.name} {vendor.version}\nSource: {vendor.source}\n")
        for license_path in vendor.licenses:
            if license_path not in included:
                sections.append(_resource(root, license_path).decode("utf-8").strip() + "\n")
                included.add(license_path)
    return "\n".join(sections).encode()


def load_bundle(vendors: tuple[str, ...], *, starter: Path | None = None):
    if not vendors:
        raise ArtifactError("Select at least one vendor.")
    resolved = select_vendors(vendors)
    root = starter or Path(__file__).parent / "starter"
    try:
        with open_source(str(root.absolute()), "file-meta.json") as source:
            bundle = Bundle.model_validate_json(source.read())
    except OSError as exc:
        raise ArtifactError("Starter is unavailable.") from exc
    paths = [entry.path for entry in bundle.files]
    if bundle.entry != "index.html" or len(set(paths)) != len(paths) or not any(
            entry.path == bundle.entry and entry.serve for entry in bundle.files):
        raise ArtifactError("Invalid starter entry or duplicate paths.")
    inventory = {str(path.relative_to(root)) for path in root.rglob("*") if not path.is_dir()}
    if inventory != {*paths, "file-meta.json"} or any(path.is_symlink() for path in root.rglob("*")):
        raise ArtifactError("Starter inventory does not match its descriptor.")
    contents = {}
    for entry in bundle.files:
        contents[entry.path] = _resource(root, entry.path)
    extension_files = [
        BundleFile(path=f"vendor/{vendor.name}.css", purpose=f"{vendor.name} display styles.", serve=True)
        for vendor in resolved
    ]
    contents.update({entry.path: _style(vendor) for entry, vendor in zip(extension_files, resolved, strict=True)})
    contents["NOTICE.txt"] = _notice(resolved)
    return Bundle(entry=bundle.entry, files=[*bundle.files, *extension_files]), contents


def open_directory(path: Path):
    """Pin every ancestor without following links, including during creation."""
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    descriptor = os.open("/", flags)
    try:
        for part in path.absolute().parts[1:]:
            child = os.open(part, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def initialize(store, *, project: str, name: str, slug: str, title: str, description: str, vendors: tuple[str, ...],
               starter: Path | None = None) -> dict:
    metadata = Metadata(slug=slug, title=title, description=description)
    Metadata(slug=name, title=title, description=description)
    store.check_schema()
    owner = ProjectRegistry().load(project)
    resolved = select_vendors(vendors)
    bundle, contents = load_bundle(vendors, starter=starter)
    mapping = import_map(resolved)
    serialized_map = json.dumps(mapping, separators=(",", ":")).replace("<", "\\u003c")
    contents[bundle.entry] = Environment(autoescape=True, undefined=StrictUndefined).from_string(
        contents[bundle.entry].decode("utf-8")).render(
            title=title,
            description=description,
            import_map=Markup(serialized_map),
            stylesheets=[f"vendor/{vendor.name}.css" for vendor in resolved],
        ).encode("utf-8")
    contents["vendor/importmap.json"] = json.dumps(mapping, indent=2).encode() + b"\n"
    if any(item["slug"] == slug or (item["project"], item["name"]) == (project, name) for item in store.list()):
        raise Conflict("Artifact identity is already registered.")
    directory = owner.root / "artifacts" / name
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    project_fd = open_directory(owner.root)
    try:
        try:
            os.mkdir("artifacts", dir_fd=project_fd)
        except FileExistsError:
            pass
        artifacts_fd = os.open("artifacts", flags, dir_fd=project_fd)
    finally:
        os.close(project_fd)
    try:
        # Exclusive mkdir is the concurrency boundary: never clean up another invocation.
        os.mkdir(name, dir_fd=artifacts_fd)
        try:
            target_fd = os.open(name, flags, dir_fd=artifacts_fd)
            try:
                for entry in bundle.files:
                    parent_fd = os.dup(target_fd)
                    try:
                        parts = entry.path.split("/")
                        for part in parts[:-1]:
                            try:
                                os.mkdir(part, dir_fd=parent_fd)
                            except FileExistsError:
                                pass
                            child = os.open(part, flags, dir_fd=parent_fd)
                            os.close(parent_fd)
                            parent_fd = child
                        descriptor = os.open(parts[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                             0o644, dir_fd=parent_fd)
                        with os.fdopen(descriptor, "wb") as output:
                            output.write(contents[entry.path])
                    finally:
                        os.close(parent_fd)
                served = tuple(entry.path for entry in bundle.files if entry.serve and entry.path != bundle.entry)
                mapping = assemble_files(directory, bundle.entry, served)
                item = store.register(**metadata.model_dump(), **mapping, status="draft", template=None,
                                       project=project, name=name)
            finally:
                os.close(target_fd)
        except BaseException:
            # rmtree's fd-relative implementation does not follow swapped symlinks.
            shutil.rmtree(name, dir_fd=artifacts_fd)
            raise
    finally:
        os.close(artifacts_fd)
    selected = set(vendors)
    return {"artifact": item, "directory": str(directory), "files": [entry.model_dump() for entry in bundle.files],
            "vendors": [vendor.summary(selected=vendor.name in selected) for vendor in resolved],
            "guidance": "Draft initialized with local extension CSS. JavaScript remains available through the import map "
                        "until you author an import. Use the artifacts skill for lifecycle and dependency guidance. "
                        f"Status: draft — not publicly visible. Publish when ready: battuta-artifact publish --project "
                        f"{project} --artifact {name}"}


def file_tree(entries: list[dict]) -> str:
    tree = {}
    for entry in entries:
        branch = tree
        parts = entry["path"].split("/")
        for part in parts[:-1]:
            branch = branch.setdefault(part, {})
        branch[parts[-1]] = entry["purpose"]
    lines = []
    def visit(branch, prefix=""):
        for index, (name, value) in enumerate(branch.items()):
            last = index == len(branch) - 1
            lines.append(prefix + ("└── " if last else "├── ") + name + ("/" if isinstance(value, dict) else f" — {value}"))
            if isinstance(value, dict):
                visit(value, prefix + ("    " if last else "│   "))
    visit(tree)
    return "\n".join(lines)
