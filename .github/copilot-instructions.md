# GitHub Copilot Instructions for Surveyor
<!--
documentation-metadata
audience: GitHub Copilot; maintainers
owner: project maintainers
status: current
last-verified: 2026-10-12
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: mandatory central policy routing and explicit approval/conflict/delegation enforcement; no competing engineering rules
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

Apply the concrete [agent enforcement procedure](../docs/policies/DEVELOPMENT_POLICY.md#agent-enforcement): compare
request/canonical/design sources before editing, obtain explicit conflict resolution, run scoped measurable checks
and review semantic boundaries and readability. A newer conflicting name and a clean checker result do not replace
approval or human review. Apply the procedure to every delegated agent and review its actual output.

## Canonical references

- [Project setup and current scripts](../README.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Development workflow](../docs/DEVELOPMENT.md)
- [Testing contract](../docs/TESTING_GUIDE.md)
- [Database and migrations](../docs/DATABASE.md)
- [Documentation policy and help trust boundary](../docs/policies/DOCUMENTATION_POLICY.md)
- [Development policy](../docs/policies/DEVELOPMENT_POLICY.md)
- [Documentation migration status](../docs/frontend-migration/DOCUMENTATION_MIGRATION_STATUS.md)

Use the topic files under [`.github/copilot/`](copilot/) only as navigation aids. If any AI instruction conflicts with a
canonical policy or approved design, resolve the conflict before changing any decision or dependent implementation.

Apply the [documentation reporting policy](../docs/policies/DOCUMENTATION_POLICY.md#documentation-is-never-a-delivery-gate).
Do not introduce competing delivery requirements in an AI instruction file.
