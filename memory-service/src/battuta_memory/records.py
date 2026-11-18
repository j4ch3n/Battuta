"""Canonical lifecycle decoding and evidence eligibility; no policy or model calls."""

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
    if operation in ("recall", "list", "inventory", "cue_targets"):
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
        expires = metadata.get("expires_at")
        if expires and not historical and now >= datetime.fromisoformat(expires):
            return False
        for link in metadata.get("evidence", []):
            target = lookup.get(link["ref"])
            if not target or target["revision"] != link["revision"] or not set(target["scope"]["projects"]) <= set(record["scope"]["projects"]):
                return False
            if not valid(link["ref"], link["requirement"] == "historical", visiting | {ref}):
                return False
        return True

    return [record for ref, record in lookup.items() if valid(ref, include_expired, set())]
