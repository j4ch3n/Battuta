"""Cold-start model download state."""

from collections.abc import Callable, Sequence
import json
import os
from pathlib import Path
import threading

DEFAULT_GROUPS = ("baseline", "charts")


def docling_downloader(models_dir: Path, group: str) -> None:
    from docling.utils.model_downloader import download_models

    flags = {
        "baseline": dict(with_layout=True, with_tableformer=True, with_rapidocr=True, with_picture_classifier=True,
                         with_code_formula=False),
        "charts": dict(with_layout=False, with_tableformer=False, with_rapidocr=False, with_picture_classifier=False,
                       with_code_formula=False, with_granite_chart_extraction_v4=True),
        "describe": dict(with_layout=False, with_tableformer=False, with_rapidocr=False, with_picture_classifier=False,
                         with_code_formula=False, with_smolvlm=True),
    }[group]
    download_models(output_dir=models_dir, **flags)


class ModelManager:
    def __init__(self, data_dir: Path, downloader: Callable[[Path, str], None]):
        self.data_dir = Path(data_dir)
        self.models_dir = self.data_dir / "models"
        self._downloader = downloader
        self._lock = threading.Lock()
        self._groups: set[str] = set(self._load().get("groups", []))
        self._error: str | None = None
        self.state = "warming_up"
        if set(DEFAULT_GROUPS) <= self._groups:
            self._go_ready()

    def _load(self) -> dict:
        try:
            return json.loads((self.data_dir / "state.json").read_text())
        except (OSError, ValueError):
            return {}

    def _save(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.data_dir / "state.json.tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump({"groups": sorted(self._groups, key=lambda g: (g not in DEFAULT_GROUPS, g))}, f)
        os.replace(tmp, self.data_dir / "state.json")

    def _go_ready(self) -> None:
        self.state = "ready"
        self._error = None
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

    def ensure(self, groups: Sequence[str] = DEFAULT_GROUPS) -> None:
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
        try:
            for group in groups:
                self._fetch(group)
        except Exception as error:  # surfaced through health(); retried on next start
            self.state = "failed"
            self._error = str(error)
            return
        self._go_ready()

    def ensure_group(self, group: str) -> None:
        # a lazy group needs the network even though HF_HUB_OFFLINE is set
        with self._lock:
            if group in self._groups:
                return
            offline = os.environ.pop("HF_HUB_OFFLINE", None)
            try:
                self._fetch(group)
            finally:
                if offline:
                    os.environ["HF_HUB_OFFLINE"] = offline

    def _fetch(self, group: str) -> None:
        if group in self._groups:
            return
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self._downloader(self.models_dir, group)
        self._groups.add(group)
        self._save()

    def health(self) -> dict:
        return {"ready": self.state == "ready", "state": self.state, "error": self._error}
