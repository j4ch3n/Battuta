"""Validated notebook indexes; legacy notebooks remain readable without writes."""

import json

import click

from .storage import atomic_write, read_text, regular_file


def load(notebook) -> dict:
    path = notebook.path.with_suffix(".json")
    regular_file(path)
    identity = {"schemaVersion": 1, "scope": notebook.scope, "role": notebook.role,
                "project": notebook.project, "workId": notebook.work_id, "itemFile": notebook.path.name}
    if not path.exists():
        return {**identity, "nextDraftId": 1, "drafts": []}
    try:
        data = json.loads(read_text(path))
        if not isinstance(data, dict) or type(data.get("schemaVersion")) is not int:
            raise ValueError("expected a versioned notebook index")
        if any(data.get(key) != value for key, value in identity.items()):
            raise ValueError("unsupported schema or mismatched notebook identity")
        if type(data.get("nextDraftId")) is not int or data["nextDraftId"] < 1 or not isinstance(data.get("drafts"), list):
            raise ValueError("invalid draft collection")
        previous = 0
        for draft in data["drafts"]:
            if not isinstance(draft, dict) or type(draft.get("id")) is not int or not previous < draft["id"] < data["nextDraftId"]:
                raise ValueError("draft IDs must be increasing and below nextDraftId")
            previous = draft["id"]
            if draft.get("file") != f"{notebook.path.stem}-draft-{previous}.md":
                raise ValueError("invalid draft file reference")
            title = draft.get("title")
            if not isinstance(title, str) or not title.strip() or any(char in title for char in "\x00\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029"):
                raise ValueError("invalid draft title")
            if not isinstance(draft.get("createdAt"), str) or not draft["createdAt"]:
                raise ValueError("missing draft creation time")
        return data
    except (ValueError, UnicodeError) as error:
        raise click.ClickException(f"Invalid notebook metadata at {path}: {error}; retain it and recover before retrying") from error


def save(notebook, data: dict) -> None:
    atomic_write(notebook.path.with_suffix(".json"), json.dumps(data, ensure_ascii=False, indent=2) + "\n")
