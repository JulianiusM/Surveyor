# Surveyor Documentation

<!--
documentation-metadata
audience: all documentation readers
owner: documentation maintainers
status: current
last-verified: 2026-10-28
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: current architecture diagrams and DEC-007 navigation; existing domain and operator guidance retained without new deployment or exhaustive verification claim
source-anchors: package.json; README.md; AGENTS.md; .github/copilot-instructions.md; .github/copilot/; docs/policies/documentation-check.json; docs/backlog/documentation-remediation.yml; docs/ARCHITECTURE.md; docs/DEVELOPMENT.md; docs/TESTING_GUIDE.md; docs/CONFIGURATION.md; docs/DATABASE.md; docs/OPERATIONS.md; docs/UPGRADING.md; docs/user-guide/; src/backend/server.ts; src/backend/app.ts; src/backend/modules/settings.ts; vitest.config.mts; playwright.config.ts; .github/workflows/ci.yml; .github/workflows/release.yml; docs/features/help/HELP_VISUALS.md; scripts/check-help-documentation.mjs; src/backend/controller/helpController.ts; tests/unit/help-documentation.spec.ts
next-review: documentation-inventory-or-status-change
-->

This index lists maintained user, contributor, operator and policy documentation.

Read the [documentation policy](policies/DOCUMENTATION_POLICY.md) for source precedence, metadata rules, the canonical in-app
help path, intentional feature exceptions, defect isolation, and advisory structural reports. Product documentation describes
the intended current working implementation: deliberate differences are documented, while transient defects remain in
the defect register instead of being repeated across user, operator, maintainer and AI documentation.

## End users

The canonical in-app help source is [`docs/user-guide/`](user-guide/). The application reads these files directly.

| Guide | Current review state |
|---|---|
| [User guide home](user-guide/en/README.md) | D01-D03 and D05-D13 feature guidance is current, including basic and advanced activity plans; D14 help navigation and visuals are delivered, with optional rendered-content reports |
| [Getting started](user-guide/en/GETTING_STARTED.md) | Current: D01 identity, guest recovery, profiles, migration, and account lifecycle verified |
| [Your overview](user-guide/en/DASHBOARD.md) | Current: D02 navigation, profile-scoped collections, search/filtering, cards, and owner actions verified |
| [Permissions and sharing](user-guide/en/PERMISSIONS.md) | Current: D03 cumulative grants, audiences, recipes, labels, presets, item fallback, and survey exclusion verified |
| [Events](user-guide/en/EVENTS.md) | Current: D05 creation, registration, deadlines, dietary data, administration, related resources, export, permissions, and privacy; D06 links the dedicated cost workflow |
| [Invoice pools and payments](user-guide/en/INVOICE_POOLS.md) | Current: D06 participant and organizer workflows, state transitions, assignments, takeovers, surcharges, invoice review, shares, settlement, proof privacy, and retention |
| [Activity plans](user-guide/en/ACTIVITY_PLANS.md) | Current: D07 basic creation and participation plus D08 requirements, live coverage, recommendation generation, review, manual staging, application, and limitations |
| [Surveys](user-guide/en/SURVEYS.md) | Current: D09 recurring-monthly primary use, one-month secondary use, creation, survey-specific sharing, guest recovery, Yes/Maybe/No voting, named results, collaborative combinations, header images, duplication, and deletion |
| [Packing lists](user-guide/en/PACKING_LISTS.md) | Current: D10 creation-time items, shared assignments, Everyone/All behavior, browser-local Packed state, counters, event linkage, permissions, images, duplication, deletion, privacy, and troubleshooting |
| [Drivers lists](user-guide/en/DRIVERS_LISTS.md) | Current: D11 driver, passenger, and organizer workflows; profile-derived identity; capacity and counters; event linkage; permissions; privacy; images; duplication; deletion; and troubleshooting |

## Maintainers and contributors

| Document | Purpose | Current review state |
|---|---|---|
| [Project README](../README.md) | Product entry point, clean-clone development start, commands, CI, and release summary | Current: D12 |
| [Architecture](ARCHITECTURE.md) | Runtime, layers, identity, authorization, persistence, frontend, build, release, and testing boundaries | Current: D12 architecture plus D08 advanced activity allocation; D14 owns help-integration follow-up |
| [Architecture diagrams](features/architecture/README.md) | Editable system, component, data, sequence, state, deployment and build views | Current source-derived structural reference; installed-schema and deployment verification remain separate |
| [Development guide](DEVELOPMENT.md) | Clean-clone setup, generated files, current code patterns, change recipes, and troubleshooting | Current: D12 |
| [Testing guide](TESTING_GUIDE.md) | Vitest/Playwright layer contracts, database safeguards, environments, commands, and CI | Current: D12/D14; content reports are separate from application tests |
| [Activity requirement algorithm](features/activity/ACTIVITY_REQUIREMENTS_ALGORITHM.md) | Detailed requirement and coverage algorithm | Current: D08 canonical requirement, coverage, allocation, job, review-state, application, and limitation reference |
| [Permission system reference](PERMISSIONS_REFERENCE.md) | Generated bit/preset/default tables and maintainer authorization semantics | Current: D03 |
| [Frontend framework decision](decisions/DEC-006-FRONTEND-FRAMEWORK.md) | Selected frontend stack, rendering ownership and approved technology choices | Current decision; component, data and contribution guidance stays in Architecture and Development |

## Operators and site reliability engineers

| Document | Purpose | Current review state |
|---|---|---|
| [Configuration reference](CONFIGURATION.md) | All accepted settings, precedence, secrets, authentication, storage, and production constraints | Current: D04 accepted; controlled environment verification tracked as non-blocking D04V |
| [Database and migrations](DATABASE.md) | MariaDB baseline, empty-schema bootstrap, migration targeting, command safety, sessions, and restore checks | Current: D04 accepted; database rehearsal tracked as non-blocking D04V |
| [Production operations runbook](OPERATIONS.md) | Release install, filesystem layout, systemd, proxy/TLS, health, logs, SMTP/OIDC, retention, backup, restore, and incidents | Current: D04 accepted; clean deployment and restore rehearsal tracked as non-blocking D04V |
| [Upgrading and rollback](UPGRADING.md) | Staging, maintenance-window migration, post-start checks, rollback, and change records | Current: D04 accepted; end-to-end upgrade rehearsal tracked as non-blocking D04V |

Use these four documents as one operating set. The runtime release archive and matching tagged migration workspace are
separate deployment inputs, while the database and both upload directories form one state and backup unit.

Authored API contracts live in `contracts/api/v1/`; generated browser/server consumers use those definitions.
The [Architecture](ARCHITECTURE.md) and [Development](DEVELOPMENT.md) guides explain their boundaries and contribution
workflow. This internal application contract does not establish an externally supported public API.
The permission reference documents the shared permission owner and its generated tables.

## AI coding agents

AI instructions are current, deliberately thin, lower-authority summaries. They route agents to executable behavior,
explicit decisions, generated references, and canonical maintained documentation instead of duplicating volatile
commands, versions, test inventories, or operating procedures.

- [General AI-agent guide](../AGENTS.md)
- [GitHub Copilot instructions](../.github/copilot-instructions.md)
- [Modular Copilot guidance](../.github/copilot/)

D13 consolidated the AI layer. `AGENTS.md` and Copilot files now require both centralized policies; they remain entry
points and topic-specific navigation aids rather than competing rule owners.

## Decisions and quality controls

- [DEC-001: survey combination authorization](decisions/DEC-001-SURVEY-COMBINATION-AUTHORIZATION.md)
- [DEC-002: OIDC callback path](decisions/DEC-002-OIDC-CALLBACK.md)
- [DEC-003: driver-list Participants counter](decisions/DEC-003-DRIVER-LIST-PARTICIPANT-COUNT.md)
- [DEC-004: in-app help Markdown trust model](decisions/DEC-004-HELP-MARKDOWN-TRUST-MODEL.md)
- [DEC-005: surveys and the general permission system](decisions/DEC-005-SURVEY-CREATION-PERMISSIONS.md)
- [DEC-006: frontend framework](decisions/DEC-006-FRONTEND-FRAMEWORK.md)
- [DEC-007: current application remediation boundaries](decisions/DEC-007-APPLICATION-ARCHITECTURE-REMEDIATION.md)
- [Documentation policy](policies/DOCUMENTATION_POLICY.md)
- [Development policy](policies/DEVELOPMENT_POLICY.md)
- [Machine-readable remediation backlog](backlog/documentation-remediation.yml)
- [Structural checker configuration](policies/documentation-check.json)
- [Structural checker implementation](../scripts/check-documentation.mjs)

Optionally collect a non-blocking documentation report with:

```bash
npm run docs:check
```

Use `npm run docs:check:strict` to include all configured stale concepts in the advisory report. Neither mode blocks CI, builds, merges, releases, or deployment. Findings and execution errors remain visible in report logs and JSON; see the [documentation policy](policies/DOCUMENTATION_POLICY.md).

## Quick task routing

| Goal | Start here |
|---|---|
| Use the application | [User guide home](user-guide/en/README.md) |
| Set up or understand the repository | [Project README](../README.md), then [Development](DEVELOPMENT.md) or [Architecture](ARCHITECTURE.md) |
| Operate a production instance | [Production operations runbook](OPERATIONS.md), with [configuration](CONFIGURATION.md), [database](DATABASE.md), and [upgrade](UPGRADING.md) references |
| Work on tests | [Testing guide](TESTING_GUIDE.md), then verify commands in `package.json` |
| Understand permissions as an organizer | [Permissions and sharing](user-guide/en/PERMISSIONS.md) |
| Submit or administer shared event costs | [Invoice pools and payments](user-guide/en/INVOICE_POOLS.md) |
| Maintain or review the permission engine | [Permission system reference](PERMISSIONS_REFERENCE.md) |
| Understand activity requirement calculation | [Activity requirement algorithm](features/activity/ACTIVITY_REQUIREMENTS_ALGORITHM.md) |
| Review recorded defects | [Remediation backlog](backlog/documentation-remediation.yml) |
| Browse architecture diagrams | [Architecture diagram reference](features/architecture/README.md) |
| Update documentation safely | [Documentation policy](policies/DOCUMENTATION_POLICY.md), including the in-app help trust boundary |

- [In-App Help Visuals](features/help/HELP_VISUALS.md) — ownership and update rules for maintained interface maps.
