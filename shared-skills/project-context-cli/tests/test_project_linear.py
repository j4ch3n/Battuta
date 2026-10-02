"""Linear queries and failures through the real GraphQL client."""

import os
import unittest
from unittest.mock import patch

import click
import httpx

from battuta_project.linear import LinearClient, require_linear_token
from linear_fixtures import CREATED_PROJECT, linear_http, payload, team_page


class LinearTests(unittest.TestCase):
    def test_token_is_required_and_trimmed(self):
        for value in (None, "", " \t\n"):
            with self.subTest(value=value), patch.dict(os.environ, {}, clear=True):
                if value is not None:
                    os.environ["LINEAR_API_TOKEN"] = value
                with self.assertRaisesRegex(click.ClickException, "LINEAR_API_TOKEN"):
                    require_linear_token()
        with patch.dict(os.environ, {"LINEAR_API_TOKEN": " token "}):
            self.assertEqual(require_linear_token(), "token")

    def test_team_pages_use_cursors_authentication_and_timeout(self):
        with linear_http(
            team_page([{"id": "team-1", "name": "Engineering"}], more=True, cursor="next"),
            team_page([{"id": "team-2", "name": "Design"}]),
        ) as requests:
            teams = LinearClient("secret").list_teams()
        self.assertEqual([(team.id, team.name) for team in teams],
                         [("team-1", "Engineering"), ("team-2", "Design")])
        self.assertEqual(len(requests), 2)
        for request in requests:
            self.assertEqual(str(request.url), "https://api.linear.app/graphql")
            self.assertEqual(request.headers["Authorization"], "secret")
            self.assertEqual(request.method, "POST")
            self.assertEqual(request.extensions["timeout"]["read"], 30)
            self.assertNotIn("__schema", payload(request)["query"])
        self.assertEqual(payload(requests[0])["variables"]["after"], None)
        self.assertEqual(payload(requests[1])["variables"]["after"], "next")

    def test_empty_team_list_is_valid(self):
        with linear_http(team_page()):
            self.assertEqual(LinearClient("secret").list_teams(), [])

    def test_invalid_and_repeated_pagination_are_rejected(self):
        for responses in (
            [team_page(more=True)],
            [team_page(more=True, cursor="same"), team_page(more=True, cursor="same")],
            [{"data": {"teams": {"nodes": [], "pageInfo": {"hasNextPage": "yes", "endCursor": None}}}}],
            [team_page([{"id": "", "name": "Engineering"}])],
            [{"data": {"teams": None}}],
        ):
            with self.subTest(responses=responses), linear_http(*responses):
                with self.assertRaisesRegex(click.ClickException, "Linear"):
                    LinearClient("secret").list_teams()

    def test_api_errors_are_readable_including_http_200_graphql_errors(self):
        responses = (
            {"errors": [{"message": "Not authenticated"}], "data": {"teams": None}},
            httpx.Response(401, text="Unauthorized"),
            httpx.Response(429, text="Rate limited"),
            httpx.Response(500, json=team_page()),
            httpx.ReadTimeout("Request timed out"),
            httpx.ConnectError("Connection failed"),
            httpx.Response(200, text="not json"),
            {"unexpected": True}, [], {"data": None},
        )
        for response in responses:
            with self.subTest(response=response), linear_http(response):
                with self.assertRaisesRegex(click.ClickException, "Linear"):
                    LinearClient("secret").list_teams()

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
