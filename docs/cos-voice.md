# CoS voice and Telegram guidance

Tracked in [FIS-156](https://linear.app/fiscumco/issue/FIS-156/give-cos-a-warmer-voice-and-integrate-everyday-telegram-guidance).

## Outcome and scope

The CoS should feel like a bright, warm, independently minded partner, not a
workflow engine. This revision changes communication instructions, not its tools,
authority, delegation model, memory permissions, or execution capabilities.
Operational requests still get decisions or action, not a coaching interview.

The [dedicated CoS source](../bots/cos-bot/AGENTS_dedicated.md) now owns everyday
voice and message-form judgment. The
[Telegram skill](../skills-hub/active-telegram-message/SKILL.md) retains bridge
operations, button markup, screenshot attachments, authorized targets, one-route
delivery, and honest delivery-status handling. Its selection is unchanged.

## Diagnosis and choices

The original dedicated prompt was strong on evidence and workflow but mostly
specified constraints and reporting mechanics. Its long billing examples modeled
a formal report more than everyday conversation. Routine phone-message guidance
was additionally behind a skill triggered by buttons, attachments, and proactive
messages. Those are inspected source facts; attributing the owner's robotic-tone
experience to their combined emphasis is a design inference, not a measured cause.

The revision adds positive voice direction: concrete language, contractions,
specific recognition of a real win, adaptable energy, occasional unforced wit,
and respectful disagreement. It replaces the billing examples with short,
explicitly illustrative operational, candid, and reflective replies. Existing
requirements for decision-changing evidence, uncertainty, complete requested
inventories, necessary questions, and meaningful progress remain.

Everyday Telegram guidance moves into the dedicated prompt: conversational text
by default, phone-readable formatting, meaningful interruptions, and optional
buttons for bounded choices rather than emotional disclosures. Tool syntax and
safety remain in the skill. A plain reply does not require loading it; a bridge
operation still does. Non-Telegram replies use the same voice without assuming a
Telegram target or emitting its controls.

Rejected alternatives include an always-coaching persona, mandatory questions,
fixed banter or emojis, blanket suppression of business lists, pretending to be a
human friend, and optimizing for continued engagement. A more agreeable CoS is
not the goal: warmth must coexist with serious judgment and honest disagreement.

## External evidence and selective borrowing

Sources inspected on 12 November 2026. Public instructions establish what their
authors ask an agent to do, not that the product reliably behaves that way or that
copying a pattern will improve Battuta. No third-party prompt text or packages
were incorporated; the revised wording is original.

| Source and evidence class                                                                                                                                                                                                                                                                     | Supported pattern                                                                                                                                | Use and limits here                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Claude Sonnet 4.5 published system-prompt archive](https://platform.claude.com/docs/en/release-notes/system-prompts/claude-sonnet-4-5), public first-party instructions with multiple dated entries                                                                                          | Natural, warm prose for conversational exchanges; short answers for simple questions; restraint in formatting and questioning                    | Adopt context-sensitive cadence, not the archive's broad restrictions on lists in reports. This is a published chat-product prompt, not the API default or a test of this CoS.                                                                                         |
| [Satori companion skill](https://github.com/MetcalfSolutions/Satori/blob/main/SKILL.md), public community instructions                                                                                                                                                                        | Honesty before comfort, tentative emotional interpretation, autonomy/human connection, and exclusion of purely technical work from introspection | Borrow the distinction between attentive conversation and therapy-like intervention. Reject automatic grounding sentences after technical work, its clinical persona, crisis taxonomy, and its unrelated tool/delegation policy. Not evidence of clinical efficacy.    |
| [heartpunk Motivational Interviewing skill](https://github.com/heartpunk/motivational-interviewing-skill/blob/ebc96be84935d4d79459fa2d3e3bba71f377c9ca/motivational-interviewing/skills/motivational-interviewing/SKILL.md), public CC-BY-4.0 community instructions, inspected commit pinned | Reflective listening, correctable interpretations, autonomy, and separating reflection from factual or execution requests                        | Useful when reflection is wanted. Reject its blanket non-advisory stance and mandatory question/pause style: CoS must still recommend, disagree, and coordinate work. The repository's dataset/training claims are author claims, not independently evaluated results. |
| [ustwo's Pi/Inflection case study](https://ustwo.com/work/inflection-ai/), product-design partner account                                                                                                                                                                                     | Describes Pi as calm, curious, empathetic, and kind, and treats conversational flow as a design concern                                          | Inspiration for warmth through attention rather than canned encouragement. This is a partner/product claim, not Pi's private prompt or independent proof of benefit. No adoption of engagement metrics as a goal.                                                      |
| [Anthropic's personal-guidance research](https://www.anthropic.com/research/claude-personal-guidance), first-party empirical report                                                                                                                                                           | Documents excessive validation and overconfident conclusions from one-sided relationship accounts as failure modes                               | Preserve willingness to disagree and distinguish feelings from factual accusations. Its automated measurement, product population, and lack of a causal counterfactual limit transfer; it does not validate these prompt edits.                                        |

An initial guessed root-level path for the heartpunk skill returned 404. The
repository was then inspected to locate the actual nested skill above; no finding
relies on that failed fetch. Public pages remain mutable except the pinned source.

## Representative before/after examples

These are authored illustrations under identical stated facts, not captured old
bot messages, generated A/B results, or new operational claims. They show the
intended direction, not fixed phrases for every conversation.

### Operational outcome

Given: an email draft has been saved and verified, but not sent.

- Before: “Draft creation completed. No email-send operation was performed.”
- After: “Your draft is ready in Gmail. I haven't sent it.”

The action boundary is equally explicit; the after version sounds like a reply.

### Status when asked

Given: Manager has verified one option; the second is still being checked.

- Before: “The investigation remains in progress pending completion of the comparison.”
- After: “One option checks out; Manager is still checking the second. I don't have a fair comparison yet.”

No invented completion time, commitment, or recommendation.

### Disagreement

Given: the owner asks to ship, but the retry check is known to fail.

- Before: “Deployment is not recommended prior to successful verification.”
- After: “I wouldn't ship it yet—the retry check is still failing. Fixing that first is the safer call.”

A clear view with the reason, not a cheerful agreement or an unauthorized repair.

### Reflection without an interview

Given: the owner wants to talk about feeling worn down, not make a plan.

- Before: “Please clarify the desired outcome of this reflective conversation.”
- After: “That sounds like a lot to carry. We can leave the planning aside for a moment.”

No forced question, diagnosis, execution plan, or simulated intimate relationship.

### Warmth without endorsing an accusation

Given: the owner is frustrated by a colleague's silence; their motive is unknown.

- Before: “Your concern is valid. Their lack of response is unacceptable.”
- After: “Being left waiting is frustrating. I wouldn't take it as proof they don't care, though—we haven't heard their side.”

Recognizes the difficulty without inventing a motive or avoiding disagreement.

### Owning a correction

Given: the CoS previously summarized two records as one.

- Before: “The previous inventory requires clarification.”
- After: “I got that summary wrong: two records, not one. Here's the corrected breakdown.”

Own the error, then supply the actual correction rather than perform an apology.

## Loading and source/runtime relationship

[Instruction assembly](../scripts/bot_setup/src/bot_setup/instructions.py) joins
shared and dedicated sources into generated `AGENTS.md`. Source configuration also
links selected skills. [Packaging](../scripts/packaging/src/battuta_packaging/bundle.py)
generates the same combined instructions and copies complete selected skills into
a release. See [skill management](skill-management.md) for ownership and discovery.

Before editing, installed `/home/opc/battuta/bots/cos-bot/AGENTS.md` exactly matched
the checkout's shared-plus-dedicated baseline, and its selected Telegram skill was
byte-identical. The installed release records commit
`38c506d8853a32d9d0eb393dfc5c9ffbe03cf0a0`; the inspected checkout baseline is
`b6224b86ad7d7f422e23053dcb05202ee45ce0a7`. The runtime does not carry the dedicated
source separately. Source edits do not update that installed copy or prove what
an already-running conversation has loaded.

At the initial source-only handoff, only repository sources and this review note
had changed; no ticket or external publication had been created. The subsequent
FIS-156 ticket/PR publication is for review, not runtime activation. No real bot
was configured, built, deployed, restarted, or contacted, no owner profile was
read, and no package was installed. Setup tests and assembly checks used isolated
temporary fixtures, not operational bot homes.

## Verification and limits

- Diff review preserves the owner-relationship and product/delivery responsibilities,
  shared authority contract, authorized Luma boundaries, presentation/issue duties,
  and existing role/skill selections. The duplicate phone-style paragraph was
  consolidated; its requirements remain in the communication section.
- Skill-manifest validation and isolated assembly exercise the real source inputs,
  including idempotence and preservation of synthetic private data. These check
  executable integration contracts, not prescribed prompt wording. The focused
  instruction/skill/source-configuration/release/worker-setup suites passed:
  **41 tests**.
- Telegram examples are checked as JSON control structures. Button limits, typed
  fallback, reference rechecks, attachment privacy/retention, no second poller,
  no duplicate delivery, and uncertain-delivery handling remain in the skill.
- Full setup tests: **187 passed, 14 failed, 30 subtests passed**. All 14 failures
  stop at the absent `memory-client/node_modules` prerequisite. An unmodified
  baseline reproduced the same counts and failing test names. No dependency
  installation or unrelated repair was attempted.
- Pre-push `make check` passed formatting, then stopped at Node lint with
  **9,827 typed/type-resolution errors** in the partially provisioned checkout;
  subsequent aggregate stages were not reached. That full lint count was not
  independently reproduced on a clean baseline, and no executable source changed.
  This is not an aggregate pass.
- Detailed local verification records are retained under
  `/tmp/battuta-cos-voice-review/`; these are temporary machine-local evidence,
  not durable product documentation or published results.
- No prompt-wording unit tests were added. Formatting, local references, assembly,
  and human source review cannot establish actual model tone or transport behavior.
  The running bot remains unchanged; owner evaluation of representative live turns
  requires separate activation authority. No live A/B improvement is claimed.
