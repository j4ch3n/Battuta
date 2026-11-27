"""The library's Manage layer, minus proposals and links that would touch overviews or cross projects.

Battuta adds two retirement drafts (declared stale by an entry, or an old dated entry nobody
recalled). Both are only proposals: they pass core review, decide and the per-kind caps like
any other, and a retirement ends the interval while keeping the file.
"""
import os
import re
import tempfile
from pathlib import Path

from agent_memory.core import reasoning, timestamp
from agent_memory.core.ledger import VERDICT_ACCEPTED
from agent_memory.core.manage import Manage, Proposal

from .layout import OVERVIEW
from .store import project_of

CROSS_PROJECT_KINDS = (reasoning.PROPOSAL_MERGE, reasoning.PROPOSAL_SUPERSEDE)
RETIRING_KINDS = (reasoning.PROPOSAL_DELETE, reasoning.PROPOSAL_SUPERSEDE)

STALE_AFTER_DAYS = 30
STALE_TYPES = ("event", "commitment", "experience")
REASON_CHARS = 240
_SLUG = re.compile(r"(?<![A-Za-z0-9])[a-z0-9]+(?:-[a-z0-9]+)+(?![A-Za-z0-9])")
_CUE = re.compile(r"\b(?:stale|obsolete|outdated|out of date|superseded|supersede|retire|retired|invalid|no longer|replaced|forget)\b",
                  re.IGNORECASE)
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+|\n\s*\n")


def one_line(text) -> str:
    return " ".join(str(text or "").split())


class BattutaManage(Manage):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Every proposal handed out, by id, so the report can name the reason behind a decision.
        self._drafted: dict[str, Proposal] = {}

    # sleep() and decide() both read proposals() here, so a dropped proposal is never reviewed or applied.
    def proposals(self, records=None, hits=None):
        inspected = self._store.records() if records is None else records
        counts = self._usage()[0] if hits is None else hits
        decided = self._ledger().decided()
        # Declarations first: proposal ids ignore the reason, so the first draft for a target wins.
        drafted = [*self._propose_declared(inspected), *self._propose_stale(inspected, counts)]
        drafted = [proposal for proposal in drafted if proposal.id not in decided]
        drafted.extend(super().proposals(records=records, hits=hits))
        known = {record.name: record for record in self._store.records(include_invalid=True)}
        kept = {}
        for proposal in drafted:
            if proposal.id in kept:
                continue
            targets = [known.get(name) for name in proposal.targets]
            if any(target is None or target.type == OVERVIEW for target in targets):
                continue
            if proposal.kind in CROSS_PROJECT_KINDS and len({project_of(target) for target in targets}) > 1:
                continue
            kept[proposal.id] = proposal
        self._drafted.update(kept)
        return list(kept.values())

    def _propose_declared(self, records):
        """An entry that names active slugs verbatim and says they are stale declares them retired.
        This is the only rule that drafts a preference or decision."""
        active = {record.name: record for record in records if record.is_active()}
        drafted = []
        for declaration in active.values():
            if declaration.type == OVERVIEW:
                continue
            text = f"{declaration.abstract}\n\n{declaration.body}"
            if not _CUE.search(text):
                continue
            sentences = [part for part in _SENTENCE_END.split(text) if part.strip()]
            seen = set()
            for slug in _SLUG.findall(text):
                target = active.get(slug)
                if slug in seen or target is None or target.type == OVERVIEW or slug == declaration.name:
                    continue
                seen.add(slug)
                sentence = next((part for part in sentences if slug in _SLUG.findall(part)), text)
                drafted.append(Proposal(kind=reasoning.PROPOSAL_DELETE, targets=(slug,),
                                        reason=one_line(sentence)[:REASON_CHARS],
                                        evidence=f"declared by {declaration.name}; slug {slug}"))
        return drafted

    def _propose_stale(self, records, hits):
        """Dated entries (events, commitments, experiences) older than a month that were never recalled."""
        now = self._clock.now()
        drafted = []
        for record in records:
            if not record.is_active() or record.type == OVERVIEW or record.type not in STALE_TYPES:
                continue
            if hits.get(record.name, 0) != 0:
                continue
            dated = record.valid_from or record.created
            try:
                age = timestamp.days_between(now, timestamp.parse(dated))
            except (ValueError, OverflowError):
                continue
            if age <= STALE_AFTER_DAYS:
                continue
            drafted.append(Proposal(kind=reasoning.PROPOSAL_DELETE, targets=(record.name,),
                                    reason=f"stale by rule: {record.type} dated {dated}, never recalled, {int(age)} days old",
                                    evidence=f"valid_from={record.valid_from or 'none'}; created={record.created}; hits=0"))
        return drafted

    # Every retirement records why in the ledger detail, which must stay one line.
    def _delete(self, proposal, expected):
        return self._with_reason(super()._delete(proposal, expected), proposal)

    def _supersede(self, proposal, expected):
        return self._with_reason(super()._supersede(proposal, expected), proposal)

    @staticmethod
    def _with_reason(detail, proposal):
        return f"{detail} - {one_line(proposal.reason)} [{one_line(proposal.evidence)}]"

    def _write_report(self, report):
        path = super()._write_report(report)
        lines = ["", "## retired", ""]
        for decision in report.decisions:
            if decision.verdict != VERDICT_ACCEPTED:
                continue
            proposal = self._drafted.get(decision.proposal_id)
            suffix = f"(proposal {decision.proposal_id}, decided {decision.at})"
            if proposal is None:
                detail = one_line(decision.detail)
                if detail.startswith(("marked ", "kept ")):
                    lines.append(f"- {detail} {suffix}")
            elif proposal.kind in RETIRING_KINDS:
                lines.append(f"- {proposal.kind} {', '.join(proposal.targets)} — {one_line(proposal.reason)}"
                             f" [{one_line(proposal.evidence)}] {suffix}")
        if len(lines) == 3:
            lines.append("- none")
        target = Path(path)
        rendered = target.read_text(encoding="utf-8") + "\n".join(lines) + "\n"
        with tempfile.NamedTemporaryFile("w", dir=target.parent, delete=False, encoding="utf-8") as temporary:
            temporary.write(rendered)
            staged = Path(temporary.name)
        try:
            os.replace(staged, target)
        finally:
            staged.unlink(missing_ok=True)
        return path

    # Unscoped recall returns several projects together; linking per project keeps every link inside one.
    def _add_cooccurrence_links(self, records):
        groups = {}
        for record in records:
            if record.type != OVERVIEW:
                groups.setdefault(project_of(record), []).append(record)
        return [action for group in groups.values() for action in super()._add_cooccurrence_links(group)]
