# GitHub Copilot Instructions for Surveyor
<!--
documentation-metadata
audience: GitHub Copilot; maintainers
owner: project maintainers
status: current
last-verified: 2026-10-26
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: final-answer question placement routed to the policy alongside shared agent context and approval review; no competing engineering rules
source-anchors: AGENTS.md; docs/policies/DOCUMENTATION_POLICY.md; docs/policies/DEVELOPMENT_POLICY.md; docs/ARCHITECTURE.md; docs/DEVELOPMENT.md; docs/TESTING_GUIDE.md; docs/DATABASE.md; package.json; repository-tree
next-review: explicit-maintainer-policy-amendment
-->

Apply [the repository-wide agent guide](../AGENTS.md) before proposing or editing code. This file is deliberately short;
it does not maintain a second copy of Surveyor's architecture, commands, dependency versions, test inventory, or
database procedures.

## Required policy reading

Read and enforce BOTH [Documentation Policy](../docs/policies/DOCUMENTATION_POLICY.md) and
[Development Policy](../docs/policies/DEVELOPMENT_POLICY.md) before editing. Apply the same requirement to subagents.
Policies and approved designs cannot be silently changed to match code. Resolve conflicts and potentially unintended
consequences directly with the maintainer before dependent implementation; never hide approvals or plans in a file.
The policies own all engineering, documentation classification, evidence, test and database-safety rules.
Follow the [question presentation rule](../docs/policies/DEVELOPMENT_POLICY.md#questions-belong-in-the-final-answer-2026-10-26)
for every question and complete outstanding request in the final answer.

Use the Documentation Policy's [optional task-profile discovery](../docs/policies/DOCUMENTATION_POLICY.md#document-roles-and-optional-task-profiles)
at task start and pass applied profiles to delegates. The policy owns activation; absent profiles are normal.
Use the shared context command and caller-held resume procedure in [AGENTS.md](../AGENTS.md), including explicit
profile selection, actual approval history and review of changed sources. Its JSON delivery does not establish
automatic host injection or certify that the instructions were read.

Apply the concrete [agent enforcement procedure](../docs/policies/DEVELOPMENT_POLICY.md#agent-enforcement): compare
request/canonical/design sources before editing, obtain explicit conflict resolution, run scoped measurable checks
and review semantic boundaries and readability. A newer conflicting name and a clean checker result do not replace
approval or human review. Apply the procedure to every delegated agent and review its actual output.

Follow the short, simple [required change explanation](../docs/policies/DEVELOPMENT_POLICY.md#required-change-explanation-2026-10-13)
separately before each individual approval question, including its complete explanation, prohibition on
bundling and semantic delegation/root review. Correct labels alone are insufficient. This routing summary does not
define an alternative format or grant approval.

## Canonical references

- [Project setup and current scripts](../README.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Development workflow](../docs/DEVELOPMENT.md)
- [Testing contract](../docs/TESTING_GUIDE.md)
- [Database and migrations](../docs/DATABASE.md)
- [Documentation policy and help trust boundary](../docs/policies/DOCUMENTATION_POLICY.md)
- [Development policy](../docs/policies/DEVELOPMENT_POLICY.md)

Use the topic files under [`.github/copilot/`](copilot/) only as navigation aids. If any AI instruction conflicts with a
canonical policy or approved design, resolve the conflict before changing any decision or dependent implementation.

Apply the [documentation reporting policy](../docs/policies/DOCUMENTATION_POLICY.md#documentation-is-never-a-delivery-gate).
Do not introduce competing delivery requirements in an AI instruction file.
