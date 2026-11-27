"""Publishing journeys through the real CLIs and HTTP server."""

import json
from pathlib import Path

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

pytestmark = pytest.mark.integration

scenarios("features/publish.feature")

PAGES = ("/artifacts/a/demo/", "/artifacts/a/demo/main.css", "/artifacts/a/demo/app.js")


def draft_bundle(project, run, cli):
    run("battuta-project", "init", project)
    source = Path(cli("init", "demo", "--project", project, "--title", "Demo", "--description", "Walkthrough", "--vendor", "mermaid")["directory"])
    (source / "index.html").write_text('<link rel="stylesheet" href="main.css"><script src="app.js"></script>')
    (source / "main.css").write_text("body {color: green}")
    (source / "app.js").write_text("console.log('demo')")
    (source / "secret.txt").write_text("unregistered")
    cli("replace-files", "demo", "--root", str(source), "--entry", "index.html", "--file", "main.css", "--file", "app.js")
    return {"project": project}


@given(parsers.parse('a registered project "{project}" with an HTML bundle'), target_fixture="bundle")
def registered_project(project, run, cli):
    return draft_bundle(project, run, cli)


@given(parsers.parse('a published artifact in project "{project}"'), target_fixture="bundle")
def published_artifact(project, run, cli):
    bundle = draft_bundle(project, run, cli)
    cli("publish", "--project", project, "--artifact", "demo")
    return bundle


@when("the artifact is published")
def publish(bundle, cli):
    cli("publish", "--project", bundle["project"], "--artifact", "demo")


@when("the project is removed")
def remove_project(bundle, run):
    run("battuta-project", "remove", bundle["project"])


@then(parsers.parse('the catalog lists it under "{project}"'))
def catalog_lists(project, get):
    artifacts = json.loads(get("/artifacts/catalog"))["artifacts"]
    assert [(item["slug"], item["project"]) for item in artifacts] == [("demo", project)]


@then("its page, stylesheet and script are served")
def bundle_served(get):
    assert 'src="app.js"' in get(PAGES[0])
    assert "color: green" in get(PAGES[1])
    assert "console.log('demo')" in get(PAGES[2])


@then("unregistered files are not served")
def unregistered_hidden(get):
    assert get("/artifacts/a/demo/secret.txt") == 404


@then("the artifact is no longer listed or served")
def artifact_gone(get):
    assert json.loads(get("/artifacts/catalog")) == {"artifacts": []}
    assert [get(path) for path in PAGES] == [404, 404, 404]
