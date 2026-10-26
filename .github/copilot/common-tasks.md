# Common Tasks
<!--
documentation-metadata
audience: GitHub Copilot; developers; documentation contributors
owner: project maintainers
status: current
last-verified: 2026-10-26
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: final-answer question placement and complete approval context routed to the authoritative policy; shared bootstrap and engineering boundaries retained
source-anchors: docs/policies/DOCUMENTATION_POLICY.md; docs/policies/DEVELOPMENT_POLICY.md; AGENTS.md; docs/ARCHITECTURE.md; docs/DEVELOPMENT.md; docs/TESTING_GUIDE.md; docs/DATABASE.md; package.json; src/; tests/
next-review: explicit-maintainer-policy-amendment
-->

Start every feature, defect or documentation task through [AGENTS.md](../../AGENTS.md), then read BOTH [Development Policy](../../docs/policies/DEVELOPMENT_POLICY.md) and [Documentation Policy](../../docs/policies/DOCUMENTATION_POLICY.md). They own scope, approval, engineering, test and documentation rules.

Apply the policy's [optional task-profile discovery](../../docs/policies/DOCUMENTATION_POLICY.md#document-roles-and-optional-task-profiles)
at task start; use its declared activation scope and pass applied profiles to delegates. Missing profiles are normal.
Use the context command and continuation procedure in [AGENTS.md](../../AGENTS.md). Refresh current source identities
on handoff or scope change, and pass actual authorization and unresolved decisions with the caller-held receipt.
Discovery, selection and matching hashes grant no approval and do not certify reading or automatic host delivery.

Use the policy's short, simple [required change explanation](../../docs/policies/DEVELOPMENT_POLICY.md#required-change-explanation-2026-10-13)
separately for each individual approval request; follow its context, scope/approach and request-identifier requirements,
prohibition on bundling and semantic handoff/root review for delegated work. Correct labels or brevity alone are insufficient.
Apply its [question presentation rule](../../docs/policies/DEVELOPMENT_POLICY.md#questions-belong-in-the-final-answer-2026-10-26)
to all questions and complete outstanding requests in the final answer.

For implementation procedures, use the [Development](../../docs/DEVELOPMENT.md), [Architecture](../../docs/ARCHITECTURE.md), [Testing](../../docs/TESTING_GUIDE.md) and [Database](../../docs/DATABASE.md) guides. For end-user labels/tasks, inspect [canonical Help](../../docs/user-guide/) with the actual views/browser code. This routing aid does not define another workflow or relax any approved decision.
