# Documentation Migration Status
<!--
documentation-metadata
audience: documentation maintainers; feature maintainers; operators; AI agents
owner: documentation maintainers
status: current
last-verified: 2026-10-12
verification-baseline: docs-baseline-2026-09-06-ci-repair
verification-scope: editorial consolidation of completed migration history, durable dispositions and independent open work; no operator rehearsal or application run claimed
source-anchors: docs/backlog/documentation-remediation.yml; docs/policies/DOCUMENTATION_POLICY.md; docs/policies/documentation-check.json; scripts/check-documentation.mjs; scripts/check-help-documentation.mjs; scripts/tests/documentation-check.test.mjs; docs/features/activity/ACTIVITY_REQUIREMENTS_ALGORITHM.md; docs/features/help/HELP_VISUALS.md; docs/frontend-migration/PILOT_PARITY_REVIEW.md
next-review: D04V-or-implementation-defect-remediation
-->

The documentation migration **D00–D14 is complete**. Its decisions, open findings, implementation defects and concise
closed-ID/package dispositions remain in the [backlog](../backlog/documentation-remediation.yml). Superseded execution
transcripts, repeated file inventories and completed procedures remain in Git history instead of another archive.
Native guidance describes native behavior. Prospective frontend technical guidance remains
[staged](staged/README.md); current pilot evidence belongs to its
[review](PILOT_PARITY_REVIEW.md).

## Delivery policy and evidence

Documentation is advisory everywhere, including CI, builds, merges, releases, deployment and review. Public report
commands retain errors and incomplete checks but exit zero; strict mode expands diagnostics. Historical references
to blocking documentation gates have been superseded by the explicit maintainer decision in the
[policy](../policies/DOCUMENTATION_POLICY.md). Baselines are historical review snapshots, not delivery prerequisites.

Application security and executable behavior tests remain separate. Help-runtime tests use synthetic fixtures;
maintained corpus/visual checks are optional under `tests/documentation/`. Release documentation copying/comparison
is non-blocking. No hosted CI result, complete application matrix or operator rehearsal is certified by this record.

## Durable completed outcomes

| Work | Maintained owner or disposition |
|---|---|
| D00–D03, D05–D11: structure and task guides | Canonical index/user guides and [permission reference](../PERMISSIONS_REFERENCE.md); deliberate survey/driver exceptions remain in the five decision records. |
| D04/D12: operator and contributor guidance | [Configuration](../CONFIGURATION.md), [Database](../DATABASE.md), [Operations](../OPERATIONS.md), [Upgrading](../UPGRADING.md), [Architecture](../ARCHITECTURE.md), [Development](../DEVELOPMENT.md), [Testing](../TESTING_GUIDE.md). |
| D08: advanced activity requirements, coverage, generation and review | [Activity algorithm](../features/activity/ACTIVITY_REQUIREMENTS_ALGORITHM.md) owns the technical contract; task procedures remain in the activity guide. |
| D13: AI instruction consolidation | Repository agent instructions link to canonical owners rather than duplicate volatile facts. |
| D14: Help navigation/search, trusted source and visuals | Native guides remain release-owned; [DEC-004](../decisions/DEC-004-HELP-MARKDOWN-TRUST-MODEL.md) owns trust assumptions and [Help Visuals](../features/help/HELP_VISUALS.md) owns asset maintenance. |
| D14-VAL-001/D14-VAL-002 | Closed by recorded dependency-free source/path/fingerprint and valid/invalid Help-authoring regression evidence; initial failures are not erased. |
| Subsequent visual correction | Four native illustrations received recorded full-resolution/narrow-size inspection. Repeated capture hashes/run transcripts remain in historical Git revisions and ignored artifacts. |
| Completed archival/overview/property plans | Their durable native contracts are consolidated into canonical architecture/development/database/permission sections. Completed sequences and repeated verification history are retired. |

This is an editorial disposition of recorded work, not a rerun of those historical checks. Current asset review and
application changes need evidence appropriate to their own inputs.

## Independent remaining work

**D04V remains deferred and non-blocking.** Start with `OPSV-001`: install a matching official release in an isolated
environment, use the documented service model, and verify health. Continue one `OPSV-*` item at a time through database
bootstrap/migrations, persistent storage/retention, proxy/authentication/SMTP/OIDC, paired restore and full rollback.
The backlog retains required environment, acceptance criteria and evidence. Verify effective disposable targets before
any schema-changing command; no rehearsal is authorized against shared or production data.

`DOC-ENTITY-PROPERTIES-VISUAL` is closed by the approved removal of the unused obsolete illustration; current written
control guidance remains. Centrally recorded implementation defects require
separately authorized runtime changes; do not copy temporary defects/workarounds into product guidance.

When an observed rehearsal disproves a durable operating contract, register the defect once and update the owning
canonical procedure only when a confirmed working setup requires it. Do not combine D04V with unrelated feature repair.
