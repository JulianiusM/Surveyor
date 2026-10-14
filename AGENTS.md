# AI Agent Guide for Surveyor
<!--
documentation-metadata
audience: AI coding agents; maintainers
owner: project maintainers
status: current
last-verified: 2026-10-14
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: shared context bootstrap and caller-held continuation routing; concise individual approval, semantic review and established engineering boundaries retained
source-anchors: docs/policies/DOCUMENTATION_POLICY.md; docs/policies/DEVELOPMENT_POLICY.md; scripts/check-documentation.mjs; scripts/tests/documentation-check.test.mjs; docs/README.md; docs/ARCHITECTURE.md; docs/DEVELOPMENT.md; docs/TESTING_GUIDE.md; docs/DATABASE.md; package.json; repository-tree
next-review: explicit-maintainer-policy-amendment
-->

This is the repository-wide entry point for every AI coding agent. The authoritative rules live in policies;
this file routes agents and must not introduce competing rules or duplicate volatile implementation facts.

## Required start and enforcement

Before edits, read BOTH [Documentation Policy](docs/policies/DOCUMENTATION_POLICY.md) and
[Development Policy](docs/policies/DEVELOPMENT_POLICY.md), then the relevant canonical guide below.
Apply them throughout the task, including documentation classification, human readability, DRY, controller/DBAL
separation, declaration-file contracts, test selection and database safety.
Inspect exact source/tests and the working tree; preserve unrelated changes.

Use the Documentation Policy's [optional task-profile discovery](docs/policies/DOCUMENTATION_POLICY.md#document-roles-and-optional-task-profiles)
at task start. Apply only profiles whose declared scope matches the request; missing profiles are normal.
Pass any applied profile with current authorization and unresolved conflicts to delegated agents.

Use `node scripts/check-documentation.mjs --context` to obtain current policy text and available profile bodies.
Record the task with `--purpose` and repeatable `--path` arguments; review declared scope before explicitly selecting
an applicable profile with repeatable `--profile` arguments. `--profiles` lists declarations without activation.
Only selected profiles load their direct owned working references. No particular profile is required.

Keep the JSON receipt with the caller's actual authorization and unresolved decisions for delegation or continuation.
Use `--expect-context` with that caller-held JSON to compare current identities on resume, handoff or scope changes;
`--no-profile` explicitly clears selection when the reviewed new scope needs none. Inspect `reviewRequired`, read the
changed sources and reconcile the handoff before dependent edits. A fresh command, matching hashes or a selection
does not prove reading, deliver context automatically to an agent host, or grant approval. The policies own this
procedure; ordinary documentation diagnostics remain separate and advisory.

Follow the [enforcement procedure](docs/policies/DEVELOPMENT_POLICY.md#agent-enforcement), including concrete
pre-edit conflict inspection, complete task-owned scope, measurable checks and independent semantic review.
Do not substitute a policy acknowledgement or a clean syntax result for that procedure.

Policies and approved designs govern what may change. Code establishes current behavior and cannot silently override
those decisions. Conflicting instructions or potentially unintended consequences require direct maintainer approval
before dependent implementation. Ask in the conversation; never hide plans or approval requests in a document.
After approval, record a concise dated amendment without erasing the original choice. Continue independent authorized
work while a required answer is pending; elapsed time is not approval.

Follow the [required change explanation](docs/policies/DEVELOPMENT_POLICY.md#required-change-explanation-2026-10-13)
with its short, simple four-field explanation and independent semantic/root review for each individual approval.
Correct labels do not excuse an unclear or lengthy explanation. The policy owns these requirements and
the prohibition on bundled approvals; do not replace it with another summary or infer implementation approval.

A new request that disagrees with an existing canonical path or approved policy/design still needs explicit conflict
resolution. Do not infer that a newer name overrides the established one or silently correct a suspected typo.

Every delegated agent must read the policies and receive current authorization, file ownership and unresolved
conflicts. The delegating agent reviews compliance and actual production adoption. No agent may silently change a
policy/design, invent approval, create a new documentation destination or remove unclassified material without
approval. Report any violation immediately.

## Canonical routing

| Task | Starting point |
|---|---|
| Understand/start the repository | [Project README](README.md) and [documentation index](docs/README.md) |
| Runtime/module boundaries | [Architecture](docs/ARCHITECTURE.md) |
| Development patterns | [Development guide](docs/DEVELOPMENT.md) |
| Testing | [Testing guide](docs/TESTING_GUIDE.md) |
| Configuration/authentication | [Configuration](docs/CONFIGURATION.md) |
| Database/migrations | [Database guide](docs/DATABASE.md) |
| Permissions | [Permission reference](docs/PERMISSIONS_REFERENCE.md) |
| Deployment/backup/recovery | [Operations](docs/OPERATIONS.md) and [upgrading/rollback](docs/UPGRADING.md) |
| End-user tasks/labels | [User docs](docs/user-guide/), rendered components and browser code |
| Recorded defects | [Backlog](docs/backlog/documentation-remediation.yml) |

Use executable package/runner/workflow configuration for commands and paths. Documentation reports are advisory;
application correctness and security checks remain distinct. Report actual changes, executed checks and limitations,
and never describe an unrun check as passed.
