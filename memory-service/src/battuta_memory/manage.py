"""The library's Manage layer, minus proposals and links that would touch overviews or cross projects.

Retirement is declaration-driven and structured: an active, non-overview entry retires another entry
only through a body line "Retire: <exact full slug> - <reason>" (optionally bulleted with "- " or "* ";
the separator may also be " — " or ": "), naming an active entry in the same project that is strictly
older than the declarer. Prose never drafts a retirement, and lines in fenced code blocks or blockquotes
are ignored. Core may also supersede an entry with a strictly newer keeper. Battuta never retires an
entry for age alone, and core deletes, merges and exact-duplicate merges never touch a preference or
decision. Every draft still passes core review, decide and the per-kind caps, and a retirement ends
the interval while keeping the file.
"""
import dataclasses
import hashlib
import os
import re
import tempfile
from pathlib import Path

from agent_memory.core import reasoning, timestamp
from agent_memory.core.ledger import VERDICT_ACCEPTED
from agent_memory.core.manage import ACTION_DUPLICATE_MERGED, PROPOSAL_ID_LENGTH, Manage, Proposal

from .layout import OVERVIEW
from .store import project_of

CROSS_PROJECT_KINDS = (reasoning.PROPOSAL_MERGE, reasoning.PROPOSAL_SUPERSEDE)
RETIRING_KINDS = (reasoning.PROPOSAL_DELETE, reasoning.PROPOSAL_SUPERSEDE, reasoning.PROPOSAL_MERGE)
PROTECTED_TYPES = ("preference", "decision")
NO_CHANGE = "no change"
REASON_CHARS = 240
_RETIRE = re.compile(r"^(?:[-*] )?Retire: ([a-z0-9]+(?:-[a-z0-9]+)+)(?: - | — |: )(.*\S.*)$")
_FENCES = ("```", "~~~")


def one_line(text) -> str:
    return " ".join(str(text or "").split())


def retire_lines(body):
    """(slug, reason) for each structured Retire line, skipping fenced code blocks and blockquotes."""
    found, fence = [], None
    for line in str(body or "").splitlines():
        marker = line.lstrip()[:3]
        if marker in _FENCES:
            fence = marker if fence is None else (None if marker == fence else fence)
            continue
        if fence is not None or line.lstrip().startswith(">"):
            continue
        match = _RETIRE.match(line)
        if match:
            found.append((match.group(1), match.group(2).strip()))
    return found


def _dated(record):
    return timestamp.parse(record.valid_from or record.created)


def _newer(first, second):
    try:
        return _dated(first) > _dated(second)
    except (ValueError, OverflowError, TypeError):
        return False


@dataclasses.dataclass(frozen=True)
class DeclaredProposal(Proposal):
    """A declared delete; its id also names the declarer, so rejecting one declaration never blocks a later one."""
    declarer: str = ""

    @property
    def id(self) -> str:
        material = self.kind + "|" + "|".join(sorted(self.targets)) + "|declared-by|" + self.declarer
        return hashlib.sha256(material.encode("utf-8")).hexdigest()[:PROPOSAL_ID_LENGTH]


def _group(proposal):
    return proposal.kind, tuple(sorted(proposal.targets))


class BattutaManage(Manage):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Every proposal handed out, by id, so the report can name the reason behind a decision.
        self._drafted: dict[str, Proposal] = {}

    # sleep() and decide() both read proposals() here, so a dropped proposal is never reviewed or applied.
    def proposals(self, records=None, hits=None):
        inspected = self._store.records() if records is None else records
        decided = self._ledger().decided()
        known = {record.name: record for record in self._store.records(include_invalid=True)}
        declared = [proposal for proposal in self._propose_declared(inspected) if proposal.id not in decided]
        core = [proposal for proposal in super().proposals(records=records, hits=hits) if self._allowed(proposal, known)]
        kept, groups = {}, set()
        # Declarations first, so a declared delete wins over a core draft for the same target.
        for proposal in [*declared, *core]:
            if proposal.id in kept or _group(proposal) in groups:
                continue
            targets = [known.get(name) for name in proposal.targets]
            if any(target is None or target.type == OVERVIEW for target in targets):
                continue
            if proposal.kind in CROSS_PROJECT_KINDS and len({project_of(target) for target in targets}) > 1:
                continue
            kept[proposal.id] = proposal
            groups.add(_group(proposal))
        self._drafted.update(kept)
        return list(kept.values())

    @staticmethod
    def _allowed(proposal, known):
        """Core never deletes or merges a preference or decision; it may supersede one only with a strictly newer keeper."""
        targets = [known.get(name) for name in proposal.targets]
        if not any(target is not None and target.type in PROTECTED_TYPES for target in targets):
            return True
        if proposal.kind != reasoning.PROPOSAL_SUPERSEDE or any(target is None for target in targets):
            return False
        keeper = max(targets, key=lambda record: (len(record.body), record.created, record.name))
        return all(_newer(keeper, target) for target in targets if target.name != keeper.name)

    def _propose_declared(self, records):
        """An active, non-overview entry D drafts a delete of slug S for each body line
        "Retire: S - reason" (see retire_lines) when S is active, is not D, is in D's project and is
        strictly older than D. Anything else, prose included, drafts nothing. This is the only Battuta
        rule that drafts a retirement."""
        active = {record.name: record for record in records if record.is_active()}
        drafted = []
        for declaration in active.values():
            if declaration.type == OVERVIEW:
                continue
            seen = set()
            for slug, reason in retire_lines(declaration.body):
                target = active.get(slug)
                if slug in seen or target is None or slug == declaration.name:
                    continue
                if project_of(target) != project_of(declaration) or not _newer(declaration, target):
                    continue
                seen.add(slug)
                drafted.append(DeclaredProposal(kind=reasoning.PROPOSAL_DELETE, targets=(slug,),
                                                reason=one_line(reason)[:REASON_CHARS],
                                                evidence=f"declared by {declaration.name}",
                                                declarer=declaration.name))
        return drafted

    def _merge_exact_duplicates(self, records):
        return super()._merge_exact_duplicates([record for record in records if record.type not in PROTECTED_TYPES])

    def _inactive(self, proposal):
        for name in proposal.targets:
            current = self._store.find(name)
            if current is None or not current.is_active():
                return f"{NO_CHANGE}: {name} already inactive"
        return None

    # Every retirement records why in the ledger detail, which must stay one line.
    def _delete(self, proposal, expected):
        return self._inactive(proposal) or self._with_reason(super()._delete(proposal, expected), proposal)

    def _supersede(self, proposal, expected):
        return self._inactive(proposal) or self._with_reason(super()._supersede(proposal, expected), proposal)

    def _merge(self, proposal, verdict, expected):
        return self._inactive(proposal) or self._with_reason(super()._merge(proposal, verdict, expected), proposal)

    @staticmethod
    def _with_reason(detail, proposal):
        return f"{detail} - {one_line(proposal.reason)} [{one_line(proposal.evidence)}]"

    def _write_report(self, report):
        path = super()._write_report(report)
        lines = ["", "## retired", ""]
        for decision in report.decisions:
            if decision.verdict != VERDICT_ACCEPTED or one_line(decision.detail).startswith(NO_CHANGE):
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
        for action in report.actions:
            if action.kind == ACTION_DUPLICATE_MERGED:
                lines.append(f"- {ACTION_DUPLICATE_MERGED} {action.target} — exact duplicate of {action.detail}")
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
