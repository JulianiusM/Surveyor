# Development Policy
<!--
documentation-metadata
audience: maintainers; developers; AI coding agents
owner: project maintainers
status: current
last-verified: 2026-10-12
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: existing maintainer engineering, boundary, test-selection and database-safety rules consolidated without changing native behavior; explicit approval/conflict requirements
source-anchors: AGENTS.md; docs/policies/DOCUMENTATION_POLICY.md; docs/DEVELOPMENT.md; docs/ARCHITECTURE.md; docs/TESTING_GUIDE.md; docs/DATABASE.md; src/; tests/; package.json
next-review: explicit-maintainer-policy-amendment
-->

This is the authoritative owner of Surveyor's shared engineering rules. The
[documentation policy](DOCUMENTATION_POLICY.md) owns document classification, audience, staging, decision provenance
and approval. Practical procedures remain in the maintained development, architecture, testing and database guides.
AI instruction files must link to these policies rather than introduce alternative rules.

## Authorization and task boundaries

Read the current request, both policies and the relevant canonical guide before editing. Inspect the exact production
behavior and tests, check the working tree and preserve unrelated user changes. Identify affected persistence,
authorization, files, UI, tests and documentation boundaries, then make the smallest coherent authorized change.

Treat explicit maintainer decisions and approved designs as constraints. Code is evidence of current behavior, not
permission to rewrite the policy to match an implementation defect. Resolve conflicting instructions directly with
the maintainer before dependent implementation. Potentially unintended consequences require advance approval;
prepare concrete reviewable work within the authorized scope and ask in the conversation, never inside a document.
Do not infer approval from elapsed time, delegation, an existing defect or an editorial cleanup request.

Before dependent edits, compare the request with the actual canonical paths, policy and design anchors. If they
disagree, state both sources directly and obtain explicit resolution even when the newer wording appears deliberate.
Only a decision that explicitly identifies and resolves the conflict authorizes the override. Apply this rule equally
to documentation names, technology choices, architecture, coding patterns and native behavior.

Preserve existing behavior unless a change is explicitly authorized or directly required by accepted implementation
instructions. During frontend coexistence, native UI/behavior remains the reference; shared backend operations serve
both frontends. Record bounded approved exceptions without broadening them into an unrelated redesign.

## Implementation principles

- Human readability, DRY, separation of concerns, a single source of truth and information hiding are acceptance
  criteria. Follow neighboring patterns; reuse an existing controller, service or middleware whose responsibility
  fits. Do not add forwarding modules or duplicate business rules for another frontend.
- Controllers own business checks, authorization, validation and context-specific errors. Services are pure DBAL:
  queries, locks, transactions and persistence. Services must not throw `APIError`, `ExpectedError`, `ApiProblem` or
  request/UI-specific errors. Invoke the controller's named operation inside a service-managed transaction when its
  decision depends on locked data; keep the check under the lock and outside the DBAL owner.
- Enforce authentication, authorization, validation and ownership on the server. UI visibility is not a security
  boundary. Page admission, method grants and private projections remain distinct; reusable controls never grant
  authority. Captured actors, CSRF/context checks and lock-time authorization protect versioned commands.
- Put shared type-only contracts in `.d.ts` files under `src/types/`; executable code belongs in `.ts`, and private
  implementation details stay in their owning module. Preserve strict TypeScript and neighboring interface/type style.
- Prefer descriptive named helpers and straightforward control flow over excessive or nested anonymous functions.
  Short readable callbacks are appropriate. Preserve existing formatting and purposeful empty lines between steps;
  avoid unrelated formatting changes.
- Comment nontrivial behavior generously: explain intent, data flow, constraints, concurrency and authorization.
  Every complex method requires method-level JSDoc describing its contract **and internal code comments explaining
  its meaningful steps**. JSDoc does not satisfy the internal-comment requirement. Keep comments accurate and current;
  explain input selection, checks, transformations, persistence, side effects and recovery without restating obvious
  syntax. Pug templates/mixins use unbuffered comments explaining arguments, render data, conditions,
  shared/personal state and browser DOM hooks. Do not substitute comments for clear code.
- Pass optional feature/page state through renderer `data` and explicit mixin arguments. `res.locals` remains the
  established common request-infrastructure channel. Keep labels, field names, routes, parsing and user Help aligned.
- Keep archival, personal visibility, permanent deletion and file retention separate. Archive/restore must not delete
  records or files. Permanent deletion remains the simple operation in its existing feature service.
- Do not hand-edit or commit generated or ignored outputs; regenerate using repository scripts when needed. Never
  commit credentials, local environment files, uploads, reports or other ignored runtime state.

## Test selection and evidence

Use the cheapest stable layer that protects observable behavior; add another layer only when the risk crosses its
boundary. Do not require every feature to have unit, frontend, integration and E2E coverage.

| Layer | Required boundary |
|---|---|
| `tests/unit/` | Isolated production logic without database, HTTP application, external service or real browser. |
| `tests/frontend/` | Browser helpers/DOM behavior with explicit restored globals under Vitest. |
| `tests/integration/` | Real TypeORM persistence, relationships, transactions or selected controller orchestration on the guarded disposable schema. |
| `tests/e2e/` | A critical built workflow requiring routes, middleware, sessions, rendering and persistence together. |

Test production behavior, not test-only helpers or private implementation details. Persistence tests use real ORM
metadata and the disposable database rather than repository/core-service mocks. A narrow replacement at a true
external side-effect boundary is acceptable when the production workflow remains intact.

Read the testing guide before destructive database-backed suites. Use exact package scripts and inspect their
implementation rather than assuming they build assets, provide credentials or prepare a database. Run focused checks
first, then broaden only as justified. Report changes, executed checks, findings and unavailable prerequisites;
never claim an unrun check passed. Documentation reports remain optional and advisory under their policy.

## Database and migration safety

A persistent schema change requires the matching entity change and a reviewed migration for existing installations.
Use settings-aware wrappers and the database guide; verify the effective target before every schema-changing command.
Never synchronize, drop or reset production, staging, shared development data or a database not explicitly disposable.
Database-backed tests use dedicated schemas and credentials with no privileges outside those schemas.

## Agent enforcement

Every agent, including subagents, applies this policy and the documentation policy at task start and throughout the
change. The delegating agent supplies current authorizations, file ownership, protected boundaries and unresolved
decisions. Each agent reports violations or conflicts immediately and completes unaffected authorized work while
required approval remains pending. The final review checks actual production adoption, native/reference preservation,
policy compliance and truthful evidence; a passing helper test or a comment alone does not establish acceptance.

Use the following task procedure; a repeated statement that policies were followed is not evidence:

1. Read both policies and the affected canonical/design sources before editing. Inspect the working tree and identify
   the exact task-owned files, existing user changes, protected native reference and approval boundaries.
2. Resolve conflicts directly before dependent edits. Pass the resolved decision, file ownership and remaining
   conflicts to every subagent; require its policy acknowledgement and review its actual changes.
3. Review every touched nontrivial operation for a purposeful contract, separate in-code explanations of its steps,
   logical spacing and readable control flow. Comment presence alone does not satisfy this review. Preserve existing
   module ownership and neighboring style; do not apply a blanket formatter or refactor unrelated functions.
4. Run `npm run check:development` for measurable engineering rules and `git diff --check` for whitespace. The checker
   inspects worktree changes and separately changed index blobs against HEAD, so restored worktree content cannot
   conceal a staged violation. In a dirty shared workspace use repeated `--file src/...` arguments
   for the complete task-owned readability scope and disclose that list; declaration and DBAL dependency checks still
   cover the full authored inventory. Never exclude a task-owned file just to make the result clean.
5. Inspect the advisory documentation/classification report and resolve task-created location violations. Preserve
   its nonblocking delivery policy. Run the appropriate production checks, then obtain an independent review of
   approval provenance, semantic boundaries, readability and native preservation where the task changes those risks.
6. Report actual findings, evidence, scope and limitations. Resolve violations in owned changes or seek a direct
   decision; do not declare an incomplete review or a skipped check successful.

[`development-check.json`](development-check.json) owns the machine-readable boundary inventory and human-review
criteria; [`check-development-policy.mjs`](../../scripts/check-development-policy.mjs) evaluates it. The checker fails
on non-declaration contracts, request-owned DBAL dependencies, unexplained nontrivial touched operations and nested
complex anonymous operations. Its control-flow coverage is a review heuristic, not a new numeric style limit.
It parses actual TypeScript (including getters/setters) and Vue script blocks without executing application code.
The complete authored worktree declaration/DBAL inventory remains global; separately changed staged sources are
also checked. It does not certify unchanged legacy index content or infer that a syntax-clean method has meaningful
JSDoc and internal explanations. Those remain required by the canonical development guide and human review.
Synthetic CLI regressions run
through `npm run test:development-policy`.

Automated syntax checks cannot establish comment quality, DRY, business semantics or actual maintainer approval.
Those require the explicit review above. The standalone engineering command has no lifecycle hook or CI/deployment
integration; adding a delivery gate, especially one involving documentation, requires resolution of the existing
nonblocking policy first. No claim that future agents cannot bypass instructions is supported by this tooling.
