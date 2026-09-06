# Code Style Guidelines
<!--
documentation-metadata
audience: GitHub Copilot; developers
owner: project maintainers
status: current
last-verified: 2026-09-06
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: D13 durable TypeScript, locality, boundary, generated-output, and UI-contract guidance
source-anchors: docs/DEVELOPMENT.md; docs/ARCHITECTURE.md; tsconfig.json; tsconfig.server.json; .eslintrc; src/
next-review: none
-->

- Follow the surrounding code and the patterns in the [Development Guide](../../docs/DEVELOPMENT.md) before creating a
  new abstraction.
- Preserve strict TypeScript behavior. Use interfaces, type aliases, generics, and asynchronous control flow according
  to the local contract; do not apply blanket preferences that conflict with nearby code.
- Keep repository access and transactions in the existing functional database-service boundary; keep HTTP concerns in
  routes and orchestration in controllers.
- Keep visible Pug labels, form names, controller parsing, browser behavior, and user documentation synchronized.
- Enforce authorization and validation on the server even when the UI hides or disables an action.
- Prefer focused changes over unrelated formatting or refactoring.
- Do not hand-edit or commit generated browser modules, compiled styles, build output, generated TypeORM metadata, or
  other ignored files. Use the repository's generation and build scripts when verification requires those outputs.
