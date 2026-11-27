import json
from types import SimpleNamespace

import pytest
from click.testing import CliRunner

from battuta_artifacts.cli import main
from battuta_artifacts.models import assemble_files
from battuta_artifacts.registry import Registry


@pytest.fixture
def cli(tmp_path):
    root = tmp_path.resolve()
    source = root / "source"
    source.mkdir()
    # Content is intentionally not HTML: extensions, not sniffing, determine format.
    (source / "index.html").write_text("trusted by extension")
    (source / "app.js").write_text("console.log('demo')")
    db = root / "registry.sqlite3"
    runner = CliRunner(env={"BATTUTA_ARTIFACT_DB": str(db),
                            "BATTUTA_ARTIFACT_BASE_URL": "https://artifacts.example.test/artifacts"})

    def run(*args):
        return runner.invoke(main, args)

    def register():
        Registry(db).register(slug="demo", title="Demo", description="Walkthrough", status="published",
                              **assemble_files(source, "index.html", ("app.js",)))
        return run("show", "demo", "--json")

    return SimpleNamespace(source=source, db=db, run=run, register=register)


@pytest.fixture
def registered(cli):
    cli.run("setup")
    cli.register()
    return cli


def test_setup_is_explicit(cli):
    result = cli.run("list", "--json")
    assert result.exit_code == 5, result.output
    assert json.loads(result.output)["error"]["code"] == "SCHEMA_MISMATCH"
    assert not cli.db.exists()
    for _ in range(2):
        assert cli.run("setup").exit_code == 0


def test_bundle_registration_update_replace_and_deregister(cli):
    cli.run("setup")
    result = cli.register()
    assert result.exit_code == 0, result.output
    artifact = json.loads(result.output)["artifact"]
    assert artifact["url"] == "https://artifacts.example.test/artifacts/a/demo/"
    assert artifact["local_url"] == "http://127.0.0.1:8000/artifacts/a/demo/"
    assert artifact["format"] == "html"
    assert set(artifact["files"]) == {"index.html", "app.js"}
    conflict = cli.run("update", "demo", "--title", "Changed", "--expected-revision", "9", "--json")
    assert conflict.exit_code == 4
    assert cli.run("update", "demo", "--title", "Changed").exit_code == 0
    (cli.source / "report.md").write_text("# Report")
    result = cli.run("replace-files", "demo", "--root", str(cli.source), "--entry", "report.md", "--json")
    assert result.exit_code == 0, result.output
    artifact = json.loads(result.output)["artifact"]
    assert artifact["files"] == {"report.md": "text/markdown"}
    assert artifact["title"] == "Changed"
    assert artifact["revision"] == 3
    assert cli.run("deregister", "demo", "--expected-revision", "3").exit_code == 0
    assert (cli.source / "index.html").exists()
    assert json.loads(cli.run("list", "--json").output)["artifacts"] == []
    assert cli.run("show", "demo").exit_code == 3


def test_single_file_and_json_output_before_subcommand(cli):
    cli.run("setup")
    (cli.source / "notes.md").write_text("# Notes")
    result = cli.run("--json", "add-file", "--type", "markdown", "--slug", "one", "--title", "One", "--description", "Page",
                     "--file", str(cli.source / "notes.md"))
    assert result.exit_code == 0, result.output
    assert set(json.loads(result.output)["artifact"]["files"]) == {"notes.md"}


def test_public_base_url_is_required_for_artifact_output(registered):
    runner = CliRunner(env={"BATTUTA_ARTIFACT_DB": str(registered.db), "BATTUTA_ARTIFACT_BASE_URL": ""})
    result = runner.invoke(main, ("list", "--json"))
    assert result.exit_code == 2, result.output
    assert "BATTUTA_ARTIFACT_BASE_URL is required" in result.output


@pytest.mark.parametrize(
    "extra",
    [("--file", "../secret"), ("--file", "*.js"), ("--file", "/etc/passwd"), ("--file", "linked.js"),
     ("--file", "missing.js"), ("--file", "a%2fb.js"), ("--file", "app.js", "--file", "app.js")],
    ids=["parent-escape", "glob", "absolute", "symlink", "missing", "encoded-separator", "duplicate"],
)
def test_invalid_replacement_files_leave_the_artifact_unchanged(registered, extra):
    (registered.source / "linked.js").symlink_to(registered.source / "app.js")

    result = registered.run("replace-files", "demo", "--root", str(registered.source), "--entry", "index.html", *extra,
                            "--json")

    assert result.exit_code == 2, result.output
    assert not json.loads(result.output)["ok"]
    assert set(json.loads(registered.run("show", "demo", "--json").output)["artifact"]["files"]) == {"index.html", "app.js"}


@pytest.mark.parametrize("slug", ["../escape", "Bad", "bad--slug"], ids=["path-escape", "uppercase", "double-hyphen"])
def test_invalid_slugs_register_nothing(registered, slug):
    (registered.source / "notes.md").write_text("# Notes")

    result = registered.run("add-file", "--type", "markdown", "--slug", slug, "--title", "Demo", "--description", "Page",
                            "--file", str(registered.source / "notes.md"))

    assert result.exit_code == 2, result.output
    assert [item["slug"] for item in json.loads(registered.run("list", "--json").output)["artifacts"]] == ["demo"]


def test_update_requires_a_change_and_parser_errors_are_json(registered):
    assert registered.run("update", "demo").exit_code == 2
    result = registered.run("publish", "--json")
    assert result.exit_code == 2
    assert json.loads(result.output)["error"]["code"] == "INVALID_INPUT"


@pytest.mark.parametrize(
    "args",
    [("--json", "--bogus", "list"), ("--json", "missing-command"), ("--json", "--bogus")],
    ids=["unknown-option-before-command", "unknown-command", "unknown-option-alone"],
)
def test_top_level_errors_use_json(cli, args):
    result = cli.run(*args)
    assert result.exit_code == 2
    assert json.loads(result.stdout)["error"]["code"] == "INVALID_INPUT"


@pytest.mark.parametrize(("args", "code"), [(("--help",), 0), (("publish", "--help"), 0), ((), 2)],
                         ids=["top-level-help", "command-help", "no-command"])
def test_help_is_shown(cli, args, code):
    result = cli.run(*args)
    assert result.exit_code == code
    assert "Usage:" in result.output
