# Common Tasks
<!--
documentation-metadata
audience: GitHub Copilot; developers; documentation contributors
owner: project maintainers
status: current
last-verified: 2026-09-06
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: D13 minimal feature, defect, database, and documentation workflows using canonical references
source-anchors: AGENTS.md; docs/ARCHITECTURE.md; docs/DEVELOPMENT.md; docs/TESTING_GUIDE.md; docs/DATABASE.md; docs/DOCUMENTATION_POLICY.md; package.json; src/; tests/
next-review: D14
-->

## Add or change a feature

1. Inspect the existing route, controller, functional database service, entity, view, browser module, and tests that
   define the affected behavior.
2. Preserve deliberate feature-specific differences instead of assuming every peer feature uses the same capability.
3. Make the smallest coherent implementation change.
4. Choose the cheapest stable test layer from the [Testing Guide](../../docs/TESTING_GUIDE.md).
5. For persistent schema changes, update the entity and add a reviewed migration using the
   [database procedure](../../docs/DATABASE.md).
6. Update affected user, maintainer, operator, and AI documentation in the same change.

## Fix a defect

1. Reproduce the observable failure at the cheapest stable layer.
2. Add or adjust a regression test when it can protect the behavior reliably.
3. Fix the narrow cause without unrelated refactoring.
4. Run focused checks, then the broader checks required by the touched boundaries.
5. Update product documentation only when the intended contract changes; do not document a temporary defect as a
   product feature.

## Change documentation only

1. Verify behavior against feature-specific implementation and tests.
2. Do not change runtime source to make the prose easier to write.
3. Use exact visible labels and novice-first task order in `docs/user-guide/`.
4. Keep implementation-defect details in migration controls and product documentation on the coherent working
   contract.
5. Run `npm run docs:check`; run `npm run docs:check:strict` when completing a migration package.

The [repository-wide agent guide](../../AGENTS.md) and [documentation policy](../../docs/DOCUMENTATION_POLICY.md) define
the complete authority, scope, and in-app help trust rules.
