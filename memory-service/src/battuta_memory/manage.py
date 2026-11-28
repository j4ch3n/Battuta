"""The library's Manage layer, minus proposals and links that would touch overviews or cross projects.

Retirement is declaration-driven: a preference or decision only retires when a newer entry in
the same project genuinely declares it retired by slug, or when a strictly newer entry supersedes
it. Battuta never retires an entry for age alone, and core deletes, merges and exact-duplicate
merges never touch a preference or decision. Every draft still passes core review, decide and the
per-kind caps, and a retirement ends the interval while keeping the file.
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
_SLUG = re.compile(r"(?<![A-Za-z0-9])[a-z0-9]+(?:-[a-z0-9]+)+(?![A-Za-z0-9])")
_CUE = re.compile(r"\b(?:stale|obsolete|outdated|out of date|superseded|supersedes|supersede|retired|retire|invalid"
                  r"|no longer|replaced|replace|forget)\b", re.IGNORECASE)
_REPLACING = frozenset({"replaced", "replace", "supersede", "supersedes"})
_NEGATOR = re.compile(r"(?:\b(?:not|never|nor|cannot|without)\b|\bno\b(?!\s+longer)|n't\b)", re.IGNORECASE)
_KEEP = re.compile(r"\b(?:remains|in force|still holds|still valid|keep|kept|not obsolete|not stale|unsure|left alone"
                   r"|never forget)\b", re.IGNORECASE)
_QUOTED = re.compile(r'"[^"\n]*"|\u201c[^\u201d\n]*\u201d')
_BULLET = re.compile(r"^\s*(?:[-*+\u2022]|\d+[.)])\s+")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
_NEGATION_WINDOW = 3


def one_line(text) -> str:
    return " ".join(str(text or "").split())


def units(text):
    """Sentences and list lines: split on newlines, then on [.!?] followed by whitespace; a bullet line stays whole."""
    found = []
    for line in str(text or "").splitlines():
        if not line.strip():
            continue
        if _BULLET.match(line):
            found.append(line.strip())
        else:
            found.extend(part.strip() for part in _SENTENCE_END.split(line) if part.strip())
    return found


def _valid_cues(unit):
    """Cues that are neither negated, quoted nor inside a question."""
    quoted = [match.span() for match in _QUOTED.finditer(unit)]
    cues = []
    for cue in _CUE.finditer(unit):
        if any(start <= cue.start() < end for start, end in quoted):
            continue
        ending = re.search(r"[.!?]", unit[cue.end():])
        if ending and ending.group() == "?":
            continue
        before = re.findall(r"[A-Za-z']+", unit[:cue.start()])[-_NEGATION_WINDOW:]
        if _NEGATOR.search(" ".join(before)):
            continue
        cues.append(cue)
    return cues


def _by(unit, position):
    """Whether the word right before a position is 'by' or 'with', so the slug there is a replacement."""
    return bool(re.search(r"\b(?:by|with)\W*$", unit[:position], re.IGNORECASE))


def _replacing(unit, cue):
    """Whether a cue is a replacing verb; 'superseded' replaces only in passive form ('S superseded by R')."""
    word = cue.group().lower()
    return word in _REPLACING or (word == "superseded" and bool(re.match(r"\s+by\b", unit[cue.end():], re.IGNORECASE)))


def _replacement(unit, slug):
    """Whether a valid replacing verb in the unit names the slug as the replacement ('replaced by slug',
    'replace S with slug')."""
    return any(_replacing(unit, cue) for cue in _valid_cues(unit)) and any(
        match.group() == slug and _by(unit, match.start()) for match in _SLUG.finditer(unit))


_REPLACE_WORD = re.compile(r"\b(?:replace[sd]?|supersed(?:e|es|ed))\b", re.IGNORECASE)
_S = _SLUG.pattern
# The only replacement phrasings honoured: active 'D replaced S', passive 'S was/is replaced by R' or
# 'S superseded by R', imperative 'replace S with R'.
_RECOGNISED = (re.compile(_S + r"[`'\"*]*\s+replaced\s+[`'\"*]*" + _S),
               re.compile(_S + r".*\b(?:replaced|superseded)\s+by\s+[`'\"*]*" + _S, re.IGNORECASE),
               re.compile(r"\breplace\s+[`'\"*]*" + _S + r"[`'\"*]*\s+with\s+[`'\"*]*" + _S, re.IGNORECASE))


def _unrecognised(unit, active):
    """Fail-safe: a unit holding two or more active slugs and a replace or supersede word in any other
    phrasing than the recognised ones drafts nothing."""
    replacing = _REPLACE_WORD.findall(unit)
    if not replacing or len({slug for slug in _SLUG.findall(unit) if slug in active}) < 2:
        return False
    return len(replacing) > 1 or not any(pattern.search(unit) for pattern in _RECOGNISED)


def _names(unit, slug, cues):
    """Whether a valid cue in the unit names the slug. A replacing verb names the slugs after it ('D replaced
    S'), or in passive form the slugs before it ('S was replaced by R'); a slug right after 'by' or 'with' is
    never named, and a unit with more than one replacing verb, or a passive one with no slug before it, names none."""
    replacing = [cue for cue in cues if _replacing(unit, cue)]
    if len(replacing) > 1:
        return False
    positions = [match.start() for match in _SLUG.finditer(unit)
                 if match.group() == slug and not (replacing and _by(unit, match.start()))]
    for cue in cues:
        if cue not in replacing:
            return bool(positions)
        if re.match(r"\s+by\b", unit[cue.end():], re.IGNORECASE):
            if any(position < cue.start() for position in positions):
                return True
        elif any(position >= cue.end() for position in positions):
            return True
    return False


def _listed(unit, slug):
    if _BULLET.match(unit):
        return True
    escaped = re.escape(slug)
    return bool(re.search(escaped + r"[`'\")\]*]*\s*[,;]", unit)
                or re.search(r"[,;]\s*(?:(?:and|or)\s+)?[`'\"(\[*]*" + escaped, unit))


def _kept(unit):
    return bool(_KEEP.search(_SLUG.sub(" ", unit)))


def _dated(record):
    return timestamp.parse(record.valid_from or record.created)


def _newer(first, second):
    try:
        return _dated(first) > _dated(second)
    except (ValueError, OverflowError):
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
        """A newer, non-overview entry in the same project declares a named active slug retired when the
        slug's sentence or list line carries a retirement cue that is not negated, quoted or asked, or
        when the declarer's abstract carries such a cue and the slug is a body list entry. A slug whose
        own sentence or line says to keep it (remains, still holds, unsure, ...) is never drafted.
        This is the only Battuta rule that drafts a retirement."""
        active = {record.name: record for record in records if record.is_active()}
        drafted = []
        for declaration in active.values():
            if declaration.type == OVERVIEW:
                continue
            abstract_units = units(declaration.abstract)
            body_units = units(declaration.body)
            abstract_cued = any(_valid_cues(unit) for unit in abstract_units)
            every = [*abstract_units, *body_units]
            seen = set()
            for slug in _SLUG.findall(f"{declaration.abstract}\n{declaration.body}"):
                target = active.get(slug)
                if slug in seen or target is None or target.type == OVERVIEW or slug == declaration.name:
                    continue
                seen.add(slug)
                if project_of(target) != project_of(declaration) or not _newer(declaration, target):
                    continue
                own = [unit for unit in every if slug in _SLUG.findall(unit)]
                if any(_kept(unit) or _replacement(unit, slug) or _unrecognised(unit, active) for unit in own):
                    continue
                reason = next((unit for unit in own if _names(unit, slug, _valid_cues(unit))), None)
                if reason is None and abstract_cued and any(_listed(unit, slug) for unit in body_units if unit in own):
                    reason = declaration.abstract
                if reason is None:
                    continue
                drafted.append(DeclaredProposal(kind=reasoning.PROPOSAL_DELETE, targets=(slug,),
                                                reason=one_line(reason)[:REASON_CHARS],
                                                evidence=f"declared by {declaration.name}; slug {slug}",
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
        return self._with_reason(super()._merge(proposal, verdict, expected), proposal)

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
