# Project Overview
<!--
documentation-metadata
audience: GitHub Copilot; developers
owner: project maintainers
status: current
last-verified: 2026-10-12
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: mandatory policy routing and stable product characterization with delegated runtime details
source-anchors: AGENTS.md; docs/policies/DOCUMENTATION_POLICY.md; docs/policies/DEVELOPMENT_POLICY.md; README.md; docs/ARCHITECTURE.md; package.json; repository-tree
next-review: explicit-maintainer-policy-amendment
-->

Read BOTH [Documentation Policy](../../docs/policies/DOCUMENTATION_POLICY.md) and
[Development Policy](../../docs/policies/DEVELOPMENT_POLICY.md) through [AGENTS.md](../../AGENTS.md) before edits.
These are the rule owners; this file supplies product/task routing only.

Surveyor is an event and collaboration management application. Its product areas include identity and profiles,
events and registration, invoice pools, recurring monthly surveys, activity plans, packing lists, drivers lists, and
shared authorization where the feature supports it.

Current dependency and version facts belong to executable configuration, as defined in the policies.

- Read the [project README](../../README.md) for the current product summary, supported development baseline, scripts,
  CI, and release entry points.
- Read [Architecture](../../docs/ARCHITECTURE.md) for runtime startup, request processing, identity, permissions,
  persistence, browser assets, help, testing, and release boundaries.
- Inspect `package.json` and the relevant implementation before relying on a framework, library, route, or feature
  capability.
