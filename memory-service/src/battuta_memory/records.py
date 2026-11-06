"""Canonical lifecycle decoding and evidence eligibility; no policy or model calls."""

import hashlib
import json
from datetime import datetime

from .contracts import MemoryMetadata, Scope, SourceRef


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

    def valid(ref, historical, visiting):
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

    def meaningful(value, seen):
        metadata = dict(value.get("memory_metadata") or {})
        metadata.pop("stage", None)
        links = metadata.pop("evidence", [])
        return {**{k: value.get(k) for k in ("ref", "content", "scope", "sources", "kind", "tags", "active", "superseded_by")},
            "memory_metadata": metadata, "evidence": [{**{k: v for k, v in link.items() if k != "revision"},
                "state": meaningful(lookup[link["ref"]], seen | {link["ref"]}) if link["ref"] in lookup and link["ref"] not in seen else None} for link in links]}

    return hashlib.sha256(json.dumps(meaningful(record, {record["ref"]}), sort_keys=True, ensure_ascii=False).encode()).hexdigest()
