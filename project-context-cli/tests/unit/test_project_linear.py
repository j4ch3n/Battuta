"""Linear queries and failures through the real GraphQL client."""

import click
import httpx
import pytest

from battuta_project.linear import LinearClient, require_linear_token


def test_get_project_uses_id_variable_and_returns_actual_url(linear_http, linear_project, payload):
    with linear_http(linear_project) as requests:
        project = LinearClient("secret").get_project("project-1")
    assert project.id == "project-1"
    assert project.url == "https://linear.app/team/project/atlas"
    assert len(requests) == 1
    assert payload(requests[0])["variables"] == {"id": "project-1"}
    assert "project(id: $id)" in payload(requests[0])["query"]
    assert requests[0].headers["Authorization"] == "secret"
    assert str(requests[0].url) == "https://api.linear.app/graphql"
    assert requests[0].method == "POST"
    assert requests[0].extensions["timeout"]["read"] == 30
    assert "__schema" not in payload(requests[0])["query"]


def test_get_project_rejects_blank_id_before_http(linear_http):
    with linear_http() as requests, pytest.raises(click.ClickException):
        LinearClient("secret").get_project(" ")
    assert requests == []


@pytest.mark.parametrize("response", [
    {"data": {"project": None}},
    {"data": {"project": {"id": "project-1", "name": "Atlas", "url": ""}}},
    {"data": {}},
    {"errors": [{"message": "Not authenticated"}]},
    {"errors": [{"message": "Not authenticated"}], "data": {"project": None}},
    httpx.ReadTimeout("Request timed out"),
    httpx.ConnectError("Connection failed"),
    httpx.Response(401, text="Unauthorized"),
    httpx.Response(429, text="Rate limited"),
    httpx.Response(500, json={"data": {"project": {"id": "project-1", "name": "Atlas", "url": "https://linear.app/p"}}}),
    httpx.Response(200, text="not json"),
    {"unexpected": True}, [], {"data": None},
], ids=["project-null", "empty-url", "empty-data", "graphql-error", "graphql-error-with-data", "read-timeout",
        "connect-error", "http-401", "http-429", "http-500", "not-json", "unexpected-shape", "list-body", "data-null"])
def test_get_project_failures_are_readable_and_not_retried(linear_http, response):
    with linear_http(response) as requests, pytest.raises(click.ClickException, match="Linear"):
        LinearClient("secret").get_project("project-1")
    assert len(requests) == 1


@pytest.mark.parametrize("value", [None, "", " \t\n"], ids=["unset", "empty", "blank"])
def test_token_is_required(monkeypatch, value):
    monkeypatch.delenv("LINEAR_API_TOKEN", raising=False)
    if value is not None:
        monkeypatch.setenv("LINEAR_API_TOKEN", value)
    with pytest.raises(click.ClickException, match="LINEAR_API_TOKEN"):
        require_linear_token()


def test_token_is_trimmed(monkeypatch):
    monkeypatch.setenv("LINEAR_API_TOKEN", " token ")
    assert require_linear_token() == "token"


def test_create_uses_variables_and_returns_remote_project(linear_http, created_project, payload):
    name = 'Atlas "quoted"'
    with linear_http(created_project) as requests:
        project = LinearClient("secret").create_project(name, "team-1")
    assert project.id == "project-1"
    assert project.url == "https://linear.app/team/project/atlas"
    assert len(requests) == 1
    assert payload(requests[0])["variables"] == {"input": {"name": name, "teamIds": ["team-1"]}}
    assert "projectCreate" in payload(requests[0])["query"]
    assert name not in payload(requests[0])["query"]


@pytest.mark.parametrize("name, team", [(" ", "team-1"), ("Atlas", " ")], ids=["blank-name", "blank-team"])
def test_create_rejects_blank_input_before_http(linear_http, name, team):
    with linear_http() as requests, pytest.raises(click.ClickException):
        LinearClient("secret").create_project(name, team)
    assert requests == []


@pytest.mark.parametrize("response", [
    {"data": {"projectCreate": {"success": False, "project": None}}},
    {"data": {"projectCreate": {"success": True, "project": None}}},
    {"data": {"projectCreate": {"success": True, "project": {"id": ""}}}},
    {"errors": [{"message": "Invalid team"}]},
    httpx.ReadTimeout("Request timed out"),
], ids=["unsuccessful", "project-null", "empty-id", "graphql-error", "read-timeout"])
def test_unsuccessful_or_invalid_creation_is_not_retried(linear_http, response):
    with linear_http(response) as requests, pytest.raises(click.ClickException, match="Linear"):
        LinearClient("secret").create_project("Atlas", "team-1")
    assert len(requests) == 1
