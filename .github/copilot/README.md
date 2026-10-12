# Modular Copilot Instructions
<!--
documentation-metadata
audience: GitHub Copilot; maintainers
owner: project maintainers
status: current
last-verified: 2026-10-12
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: mandatory policy routing and topic-index role without competing rules
source-anchors: AGENTS.md; .github/copilot-instructions.md; docs/README.md; docs/policies/DOCUMENTATION_POLICY.md; docs/policies/DEVELOPMENT_POLICY.md; repository-tree
next-review: explicit-maintainer-policy-amendment
-->

These files are focused navigation aids for GitHub Copilot. Read and enforce the governing
[documentation](../../docs/policies/DOCUMENTATION_POLICY.md) and
[development](../../docs/policies/DEVELOPMENT_POLICY.md) policies before edits. The required routing entry point is
[`AGENTS.md`](../../AGENTS.md), with the Copilot entry point in
[`copilot-instructions.md`](../copilot-instructions.md). Neither this directory nor the entry point is an independent
source of implementation truth.

| Topic file | Use it to find |
|---|---|
| [Project overview](project-overview.md) | Canonical product and architecture references. |
| [Code style](code-style.md) | Stable editing rules and the current development guide. |
| [Database guidelines](database-guidelines.md) | The single schema/migration safety rule and database references. |
| [Testing quick reference](testing-quick-reference.md) | The single test-selection rule and layer boundaries. |
| [Build and run](build-and-run.md) | Authoritative setup, command, CI, release, and operations references. |
| [Common tasks](common-tasks.md) | A minimal feature, bug-fix, and documentation workflow. |

## Maintenance rule

Keep these files short. Do not duplicate dependency versions, command matrices, test counts, branch lists, database
names, route inventories, or deployment examples here. Update the executable configuration or canonical maintained
document first, then change an AI file only when its durable routing or safety guidance is affected.
