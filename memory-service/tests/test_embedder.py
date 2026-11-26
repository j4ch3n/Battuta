import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import numpy as np

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


class EmbedderTests(unittest.TestCase):
    def test_query_has_instruction_and_documents_do_not(self):
        tokenizer = FakeTokenizer()
        embedder = QwenEmbedder(Path("/unused"), session=FakeSession(), tokenizer=tokenizer)
        embedder.embed_documents(["Acme is the client"])
        embedder.embed_query("who is the client")
        self.assertEqual(tokenizer.seen, ["Acme is the client", QUERY_INSTRUCTION + "who is the client"])

    def test_last_token_pooling_normalised_with_empty_cache(self):
        session = FakeSession()
        vector = QwenEmbedder(Path("/unused"), session=session, tokenizer=FakeTokenizer()).embed_query("hello")
        self.assertEqual([round(value, 6) for value in vector], [0.6, 0.0, 0.8])
        feeds = session.feeds[0]
        self.assertEqual(feeds["past_key_values.0.key"].shape, (1, 2, 0, 4))
        self.assertEqual(feeds["position_ids"].tolist()[0], list(range(feeds["input_ids"].shape[1])))


class ModelSetupTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.source = self.root / "source"
        for name in model_setup.FILES:
            (self.source / name).parent.mkdir(parents=True, exist_ok=True)
            (self.source / name).write_bytes(name.encode())
        self.digests = {name: hashlib.sha256(name.encode()).hexdigest() for name in model_setup.FILES}

    def test_install_from_directory_then_verify(self):
        with mock.patch.object(model_setup, "FILES", self.digests):
            manifest = model_setup.install_model(self.root / "home", self.source)
            self.assertEqual(model_setup.verify_model(self.root / "home"), manifest)
            self.assertEqual(json.loads((model_setup.model_folder(self.root / "home") / "battuta-manifest.json").read_text())["revision"], model_setup.REVISION)

    def test_install_rejects_checksum_mismatch(self):
        wrong = {name: "0" * 64 for name in model_setup.FILES}
        with mock.patch.object(model_setup, "FILES", wrong), self.assertRaises(RuntimeError):
            model_setup.install_model(self.root / "home", self.source)
        self.assertFalse(model_setup.model_folder(self.root / "home").exists())

    def test_verify_rejects_tampered_file(self):
        with mock.patch.object(model_setup, "FILES", self.digests):
            model_setup.install_model(self.root / "home", self.source)
            (model_setup.model_folder(self.root / "home") / "tokenizer.json").write_text("tampered")
            with self.assertRaises(RuntimeError):
                model_setup.verify_model(self.root / "home")


if __name__ == "__main__":
    unittest.main()
