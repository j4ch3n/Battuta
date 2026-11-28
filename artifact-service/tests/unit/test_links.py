import os
import shutil
from types import SimpleNamespace
from unittest.mock import patch

import click
import pytest
from fastapi.testclient import TestClient

from battuta_artifacts import files
from battuta_artifacts.app import create_app
from battuta_artifacts.models import assemble_files
from battuta_artifacts.registry import ArtifactError


@pytest.fixture
def link(bundle):
    assert bundle.init("--vendor", "mermaid").exit_code == 0
    (bundle.code / "notes.txt").write_bytes(b"tracked")
    outside = bundle.home / "outside.txt"
    outside.write_bytes(b"secret")
    path = bundle.directory / "linked.txt"

    def publish(name="linked.txt"):
        return bundle.publish("--file", name)

    def get(name="linked.txt"):
        return bundle.get(name)

    def publish_valid_link():
        path.symlink_to(bundle.code / "notes.txt")
        result = publish()
        assert result.exit_code == 0, result.output
        assert get().content == b"tracked"

    def repoint(target):
        path.unlink()
        path.symlink_to(target)

    return SimpleNamespace(bundle=bundle, code=bundle.code, directory=bundle.directory, outside=outside, path=path,
                           publish=publish, get=get, publish_valid_link=publish_valid_link, repoint=repoint)


@pytest.mark.parametrize("name", ["linked.txt", "chained.txt"], ids=["relative-leaf-link", "chained-link"])
def test_leaf_link_into_project_checkout_publishes_and_serves_target_bytes(link, name):
    nested = link.code / "docs/guide.txt"
    nested.parent.mkdir()
    nested.write_bytes(b"guide")
    link.path.symlink_to(os.path.relpath(nested, link.directory))
    (link.code / "hop").symlink_to("docs/guide.txt")
    (link.directory / "chained.txt").symlink_to(link.code / "hop")

    result = link.publish(name)

    assert result.exit_code == 0, result.output
    response = link.get(name)
    assert response.status_code == 200
    assert response.content == b"guide"


def test_regular_bundle_files_are_unaffected(link):
    (link.directory / "plain.txt").write_bytes(b"plain")
    assert link.publish("plain.txt").exit_code == 0
    assert link.get("plain.txt").content == b"plain"


def absolute_outside(link):
    return link.outside


def relative_outside(link):
    return os.path.relpath(link.outside, link.directory)


def chain_leaving_root(link):
    (link.code / "inside-link").symlink_to(link.outside)
    return link.code / "inside-link"


def directory(link):
    (link.code / "folder").mkdir()
    return link.code / "folder"


def fifo_inside_root(link):
    os.mkfifo(link.code / "pipe")
    return link.code / "pipe"


@pytest.mark.parametrize(
    "target",
    [absolute_outside, relative_outside, chain_leaving_root, directory, lambda link: link.code, fifo_inside_root,
     lambda link: "/dev/null", lambda link: link.code / "missing.txt"],
    ids=["absolute-outside", "relative-outside", "chain-leaving-root", "directory", "checkout-root", "fifo-inside-root",
         "device", "dangling"],
)
def test_disallowed_targets_are_rejected_at_publish_and_serve(link, target):
    link.publish_valid_link()
    link.repoint(target(link))

    assert link.get().status_code == 404
    result = link.publish()
    assert result.exit_code != 0, result.output
    assert "File is unavailable" in result.output


def test_hidden_symlink_target_is_rejected_at_serve_and_publish(link):
    link.publish_valid_link()
    hidden = link.code / ".git/config"
    hidden.parent.mkdir()
    hidden.write_bytes(b"TOKEN")
    link.repoint(hidden)

    response = link.get()
    assert response.status_code == 404
    assert "Hidden files stay hidden" in response.text
    assert "TOKEN" not in response.text
    with pytest.raises(ArtifactError) as raised:
        assemble_files(link.directory, "index.html", ("linked.txt",), project="procurement")
    assert str(raised.value) == "File is unavailable: linked.txt (hidden target)"
    assert str(link.bundle.home) not in str(raised.value)


def test_symlinked_ancestor_inside_bundle_is_rejected(link):
    real = link.code / "docs"
    real.mkdir()
    (real / "file.txt").write_bytes(b"tracked")
    shutil.copytree(real, link.directory / "docs")
    assert link.publish("docs/file.txt").exit_code == 0
    shutil.rmtree(link.directory / "docs")
    (link.directory / "docs").symlink_to(real, target_is_directory=True)

    assert link.get("docs/file.txt").status_code == 404
    assert link.publish("docs/file.txt").exit_code != 0


def test_artifacts_without_a_project_never_follow_links(link):
    link.path.symlink_to(link.code / "notes.txt")
    with pytest.raises(ArtifactError, match="File is unavailable"):
        assemble_files(link.directory, "index.html", ("linked.txt",))
    assert assemble_files(link.directory, "index.html", ("linked.txt",), project="procurement")["files"] == {
        "index.html": "text/html", "linked.txt": "text/plain"}
    link.bundle.store.register(slug="standalone", title="Standalone", description="Detached",
                               source_root=str(link.directory), entry_path="index.html", format="html",
                               files={"index.html": "text/html", "linked.txt": "text/plain"}, status="published")
    with TestClient(create_app(link.bundle.store.path)) as client:
        assert client.get("/artifacts/a/standalone/index.html").status_code == 200
        assert client.get("/artifacts/a/standalone/linked.txt").status_code == 404


@pytest.mark.parametrize(
    ("project", "failure"),
    [(None, None), ("procurement", click.ClickException("missing")), ("procurement", OSError("io")),
     ("procurement", ValueError("bad"))],
    ids=["no-project", "unknown-project", "io-error", "invalid-context"],
)
def test_registry_failures_disable_links(bundle, project, failure):
    assert files.allowed_link_root("procurement") == bundle.code.resolve()
    bundle.registry.reset_mock()
    bundle.registry.return_value.load.side_effect = failure

    assert files.allowed_link_root(project) is None
    if project is None:
        bundle.registry.assert_not_called()


@pytest.fixture
def race(link):
    def open_link():
        return files.open_source(str(link.directory), "linked.txt", link_root=link.code.resolve())

    def swap_after_resolution(swap):
        real = files._check_target

        def check_then_swap(*args):
            real(*args)
            swap()

        return patch("battuta_artifacts.files._check_target", side_effect=check_then_swap)

    link.open = open_link
    link.swap_after_resolution = swap_after_resolution
    return link


def test_target_swapped_to_outside_link_after_resolution_fails_closed(race):
    race.path.symlink_to(race.code / "notes.txt")

    def swap():
        (race.code / "notes.txt").unlink()
        (race.code / "notes.txt").symlink_to(race.outside)

    with race.swap_after_resolution(swap), pytest.raises(OSError):
        race.open()


def test_leaf_link_repointed_after_readlink_never_yields_outside_file(race):
    race.path.symlink_to(race.code / "notes.txt")
    real = os.readlink

    def read_then_repoint(*args, **kwargs):
        text = real(*args, **kwargs)
        race.repoint(race.outside)
        return text

    with patch("battuta_artifacts.files.os.readlink", side_effect=read_then_repoint):
        try:
            with race.open() as source:
                assert source.read() == b"tracked"
        except OSError:
            pass


def test_ancestor_replaced_by_symlink_during_walk_fails_closed(race, tmp_path_factory):
    (race.code / "docs").mkdir()
    (race.code / "docs/notes.txt").write_bytes(b"tracked")
    race.path.symlink_to(race.code / "docs/notes.txt")
    elsewhere = tmp_path_factory.mktemp("elsewhere")
    (elsewhere / "notes.txt").write_bytes(b"secret")

    def swap():
        (race.code / "docs").rename(race.code / "docs-old")
        (race.code / "docs").symlink_to(elsewhere, target_is_directory=True)

    with race.swap_after_resolution(swap), pytest.raises(OSError):
        race.open()
