# Surveyor Documentation

<!--
documentation-metadata
audience: all documentation readers
owner: documentation maintainers
status: current
last-verified: 2026-09-06
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: non-blocking documentation policy and optional report/test routing; D00 foundation plus D01-D13 reviewed user, operator, permission, activity-algorithm, maintainer, repository-entry, and AI-agent documentation; D14 completed in-app help UX, semantic validation, visual ownership, and trust-boundary enforcement
source-anchors: repository-tree; package.json; README.md; AGENTS.md; .github/copilot-instructions.md; .github/copilot/; docs/documentation-check.json; docs/documentation-remediation.yml; docs/ARCHITECTURE.md; docs/DEVELOPMENT.md; docs/TESTING_GUIDE.md; docs/CONFIGURATION.md; docs/DATABASE.md; docs/OPERATIONS.md; docs/UPGRADING.md; docs/user-guide/; src/server.ts; src/app.ts; src/modules/settings.ts; vitest.config.mts; playwright.config.ts; .github/workflows/ci.yml; .github/workflows/release.yml; docs/HELP_VISUALS.md; scripts/check-help-documentation.mjs; src/controller/helpController.ts; tests/unit/help-documentation.spec.ts
next-review: documentation-inventory-or-status-change
-->

This index lists documentation that exists in the repository. The content is being reconciled with the implementation
through the phased [documentation migration](DOCUMENTATION_MIGRATION_STATUS.md). A file marked **migration pending**
may be useful context, but its behavior-sensitive instructions are not yet authoritative.

Read the [documentation policy](DOCUMENTATION_POLICY.md) for source precedence, metadata rules, the canonical in-app
help path, intentional feature exceptions, defect isolation, and advisory structural reports. Product documentation describes
the intended current working implementation: deliberate differences are documented, while transient defects remain in
migration-control records instead of being repeated across user, operator, maintainer, and AI documentation.

## End users

The canonical in-app help source is [`docs/user-guide/`](user-guide/). The application reads these files directly.

| Guide | Current review state |
|---|---|
| [User guide home](user-guide/README.md) | D01-D03 and D05-D13 feature guidance is current, including basic and advanced activity plans; D14 help navigation and visuals are delivered, with optional rendered-content reports |
| [Getting started](user-guide/GETTING_STARTED.md) | Current: D01 identity, guest recovery, profiles, migration, and account lifecycle verified |
| [Your overview](user-guide/DASHBOARD.md) | Current: D02 navigation, profile-scoped collections, search/filtering, cards, and owner actions verified |
| [Permissions and sharing](user-guide/PERMISSIONS.md) | Current: D03 cumulative grants, audiences, recipes, labels, presets, item fallback, and survey exclusion verified |
| [Events](user-guide/EVENTS.md) | Current: D05 creation, registration, deadlines, dietary data, administration, related resources, export, permissions, and privacy; D06 links the dedicated cost workflow |
| [Invoice pools and payments](user-guide/INVOICE_POOLS.md) | Current: D06 participant and organizer workflows, state transitions, assignments, takeovers, surcharges, invoice review, shares, settlement, proof privacy, and retention |
| [Activity plans](user-guide/ACTIVITY_PLANS.md) | Current: D07 basic creation and participation plus D08 requirements, live coverage, recommendation generation, review, manual staging, application, and limitations |
| [Surveys](user-guide/SURVEYS.md) | Current: D09 recurring-monthly primary use, one-month secondary use, creation, survey-specific sharing, guest recovery, Yes/Maybe/No voting, named results, collaborative combinations, header images, duplication, and deletion |
| [Packing lists](user-guide/PACKING_LISTS.md) | Current: D10 creation-time items, shared assignments, Everyone/All behavior, browser-local Packed state, counters, event linkage, permissions, images, duplication, deletion, privacy, and troubleshooting |
| [Drivers lists](user-guide/DRIVERS_LISTS.md) | Current: D11 driver, passenger, and organizer workflows; profile-derived identity; capacity and counters; event linkage; permissions; privacy; images; duplication; deletion; and troubleshooting |

## Maintainers and contributors

| Document | Purpose | Current review state |
|---|---|---|
| [Project README](../README.md) | Product entry point, clean-clone development start, commands, CI, and release summary | Current: D12 |
| [Architecture](ARCHITECTURE.md) | Runtime, layers, identity, authorization, persistence, frontend, build, release, and testing boundaries | Current: D12 architecture plus D08 advanced activity allocation; D14 owns help-integration follow-up |
| [Development guide](DEVELOPMENT.md) | Clean-clone setup, generated files, current code patterns, change recipes, and troubleshooting | Current: D12 |
| [Testing guide](TESTING_GUIDE.md) | Vitest/Playwright layer contracts, database safeguards, environments, commands, and CI | Current: D12/D14; content reports are separate from application tests |
| [Activity requirement algorithm](ACTIVITY_REQUIREMENTS_ALGORITHM.md) | Detailed requirement and coverage algorithm | Current: D08 canonical requirement, coverage, allocation, job, review-state, application, and limitation reference |
| [Permission system reference](PERMISSIONS_REFERENCE.md) | Generated bit/preset/default tables and maintainer authorization semantics | Current: D03 |

## Operators and site reliability engineers

| Document | Purpose | Current review state |
|---|---|---|
| [Configuration reference](CONFIGURATION.md) | All accepted settings, precedence, secrets, authentication, storage, and production constraints | Current: D04 accepted; controlled environment verification tracked as non-blocking D04V |
| [Database and migrations](DATABASE.md) | MariaDB baseline, empty-schema bootstrap, migration targeting, command safety, sessions, and restore checks | Current: D04 accepted; database rehearsal tracked as non-blocking D04V |
| [Production operations runbook](OPERATIONS.md) | Release install, filesystem layout, systemd, proxy/TLS, health, logs, SMTP/OIDC, retention, backup, restore, and incidents | Current: D04 accepted; clean deployment and restore rehearsal tracked as non-blocking D04V |
| [Upgrading and rollback](UPGRADING.md) | Staging, maintenance-window migration, post-start checks, rollback, and change records | Current: D04 accepted; end-to-end upgrade rehearsal tracked as non-blocking D04V |

Use these four documents as one operating set. The runtime release archive and matching tagged migration workspace are
separate deployment inputs, while the database and both upload directories form one state and backup unit.

Planned API and generated inventory references remain backlog deliverables rather than placeholder documents. The
permission reference exists and is generated and verified in D03.

## AI coding agents

AI instructions are current, deliberately thin, lower-authority summaries. They route agents to executable behavior,
explicit decisions, generated references, and canonical maintained documentation instead of duplicating volatile
commands, versions, test inventories, or operating procedures.

- [General AI-agent guide](../AGENTS.md)
- [GitHub Copilot instructions](../.github/copilot-instructions.md)
- [Modular Copilot guidance](../.github/copilot/)

D13 consolidated the AI layer. `AGENTS.md` is the repository-wide contract; the Copilot files are short entry points and topic-specific navigation aids.

## Decisions, migration, and quality controls

- [DEC-001: survey combination authorization](decisions/DEC-001-SURVEY-COMBINATION-AUTHORIZATION.md)
- [DEC-002: OIDC callback path](decisions/DEC-002-OIDC-CALLBACK.md)
- [DEC-003: driver-list Participants counter](decisions/DEC-003-DRIVER-LIST-PARTICIPANT-COUNT.md)
- [DEC-004: in-app help Markdown trust model](decisions/DEC-004-HELP-MARKDOWN-TRUST-MODEL.md)
- [DEC-005: surveys and the general permission system](decisions/DEC-005-SURVEY-CREATION-PERMISSIONS.md)
- [Migration status and continuation point](DOCUMENTATION_MIGRATION_STATUS.md)
- [Documentation policy](DOCUMENTATION_POLICY.md)
- [Machine-readable remediation backlog](documentation-remediation.yml)
- [Structural checker configuration](documentation-check.json)
- [Structural checker implementation](../scripts/check-documentation.mjs)

Optionally collect a non-blocking documentation report with:

```bash
npm run docs:check
```

Use `npm run docs:check:strict` to include all configured stale concepts in the advisory report. Neither mode blocks CI, builds, merges, releases, or deployment. Findings and execution errors remain visible in report logs and JSON; see the [documentation policy](DOCUMENTATION_POLICY.md).

## Quick task routing

| Goal | Start here |
|---|---|
| Use the application | [User guide home](user-guide/README.md) |
| Set up or understand the repository | [Project README](../README.md), then [Development](DEVELOPMENT.md) or [Architecture](ARCHITECTURE.md) |
| Operate a production instance | [Production operations runbook](OPERATIONS.md), with [configuration](CONFIGURATION.md), [database](DATABASE.md), and [upgrade](UPGRADING.md) references |
| Work on tests | [Testing guide](TESTING_GUIDE.md), then verify commands in `package.json` |
| Understand permissions as an organizer | [Permissions and sharing](user-guide/PERMISSIONS.md) |
| Submit or administer shared event costs | [Invoice pools and payments](user-guide/INVOICE_POOLS.md) |
| Maintain or review the permission engine | [Permission system reference](PERMISSIONS_REFERENCE.md) |
| Understand activity requirement calculation | [Activity requirement algorithm](ACTIVITY_REQUIREMENTS_ALGORITHM.md) |
| Continue documentation remediation | [Migration status](DOCUMENTATION_MIGRATION_STATUS.md) |
| Update documentation safely | [Documentation policy](DOCUMENTATION_POLICY.md), including the in-app help trust boundary |

- [In-App Help Visuals](HELP_VISUALS.md) — ownership and update rules for maintained interface maps.
