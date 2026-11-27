import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import numpy as np
import pytest

from battuta_memory import model_setup
from battuta_memory.embedder import QUERY_INSTRUCTION, QwenEmbedder

END = 99


class FakeTokenizer:
    def __init__(self):
        self.seen = []

    def encode(self, text):
        self.seen.append(text)
        return SimpleNamespace(ids=[len(word) for word in text.split()] + [END])

    def token_to_id(self, token):
        return END


class FakeSession:
    def __init__(self):
        self.feeds = []

    def get_inputs(self):
        names = ("input_ids", "attention_mask", "position_ids", "past_key_values.0.key")
        return [SimpleNamespace(name=name, shape=["batch", 2, "past", 4]) for name in names]

    def run(self, _outputs, feeds):
        self.feeds.append(feeds)
        length = feeds["input_ids"].shape[1]
        hidden = np.zeros((1, length, 3))
        hidden[0, -1] = [3.0, 0.0, 4.0]
        return [hidden]


def test_query_has_instruction_and_documents_do_not():
    tokenizer = FakeTokenizer()
    embedder = QwenEmbedder(Path("/unused"), session=FakeSession(), tokenizer=tokenizer)
    embedder.embed_documents(["Acme is the client"])
    embedder.embed_query("who is the client")
    assert tokenizer.seen == ["Acme is the client", QUERY_INSTRUCTION + "who is the client"]


def test_last_token_pooling_normalised_with_empty_cache():
    session = FakeSession()
    vector = QwenEmbedder(Path("/unused"), session=session, tokenizer=FakeTokenizer()).embed_query("hello")
    assert [round(value, 6) for value in vector] == [0.6, 0.0, 0.8]
    feeds = session.feeds[0]
    assert feeds["past_key_values.0.key"].shape == (1, 2, 0, 4)
    assert feeds["position_ids"].tolist()[0] == list(range(feeds["input_ids"].shape[1]))


@pytest.fixture
def source(tmp_path):
    source = tmp_path / "source"
    for name in model_setup.FILES:
        (source / name).parent.mkdir(parents=True, exist_ok=True)
        (source / name).write_bytes(name.encode())
    return source


@pytest.fixture
def digests():
    return {name: hashlib.sha256(name.encode()).hexdigest() for name in model_setup.FILES}


def test_install_from_directory_then_verify(tmp_path, source, digests):
    home = tmp_path / "home"
    with mock.patch.object(model_setup, "FILES", digests):
        manifest = model_setup.install_model(home, source)
        assert model_setup.verify_model(home) == manifest
        assert json.loads((model_setup.model_folder(home) / "battuta-manifest.json").read_text())["revision"] == model_setup.REVISION


def test_install_rejects_checksum_mismatch(tmp_path, source):
    home = tmp_path / "home"
    wrong = {name: "0" * 64 for name in model_setup.FILES}
    with mock.patch.object(model_setup, "FILES", wrong), pytest.raises(RuntimeError):
        model_setup.install_model(home, source)
    assert not model_setup.model_folder(home).exists()


def test_verify_rejects_tampered_file(tmp_path, source, digests):
    home = tmp_path / "home"
    with mock.patch.object(model_setup, "FILES", digests):
        model_setup.install_model(home, source)
        (model_setup.model_folder(home) / "tokenizer.json").write_text("tampered")
        with pytest.raises(RuntimeError):
            model_setup.verify_model(home)
