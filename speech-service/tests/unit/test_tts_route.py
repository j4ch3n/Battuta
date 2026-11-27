import pytest
from starlette.testclient import TestClient

from battuta_speech.server import create_mcp_app


class Engine:
    def synthesize(self, text):
        return b"ogg:" + text.encode()


def test_tts_route_returns_ogg_bytes():
    with TestClient(create_mcp_app(lambda: Engine())) as client:
        response = client.post("/tts", content=b"hello")
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/ogg"
    assert response.content == b"ogg:hello"


@pytest.mark.parametrize("body", [b"", b"   ", b"\xff", b"x" * 4001],
                         ids=["empty", "blank", "invalid-utf8", "too-long"])
def test_tts_route_rejects_invalid_text(body):
    with TestClient(create_mcp_app(lambda: Engine())) as client:
        response = client.post("/tts", content=body)
    assert response.status_code in {400, 413}
