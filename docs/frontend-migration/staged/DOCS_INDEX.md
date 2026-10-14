# Staged frontend documentation index amendments
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-14
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: digest-guarded frontend amendments preserve complete reviewed candidate guidance; unchanged production procedures stay in their existing owners; no runtime or cutover execution claimed
source-anchors: docs/frontend-migration/documentation-boundary.json; docs/frontend-migration/check-documentation-boundary.mjs; docs/policies/DOCUMENTATION_POLICY.md; docs/policies/DEVELOPMENT_POLICY.md; src/frontend/; package.json
next-review: next-authorized-migration-slice-or-cutover
-->

These amendments retain the reviewed frontend guidance without copying unchanged production procedures.
The [profile](../PROFILE.md) governs preparation and review; its [manifest](../documentation-boundary.json)
owns destination mapping and exact operations. Payload links use their mapped production location.
Surrounding notes use this file's location. Preparing complete temporary output does not authorize cutover.

## Introduction — amendment-01

<!-- delta:amendment-01 -->


This index lists maintained user, contributor, operator and policy documentation.

Read the [documentation policy](policies/DOCUMENTATION_POLICY.md) for source precedence, metadata rules, the canonical in-app
help path, intentional feature exceptions, defect isolation, and advisory structural reports. Product documentation describes
the intended current working implementation: deliberate differences are documented, while transient defects remain in
the defect register instead of being repeated across user, operator, maintainer and AI documentation.


<!-- /delta:amendment-01 -->

## Operators and site reliability engineers — amendment-02

<!-- delta:amendment-02 -->


Authored API contracts live in `contracts/api/v1/`; generated browser/server consumers use those definitions.
The [Architecture](ARCHITECTURE.md) and [Development](DEVELOPMENT.md) guides explain their boundaries and contribution
workflow. This internal application contract does not establish an externally supported public API.
The permission reference documents the shared permission owner and its generated tables.


<!-- /delta:amendment-02 -->

## Quick task routing — amendment-03

<!-- delta:amendment-03 -->
| Review recorded defects | [Remediation backlog](backlog/documentation-remediation.yml) |

<!-- /delta:amendment-03 -->

## End users — amendment-04

<!-- delta:amendment-04 -->
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

<!-- /delta:amendment-04 -->

## Introduction — amendment-05

<!-- delta:amendment-05 -->
| [Frontend framework decision](decisions/DEC-006-FRONTEND-FRAMEWORK.md) | Selected frontend stack, rendering ownership and approved technology choices | Current decision; component, data and contribution guidance stays in Architecture and Development |

## Operators and site reliability engineers

<!-- /delta:amendment-05 -->

## Quick task routing — amendment-06

<!-- delta:amendment-06 -->
| Use the application | [User guide home](user-guide/en/README.md) |

<!-- /delta:amendment-06 -->

## Quick task routing — amendment-07

<!-- delta:amendment-07 -->
| Understand permissions as an organizer | [Permissions and sharing](user-guide/en/PERMISSIONS.md) |
| Submit or administer shared event costs | [Invoice pools and payments](user-guide/en/INVOICE_POOLS.md) |

<!-- /delta:amendment-07 -->
