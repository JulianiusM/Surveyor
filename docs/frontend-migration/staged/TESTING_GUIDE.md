# Staged frontend testing guide amendments
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-15
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: current database-free inventory and revised one-session/stateless admission assertions source-reconciled; repair execution remains distinct from prior results; no cutover or operator execution claimed
source-anchors: docs/frontend-migration/documentation-boundary.json; docs/frontend-migration/check-documentation-boundary.mjs; docs/policies/DOCUMENTATION_POLICY.md; docs/policies/DEVELOPMENT_POLICY.md; src/frontend/; tests/integration/frontend-development-runtime.spec.ts; tests/integration/frontend-session-admission.spec.ts; vitest.config.mts; package.json
next-review: next-authorized-migration-slice-or-cutover
-->

These amendments retain the reviewed frontend guidance without copying unchanged production procedures.
The [profile](../PROFILE.md) governs preparation and review; its [manifest](../documentation-boundary.json)
owns destination mapping and exact operations. Payload links use their mapped production location.
Surrounding notes use this file's location. Preparing complete temporary output does not authorize cutover.

## Runner classification — amendment-01

<!-- delta:amendment-01 -->
The explicit 2026-10-13 decision retains this E2E boundary. Isolated built-browser fixtures belong to the client
layer even when another runner happens to start a server/database. Source-server browser workflows with real
persistence belong to integration coverage; they are not built-application E2E. Exact runner selection comes from
configuration and package scripts; the frontend and compiler contracts below cover their distinct scopes.

Genuine integration of production server components can be database-free when application database persistence lies
outside the exercised boundary. The Express/Vite fixture combines development middleware, shared SSR and HTTP asset
delivery; the session-admission fixture combines actual Express/session middleware and production admission with
synthetic anonymous MemoryStore contexts. Both use the existing database-free selection without initializing a
schema. The session fixture preserves the original middleware Session/save methods, rejects a changed stored
generation instead of adopting it, and leaves cookie-free initial reads uninitialized. Store writes/touches,
response cookies and original object identity are observable assertions; synthetic contexts do not establish real
account/guest ORM identity or domain permission behavior. Those require the existing persistence/system boundaries.
Both fixtures close their owned infrastructure. A mocked response alone does not establish
that integration boundary. The [Development Policy](policies/DEVELOPMENT_POLICY.md#test-selection-and-evidence)
owns this bounded classification; database-backed integration retains real ORM metadata and guarded schema setup.
<!-- /delta:amendment-01 -->

## Frontend tests — amendment-02

<!-- delta:amendment-02 -->
- mounted components, scoped Query/transport consumers and draft/command state;
- initialization, localization and feedback lifetimes; and

<!-- /delta:amendment-02 -->

## Frontend tests — amendment-03

<!-- delta:amendment-03 -->
Do not assume a global browser DOM. Save and restore every global installed by the test, and dispose application
contexts, query observers, timers, listeners and object URLs so one frontend spec cannot contaminate another.

<!-- /delta:amendment-03 -->

## 3. Install Chromium and run — amendment-04

<!-- delta:amendment-04 -->
Playwright starts and stops its managed built server through `playwright.config.ts`, after configured E2E database
preparation. `reuseExistingServer: false` applies locally and in CI. Stop any existing process on the selected port
before E2E so the runner owns the compiled application and prepared database.

<!-- /delta:amendment-04 -->

## 3. Install Chromium and run — amendment-05

<!-- delta:amendment-05 -->
npm run test:all      # Vitest, build, isolated client browser and system E2E

<!-- /delta:amendment-05 -->

## Choosing the layer — amendment-06

<!-- delta:amendment-06 -->
| Client helper or mounted component | Frontend | actual browser focus/hydration or integrated session/persistence matters |

<!-- /delta:amendment-06 -->

## Archival coverage — amendment-07

<!-- delta:amendment-07 -->
## Frontend compiler and build scopes

`npm run typecheck:frontend` checks the separate Vue client and SSR configurations. `npm run typecheck:tests` uses
vue-tsc with `tsconfig.test.json` for tests and production/SFC imports reached by that graph. Vitest transpilation
does not type-check assertions or fixtures, and a test-graph pass does not certify every unimported browser source.
Server compilation belongs to `tsconfig.server.json`; Vite compilation alone is not a TypeScript check.

`vitest.config.mts` includes the exact development-runtime and session-admission files under `tests/integration/`
in its `database-free` project and excludes them from its schema-resetting `integration` project. The first combines
Express/Vite/SSR; the second combines actual Express/session middleware, production admission and an in-memory
store to protect response-completion and server-owned input checks. Neither substitutes a database-backed identity
or transaction test. `npm run test:quick` selects that project without copying discovery globs into the package
command. A focused infrastructure run uses the same project with its exact file; `test:integration` still
selects the whole integration directory and therefore includes database-backed suites. Do not describe the quick
selection as unit/client-only or infer a layer from whether its runner starts a database.

Package pre-hooks prepare generated API/localization/database inputs. Direct runners can bypass those hooks;
generate after checkout or authored contract/catalog changes. Generated compile fixtures exercise actual request,
response and problem declaration relationships, including negative cases. Do not add parallel handwritten contracts.

Source HMR, serialized contract/catalog regeneration, coherent production SSR dependencies and release/chunk recovery
cross different boundaries. Exercise the relevant owner when changed; a build or hydration marker alone does not
prove usable controls, request-local identity/locale or release replacement behavior.

## Mounted reads, drafts and commands

Use actual Query/cache/transport consumers where they uniquely detect:

- Missing pending data versus retained background content, independent regions and unknown membership counts.
- Original/local/current values, sparse normalized input and independent settings-section drafts.
- Field write loss versus readable content, actor/resource retirement and validated denial of protected projections.
- Actual fresh authority after a confirmed write; canceled retained data, idle flags and manual cache aliases are not receipts.
- Saved operations with failed follow-up reads and unknown outcomes without replay or false rollback assumptions.
- Confirmed destination/feedback retention through failed navigation, including retired command editors.
- Receipt-owned transient expiry, repeated renewal, locale reactivity and detached initiating hosts.
- Session/bootstrap dispatch admission, visibility/disclosure pause, terminal rejection and Retry-After deadlines.
- Eligible observer selection when shared-key consumers have different visibility or lifecycle.
- Aggregate totals/badges retiring with their source authority, while independently admitted siblings remain readable.
- Locale changes canceling translated families only, leaving machine authority reads and drafts intact.
- Explicit value lifetimes across warm/cold routes, actor changes and completion for text, select, checkbox and file inputs.

Hold/cancel the real post-command read to prove one write and blocked authority until a new admitted read. Equal
successful data is a valid receipt; object identity alone is not. A read cannot prove an unknown creation failed.
Preserve the submitted input and deliberate review. Commands default to no automatic replay.

Packing's local checklist is separate from server snapshots. Test unavailable/throwing storage, per-row pending writes,
healthy rereads/missing keys, visible warning lifetime and explicit local Retry. Background reads never retry writes;
list/context retirement removes temporary fallback without server persistence or a restoration promise.

Real persistence checks cover method-specific projections, touched-field comparison, authorization under locks,
assignment/capacity interleavings, relationship no-ops and changed associations. Keep finance revisions, signed
settlement evidence and recommendation fingerprints at their domain boundaries. General repository mocks cannot
establish any of those guarantees.

## Browser initialization, focus and recovery

Use isolated built-browser checks for SSR/hydration/module delivery and focus when a full backend workflow is not
needed. Use built-application E2E when actual routes, sessions, rendering and persistence are the boundary. Source
development/HMR with real server/persistence belongs to browser integration. Configuration skips are unrun modes.

Verify request-local SSR identity/locale, escaped validated bootstrap and same-tree hydration. Interactive initial
content uses shared skeletons; successful initialization reveals controls. Readable Help retains functional GET
search, links and anchors. JavaScript-only shell selectors/actions/Retry/dismiss are unavailable before initialization.
The localized startup notice must work independently of the missing/blocked entry module.

Exercise actual initial Vue setup, mount and first-readiness failures, including partial handlers: initialization stays
unconfirmed, static navigation/search remains usable and edited-control recovery retains consent. Keep this bounded
initial contract separate from later feature-error handling. Hold/reject route loading, edit genuine static early
input and verify failure/canceled recovery preserves its original control. Automatic reload needs clean state and
working loop protection; deliberate recovery respects pending/unknown work without persisting secrets/files.

File tests distinguish confirmation from rejection, unknown delivery and background reads. Confirmed upload releases
the feature File and clears the same chooser even when refresh fails; other outcomes retain both. Verify reselection
and focus/input identity instead of replacing nodes merely to make tests pass. A warm form must not display old bytes
when its new draft submits no file.

Committed identity creation requires real ORM atomicity of identity/profile/session and validated prepared output.
Failures before commit leave none of those writes; later mutable context cannot reject a committed receipt. SMTP
failure is delivery uncertainty, not failed creation or permission to replay. Exercise rollback, opposing transitions,
HTTP adoption and receipt privacy at their actual boundaries.

Visual review uses equivalent synthetic records, actors and viewport sizes. Inspect each original image and affected
control; contact sheets and capture success do not establish parity. Test actual keyboard/scroll reachability where
screenshots cannot show lower controls. Label bounded scenes and source scope; do not claim app-wide accessibility
or deployment acceptance from selected checks.

## Risk and test cost

Choose incremental protection after retained coverage:

```text
Expected harm without this test = P(regression) × impact × P(unique detection)
Cost = setup/execution time + maintenance + failure diagnosis
```

Use observed evidence when available; otherwise describe likelihood/impact and uncertainty without invented
percentages. Transfer unique observable assertions before retiring duplicates. Money, deletion, privacy,
authorization and demonstrated concurrency failures retain their consequential checks. Similar operation names or
cosmetic fixtures do not prove equivalent coverage. Run affected checks first, then broaden for a changed shared
owner, new failure or unresolved boundary. Measure preparation and diagnosis as well as case count.

## Archival coverage

<!-- /delta:amendment-07 -->

## Command matrix — amendment-08

<!-- delta:amendment-08 -->
| `npm run test:frontend` | No | No | Stubbed globals only | Client helpers and mounted component/state logic. |

<!-- /delta:amendment-08 -->

## CI passes a layer that fails locally — amendment-09

<!-- delta:amendment-09 -->
Compare Node.js, MariaDB, environment files, process-level variables, generated output and Chromium version.
The E2E runner refuses existing-server reuse; check its selected port. Workflow files and the lockfile are the
reproducibility baseline. Record the original failure and measured focused/full reruns rather than widening a timeout
or changing fixtures without establishing the cause.

<!-- /delta:amendment-09 -->

## Runner classification — amendment-10

<!-- delta:amendment-10 -->
- **Vitest integration tests** for production services/controllers against real disposable MariaDB, or genuine integration of production server components when persistence is outside the tested boundary.

<!-- /delta:amendment-10 -->

## Safety first — amendment-11

<!-- delta:amendment-11 -->
- Database-backed integration setup calls `AppDataSource.synchronize(true)` for each suite in the schema-resetting project; the separately selected server-infrastructure fixtures never initialize a database.

<!-- /delta:amendment-11 -->

## 3. Run the desired layer — amendment-12

<!-- delta:amendment-12 -->
`npm test` runs every Vitest layer, including MariaDB integration tests. It is not a database-free shortcut.
`npm run test:quick` selects the configured database-free project: unit/client checks and scoped server-component
integration. The runner configuration owns this selection once.

<!-- /delta:amendment-12 -->

## Command matrix — amendment-13

<!-- delta:amendment-13 -->
| `npm run test:quick` | No | No | Stubbed client globals; real local HTTP listeners for scoped server fixtures | Configured database-free regression selection, including server-component integration. |

<!-- /delta:amendment-13 -->

## Integration tests — amendment-14

<!-- delta:amendment-14 -->
Use `tests/integration/` when correctness depends on TypeORM mappings, transactions, constraints, relationships,
persisted queries or coordination among production services. Selected controller orchestration uses production-shaped
data. Genuine server-component integration may instead exercise actual middleware/rendering/HTTP without application
database persistence. The bounded development-runtime and session-admission fixtures use that boundary rather than
mocked HTTP delivery. Synthetic MemoryStore contexts do not establish stored application identities or ORM behavior.

Database-backed integration uses the real `AppDataSource` and production entity metadata, without general-purpose
repository mocks. The database-free infrastructure selection does not initialize that datasource.

The standard database-backed lifecycle is:

<!-- /delta:amendment-14 -->

## Choosing the layer — amendment-15

<!-- delta:amendment-15 -->
| Controller using production services | Integration | full request parsing, cookies, redirect, or view rendering matters |
| Genuine middleware/rendering/asset delivery | Integration; database-free when application database persistence is outside its boundary | stored application identities, domain workflow or ORM persistence require the integrated application |

<!-- /delta:amendment-15 -->

## Integration tests — amendment-16

<!-- delta:amendment-16 -->
Each database-backed integration file owns a clean schema for its suite. Do not rely on rows created by another
spec file. Use `tests/factories/` for valid production-shaped entities/inputs and remove arbitrary sleeps or ordering
assumptions. The scoped database-free server fixtures instead own and close their local HTTP listeners and any Vite
instance they create.

<!-- /delta:amendment-16 -->

## Vitest configuration — amendment-17

<!-- delta:amendment-17 -->
The configuration uses the Node environment and loads `tests/support/env.ts`. The `database-free` project runs
isolated unit/client files and scoped server-component integration with bounded thread workers.
The database-backed `integration` project serializes its files because each rebuilds the same disposable schema.
A full local Vitest run orders those projects so database resets do not overlap independent files. Keep database-backed
fixture resets serialized; their requirement does not prohibit isolated database-free parallelism. Exact discovery,
worker limits and project order belong to `vitest.config.mts`.

<!-- /delta:amendment-17 -->
