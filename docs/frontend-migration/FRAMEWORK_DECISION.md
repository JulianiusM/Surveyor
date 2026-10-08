# Frontend framework decision
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-08
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: approved D1–D5 rectification source/ownership and documentation consistency review; actual execution evidence remains in the paired review record; framework selection from step two, with the Vue/Vite packing and help SSR proof now implemented in step three; benchmarks and broader route cutover remain pending
source-anchors: package.json; esbuild.client.js; tsconfig.json; tsconfig.server.json; tsconfig.test.json; vitest.config.mts; playwright.config.ts; .github/workflows/ci.yml; .github/workflows/release.yml; src/app.ts; src/views/layout.pug; src/public/style/; src/public/js/; docs/frontend-migration/EDGE_CASES.md; docs/frontend-migration/BEHAVIOR_INVENTORY.md
next-review: broader-feature-migration-or-measured-framework-limitation
-->

## Decision and scope

Choose **Vue 3 with TypeScript single-file components, Vite, Vue Router and TanStack Vue Query**. Keep Express as
the HTTP, authentication and backend owner. Build a small Surveyor component library using the existing Bootstrap
appearance, native HTML controls and selected Reka UI primitives for complex interaction. Use shared i18next
resources with **i18next-vue** and the typed shared translation interface, as defined in the
[localization design](LOCALIZATION_DESIGN.md).

The normal interactive experience is an SPA: client navigation, data reads, periodic refresh and mutations update
the existing document. Preserve deliberate native fallbacks through **selective Vue server rendering of the same
components**, followed by hydration when JavaScript is available. This supersedes a static-only SPA proposal:
overview native search/filter/hidden links, survey voting and help search cannot disappear to simplify the stack.
The final frontend has one component owner for each screen; duplicated Pug and Vue feature views are transitional.

This record owns the framework selection. The [step-three pilot](../FRONTEND_PILOT.md) now implements Vue packing
and same-component help SSR, with installed versions pinned in the root package/lockfile and executable compiler,
build and browser evidence. Broader feature parity and measured performance remain future work.
The [foundation design](../FRONTEND_FOUNDATION_DESIGN.md) owns the overall architecture,
contract, rollout and pilot. The [baseline](../FRONTEND_MIGRATION_BASELINE.md) and its 121 recorded
[edge cases](EDGE_CASES.md) govern parity; framework convenience does not override them.

## Why this fits the repository

Surveyor already has strict TypeScript, functional feature modules, reusable Pug mixins and pure shared invoice
presentation/wording code. Vue's HTML-oriented templates provide a direct way to express the existing conditional
markup, slots and form controls, while typed component props and composables replace imperative DOM coordination.
This is a fit judgment based on the source, not evidence that maintainers already know Vue or that migration requires
less measured effort than another framework. Vue documents TypeScript support in SFCs, a Vite-based toolchain and
separate `vue-tsc` checking. [Vue TypeScript guide](https://vuejs.org/guide/typescript/overview.html)

| Repository evidence | Design consequence |
|---|---|
| [Browser build](../../esbuild.client.js) emits independent `.gen.js` entries and explicitly shares pure invoice modules. | Add a separately owned Vue build; keep the existing output graph until its consumers migrate. Reuse pure domain/presentation owners directly instead of copying them into components. |
| [Express app](../../src/app.ts) owns sessions, middleware, static assets, Pug routes and error handling. | Keep one public origin and the existing backend. Introduce versioned JSON endpoints and selected Vue page rendering behind existing authorization boundaries. |
| [Layout](../../src/views/layout.pug) loads Bootstrap CSS/JS 5.3.3 and jQuery 3.6.0 from CDNs, while [package declarations](../../package.json) contain different versions. | Preserve the rendered baseline deliberately. Installing the declared package version is not proof of visual equivalence; dependency upgrades and asset-hosting changes need explicit checks. |
| [Styles](../../src/public/style/style.sass) depend on Bootstrap utilities, variables, responsive tables and feature hooks. | Retain dark styling, spacing, table behavior and breakpoints initially. Consolidate component styling without introducing a new visual theme. |
| [TypeScript configuration](../../tsconfig.server.json) inherits NodeNext and server decorator support. | Give the browser and Vue SSR entries their own configurations. Do not change the server module system or TypeORM compilation to accommodate a frontend starter template. |
| [CI](../../.github/workflows/ci.yml) builds the application before browser workflows; [release packaging](../../.github/workflows/release.yml) ships `dist` and omits development dependencies. | Produce browser assets and a Vue server-rendering entry inside `dist`; retain runtime SSR dependencies in production packaging. Keep Vite a build/development tool. |
| [Existing tests](TEST_COVERAGE.md) use Vitest and Playwright with important behavior already asserted. | Extend those runners at the cheapest relevant layer; migrating framework does not require replacing the test strategy. |

## Alternatives considered

All candidates can consume a versioned JSON API, use a shared JavaScript localization runtime and preserve Bootstrap
CSS. None supplies Surveyor's permissions, revisions, capacity rules or financial review semantics automatically.
The choice is about composition and integration cost, not a framework benchmark.

| Candidate | Relevant strengths | Tradeoff for Surveyor and decision |
|---|---|---|
| **Vue 3 + Vite + Vue Router** | Typed HTML-oriented components, composables, an official router, and a documented Vue SSR API that can render into Express responses. [Vue TypeScript](https://vuejs.org/guide/typescript/overview.html), [Vue SSR](https://vuejs.org/guide/scaling-up/ssr.html) | **Selected.** Fits the current template/module split and leaves backend ownership intact. We accept explicit setup for scoped SSR, accessible primitives and query policy; Vue alone does not solve these. |
| **Svelte 5 + Vite; SvelteKit where routing/SSR is needed** | Concise HTML/CSS components, typed props, reusable reactive logic and compiler accessibility diagnostics. SvelteKit supplies routing, rendering and native form conventions. [Svelte TypeScript](https://svelte.dev/docs/svelte/typescript), [compiler warnings](https://svelte.dev/docs/svelte/compiler-warnings) | **Strongest alternative.** Runes/snippets introduce a new authoring model, just as Vue introduces its own model. Plain Vite needs an explicit routing/SSR integration choice; Kit gives more of that structure but requires adapting its route/load/action ownership to existing Express controllers. Kit can be mounted in a custom Express server; incompatibility is not the reason for rejection. [Kit custom server](https://svelte.dev/docs/kit/adapter-node#Custom-server) |
| **React + Vite + a router + query library** | Typed JSX components and explicit composition; React's own guide identifies routers and purpose-built data libraries for a standalone application. [React application guide](https://react.dev/learn/build-a-react-app-from-scratch) | **Viable, not selected.** Adds a JSX/rendering model to a template-heavy migration while still requiring the same state, SSR and UI decisions. There is no established React code or demonstrated team preference here to offset that extra change. This is not a claim that React is inherently less maintainable. |
| **Angular** | Integrated routing, dependency injection and strictly typed reactive forms offer a prescribed structure for a large application. [Angular routing](https://angular.dev/guide/routing), [dependency injection](https://angular.dev/essentials/dependency-injection), [typed forms](https://angular.dev/guide/forms/typed-forms) | **Viable, not selected.** Its broader application conventions would replace more of Surveyor's current lightweight module organization. The reviewed needs do not justify that additional migration scope. Preserve native browser controls and shared contracts without adopting a second extensive application architecture. |
| **Solid** | Typed component development, signal-based reactivity, JSX and a router can support the same interaction model. [Solid reactivity](https://docs.solidjs.com/concepts/intro-to-reactivity), [Solid Router](https://docs.solidjs.com/solid-router/getting-started/installation-and-setup) | **Viable, not selected.** Requires another JSX/reactivity integration and equivalent SSR, component and testing decisions. The baseline identifies no requirement for which those differences provide a concrete advantage over Vue. No popularity or performance assumption is used. |
| **Keep Pug plus an enhancement library** | Reuses current native routes and initially changes less markup. | **Rejected as the target.** It retains separate server templates and dynamic client presentation for the same interactive feature, leaving the principal maintenance problem unresolved. Existing Pug remains useful only during feature migration and for separately owned output formats. |

SvelteKit's static SPA mode explicitly disables SSR for client-rendered pages. That configuration cannot serve the
personalized native fallback pages required here; dynamic rendering would still be needed. This is a constraint on
the configuration, not a limitation of Svelte. [SvelteKit SPA documentation](https://svelte.dev/docs/kit/single-page-apps)

Do not introduce Nuxt merely to obtain Vue SSR. Express already owns authentication, controllers, sessions and
deployment, and the proposed renderer has a narrow compatibility purpose. Nuxt could reduce custom application
plumbing if that scope later expands, but adopting another server/routing framework now would enlarge the integration
boundary. The foundation must prove its limited renderer remains understandable; revisiting this decision is warranted
if it grows into a general framework of its own.

## Rendering and route ownership

Vue can render components on the server and hydrate the resulting markup in the browser. Its documentation also
identifies request isolation, browser-only APIs and hydration consistency as implementation concerns.
[Vue SSR](https://vuejs.org/guide/scaling-up/ssr.html)

Use one route definition and one feature component tree, with an explicit delivery policy for initial requests:

1. **Native-capable routes:** Express authorizes and prepares a contract-shaped snapshot, then the Vue server entry
   renders the page. The same controls have real links and form `action`/`method`/`name` attributes. Without JavaScript,
   approved native requests return another server-rendered document; after hydration, Vue handles ordinary navigation
   and API submissions in place. Overview, survey voting and help are mandatory examples. Apply the
   [route inventory](ROUTE_INVENTORY.md) to authentication, recovery and profile native flows too; a list of three
   examples must not become permission to drop other functional native behavior.
2. **Interactive routes with no established native fallback:** Express supplies the authorized application shell and
   Vue loads the required resource. Do not imply that current JavaScript-built creation rows or invoice dialogs have a
   no-JavaScript implementation. Route-local loading, unavailable and error states remain explicit.
3. **Protocol and separate-output routes:** OIDC callbacks, activation/recovery/token handling, downloads, print views
   and PDFs remain their appropriate HTTP/document operations. Normal browser navigation is correct for external
   identity handoffs and separate exports; routing everything through SPA fetch would change their meaning.

Native form adapters and API handlers call the same controller-owned operations. They differ only in transport,
validation presentation and response delivery; they do not duplicate business checks or access the database from
Vue components. Native success redirects to a Vue-rendered route. Migration removes the old Pug feature view once
the entire route family meets its behavior requirements. Keeping native form transport is compatible with the
uniform component frontend; server-generated AJAX HTML fragments are not part of the target.

Create the Vue app, router, translation context and query client per SSR request. Pass only authorized, serializable
read models to the renderer; never serialize session entities, credentials, private recovery tokens or unrelated
cached resources. Escape the bootstrap payload for its HTML context and use the same initial locale, timezone
policy, stable IDs and data on both sides. Browser storage, timers, observers and interactive portals start only in
the appropriate browser lifecycle. Authenticated SSR HTML is private and must not enter a shared response cache.
These are implementation acceptance requirements, not existing protections established by this design review.

Use web history in the browser and memory history for SSR. Preserve current query parameters, fragments, useful
back/forward state and direct links. Express must recognize migrated page routes explicitly, authorize initial reads
and return real errors for unknown or forbidden paths; do not apply a blanket HTML fallback to `/api`, tokens,
downloads or missing assets. Vue Router documents the history modes and direct-link server requirement.
[Vue Router history](https://router.vuejs.org/guide/essentials/history-mode.html)

## Shared components without a redesign

The library is Surveyor's small collection of named components, not a new general-purpose design system. Feature
developers consume its stable props/events/slots and do not coordinate DOM elements through IDs, jQuery or global
initializers. Start with components justified by repeated behavior:

| Shared owner | Responsibility and boundary |
|---|---|
| `AppShell`, `PageHeader` | Navigation, active profile, contextual help, titles, landmarks, responsive layout and common feedback area. |
| `ActionButton`, `FormField`, `FieldErrors` | Existing Bootstrap appearance, semantic button/link distinction, labels/help/errors and pending state. Native inputs remain native. |
| `AppDialog`, `ConfirmDialog` | Modal layout, controlled open state, focus return, keyboard behavior and explicit close policy. Feature code supplies the action and draft decision. |
| `StatusNotice`, `ResourceState` | Loading, empty, stale, failed refresh, validation and persistent action outcomes. An uncertain upload is not a transient success toast. |
| `EntityHeader`, `EntityCard` | Shared entity identity and common visual arrangement; accept server-supplied capabilities and typed lifecycle projections. They do not calculate permission masks. |
| `PagedEntitySelect`, `TimezoneField` | Repeated selector interaction, controlled value and accessible search. Feature queries preserve bounded authorized results; timezone semantics remain in shared domain logic. |
| Feature-owned editors and tables | Survey combinations, activity assignment grids and invoice settlement review compose these primitives. Preserve deliberate exceptions instead of forcing them into one configurable mega-form or mega-table. |

Use **Reka UI behind the dialog, confirmation, menu and combobox wrappers** where its interaction primitives fit.
It documents keyboard/focus and ARIA responsibilities, and exposes unstyled components. Surveyor still supplies
layout, visual states, labels and integration checks. Preserve Bootstrap classes/variables where appropriate and
add the small wrapper styles required for overlays, positioning and transitions; an unstyled primitive does not
automatically reproduce Bootstrap geometry. [Reka accessibility](https://reka-ui.com/docs/overview/accessibility),
[styling](https://reka-ui.com/docs/guides/styling), [dialog](https://reka-ui.com/docs/components/dialog)

Prefer native text fields, checkboxes, selects and semantic tables when they meet the existing behavior. Do not
replace a native field with a complex widget simply because the library includes one. Use stable, documented
primitive APIs; adopting experimental date widgets is unnecessary to preserve Surveyor's date/time rules.

**Bootstrap JS is not the target interaction owner.** Bootstrap itself warns about simultaneous framework/plugin
DOM mutation. During transition, an exceptional wrapper may own an isolated legacy subtree, instantiate its plugin
after mount and dispose listeners/instances before removal. Such a wrapper must also handle pending transitions
and focus cleanup. Do not let Vue conditionals and Bootstrap data-API handlers manage the same modal or dropdown.
Full legacy pages can retain their existing scripts until cutover. [Bootstrap JavaScript guidance](https://getbootstrap.com/docs/5.3/getting-started/javascript/)

BootstrapVueNext is a reasonable alternative to the chosen primitive layer and explicitly targets Vue with
Bootstrap 5. It is not rejected using Bootstrap's potentially stale maturity label. For this migration, keeping
the small app-owned API and selected headless interactions gives more control over existing special dialogs,
pending/dirty rules and markup. Adopting a broad themed widget suite would still require that application layer and
visual checks. Reconsider a particular component if its total maintained code is demonstrably smaller with
BootstrapVueNext; do not mix widget libraries screen by screen. [BootstrapVueNext introduction](https://bootstrap-vue-next.github.io/bootstrap-vue-next/)

## State, forms and shared-data refresh

Keep three kinds of state distinct: authorized server resources in TanStack Query, unsaved drafts in feature
composables, and durable navigation state in Vue Router. A small injected application context holds current identity
and locale. Do not add Pinia initially or mirror query results into another store. Add a store only for a demonstrated
shared client-only responsibility that the existing owners cannot express clearly.

TanStack Query provides configurable refetch-on-focus/reconnect, periodic intervals and cache invalidation.
Its defaults require deliberate configuration; cached data is initially stale and failures can retry. The
application must explicitly distinguish safe read retries from commands and identity/permission failures.
[TanStack Query defaults](https://tanstack.com/query/latest/docs/framework/vue/guides/important-defaults)

The [refresh and conflict design](REFRESH_CONFLICT_DESIGN.md) owns intervals, identity isolation, revision contracts
and recovery. Components follow these rules:

- Resource keys include the active identity/profile context, entity and applicable filters/cursors. Switching
  profile, logout or revoked access invalidates private context; a late response must not repopulate the old view.
  SSR query clients are request-local, with a controlled initial snapshot. The library documents SSR hydration,
  but Surveyor must enforce the authorization boundary. [Vue Query SSR](https://tanstack.com/query/latest/docs/framework/vue/guides/ssr)
- Background refresh updates clean views without replacing dirty values or an overlapping comparison baseline. A failed
  refresh keeps confirmed visible data marked stale; a confirmed successful save followed by failed refresh does
  not become a failed save. Navigation and dialog close resolve unsaved drafts explicitly.
- Ordinary resource changes use the approved touched-current-value comparison protocol and offer explicit conflict
  resolution. Shared component code must not assume a last-write-wins update. Current property checks are narrower
  than a general old-form revision check; see [identity/lifecycle cases](IDENTITY_LIFECYCLE_EDGE_CASES.md).
- Financial previews, recalculation, settlement, payments/refunds, upload uncertainty and recommendation reviews
  retain their distinct server protocols. Do not optimistically finalize money, auto-merge reviewed amounts, replay
  an uncertain upload or automatically rebase a reviewed command. Reuse visual primitives, not a generic conflict
  algorithm. See [invoice cases](INVOICE_EDGE_CASES.md) and [participation cases](PARTICIPATION_EDGE_CASES.md).
- Capabilities are server projections for this actor and resource. UI visibility and disabled controls improve
  usability but never authorize a write. Owner, assigned administrator, cumulative grants, archive, personal hide
  and permanent deletion remain separate concepts. Refresh capabilities along with mutable context.

Use normal Vue bindings with an application form composable for original values, changed fields, pending state and
server field errors. Start without a schema-driven form generator or a second validation language. Reuse the
contract's runtime constraints for suitable immediate feedback and submit only deliberate changes; the controller
still owns authorization and contextual validation. Preserve omitted versus empty versus false values and separate
drafts inside the settings dialog. Complex feature forms retain named feature logic.

Localization is not a deciding advantage of any candidate. The shared catalog/runtime can serve browser components,
Express validation, SSR, email and exports. Vue's adapter must react to locale changes without copying translation
resources into a Vue-only dictionary; per-request server locale prevents one user's choice affecting another.
i18next documents browser/Node use and multiple framework integrations.
[i18next getting started](https://www.i18next.com/overview/getting-started),
[supported frameworks](https://www.i18next.com/overview/supported-frameworks)

The i18next-vue SSR guidance describes its advice as largely theoretical and excludes component-local message
registration and server rerender events. Preload central resources before rendering and prove request isolation and
hydration with the selected versions. The originally described provide/inject fallback was an alternative, not
authorization to replace the primary binding. The pilot initially selected it without approval; approved D1 restores
i18next-vue while keeping the typed translator and shared core. Any future substitution needs active user approval,
a recorded amendment and equivalent request-isolation/hydration evidence.
[i18next-vue SSR guidance](https://i18next.github.io/i18next-vue/guide/ssr.html)

## Build and deployment integration

Keep the existing npm workflow and release shape. Add dedicated Vue browser and SSR entries instead of replacing the
application with a generated starter repository. Vite documents backend manifests, separate server/client entries,
SSR production builds and Express middleware during development.
[Vite backend integration](https://vite.dev/guide/backend-integration), [Vite SSR integration](https://vite.dev/guide/ssr)

The pilot gives each emitter a separate output directory: browser assets under
`dist/public/app/` and a nonpublic Vue renderer under `dist/frontend-server/`. Existing esbuild continues to own
`dist/public/js/` until its callers migrate. Build cleanup must never erase another emitter's files. The client
manifest identifies hashed browser assets; an SSR manifest can identify preload dependencies. Express loads the
renderer and manifests from the deployed release, with explicit module-format compatibility with the current server.

Use a dedicated browser TypeScript configuration with DOM/bundler settings, a Vue SSR entry configuration, and
explicit server exclusions so `tsc` does not accidentally compile browser files or SFC imports. Preserve strictness
and existing declaration-file contracts. `vite build` does not replace SFC type checking: add `vue-tsc` to application
verification. Confirm the chosen Vue tooling against the repository's actual TypeScript and Node versions during
implementation; reading compatibility guidance is not an executed compatibility check.

The primary development choice is implemented through Express-hosted Vite middleware and HMR. The earlier
manual-refresh watch builds were an unauthorized substitution, corrected by the approved rectification. The root
workflow watches authored contracts/catalogs, regenerates dependent artifacts in order and restarts Express only
after completion. Express retains request ownership and cookie behavior. Production runs the existing Node
application with built assets and the built Vue renderer, not a Vite development server. Packages externalized by
the SSR build must be production dependencies; release packaging currently removes development dependencies. Keep
browser bundles free of database entities, server settings, secrets and Node-only imports. Any changed browser
support baseline needs a deliberate compatibility decision instead of silently accepting a tool's default target.

Route migration is incremental but component ownership is complete at cutover. A mixed release can navigate between
legacy and migrated route families through ordinary links; it must not mount two competing frontend owners on one
feature subtree. Remove a legacy browser entry only after all its consumers move. The pilot establishes the
foundation and tests a narrow feature path; it does not authorize removal of the rest of that feature's legacy route
family before parity is met.

## Verification required for implementation

The [testing guide](../TESTING_GUIDE.md) and [coverage map](TEST_COVERAGE.md) remain authoritative for layer selection.
Vue documents Vitest and Vue Test Utils for component checks; integrate an appropriate DOM environment for those
tests instead of changing the current Node test environment for database suites.
[Vue testing guide](https://vuejs.org/guide/scaling-up/testing.html)

Use focused application checks for the new boundaries:

- Type checking and production builds verify SFC props, shared contracts, browser/server import separation, manifests
  and the production renderer with development dependencies absent.
- Component checks exercise dirty-draft retention during refresh, changed-field submission, capability updates,
  independent settings drafts and confirmed/uncertain command outcomes. Test observable behavior rather than Vue
  internals or snapshots that only repeat the implementation.
- Browser checks protect direct URLs, back/forward/fragments, modal focus and pending locks, responsive tables,
  desktop/mobile visual parity, and same-document navigation inside a migrated route family.
- Two browser contexts verify profile/cache isolation, another client's edit or permission revocation, capacity
  conflicts and financial stale-review handling at their real server boundary.
- Native-mode browser checks verify the explicit overview fallback, survey voting and help search, plus other
  established native flows when their route family migrates. Check rendered SSR output and successful hydration
  separately, including consistent locale and absence of cross-request private data.

Accessible primitives are a foundation, not an accessibility certification. Preserve meaningful labels, native form
semantics, keyboard operation, focus restoration, headings and route-change announcements; verify zoom, long
localized text and small screens. Vue's guide explicitly covers semantic forms and focus after navigation.
[Vue accessibility guide](https://vuejs.org/guide/best-practices/accessibility.html)

The original step-two decision used official documentation and repository review. The implemented step-three
[pilot](../FRONTEND_PILOT.md) now provides actual build, type, application-test and
[paired visual evidence](PILOT_PARITY_REVIEW.md). There is no framework bundle-size comparison or performance
benchmark. Broader route replacement still requires each feature's complete permission, behavior and visual review.
