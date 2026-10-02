"""Stub only HTTP I/O while retaining the real gql and HTTPX clients."""

from contextlib import contextmanager
import json
from unittest.mock import patch

import httpx


def team_page(nodes=(), *, more=False, cursor=None):
    return {"data": {"teams": {
        "nodes": list(nodes), "pageInfo": {"hasNextPage": more, "endCursor": cursor},
    }}}


CREATED_PROJECT = {"data": {"projectCreate": {
    "success": True,
    "project": {"id": "project-1", "name": "Atlas", "url": "https://linear.app/team/project/atlas"},
}}}


@contextmanager
def linear_http(*responses):
    requests = []
    pending = iter(responses)
    real_client = httpx.Client

    def handle(request):
        requests.append(request)
        response = next(pending)
        if callable(response):
            response = response(request)
        if isinstance(response, Exception):
            raise response
        return response if isinstance(response, httpx.Response) else httpx.Response(200, json=response)

    def client(**kwargs):
        return real_client(transport=httpx.MockTransport(handle), **kwargs)

    with patch("gql.transport.httpx.httpx.Client", side_effect=client):
        yield requests


def payload(request):
    return json.loads(request.content)
