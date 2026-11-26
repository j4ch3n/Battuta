"""The library's Manage layer, minus proposals that would rewrite overviews or move knowledge between projects."""
from agent_memory.core import reasoning
from agent_memory.core.manage import Manage

from .layout import OVERVIEW
from .store import project_of

CROSS_PROJECT_KINDS = (reasoning.PROPOSAL_MERGE, reasoning.PROPOSAL_SUPERSEDE)


class BattutaManage(Manage):
    # sleep() and decide() both read proposals() here, so a dropped proposal is never reviewed or applied.
    def proposals(self, records=None, hits=None):
        drafted = super().proposals(records=records, hits=hits)
        known = {record.name: record for record in self._store.records(include_invalid=True)}
        kept = []
        for proposal in drafted:
            targets = [known.get(name) for name in proposal.targets]
            if any(target is None or target.type == OVERVIEW for target in targets):
                continue
            if proposal.kind in CROSS_PROJECT_KINDS and len({project_of(target) for target in targets}) > 1:
                continue
            kept.append(proposal)
        return kept
