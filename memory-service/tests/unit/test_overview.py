import pytest

from battuta_memory.overview import _parse


@pytest.mark.parametrize("reply", [
    'Here it is:\n```json\n{"abstract": "Banking prototype", "body": "Client Acme"}\n```',
    '{"abstract": "Banking prototype", "body": "Client Acme",}',
    "{'abstract': 'Banking prototype', 'body': 'Client Acme'}",
], ids=["fenced-with-prose", "trailing-comma", "single-quotes"])
def test_parses_imperfect_model_json(reply):
    assert _parse(reply) == ("Banking prototype", "Client Acme")


@pytest.mark.parametrize("reply", ["no json here", '{"abstract": "only a line"}', "[1, 2]"],
                         ids=["no-json", "missing-body", "not-an-object"])
def test_rejects_reply_without_both_parts(reply):
    with pytest.raises(ValueError):
        _parse(reply)
