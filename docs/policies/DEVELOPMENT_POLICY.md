# Development Policy
<!--
documentation-metadata
audience: maintainers; developers; AI coding agents
owner: project maintainers
status: current
last-verified: 2026-10-14
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: shared engineering and concise individual approval retained; generic task-context bootstrap, scoped profile selection and continuation/delegation freshness routed to the documentation policy
source-anchors: AGENTS.md; docs/policies/DOCUMENTATION_POLICY.md; docs/DEVELOPMENT.md; docs/ARCHITECTURE.md; docs/TESTING_GUIDE.md; docs/DATABASE.md; src/; tests/; package.json
next-review: explicit-maintainer-policy-amendment
-->

This is the authoritative owner of Surveyor's shared engineering rules. The
[documentation policy](DOCUMENTATION_POLICY.md) owns document classification, audience, decision provenance
and approval. Practical procedures remain in the maintained development, architecture, testing and database guides.
AI instruction files must link to these policies rather than introduce alternative rules.

## Authorization and task boundaries

Read the current request, both policies and the relevant canonical guide before editing. Inspect the exact production
behavior and tests, check the working tree and preserve unrelated user changes. Identify affected persistence,
authorization, files, UI, tests and documentation boundaries, then make the smallest coherent authorized change.

Apply the documentation policy's [optional task-profile context procedure](DOCUMENTATION_POLICY.md#document-roles-and-optional-task-profiles)
before dependent edits and when scope or governing instructions change. Use its shared bootstrap, explicit selection
and continuation/delegation evidence; missing profiles are normal. An applicable profile supplements these rules
within its declared scope. Temporary boundaries do not belong in permanent guidance or supply additional approval.

Treat explicit maintainer decisions and approved designs as constraints. Code is evidence of current behavior, not
permission to rewrite the policy to match an implementation defect. Resolve conflicting instructions directly with
the maintainer before dependent implementation. Potentially unintended consequences require advance approval;
prepare concrete reviewable work within the authorized scope and ask in the conversation, never inside a document.
Do not infer approval from elapsed time, delegation, an existing defect or an editorial cleanup request.

Before dependent edits, compare the request with the actual canonical paths, policy and design anchors. If they
disagree, state both sources directly and obtain explicit resolution even when the newer wording appears deliberate.
Only a decision that explicitly identifies and resolves the conflict authorizes the override. Apply this rule equally
to documentation names, technology choices, architecture, coding patterns and existing behavior.

Preserve existing behavior unless a change is explicitly authorized or directly required by accepted implementation
instructions. Shared callers use the existing backend business owners. Record bounded approved exceptions without
broadening them into an unrelated redesign.

### Scope of separately authorized work

General defects, large changes and backend behavior changes outside the accepted task scope belong in the existing
backlog for a separate effort. A related frontend adjustment does not authorize an unrelated backend behavior change.
Reuse and transport adaptation preserve existing business behavior rather than introduce a second implementation.

Record each general defect once with its evidence, scope and disposition. A backlog entry does not authorize its
implementation. A separate effort requires explicit authorization under the required change explanation below.
Previously valid approvals retain their recorded scope; this rule grants no permission for further changes.

### Required change explanation (2026-10-13)

The maintainer's 2026-10-13 correction withdraws the quotation and mandatory read-back amendment in favor of concise,
meaningful explanations. Earlier valid approvals retain their scope.

Every individual approval request must be short, simple and understandable on its own. Use these four labels in
this order, with a brief sentence or two for each:

- **Reason:** who encounters the problem, what currently happens and why the change is needed.
- **Implications:** what the existing owner will change from the current rule or behavior to the proposed end state,
  and the resulting user-visible effects or material risks.
- **Prior decisions and requirements:** which earlier choice or requirement the change preserves, affects or
  conflicts with. State when no conflict was found.
- **History:** the relevant original choice, approved amendments and how the issue was discovered. Distinguish
  observed evidence from inference; keep unknown rationale or authorization explicitly unknown.

Explain the change clearly in concise prose. Exact quotations, replacement text, code, diffs and implementation
transcripts are forbidden in approval requests. Name affected material only where needed to define the decision's
scope; avoid unexplained file inventories. A source link may identify an owner, but must not replace the explanation.
Use familiar words and only the context needed to decide; define necessary technical terms. When several layers
change, briefly name their shared owner and callers so the actual reuse and responsibility remain understandable.

One request covers the smallest independently decidable change. If one part could be approved and another rejected,
make separate requests, each with its own four fields, specific decision and governing approval-rule link. Do not
bundle decisions, share their explanations or substitute "see above" for a field. After the four fields, ask a direct
question naming the decision and link the rule requiring approval. Never hide the request or implementation plan in
documentation, infer consent from silence or request permission again for work already explicitly authorized.

Before presenting each request, obtain an independent nonauthor review and root review against the inspected source.
Reject and rewrite requests that are lengthy, quote proposed edits, depend on jargon or fail to explain what changes
to what, why, the consequences, affected decisions and relevant history. Correct labels and a declaration of compliance
are insufficient. Both reviewers must assess meaning, actual shared adoption and approval provenance; no prescribed
read-back or verbatim reproduction is required.

Withdraw and reissue a rejected unresolved request. Its unclear wording or an inferred answer supplies no approval.
Existing valid approvals remain effective. Pass current authorization, unresolved decisions and these concise
requirements to every delegated agent; require its acknowledgement. Track each answer against that individual
decision. Delegation or successful checks cannot grant approval or certify the quality of an explanation.

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
  syntax. Templates/components explain their inputs, rendered data, conditions, shared/personal state and
  DOM lifecycle hooks in the established comment style. Do not substitute comments for clear code.
- Pass optional feature/page state through explicit component inputs and the owning renderer's data contract. `res.locals` remains the
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
required approval remains pending. The final review checks actual production adoption, behavior preservation,
policy compliance and truthful evidence; a passing helper test or a comment alone does not establish acceptance.

Use the following task procedure; a repeated statement that policies were followed is not evidence:

1. Obtain current task context through the documentation policy's shared bootstrap and read both policies and affected
   canonical/design sources before editing. Refresh selected profile identities on continuation or scope changes.
   Inspect the working tree and identify the exact task-owned files, existing user
   changes, active profile scope, existing behavior and approval boundaries.
2. Resolve conflicts directly before dependent edits. Pass the resolved decision, file ownership, applied profile,
   remaining conflicts and required approval-request format to every subagent; require its policy acknowledgement
   and review its actual changes. Keep general defects outside the authorized scope and follow the
   [separate-work boundary](#scope-of-separately-authorized-work) before expanding the task. The root agent and an
   independent nonauthor review each approval request under the required change explanation before presentation.
   Check its plain-language journey, concrete before/after change, existing owners and actual shared adoption against
   the source. Reject and rewrite unclear, lengthy or quotation-based requests before asking. No missing substantive
   explanation can be supplied by a documentation file.
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
   approval provenance, semantic boundaries, readability and behavior preservation where the task changes those risks.
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
