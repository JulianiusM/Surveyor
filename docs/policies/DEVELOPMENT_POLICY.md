# Development Policy
<!--
documentation-metadata
audience: maintainers; developers; AI coding agents
owner: project maintainers
status: current
last-verified: 2026-10-28
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: 2026-10-28 maintainer amendments establish completed frontend cutover, current-source review and controller/feature/DBAL ownership; direct prose plans and individual approval requirements retained
source-anchors: AGENTS.md; docs/policies/DOCUMENTATION_POLICY.md; docs/policies/development-check.json; scripts/check-development-policy.mjs; scripts/tests/development-policy-check.test.mjs; docs/DEVELOPMENT.md; docs/ARCHITECTURE.md; docs/TESTING_GUIDE.md; docs/DATABASE.md; src/; tests/; package.json
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
prepare concrete reviewable work within the authorized scope and ask in the final answer under the
[question presentation rule](#questions-belong-in-the-final-answer-2026-10-26), never inside a document.
Do not infer approval from elapsed time, delegation, an existing defect or an editorial cleanup request.

Before dependent edits, compare the request with the actual canonical paths, policy and design anchors. If they
disagree, state both sources directly and obtain explicit resolution even when the newer wording appears deliberate.
Only a decision that explicitly identifies and resolves the conflict authorizes the override. Apply this rule equally
to documentation names, technology choices, architecture, coding patterns and existing behavior.

Preserve existing behavior unless a change is explicitly authorized or directly required by accepted implementation
instructions. Shared callers use the existing backend business owners. Record bounded approved exceptions without
broadening them into an unrelated redesign.

**Authorized enforcement correction (2026-10-15; amended below on 2026-10-28):** compare each touched responsibility with its accepted
requirements and explicit amendments. Before editing, explain the intended owner,
callers, reads, writes and lifecycle effects in the conversation. Reusing the same files, library, database table or
schema does not prove that responsibility or behavior is unchanged. A new writable request-state mirror, save
interceptor, lock or persistence from common admission requires review of those effects against the actual approval
before dependent implementation. Existing scoped operations, middleware expiry/touch and feedback retain their
approved behavior; this rule does not authorize their removal or a general backend redesign.

**Current-source and completed-cutover amendment (2026-10-28):** the maintainer explicitly confirms that the frontend
cutover has happened and the application is no longer in migration. Review the currently implemented application,
its callers and tests; do not consult past commits or require comparison with a former frontend or "native"
implementation. This supersedes historical-baseline comparison and migration-preservation requirements for current
application work. Explicit approved requirements still govern intended behavior; obsolete migration framing does
not supply an additional behavior to preserve. Working-tree diffs remain useful for reviewing the current change.

### Scope of separately authorized work

General defects, large changes and backend behavior changes outside the accepted task scope belong in the existing
backlog for a separate effort. A related frontend adjustment does not authorize an unrelated backend behavior change.
Reuse and transport adaptation preserve existing business behavior rather than introduce a second implementation.

Record each general defect once with its evidence, scope and disposition. A backlog entry does not authorize its
implementation. A separate effort requires explicit authorization under the required change explanation below.
Previously valid approvals retain their recorded scope; this rule grants no permission for further changes.

The maintainer's 2026-10-14 scope clarification permits a presentation or transport adaptation to reuse an existing
business operation with its recorded behavior without making repair of its existing defects a prerequisite. A new
consumer does not by itself make that business operation new. Record inherited defects and their disposition;
explicitly excluded remedies remain deferred rather than pending approvals for the adaptation. Operation-finality
requirements govern newly introduced or deliberately changed business behavior and must not become authority for an
unapproved legacy repair. New adapter code still enforces its own authentication, authorization, privacy, decoding
and delivery boundaries; it must not add avoidable postcommit rejection, automatic replay or stronger guarantees
than the shared operation provides. This clarification does not weaken security or authorize new behavior.

### Questions belong in the final answer (2026-10-26)

The maintainer explicitly requires every question to appear in the agent's final answer. This covers factual
clarifications, preferences, options, confirmations and approval requests. Asking through commentary, progress
updates, question tools, logs or documentation is a policy violation. Internal drafts for required preflight and
review are allowed, but they do not present a question to the maintainer or establish an answer.

The final answer must contain every outstanding question in full. Approval requests retain the complete required
change explanation below; a reference to an earlier question or a statement that approval is pending is insufficient.
If a question was presented elsewhere, re-present it completely in the final answer. Neither its earlier placement
nor silence supplies approval. Complete independent authorized work, and stop dependent work when an answer is
required; end the turn with the actual question in the final answer.

The root agent reviews actual question placement and completeness before sending the final answer. Delegates relay
unresolved questions to the root rather than presenting them to the maintainer elsewhere. The development checker's
review criteria and approval preflight remind agents of this requirement; they cannot inspect conversation channels
or certify that the final answer was delivered correctly. This dated clarification narrows the earlier requirement
to ask in the conversation; it preserves individual approval, independent review and the prohibition on inferred consent.

### Implementation plans belong in the final answer (2026-10-28)

The maintainer's explicit 2026-10-28 correction clarifies the existing prohibition on hiding implementation plans
in documentation. When an implementation plan is requested or needed for a decision, present the complete plan
directly in the final answer as readable prose. The maintainer must be able to understand and assess the proposed
work without opening a file, following a link or reconstructing it from identifiers.

Explain each independently decidable change: the current problem and intended result, its scope and existing
owner, the approach, execution order and actual dependencies, material consequences and prior constraints, and
the planned verification. Group related work for readability while keeping distinct changes and decisions clear.
Distinguish remaining defects from verification or retirement of superseded findings, and required work from
conditional proposals. Do not replace these explanations with a list of backlog IDs or a brief roadmap.

Documentation, backlog entries and generated artifacts may support the plan when appropriate, but they do not
deliver it. A file link, attachment, YAML/JSON record, code block, table, checklist, progress update or short summary
is not a substitute for the complete prose plan in the final answer. This remains true when the task also requests
saving material in the repository. Do not leave any proposed work or unresolved decision explained only in a file.

The plan itself grants no implementation approval. Preserve existing valid approvals within their actual scope;
apply the required change explanation separately to every actual approval request, and present every question
under the final-answer question rule above. This clarification adds no blanket approval or requirement to seek
permission again for authorized work.

An independent nonauthor and the root agent review the actual proposed final-answer wording for completeness,
clarity, scope, decision boundaries and question placement. Reviewing a saved plan or checking its identifiers is
insufficient. The root agent checks the final answer that will actually be sent. Automated checks and metadata
cannot certify conversational delivery.

### Required change explanation (2026-10-13)

The maintainer's 2026-10-13 correction withdraws the quotation and mandatory read-back amendment in favor of concise,
meaningful explanations. The 2026-10-14 correction strengthens that original four-field format after requests supplied
too little context to support an informed decision: add explicit scope and approach, and identifiable simultaneous
requests. Earlier valid approvals retain their scope; brevity alone never establishes explanation quality.

Every individual approval request must be short, simple and understandable on its own to a maintainer who has not
followed the investigation. Supply enough current behavior, intended outcome and relevant context to decide without
opening source files or reconstructing earlier messages. Use these labels in this order, normally with a brief
sentence or two for each; keep necessary context rather than compress the explanation into ambiguous shorthand:

- **Reason:** who encounters the problem, what currently happens and why the change is needed.
- **What is to be changed:** the concrete behavior, rule or responsibility in scope, from its current state to the
  proposed result. Identify the affected user action or workflow and its boundaries, rather than naming only an
  unused helper, file or abstract capability.
- **How it is to be changed:** the intended approach and resulting ownership. Explain which existing owner and
  callers adopt the change, what remains shared and how the target behavior is reached, without code or a technical
  implementation transcript. Describe the target, not an unexplained instruction such as "remove the branch."
- **Implications:** the resulting user-visible effects, compatibility consequences, material risks or tradeoffs.
  Explain the consequences separately from the scope and approach; state when no current user-facing change is expected.
- **Prior decisions and requirements:** which earlier choice or requirement the change preserves, affects or
  conflicts with. State when no conflict was found.
- **History:** the relevant original choice, approved amendments and how the issue was discovered. Distinguish
  observed evidence from inference; keep unknown rationale or authorization explicitly unknown.

The maintainer's 2026-10-15 enforcement correction explicitly applies this complete explanation and direct-question
requirement to a clarification, preference or option question that resolves a policy/design conflict or authorizes
changed behavior. Calling it a clarification does not waive the approval rules. A factual question that grants no
such decision remains an ordinary clarification. Inspect the exact proposed request with both required reviewers
before sending it; a previous review of the broader plan does not review a later question automatically.
Preflight the exact proposed text with `node scripts/check-development-policy.mjs --approval-request <temporary-file>`
before presentation. This read-only mode checks field/order/question/link/identifier syntax only; its temporary input
is not a documentation destination or approval record. Present the full request in the final answer under the
[question presentation rule](#questions-belong-in-the-final-answer-2026-10-26). Passing it
does not replace either semantic reviewer, grant approval or create an application/documentation delivery gate.

Explain the change clearly in concise prose. Exact quotations, replacement text, code, diffs and implementation
transcripts are forbidden in approval requests. Name affected material only where needed to define the decision's
scope; avoid unexplained file inventories. A source link may identify an owner, but must not replace the explanation.
Use familiar words and only the context needed to decide; define necessary technical terms. When several layers
change, briefly name their shared owner and callers so the actual reuse and responsibility remain understandable.
Use a concrete trigger or before/after example when the behavior would otherwise remain abstract. Explain why the
proposed choice is appropriate and mention a material alternative when it affects the decision. Do not add a long
inventory or speculative alternatives merely to fill the format.

One request covers the smallest independently decidable change. If one part could be approved and another rejected,
make separate requests, each with its own complete explanation, specific decision and governing approval-rule link. Do not
bundle decisions, share their explanations or substitute "see above" for a field. After the explanation, ask a direct
question naming the decision and link the rule requiring approval. Never hide the request or implementation plan in
documentation, infer consent from silence or request permission again for work already explicitly authorized.

When one answer presents multiple approval requests, give each a short, distinct identifier, such as **R1** and
**R2**, and repeat that identifier in its direct question. Identifiers must be unique within that answer; global
uniqueness is unnecessary. Track replies against both the identifier and its actual decision, including the answer
which introduced it. A later identifier reuse or an ambiguous reply must not transfer approval to another change.

Before presenting each request, obtain an independent nonauthor review and root review against the inspected source.
Reject and rewrite requests that are lengthy, quote proposed edits, depend on jargon or fail to explain what changes
to what, why, the consequences, affected decisions and relevant history. Correct labels and a declaration of compliance
are insufficient. Both reviewers must assess whether an uninvolved maintainer can understand the current problem,
concrete proposal, approach and consequences well enough to choose, as well as actual shared adoption, identifiers
and approval provenance. A short request with insufficient context fails this review. No prescribed read-back or
verbatim reproduction is required.

Withdraw and reissue a rejected unresolved request. Its unclear wording or an inferred answer supplies no approval.
Existing valid approvals remain effective. Pass current authorization, unresolved decisions and these concise
requirements to every delegated agent; require its acknowledgement. Track each answer against that individual
decision. Delegation or successful checks cannot grant approval or certify the quality of an explanation.
Tests establish their exercised behavior, not design authorization. An agent-authored amendment, backlog closure or
review claim cannot supply missing conversational approval or retroactively authorize its own implementation.

### Task-scoped architecture remediation authority (2026-10-26)

The maintainer explicitly approved **R3**, authorizing completion of the already reviewed, behavior-preserving
architecture remediation in IMP-137 through IMP-146 and IMP-148 through IMP-158, plus retirement of the unused
session validator identified under ARCH-005. For this effort only, those equivalent refactors and confirmed
readability corrections do not require another individual implementation approval. The original approval rules
above remain authoritative outside this exception, which expires when this recorded remediation is complete.

Classify heuristic warnings before correcting debt. Apply scoped implementation, actual caller adoption,
independent nonauthor and root source review, and appropriate checks throughout. Preserve observable behavior,
security, identity/session rules, error statuses, reads/writes, transaction and lock order, file lifetimes,
database schema and wire compatibility. Any required change to those, or conflict with another approved design,
still needs its own complete approval request in the final answer. Broader session redesign and unrelated remedies
remain outside this authority.

The maintainer separately approved **R4**, lifting the explicit IMP-070 deferral for its matching administrator and
default-permission orchestration. That bounded consolidation may proceed under R3 through the existing shared
administration controller with actual adoption by Packing, Drivers, Event and Activity. Feature controllers retain
admission; existing DBAL services retain transaction/lock ownership. Preserve grants, private projections, comparison
tokens, validation order, zero versus absent grants and every feature's lock/commit order. The rejected earlier
attempt and rollback remain historical; this amendment neither accepts that patch retrospectively nor authorizes
changed administration rules or other excluded backend remedies.

**Further direct maintainer instruction (2026-10-26):** after rejecting incomplete shared ownership, the maintainer
instructs implementation of the renewed review's proposals, including IMP-159 through IMP-174 and incomplete
original remedies. The maintainer explicitly approves R5 for all frontend validation, broadens IMP-154 to every
feature-specific shared contract and the root OpenAPI operation ownership, and requires reuse of existing owners.
Review already created modules and consolidate overlapping responsibilities into their actual existing owner;
create a module only when no existing module has the same or a similar job. This authorizes the reviewed current
ownership corrections and the separately identified identifier/ORM corrections, not copying implementations,
forwarding facades or a blanket future redesign. Preserve original decisions and deliberate feature differences;
R4's matching permission administration remains in its existing shared controller. New consequences outside these
specified proposals still follow the ordinary individual decision rules.

**Subsequent explicit decisions (2026-10-27):** the maintainer approves R6/IMP-175 with the requirement that UUID
identity handling have one shared implementation rather than controller copies. Adopt it throughout the confirmed
scope, lookup, ordering, submitted-reference and Activity job paths using existing owners. Preserve grants, foreign
and missing-row checks, transaction/lock order, numeric identifiers and case-sensitive opaque security evidence;
the generic job coordinator retains its own responsibility. The maintainer separately approves R7/IMP-176:
the existing recommendation resolver uses its assignment-detail match when a supplied row ID is unrecognized,
preserving saved provenance and legitimate new manual proposals. Current-plan ownership remains authoritative;
an unknown submitted ID supplies no authority over another plan's saved row. These decisions supersede the two
pending requests, not unrelated exclusions or the ordinary approval rules for future consequences.

**Further architecture implementation decisions (2026-10-27):** the maintainer explicitly approves all **R1–R20**
from the complete implementation-plan answer immediately preceding that approval. These identifiers belong to that
answer, not earlier uses of R1–R7. The scope is IMP-177 through IMP-191, the concrete retained-export actor finding
under ARCH-005, and the separately approved IMP-013, IMP-016 and IMP-079 remedies. The existing backlog records the
individual mapping and acceptance evidence. This authority includes the reviewed proof ledger/entity/migration and
offline historical reconciliation tooling; it does not authorize deployment or unspecified real-installation file actions.

The maintainer expressly requires **R2** to preserve complete role removal from both frontend and backend, including
an empty selection. For **R3 and R7–R20**, reuse established procedures and existing modules with the same or similar
responsibility; moving or copying an implementation alone is insufficient. Frontend controls must be reusable shared
implementations without duplicate copies. Adopt the actual owner at all live callers and retire obsolete implementations.
All previously recorded decisions remain historical. Broader session/flash redesign and unrelated operational remedies
remain excluded; the specifically approved proof cleanup boundary and historical reconciliation retain their plan scope.

**Additional explicit decision (2026-10-27):** the maintainer approves **R21**, the independently reviewed Event flag
checkbox proposal from the preceding final answer. Extend the existing `FormField` owner with a separate controlled
boolean checked channel and adopt it in both Event flag presentations and the dietary choice renderer. Preserve the
existing string model API, native flag names/default values/unchecked omission, dietary submitted values, layout,
labels/icons, disabled behavior and feature-owned drafts. This resolves IMP-192's pending approval; it does not
authorize unrelated checkbox, backend or form-behavior changes.

## Implementation principles

- Human readability, DRY, separation of concerns, a single source of truth and information hiding are acceptance
  criteria. Follow neighboring patterns; reuse an existing controller, service or middleware whose responsibility
  fits. Do not add forwarding modules or duplicate business rules for another frontend.
- Controllers coordinate request admission, feature operations and responses. Feature modules own shared business
  implementation, including business checks and errors. Services are pure DBAL: queries, locks, transactions and
  persistence. Services must not throw `APIError`, `ExpectedError`, `ApiProblem` or request/UI-specific errors.
  Invoke the feature operation inside a service-managed transaction when its decision depends on locked data;
  keep the check under the lock and outside the DBAL owner. The maintainer explicitly clarified this ownership on
  2026-10-28, superseding the earlier controller-owned-business wording. Adopt shared implementations at all matching
  live callers; moving duplicate implementations or adding forwarding facades does not satisfy this boundary.
- Enforce authentication, authorization, validation and ownership on the server. UI visibility is not a security
  boundary. Page admission, method grants and private projections remain distinct; reusable controls never grant
  authority. Captured actors, CSRF/context checks and lock-time authorization protect versioned commands.
- Keep rendered controls, feature-owned drafts and submitted values consistent. For every reused or restored
  component ask whether its current use-case requires the value to remain. Preserve intentional unsaved input;
  clear values which the admitted route, actor or completed operation has released. Browser caching, autofill and
  DOM reuse must not leave an old value visible while requests silently omit or overwrite it. Review text, select,
  checkbox and file controls with their actual ownership and lifecycle, rather than applying a blanket reset.
- Treat a committed operation as final within the [authorized operation scope](#scope-of-separately-authorized-work).
  For new or deliberately changed business behavior, complete fallible admission, business checks, dependent
  persistence and result preparation before its commit. A later mutable-context check or session write must not reject
  an already committed creation and leave unintended records. Required identity/session changes share that operation's
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
| `tests/integration/` | Real TypeORM persistence, relationships, transactions or selected controller orchestration on the guarded disposable schema; genuine integration of production server components may be database-free when persistence is outside the tested boundary. |
| `tests/e2e/` | A critical built workflow requiring routes, middleware, sessions, rendering and persistence together. |

The maintainer's explicit 2026-10-13 decision reaffirms that **every E2E test exercises the built application against
a fully prepared database through its integrated backend**: this is a system test with the production application
setup. An incidentally running server/database does not turn a substituted document or fully intercepted client
fixture into E2E coverage. Isolated built-browser checks belong only to the client-test layer. Source-development
server workflows remain integration evidence and must not be labeled built-application E2E. Preserve the original
full-workflow boundary rather than broadening it to accommodate an incorrectly classified test.

The maintainer's 2026-10-14 conditional decision admits the Express/Vite fixture as genuine integration: it combines
the actual development middleware, shared SSR renderer and HTTP asset delivery instead of replacing those components
with mocks. Such isolated server-rendering/development-asset checks belong in `tests/integration/` and use the existing
database-free runner selection without initializing a schema they never access. A mocked HTTP response alone is not
this boundary. Database-backed integration retains real ORM metadata and its guarded schema; unit/client limits and
the built-application E2E requirement remain unchanged.

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
   changes, active profile scope, existing behavior and approval boundaries. Trace current implemented owners and
   explicit approved requirements; identify any proposed change in reads, writes, authority or lifecycle before editing.
2. Resolve conflicts directly before dependent edits. Pass the resolved decision, file ownership, applied profile,
   remaining conflicts and required approval-request format to every subagent; require its policy acknowledgement
   and review its actual changes. Keep general defects outside the authorized scope and follow the
   [separate-work boundary](#scope-of-separately-authorized-work) before expanding the task. The root agent and an
   independent nonauthor review each approval request under the required change explanation before presentation.
   Check its plain-language journey, concrete before/after change, existing owners and actual shared adoption against
   the source, including conflict-resolving clarification questions. Reject and rewrite unclear, lengthy or quotation-based requests before asking. No missing substantive
   explanation can be supplied by a documentation file.
3. Review every touched nontrivial operation for a purposeful contract, separate in-code explanations of its steps,
   logical spacing and readable control flow. Comment presence alone does not satisfy this review. Preserve existing
   module ownership and neighboring style; do not apply a blanket formatter or refactor unrelated functions.
4. Run `npm run check:development` for measurable engineering rules and `git diff --check` for whitespace. The checker
   inspects worktree changes and separately changed index blobs against HEAD, so restored worktree content cannot
   conceal a staged violation. In a dirty shared workspace use repeated `--file src/...` arguments
   for the complete task-owned readability scope and disclose that list; declaration, DBAL dependency and
   session-ownership checks still cover the full authored inventory. Never exclude a task-owned file just to make
   the result clean.
5. Inspect the advisory documentation/classification report and resolve task-created location violations. Preserve
   its nonblocking delivery policy. Run the appropriate production checks, then obtain an independent review of
   approval provenance, semantic boundaries, readability and behavior preservation where the task changes those risks.
6. Report actual findings, evidence, scope and limitations. Review the actual final answer for all outstanding
   questions and complete approval explanations under the question presentation rule. Resolve violations in owned
   changes or seek a direct decision there; do not declare an incomplete review or a skipped check successful.

[`development-check.json`](development-check.json) owns the machine-readable boundary inventory and human-review
criteria; [`check-development-policy.mjs`](../../scripts/check-development-policy.mjs) evaluates it. The checker fails
on non-declaration contracts, request-owned DBAL dependencies, unexplained nontrivial touched operations and nested
complex anonymous operations. Its control-flow coverage is a review heuristic, not a new numeric style limit.
It parses actual TypeScript (including getters/setters) and Vue script blocks without executing application code.
The complete authored worktree declaration/DBAL/session inventory remains global; separately changed staged sources are
also checked. It does not certify unchanged legacy index content or infer that a syntax-clean method has meaningful
JSDoc and internal explanations. Those remain required by the canonical development guide and human review.
Synthetic CLI regressions run
through `npm run test:development-policy`.

Automated syntax checks cannot establish comment quality, DRY, business semantics or actual maintainer approval.
Those require the explicit review above. The standalone engineering command has no lifecycle hook or CI/deployment
integration; adding a delivery gate, especially one involving documentation, requires resolution of the existing
nonblocking policy first. No claim that future agents cannot bypass instructions is supported by this tooling.

The bounded session-ownership checks detect recognizable extra request Session declarations, store construction and
save overrides. The existing explicitly scoped identity-transaction staging operation is the sole configured owner;
its configuration records that boundary rather than granting approval to new callers or effects. Other aliases and
indirect mutation still require semantic review. Ordinary saves and existing middleware behavior are not prohibited.
Property-name heuristics are conservative: a `createSession` call or `.session` alias does not establish its runtime
type. Review an unrelated-domain match against its actual owner rather than invent an exception to hide the finding.
