"""Linear queries and failures through the real GraphQL client."""

import os
import unittest
from unittest.mock import patch

import click
import httpx

from battuta_project.linear import LinearClient, require_linear_token
from linear_fixtures import CREATED_PROJECT, PROJECT, linear_http, payload


class LinearTests(unittest.TestCase):
    def test_get_project_uses_id_variable_and_returns_actual_url(self):
        with linear_http(PROJECT) as requests:
            project = LinearClient("secret").get_project("project-1")
        self.assertEqual(project.id, "project-1")
        self.assertEqual(project.url, "https://linear.app/team/project/atlas")
        self.assertEqual(len(requests), 1)
        self.assertEqual(payload(requests[0])["variables"], {"id": "project-1"})
        self.assertIn("project(id: $id)", payload(requests[0])["query"])
        self.assertEqual(requests[0].headers["Authorization"], "secret")
        self.assertEqual(str(requests[0].url), "https://api.linear.app/graphql")
        self.assertEqual(requests[0].method, "POST")
        self.assertEqual(requests[0].extensions["timeout"]["read"], 30)
        self.assertNotIn("__schema", payload(requests[0])["query"])

    def test_get_project_rejects_blank_id_before_http(self):
        with linear_http() as requests:
            with self.assertRaises(click.ClickException):
                LinearClient("secret").get_project(" ")
        self.assertEqual(requests, [])

    def test_get_project_failures_are_readable_and_not_retried(self):
        for response in (
            {"data": {"project": None}},
            {"data": {"project": {"id": "project-1", "name": "Atlas", "url": ""}}},
            {"data": {}},
            {"errors": [{"message": "Not authenticated"}]},
            httpx.ReadTimeout("Request timed out"),
        ):
            with self.subTest(response=response), linear_http(response) as requests:
                with self.assertRaisesRegex(click.ClickException, "Linear"):
                    LinearClient("secret").get_project("project-1")
                self.assertEqual(len(requests), 1)

    def test_token_is_required_and_trimmed(self):
        for value in (None, "", " \t\n"):
            with self.subTest(value=value), patch.dict(os.environ, {}, clear=True):
                if value is not None:
                    os.environ["LINEAR_API_TOKEN"] = value
                with self.assertRaisesRegex(click.ClickException, "LINEAR_API_TOKEN"):
                    require_linear_token()
        with patch.dict(os.environ, {"LINEAR_API_TOKEN": " token "}):
            self.assertEqual(require_linear_token(), "token")

    def test_api_errors_are_readable_including_http_200_graphql_errors(self):
        responses = (
            {"errors": [{"message": "Not authenticated"}], "data": {"project": None}},
            httpx.Response(401, text="Unauthorized"),
            httpx.Response(429, text="Rate limited"),
            httpx.Response(500, json=PROJECT),
            httpx.ReadTimeout("Request timed out"),
            httpx.ConnectError("Connection failed"),
            httpx.Response(200, text="not json"),
            {"unexpected": True}, [], {"data": None},
        )
        for response in responses:
            with self.subTest(response=response), linear_http(response):
                with self.assertRaisesRegex(click.ClickException, "Linear"):
                    LinearClient("secret").get_project("project-1")

    def test_create_uses_variables_and_returns_remote_project(self):
        name = 'Atlas "quoted"'
        with linear_http(CREATED_PROJECT) as requests:
            project = LinearClient("secret").create_project(name, "team-1")
        self.assertEqual(project.id, "project-1")
        self.assertEqual(project.url, "https://linear.app/team/project/atlas")
        self.assertEqual(len(requests), 1)
        self.assertEqual(payload(requests[0])["variables"], {
            "input": {"name": name, "teamIds": ["team-1"]},
        })
        self.assertIn("projectCreate", payload(requests[0])["query"])
        self.assertNotIn(name, payload(requests[0])["query"])

    def test_create_rejects_blank_input_before_http(self):
        for name, team in ((" ", "team-1"), ("Atlas", " ")):
            with self.subTest(name=name, team=team), linear_http() as requests:
                with self.assertRaises(click.ClickException):
                    LinearClient("secret").create_project(name, team)
                self.assertEqual(requests, [])

    def test_unsuccessful_or_invalid_creation_is_not_retried(self):
        for response in (
            {"data": {"projectCreate": {"success": False, "project": None}}},
            {"data": {"projectCreate": {"success": True, "project": None}}},
            {"data": {"projectCreate": {"success": True, "project": {"id": ""}}}},
            {"errors": [{"message": "Invalid team"}]},
            httpx.ReadTimeout("Request timed out"),
        ):
            with self.subTest(response=response), linear_http(response) as requests:
                with self.assertRaisesRegex(click.ClickException, "Linear"):
                    LinearClient("secret").create_project("Atlas", "team-1")
                self.assertEqual(len(requests), 1)
