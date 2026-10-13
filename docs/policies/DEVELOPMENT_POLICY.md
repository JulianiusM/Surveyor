# Development Policy
<!--
documentation-metadata
audience: maintainers; developers; AI coding agents
owner: project maintainers
status: current
last-verified: 2026-10-13
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: meaningful individual approval/semantic delegation review retained; explicit native-parity frontend migration boundary separates general defects and backend behavior changes from migration work; previously approved implementation and engineering/test boundaries preserved
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

### Frontend migration boundary (2026-10-13)

The maintainer explicitly requires frontend migration to attain native visual and behavioral parity through shared
backend owners. Classify a discovered difference against that reference and the recorded approved exceptions before
changing it. A general application defect is separate from a defect introduced by the migration.

General defects, large changes and backend behavior changes belong in the existing backlog for a separate effort;
they are not fixed as part of frontend migration. Accompanying a backend behavior change with a minor frontend
adjustment does not make it migration work. Reuse and transport adaptation must preserve the existing business
behavior rather than introduce a second implementation or conceal an unrelated behavior change.

Record each general defect once with its evidence, scope and disposition; a backlog entry or migration instruction
does not authorize its implementation. Any separate effort requires its own explicit authorization under the
required change explanation below. This clarification preserves previously explicitly approved work and its
recorded provenance; it does not instruct agents to roll that work back or grant permission for further changes.

### Required change explanation (2026-10-13)

The maintainer explicitly requires every AI agent to explain proposed changes briefly and simply, in addition to
the existing direct approval rules. The subsequent explicit 2026-10-13 correction requires the following exact
labels, in this order, before every approval request. Before presenting a change for maintainer review or approval,
explain in the conversation:

- **Reason:** the concrete problem and why the change is needed.
- **Implications:** the resulting behavior, affected scope and any potentially unintended consequences.
- **Prior decisions and requirements:** whether an earlier choice or design requirement explains, limits or conflicts
  with the change. Identify the relevant source, or state that no conflicting requirement was found.
- **History:** the relevant original choice, approved amendments and how the issue was discovered. Distinguish
  verified history from inference; say when the history is unknown rather than inventing a rationale or approval.

The maintainer's further explicit 2026-10-13 correction applies this complete format to **each and every individual
approval**. One request must concern the smallest independently decidable change or conflict resolution. Several
files or steps may belong to one request only when they are necessary for that same indivisible outcome. If the
maintainer could approve one part and reject another, split those parts into separate requests, even when they
support the same project or implementation plan. Presenting several requests in one message is permitted only
when each is self-contained, with its own complete explanation, specific decision, approval rule/source link and
direct question.

**Bundling is forbidden.** Never share one set of the four fields across multiple decisions, combine several
approvals into an umbrella plan request, ask to approve a list such as A–D together, or replace an individual field
with "see above", "the full plan" or another request's explanation. Formatting each field once is insufficient
when the maintainer must decide more than one matter. An incomplete or bundled request establishes no approval;
correct it before seeking a decision or implementing dependent work.

Every field must contain information relevant to that individual decision. Identify the concrete affected behavior
and source, explain its specific effects and material risks, name the original choice and applicable amendments,
and state the actual discovery evidence and its limits. Generic policy acknowledgements, unrelated findings,
blanket assurances or repeated boilerplate do not provide an informed choice. Unknown rationale or authorization
must remain explicitly unknown. Do not claim that a proposed remedy has passed checks which have not been run.

**Meaningful information is mandatory (2026-10-13).** The maintainer explicitly rejected correctly labeled requests
which left the affected journey, proposed edit or shared responsibilities unclear. The four fields must let the
maintainer understand and decide the individual change without reconstructing it from code, links or earlier messages:

- In **Reason**, identify the feature and who encounters the problem, explain how it happens, and give a concrete
  current outcome. Use a short example when timing, alternative entry points or concurrency would otherwise be unclear.
- In **Implications**, say exactly what will change and describe the resulting observable behavior. For changes across
  frontends or layers, identify the existing routes/functions/modules to edit and explain each owner's responsibility.
  Trace how the affected callers will use the shared implementation. State material risks and a practical alternative
  where it would affect the decision; do not substitute an unexplained file inventory or a blanket assurance.
- Explain modularization and reuse concretely whenever they are affected: which owner retains each business rule,
  which repeated steps are consolidated, and which separate input/response handling is necessary. If existing paths
  differ, identify their users and the reason for retaining or changing each difference. A promise to "share logic"
  is insufficient. Do not introduce another implementation of the same responsibility to fix only one caller.
- In **Prior decisions and requirements**, connect the actual proposed change to the applicable approved choices and
  constraints. Specify the exact preserved behavior or bounded exception being requested; citing DRY or a policy name
  alone does not explain that relationship.
- In **History**, identify what the source/history actually establishes, any relevant approved amendments, and the
  evidence used to discover the issue. Distinguish an observed failure from a source-inferred schedule, an unrun check
  or an unknown original rationale. Do not label a path "legacy" instead of explaining why it exists and who uses it.

Lead with plain user actions and outcomes, then add code identifiers as precise anchors. Define necessary technical
terms at first use; internal shorthand must never carry the explanation. Keep the request short without removing
information needed to understand the change, its scope, responsibility boundaries or consequences.

Keep this explanation short and use plain language. After these four labeled fields, identify the specific decision
being requested, name the rule requiring approval and link its governing source, then ask the maintainer directly.
Do not substitute an unlabeled summary, hide the request in a document or infer an answer from elapsed time.
Documentation may record the decision afterward, but must never substitute for this explanation or approval request.

The delegating agent includes this per-decision format and the actual authorization in every handoff, and requires
the delegated agent to acknowledge them. A delegated agent reports unresolved decisions to the coordinating agent;
the root agent reviews each request separately for all four substantive fields, its exact single decision, approval
rule/source link and evidence before presenting it to the maintainer. This review must check meaning as well as labels:
can the maintainer identify the affected user journey, the current problem, the precise proposed edits, the shared
owners/callers, the before/after behavior and the material consequences from the request itself? Can the reviewer
trace the claimed reuse to the inspected source rather than infer it from function names? Reject and rewrite any
request which fails these checks, even when every label is present. Reject bundled, incomplete, jargon-dependent or
irrelevant explanations. Delegation and a reviewed request grant no implementation approval.
Track the maintainer's answer against that individual decision; approval of one request does not approve another.
This requirement supplements the existing approval boundaries; it neither grants implementation approval nor
requires asking again for work already authorized.

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
- Keep rendered controls, feature-owned drafts and submitted values consistent. For every reused or restored
  component ask whether its current use-case requires the value to remain. Preserve intentional unsaved input;
  clear values which the admitted route, actor or completed operation has released. Browser caching, autofill and
  DOM reuse must not leave an old value visible while requests silently omit or overwrite it. Review text, select,
  checkbox and file controls with their actual ownership and lifecycle, rather than applying a blanket reset.
- Treat a committed operation as final. Complete fallible admission, business checks, dependent persistence and
  result preparation before its commit. A later mutable-context check or session write must not reject an already
  committed creation and leave unintended records. Required identity/session changes share that operation's
  transaction; delivery failure remains distinct from business rejection. Network uncertainty is not rollback
  evidence and must never cause automatic replay or speculative deletion.
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
| `tests/frontend/` | Client helpers/DOM behavior under Vitest, or isolated real-browser client behavior under the client Playwright runner. |
| `tests/integration/` | Real TypeORM persistence, relationships, transactions or selected controller orchestration on the guarded disposable schema. |
| `tests/e2e/` | A critical built workflow requiring routes, middleware, sessions, rendering and persistence together. |

The maintainer's explicit 2026-10-13 decision reaffirms that **every E2E test exercises the built application against
a fully prepared database through its integrated backend**: this is a system test with the production application
setup. An incidentally running server/database does not turn a substituted document or fully intercepted client
fixture into E2E coverage. Isolated built-browser checks belong only to the client-test layer. Source-development
server workflows remain integration evidence and must not be labeled built-application E2E. Preserve the original
full-workflow boundary rather than broadening it to accommodate an incorrectly classified test.

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
2. Resolve conflicts directly before dependent edits. Pass the resolved decision, file ownership, remaining
   conflicts and required approval-request format to every subagent; require its policy acknowledgement and review
   its actual changes. Apply the [frontend migration boundary](#frontend-migration-boundary-2026-10-13) before
   expanding a migration task; classify general defects for the separate backlog effort. The root agent reviews
   any delegated approval request under the required change explanation
   before presenting it to the maintainer. Check its plain-language journey, concrete before/after change, existing
   owners and actual shared adoption against the source; a correctly formatted but unclear request is rejected and
   rewritten before asking. No missing substantive explanation can be supplied by a documentation file.
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
