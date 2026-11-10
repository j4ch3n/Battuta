"""Hatchling consumes release pins before assembling wheel metadata and RECORD."""

import json
from pathlib import Path

from hatchling.metadata.plugin.interface import MetadataHookInterface


class CustomMetadataHook(MetadataHookInterface):
    def update(self, metadata):
        metadata["dependencies"] = json.loads((Path(self.root) / "release-requirements.json").read_text())
