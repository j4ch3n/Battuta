"""Linear operations using gql's synchronous HTTPX transport."""

from contextlib import contextmanager
import os
from typing import Literal

import click
from gql import Client, GraphQLRequest, gql
from gql.transport.exceptions import TransportError
from gql.transport.httpx import HTTPXTransport
from pydantic import Field, ValidationError

from .models import LinearProject, LinearTeam, Model, Text


TEAMS = gql("""
    query BattutaTeams($after: String) {
      teams(first: 100, after: $after) {
        nodes { id name }
        pageInfo { hasNextPage endCursor }
      }
    }
""")

CREATE_PROJECT = gql("""
    mutation BattutaProjectCreate($input: ProjectCreateInput!) {
      projectCreate(input: $input) {
        success
        project { id name url }
      }
    }
""")

GET_PROJECT = gql("""
    query BattutaProject($id: String!) {
      project(id: $id) { id name url }
    }
""")


class _PageInfo(Model):
    has_next_page: bool = Field(alias="hasNextPage")
    end_cursor: Text | None = Field(alias="endCursor")


class _Teams(Model):
    nodes: list[LinearTeam]
    page_info: _PageInfo = Field(alias="pageInfo")


class _TeamResult(Model):
    teams: _Teams


class _CreateInput(Model):
    name: Text
    team_ids: list[Text] = Field(alias="teamIds")


class _CreatePayload(Model):
    success: Literal[True]
    project: LinearProject


class _CreateResult(Model):
    project_create: _CreatePayload = Field(alias="projectCreate")


class _ProjectInput(Model):
    id: Text


class _ProjectResult(Model):
    project: LinearProject | None


def require_linear_token() -> str:
    token = os.environ.get("LINEAR_API_TOKEN", "").strip()
    if not token:
        raise click.ClickException("LINEAR_API_TOKEN is required to use battuta-project; set it in the session environment.")
    return token


class LinearClient:
    def __init__(self, token: str):
        self.client = Client(
            transport=HTTPXTransport(
                url="https://api.linear.app/graphql",
                headers={"Authorization": token},
                timeout=30,
                event_hooks={"response": [lambda response: response.raise_for_status()]},
            ),
            fetch_schema_from_transport=False,
        )

    @contextmanager
    def _errors(self):
        try:
            yield
        except TransportError as error:
            raise click.ClickException(f"Linear API request failed: {error}") from error
        except (ValidationError, AssertionError, AttributeError, TypeError) as error:
            raise click.ClickException(f"Invalid Linear input or response: {error}") from error

    def list_teams(self) -> list[LinearTeam]:
        teams = []
        cursor = None
        seen = set()
        with self._errors(), self.client as session:
            while True:
                request = GraphQLRequest(TEAMS, variable_values={"after": cursor})
                result = _TeamResult.model_validate(session.execute(request))
                teams.extend(result.teams.nodes)
                page = result.teams.page_info
                if not page.has_next_page:
                    return teams
                cursor = page.end_cursor
                if cursor is None or cursor in seen:
                    raise click.ClickException("Invalid Linear pagination: missing or repeated next-page cursor.")
                seen.add(cursor)

    def create_project(self, name: str, team_id: str) -> LinearProject:
        with self._errors():
            inputs = _CreateInput(name=name, teamIds=[team_id])
            with self.client as session:
                request = GraphQLRequest(CREATE_PROJECT, variable_values={"input": inputs.model_dump(by_alias=True)})
                result = session.execute(request)
            return _CreateResult.model_validate(result).project_create.project

    def get_project(self, project_id: str) -> LinearProject:
        with self._errors():
            inputs = _ProjectInput(id=project_id)
            with self.client as session:
                request = GraphQLRequest(GET_PROJECT, variable_values=inputs.model_dump())
                result = _ProjectResult.model_validate(session.execute(request))
            if result.project is None:
                raise click.ClickException(f"Linear project {inputs.id} was not found or is inaccessible.")
            return result.project
