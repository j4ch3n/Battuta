import os
import shutil
import tempfile
from unittest.mock import patch

import click
from fastapi.testclient import TestClient

from battuta_artifacts import files
from battuta_artifacts.models import assemble_files
from battuta_artifacts.registry import ArtifactError
from fixtures import BundleFixture


class LinkFixture(BundleFixture):
    def setUp(self):
        super().setUp()
        self.assertEqual(self.init("--vendor", "mermaid").exit_code, 0)
        self.bundle = self.project / "artifacts/sizing"
        self.code = self.project / "code"
        (self.code / "notes.txt").write_bytes(b"tracked")
        self.outside = self.home / "outside.txt"
        self.outside.write_bytes(b"secret")
        self.link = self.bundle / "linked.txt"

    def command(self, *args):
        from battuta_artifacts.cli import main
        from click.testing import CliRunner
        with patch.dict(os.environ, {"BATTUTA_ARTIFACT_BASE_URL": "https://example.test/artifacts"}):
            return CliRunner().invoke(main, [*args, "--json"])

    def publish(self, path="linked.txt"):
        return self.command("publish", "--project", "procurement", "--artifact", "sizing", "--file", path)

    def get(self, path="linked.txt"):
        from battuta_artifacts.app import create_app
        with TestClient(create_app(self.store.path)) as client:
            return client.get("/artifacts/a/sizing/" + path)

    def publish_valid_link(self):
        self.link.symlink_to(self.code / "notes.txt")
        result = self.publish()
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(self.get().content, b"tracked")

    def repoint(self, target):
        self.link.unlink()
        self.link.symlink_to(target)


class AllowedLinkTests(LinkFixture):
    def test_leaf_link_into_project_checkout_publishes_and_serves_target_bytes(self):
        nested = self.code / "docs/guide.txt"
        nested.parent.mkdir()
        nested.write_bytes(b"guide")
        self.link.symlink_to(os.path.relpath(nested, self.bundle))
        (self.code / "hop").symlink_to("docs/guide.txt")
        (self.bundle / "chained.txt").symlink_to(self.code / "hop")

        for path, expected in (("linked.txt", b"guide"), ("chained.txt", b"guide")):
            with self.subTest(path=path):
                result = self.publish(path)
                self.assertEqual(result.exit_code, 0, result.output)
                response = self.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content, expected)

    def test_regular_bundle_files_are_unaffected(self):
        (self.bundle / "plain.txt").write_bytes(b"plain")
        self.assertEqual(self.publish("plain.txt").exit_code, 0)
        self.assertEqual(self.get("plain.txt").content, b"plain")


class RejectedLinkTests(LinkFixture):
    def targets(self):
        (self.code / "inside-link").symlink_to(self.outside)
        (self.code / "folder").mkdir()
        os.mkfifo(self.code / "pipe")
        return {
            "absolute outside": self.outside,
            "relative outside": os.path.relpath(self.outside, self.bundle),
            "chain leaving root": self.code / "inside-link",
            "directory": self.code / "folder",
            "checkout root": self.code,
            "fifo inside root": self.code / "pipe",
            "device": "/dev/null",
            "dangling": self.code / "missing.txt",
        }

    def test_disallowed_targets_are_rejected_at_publish_and_serve(self):
        self.publish_valid_link()
        for name, target in self.targets().items():
            with self.subTest(target=name):
                self.repoint(target)
                self.assertEqual(self.get().status_code, 404)
                result = self.publish()
                self.assertNotEqual(result.exit_code, 0, result.output)
                self.assertIn("File is unavailable", result.output)

    def test_hidden_symlink_target_is_rejected_at_serve_and_publish(self):
        self.publish_valid_link()
        hidden = self.code / ".git/config"
        hidden.parent.mkdir()
        hidden.write_bytes(b"TOKEN")
        self.repoint(hidden)

        response = self.get()
        self.assertEqual(response.status_code, 404)
        self.assertIn("Hidden file warning", response.text)
        self.assertNotIn("TOKEN", response.text)
        with self.assertRaises(ArtifactError) as raised:
            assemble_files(self.bundle, "index.html", ("linked.txt",), project="procurement")
        self.assertEqual(str(raised.exception), "File is unavailable: linked.txt (hidden target)")
        self.assertNotIn(str(self.home), str(raised.exception))

    def test_symlinked_ancestor_inside_bundle_is_rejected(self):
        real = self.code / "docs"
        real.mkdir()
        (real / "file.txt").write_bytes(b"tracked")
        shutil.copytree(real, self.bundle / "docs")
        self.assertEqual(self.publish("docs/file.txt").exit_code, 0)
        shutil.rmtree(self.bundle / "docs")
        (self.bundle / "docs").symlink_to(real, target_is_directory=True)

        self.assertEqual(self.get("docs/file.txt").status_code, 404)
        self.assertNotEqual(self.publish("docs/file.txt").exit_code, 0)

    def test_artifacts_without_a_project_never_follow_links(self):
        self.link.symlink_to(self.code / "notes.txt")
        with self.assertRaisesRegex(ArtifactError, "File is unavailable"):
            assemble_files(self.bundle, "index.html", ("linked.txt",))
        self.assertEqual(assemble_files(self.bundle, "index.html", ("linked.txt",), project="procurement")["files"],
                         {"index.html": "text/html", "linked.txt": "text/plain"})
        self.store.register(slug="standalone", title="Standalone", description="Detached",
                            source_root=str(self.bundle), entry_path="index.html", format="html",
                            files={"index.html": "text/html", "linked.txt": "text/plain"}, status="published")
        from battuta_artifacts.app import create_app
        with TestClient(create_app(self.store.path)) as client:
            self.assertEqual(client.get("/artifacts/a/standalone/index.html").status_code, 200)
            self.assertEqual(client.get("/artifacts/a/standalone/linked.txt").status_code, 404)

    def test_project_without_valid_checkout_rejects_links(self):
        self.publish_valid_link()
        real = self.project / "code-real"
        self.code.rename(real)
        self.code.symlink_to(real, target_is_directory=True)
        self.assertEqual(self.get().status_code, 404)
        self.assertNotEqual(self.publish().exit_code, 0)
        self.code.unlink()
        self.assertEqual(self.get().status_code, 404)

    def test_registry_failures_disable_links(self):
        self.assertIsNone(files.allowed_link_root(None))
        for error in (click.ClickException("missing"), OSError("io"), ValueError("bad")):
            with self.subTest(error=error), patch("battuta_project.registry.ProjectRegistry.load", side_effect=error):
                self.assertIsNone(files.allowed_link_root("procurement"))
        self.assertIsNone(files.allowed_link_root("unknown"))


class LinkRaceTests(LinkFixture):
    def open(self):
        return files.open_source(str(self.bundle), "linked.txt", link_root=self.code.resolve())

    def swap_after_resolution(self, swap):
        real = files._check_target

        def check_then_swap(*args):
            real(*args)
            swap()

        return patch("battuta_artifacts.files._check_target", side_effect=check_then_swap)

    def test_target_swapped_to_outside_link_after_resolution_fails_closed(self):
        self.link.symlink_to(self.code / "notes.txt")

        def swap():
            (self.code / "notes.txt").unlink()
            (self.code / "notes.txt").symlink_to(self.outside)

        with self.swap_after_resolution(swap), self.assertRaises(OSError):
            self.open()

    def test_leaf_link_repointed_after_readlink_never_yields_outside_file(self):
        self.link.symlink_to(self.code / "notes.txt")
        real = os.readlink

        def read_then_repoint(*args, **kwargs):
            text = real(*args, **kwargs)
            self.repoint(self.outside)
            return text

        with patch("battuta_artifacts.files.os.readlink", side_effect=read_then_repoint):
            try:
                with self.open() as source:
                    self.assertEqual(source.read(), b"tracked")
            except OSError:
                pass

    def test_ancestor_replaced_by_symlink_during_walk_fails_closed(self):
        (self.code / "docs").mkdir()
        (self.code / "docs/notes.txt").write_bytes(b"tracked")
        self.link.symlink_to(self.code / "docs/notes.txt")
        elsewhere = tempfile.mkdtemp(dir=self.home)
        with open(os.path.join(elsewhere, "notes.txt"), "wb") as handle:
            handle.write(b"secret")

        def swap():
            (self.code / "docs").rename(self.code / "docs-old")
            (self.code / "docs").symlink_to(elsewhere, target_is_directory=True)

        with self.swap_after_resolution(swap), self.assertRaises(OSError):
            self.open()
