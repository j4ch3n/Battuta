"""Canonical lifecycle decoding and evidence eligibility; no policy or model calls."""

import hashlib
import json
from datetime import datetime

from .contracts import MemoryMetadata, Scope, SourceRef


def public_record(record):
    from .scope import projects_from_scope
    result = dict(record)
    if "scope" in result:
        result["projects"] = projects_from_scope(Scope.model_validate(result.pop("scope")))
    if "history" in result:
        result["history"] = [public_record(r) for r in result["history"]]
    if "validation_evidence" in result:
        result["validation_evidence"] = [public_record(r) for r in result["validation_evidence"]]
    return result


def public_response(operation, data):
    if operation in ("get", "forget"):
        return public_record(data)
    if operation in ("recall", "list", "inventory"):
        result = {**data, "records": [public_record(r) for r in data["records"]]}
        if operation == "recall" and "validation_evidence" in data:
            result["validation_evidence"] = [public_record(r) for r in data["validation_evidence"]]
        return result
    return data


def decode_record(record):
    result = dict(record)
    metadata = record.get("memory_metadata")
    if metadata is not None:
        try:
            result["memory_metadata"] = MemoryMetadata.model_validate(metadata).model_dump(mode="json")
        except ValueError:
            result["metadata_error"] = True
    return result


def eligible_records(records, now, include_expired=False):
    lookup = {r["ref"]: decode_record(r) for r in records}
    checked = {}

    def valid(ref, historical, visiting):
        key = (ref, historical)
        if key not in checked:
            checked[key] = check(ref, historical, visiting)
        return checked[key]

    def check(ref, historical, visiting):
        record = lookup.get(ref)
        if not record or ref in visiting or not record.get("active") or record.get("metadata_error"):
            return False
        try:
            Scope.model_validate(record.get("scope"))
            if not record.get("sources"):
                return False
            for source in record["sources"]:
                SourceRef.model_validate(source)
        except ValueError:
            return False
        metadata = record.get("memory_metadata") or {}
        if metadata.get("status", "active") != "active":
            return False
        expires = metadata.get("expires_at")
        if expires and not historical and now >= datetime.fromisoformat(expires):
            return False
        for link in metadata.get("evidence", []):
            target = lookup.get(link["ref"])
            if not target or target["revision"] != link["revision"] or target.get("scope") != record.get("scope"):
                return False
            if not valid(link["ref"], link["requirement"] == "historical", visiting | {ref}):
                return False
        return True

    return [record for ref, record in lookup.items() if valid(ref, include_expired, set())]


def review_fingerprint(record, evidence_records):
    lookup = {r["ref"]: r for r in evidence_records}
    lookup[record["ref"]] = record
    states, pending = {}, [record["ref"]]
    while pending:
        ref = pending.pop()
        if ref in states:
            continue
        value = lookup.get(ref)
        if value is None:
            states[ref] = None
            continue
        if value.get("metadata_error"):
            states[ref] = {"revision": value["revision"], "invalid": True}
            continue
        metadata = dict(value.get("memory_metadata") or {})
        metadata.pop("stage", None)
        links = metadata.pop("evidence", [])
        states[ref] = {**{k: value.get(k) for k in ("content", "scope", "sources", "kind", "tags", "active", "superseded_by")},
            "memory_metadata": metadata, "evidence": [{k: v for k, v in link.items() if k != "revision"} for link in links]}
        pending.extend(link["ref"] for link in links)
    return hashlib.sha256(json.dumps({"claim": record["ref"], "states": states}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
