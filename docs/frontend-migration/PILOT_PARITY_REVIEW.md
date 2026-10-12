# Frontend pilot parity review
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-12
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: restored original canonical Help path, approved cleanup, behavior-preserving readability corrections, measurable agent policy checks and independent source/equivalence review; scoped execution receipts below
source-anchors: src/controller/packingController.ts; src/controller/entityAdminController.ts; src/controller/eventController.ts; src/modules/database/services/PackingService.ts; src/modules/database/services/EntityLifecycleService.ts; src/modules/lib/fileCommons.ts; src/controller/helpController.ts; src/frontend/; contracts/api/v1/; src/locales/; tests/integration/packing-coexistence.spec.ts; tests/integration/packing-management-api.spec.ts; docs/frontend-migration/FRONTEND_PILOT.md; docs/frontend-migration/FRONTEND_FOUNDATION_DESIGN.md; docs/frontend-migration/staged/; docs/backlog/documentation-remediation.yml
next-review: next-migration-slice-or-permission-policy-review
-->

The native comparator is `2dfa2573c64178f54684cc4877b5a945f66e24c8`, with explicit exceptions retained in the
[foundation ledger](FRONTEND_FOUNDATION_DESIGN.md#original-decisions-and-dated-amendments). This record owns current
findings and latest relevant evidence. Superseded procedures, repeated failures/counts and capture transcripts stay
in Git history and ignored artifacts, without another maintained archive.

**The approved implementation corrections are applied and their final verification passed within the scopes below.** The maintainer's
2026-10-12 decisions restore the canonical documentation classifications, authorize the bounded native lock remedy,
and permit safe native public-action parity. The independent security/design review found no protected-resource
disclosure or original blanket profile requirement for those narrow operations. Further permission-policy review
remains backlog scope. This record contains dispositions and evidence, never hidden approval requests.

## Implemented disposition (2026-10-12)

| Reviewed issue | Applied correction and boundary |
|---|---|
| Relocation left duplicate backend business owners | Existing Packing controller shares creation, metadata, item/membership writes, counters and reorder/delete/default hooks. Existing event/admin/lifecycle/image owners supply their shared behavior. Native/v1 adapters retain protocol/normalization/error/feedback differences and retire independently. |
| Method grants imposed unrelated detail/principal admission | Central controller policy drives native middleware, v1 commands and capabilities. Narrow item/order/description/header/default/admin baselines expose only method-permitted values and hashes. Public writes retain authoritative context, CSRF, session-bound comparison tokens and locked grant checks. Full detail/metadata/settings/header-byte reads and operations requiring a profile remain protected. Scoped profile search shares the native rate budget, preserving native text errors and v1 structured errors. |
| Native/v1 assignment deadlock | Approved native assignment coordination locks the root in shared mode before the item in exclusive mode; v1 retains its exclusive root lock. Actual production-controller schedules now complete in both orders and for different items, with capacity, deletion-race and removal behavior preserved. |
| Inherited native permission/coercion quirks | Preserve native item description/write versus display grants, raw Everyone omission/missing-row outcomes, signed/null capacity inputs and SQL rounding, sparse order and partial failure. `IMP-022`/`IMP-023` and other native defects remain distinct from migration corrections. |
| Repeated metadata structural validation | The normalized HTTP adapter validates once; the typed controller operation consumes the admitted patch. Native Joi diagnostics remain its adapter contract. |
| Shared setup/image projections | Preserve numeric default-mask bits through the existing permission owner; controller administrator operation returns domain outcomes; parent/privacy and archival projections use existing owners and the transaction manager. Image replacement uses the existing committed previous-image receipt, with v1 post-commit cleanup. The separately approved automatic-archival remedy closes `IMP-042` through its own real queued date/restore/job schedules and independent one-primary-read review. |
| Help source and future-language fallback | One canonical `docs/user-guide/` root contains native English plus adjacent `en/`, `de/` and approved catalog directories. The unauthorized separate pilot root is retired. Missing locale/topic/figure uses reviewed pilot English with visible notice, English result markers and actual content language. Unsafe/unreadable/escaped existing sources fail normally. Staging is never application input. |
| Readability and policy execution | Purposeful contracts, separate internal step explanations, accurate state/authorization terminology and logical spacing are reviewed across 25 frontend files and 14 existing backend owners. Measurable TypeScript/Vue checks complement independent human review; instructions alone and comment presence are insufficient. No native layout redesign is included. |
| Documentation history/ownership | Repeated backlog/history is substantially consolidated while original IDs remain. Root guides, policies, ADRs, feature references, backlog and migration records follow the approved classifications. The mistaken intermediate rename is explicitly corrected to original `docs/user-guide/`, without treating it as design precedent. Approved cleanup removes only the unreferenced obsolete controls illustration and maintainer-only Activity Help paragraph. |
| Staged guidance diverged from source | One existing playbook now includes concrete shared operations, adapter compatibility, every-writer/FK lock review and precise baseline-to-assertion links. Fixed-source/fallback governance stays staged; released API compatibility rules are restored. |

The [coverage map](TEST_COVERAGE.md#pilot-baseline-to-implementation-assertions) links baseline IDs to implementation
owners and concrete assertions. Aggregate passing counts alone do not establish full feature parity.

## Approved runtime boundaries

The native assignment root lock can extend waits behind exclusive list writers. That bounded consequence was approved;
it does not authorize a general lock framework. The original failing schedule remains recoverable in Git history;
maintained acceptance tests exercise the remedy through actual shared production controllers and foreign keys.

Public permissions remain explicit native grants, not default edit/manage authority. Anonymous comparison tokens use
captured session context without fabricating a profile. Protected projections, identity hydration, method/field grants,
actual route-parent scope, closed payloads and authorization before conditional responses remain enforced.
The [permission-review backlog](../backlog/documentation-remediation.yml) owns broader review and any future rework;
its existence does not allege a newly discovered vulnerability or authorize changing native permission policy.

## Original choices and reusable lessons

The ledger retains original choices and D1–D5/Oct8 amendments, including the i18next-vue restoration, current-value
comparison, reconcile-only commands, folder replacement, JavaScript and progressive-loading decisions. The latest
direct instruction permits editorial cleanup and restores visible English Help fallback. Recorded historic approval
provenance is distinct from independently reconstructed conversation receipts; that earlier evidence limit is retained
here once and is not turned into repeated approval requests.

| Unique lesson | Required practice for the next slice |
|---|---|
| Initial translation/watch substitutions and source-only success | Preserve original technology decisions; exercise actual emitted source URLs, mounted controls and authored-input regeneration only when their owners change. |
| Passing broad tests missed parity/consumer details | Trace native GET/POST/controller/rendered outcomes by actor, including no-op/coercion/feedback/destinations. Test actual adoption, receipt lifetime and browser validity rather than helpers alone. |
| Recovered caches could carry retired authority | Preserve raw original/local/current state, forward cancellation through classification, and require a dispatched admitted read. Equal successful data can renew authority; retained canceled data cannot. |
| Frozen native fixes changed the comparator | Compare immutable reference first; keep inherited defects/diagnostics separate and seek direct approval for unintended consequences. |
| Source policy/lock comments overstated sharing | Named controller operations and independently specified runtime fixtures prove ownership/source boundaries; actual native/v1/FK schedules distinguish inference from reproduced failure. |

## All requested review criteria

| Criterion | Current disposition |
|---|---|
| Original vision and completeness | Bounded Help/Packing/required entry foundation and approved corrections are implemented; final execution evidence is recorded below. Other migrations/default-route cutover remain future scope. |
| Original design and authorization | Selected stack preserved; original choices and dated amendments remain visible. Unapproved runtime consequences remain unapplied. |
| Modularity, DRY and single source of truth | Existing controllers own shared operations/policy; adapters own protocols; pure DBAL owns persistence/locks. Generated contracts/catalogs remain authoritative. |
| Comments, readability and formatting | Named operations/presentation helpers, purposeful transaction/command/template comments and logical boundaries; no blanket refactor or new forwarding modules. |
| Core coding principles | Shared type-only contracts are `.d.ts`; renderer data is explicit; business checks/contextual errors remain outside DBAL. |
| Technical debt | Duplicate ownership/validation/staging defects and reproduced coexistence failure corrected. Inherited native defects and future permission review remain in their existing backlog owners. |
| Repository/documentation cleanliness | Completed sequences and repeated histories retired; durable contracts, IDs and original decision rationale preserved. Native content remains the reference. |
| Consistent implementation guideline | One staged Development playbook plus baseline-to-owner/assertion map covers policy, transport, drafts, privacy, SSR, Help, recovery and cost-based verification. |
| Designed versus implemented architecture | Shared controller/pure-DBAL structure matches the target. Approved coexistence and bounded public-action adjustments are explicit dated amendments. |
| Staged consistency | Technical pilot deltas remain staged; original choices are amended explicitly; current execution is owned here once. |

## Latest verification and limits

| Check | Current receipt and scope |
|---|---|
| Focused real Packing persistence | 71 tests passed across five affected persistence/permission suites, including explicit public grants, protected reads, minimal baselines, session binding and actual writes on the guarded disposable schema. |
| Native/v1 coordination | Eight production-controller concurrency/regression tests passed, including both execution orders, parallel different-item assignments, deletion races and preserved removals/overwrite. Included in the focused persistence receipt. |
| Database-free quick suite | Last full implementation snapshot: 61 files, 1,316 tests passed. The final path/cleanup/readability pass has focused Help checks and parser/equivalence proof; no new full quick run is claimed. |
| Guarded integration suite | Last complete integration snapshot: 22 files, 335 tests passed on the guarded schema. The subsequent 14-owner maintenance pass preserves executable ASTs; no new database run is claimed for comments/spacing. |
| Focused administrator selection | 3/3 passed; this is its scoped invocation, not all administration/session/HTTP coverage. |
| Compiler scopes | Final server and Vue-aware test compilers passed; frontend compiler passed its selected graph. Test compiler uses actual test-import scope. No whole native/editor-graph certification. |
| Built browser/HTTP selection | Full implementation snapshot: 54 passed, one authentication-configuration case skipped. Final restored-path selection: four Help/browser journeys passed, including native context link, aliases, no-JavaScript Help and locale/search/SSR isolation. The skipped mode remains unrun. |
| Integrated source development | Three journeys passed: executable source assets/locale navigation, pre-hydration overview search and mounted Packing controls/real commands without document replacement. No dynamic HMR/authored-edit regeneration result is claimed. |
| Native reference and structural scans | Original 133-file comparison finds no unexpected changes after reconstructing precisely the approved paragraph removal and recording the approved obsolete-asset removal. Native runtime/layout/browser source remains unchanged. |
| Documentation tooling | Canonical-path tooling: 51 tests passed; synthetic Help: 39 passed. Help authoring is now clean. Structural reporting has no classification/link/metadata/script/path/stale-term errors; the historical fingerprint mismatch remains advisory. The earlier 12 corpus checks predate approved cleanup. |
| Engineering enforcement | 17 synthetic CLI regressions passed, including typed/aliased imports, Vue and accessor coverage, removed contracts, separately staged violations, Unicode paths, invalid configuration and explicit scope. Complete task-owned readability scope: 42 files, 206 nontrivial operations, zero findings; all 11 authored DBAL services and declaration filenames checked. Seven existing whole-worktree native/unrelated readability findings remain outside this pass, without persistent exclusions or a claim that the whole checkout is clean. |
| Independent source review | Public-method/lock/security review remains accepted. Separate maintenance reviewers accept accurate contracts/internal explanations and controller/DBAL ownership; frontend proof independently reproduces unchanged executable syntax and exact template/style hashes across all 52 files. Backend emitted-AST proof covers all 14 owners. |
| Production build | Restored-path `npm run build` passed, including server/frontend/SSR. Final comment corrections retain executable equivalence. Existing Sass/dynamic-import warnings remain; no whole-editor-graph claim. |

Native nullable-date diagnostics and previously observed narrow creation/Help layout limits remain inherited. No native
UI/compiler repair is authorized by this correction. Local checks do not certify hosted CI, live OIDC/mail, a new full
visual matrix, dynamic HMR/authored-edit regeneration, installed-folder replay, production cutover or operator rehearsal. Documentation reports remain advisory
and never become application, CI, release or deployment gates.
