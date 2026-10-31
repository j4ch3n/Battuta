"""Copy complete, metadata-declared examples into an explicitly owned project."""

import os
import shutil
from pathlib import Path

from battuta_project.registry import ProjectRegistry
from jinja2 import Environment, StrictUndefined
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator

from .files import open_source
from .models import Metadata, assemble_files, relative_path
from .registry import ArtifactError, Conflict


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


def load_bundle(template: str, scaffolds: Path | None = None):
    relative_path(template)
    if "/" in template:
        raise ArtifactError("Invalid template name.")
    root = (scaffolds or Path(__file__).parent / "scaffolds") / template
    try:
        with open_source(str(root.absolute()), "file-meta.json") as source:
            bundle = Bundle.model_validate_json(source.read())
    except OSError as exc:
        raise ArtifactError(f"Template is unavailable: {template}") from exc
    paths = [entry.path for entry in bundle.files]
    if bundle.entry != "index.html" or len(set(paths)) != len(paths) or not any(
            entry.path == bundle.entry and entry.serve for entry in bundle.files):
        raise ArtifactError("Invalid template entry or duplicate paths.")
    inventory = {str(path.relative_to(root)) for path in root.rglob("*") if not path.is_dir()}
    if inventory != {*paths, "file-meta.json"} or any(path.is_symlink() for path in root.rglob("*")):
        raise ArtifactError("Template inventory does not match its descriptor.")
    contents = {}
    for entry in bundle.files:
        with open_source(str(root.absolute()), entry.path) as source:
            contents[entry.path] = source.read()
    return bundle, contents


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


def initialize(store, *, project: str, name: str, slug: str, template: str, title: str, description: str,
               scaffolds: Path | None = None) -> dict:
    metadata = Metadata(slug=slug, title=title, description=description)
    Metadata(slug=name, title=title, description=description)
    store.check_schema()
    owner = ProjectRegistry().load(project)
    bundle, contents = load_bundle(template, scaffolds)
    # Render only the designated HTML entry, never JavaScript or arbitrary user data.
    contents[bundle.entry] = Environment(autoescape=True, undefined=StrictUndefined).from_string(
        contents[bundle.entry].decode("utf-8")).render(title=title, description=description).encode("utf-8")
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
                item = store.register(**metadata.model_dump(), **mapping, status="draft", template=template,
                                      project=project, name=name)
            finally:
                os.close(target_fd)
        except BaseException:
            # rmtree's fd-relative implementation does not follow swapped symlinks.
            shutil.rmtree(name, dir_fd=artifacts_fd)
            raise
    finally:
        os.close(artifacts_fd)
    return {"artifact": item, "directory": str(directory), "files": [entry.model_dump() for entry in bundle.files],
            "guidance": f"{template} template initialized at {directory}. These files are working reference examples; "
                        "adapt, replace, remove or extend them to present your content. Status: draft — not publicly visible. "
                        f"Publish when ready: battuta-artifact publish --project {project} --artifact {name}"}


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
