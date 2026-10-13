# DEC-006: Frontend framework decision
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-13
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: original technology comparison, primary choices and dated rendering/development amendments retained; shared-operation status and shared-action/factory source adoption reconciled; execution belongs to paired review
source-anchors: package.json; vite.config.mts; src/app.ts; src/modules/frontendDevelopment.ts; src/modules/frontendPilotRenderer.ts; src/frontend/; src/views/layout.pug; docs/frontend-migration/EDGE_CASES.md; docs/frontend-migration/FRONTEND_FOUNDATION_DESIGN.md
next-review: expanded-feature-migration
-->

## Decision and scope

Use Vue 3/TypeScript, Vite, Vue Router and TanStack Vue Query while Express retains HTTP/session/backend ownership.
Keep Bootstrap-compatible appearance, native controls and suitable Reka UI primitives behind app-owned components.
Use shared i18next resources with primary i18next-vue binding and typed translator.

This is the original selected stack. It is not a benchmark or a claim that library defaults satisfy Surveyor's
permissions, capacity, revisions, financial reviews, accessibility or private-cache boundaries.
[Foundation](../frontend-migration/FRONTEND_FOUNDATION_DESIGN.md) owns original choices and dated D1–D5 amendments;
[Development](../frontend-migration/staged/DEVELOPMENT.md) owns the one contribution recipe.

## Authorized fallback and scope amendment (2026-10-08)

The original rendering decision required same-component SSR/native forms for established no-JavaScript flows.
That historical rationale remains: a static-only SPA could not preserve them.

The approved Oct8 amendment supersedes mandatory interactive no-JavaScript operation.
Interactive migrated routes require JavaScript and display a clear shared message or genuinely read-only result.
Same-component SSR/hydration remains; Help retains readable/searchable no-JavaScript GET/search.
Progressive Overview loads independent active regions after session-authorized shell rendering.
Neither amendment drops native behavior from unmigrated routes or authorizes default-route cutover.

## Why this fits the repository

Surveyor already has template composition, typed browser modules, shared UI owners and pure domain/presentation
modules. Vue's SFC/template model preserves familiar HTML while moving interactive composition into one owner.
Express keeps existing controllers/services/sessions/deployment rather than adopting a second application server.

Add isolated Vite client/SSR outputs beside native esbuild until consumers migrate.
Preserve the actual rendered Bootstrap/style baseline; installed package versions alone do not prove visual parity.
Reuse browser-safe domain owners directly, without barrels/forwarding modules.

## Alternatives considered

The original comparison used framework documentation and repository needs, not popularity or speculative speed.

| Candidate | Original assessment |
|---|---|
| Vue + Vite/Router/Query | Selected: typed SFC/template composition fits current HTML-oriented structure; integration still requires explicit routing/SSR/state/controls. |
| Svelte + Vite or SvelteKit | Strongest alternative: compile-time reactivity and Kit conventions are viable, including a custom Express host; adapting load/action/routing ownership adds migration scope. |
| React + Vite/router/query | Viable: typed JSX/composition, but another authoring model with no established repository/team advantage to offset it. |
| Angular | Viable: integrated routing/DI/typed forms, but broader conventions replace more of Surveyor's lightweight organization than reviewed needs justify. |
| Solid | Viable: signals/JSX/router, with equivalent integration/testing decisions and no demonstrated requirement advantage here. |
| Pug plus enhancement library | Rejected as target: retains separate server/client presentation for interactive features; native remains the migration reference and owns separate outputs. |

Primary references: [Vue SFC](https://vuejs.org/guide/scaling-up/sfc.html),
[Svelte TypeScript](https://svelte.dev/docs/svelte/typescript),
[SvelteKit custom server](https://svelte.dev/docs/kit/adapter-node#Custom-server),
[React application guide](https://react.dev/learn/build-a-react-app-from-scratch),
[Angular typed forms](https://angular.dev/guide/forms/typed-forms),
[Solid reactivity](https://docs.solidjs.com/concepts/intro-to-reactivity).

SvelteKit static SPA mode disables SSR; under the original fallback obligation that configuration could not
supply personalized native pages. This historical comparison is a configuration constraint, not a claim of Svelte
incompatibility or restoration of the superseded interactive obligation.
[SvelteKit SPA](https://svelte.dev/docs/kit/single-page-apps)

Do not add Nuxt merely for Vue SSR: Express already owns the relevant responsibilities and the renderer is bounded.

## Rendering and route ownership

Express explicitly authorizes recognized document routes. Request-local Vue SSR uses the same component tree,
router/query/locale state and controlled bootstrap; no self-HTTP or global private cache.
The browser hydrates and uses typed JSON/multipart inside migrated route families.

Preserve provider/token/email/print/download document boundaries and native destinations until migrated.
No wildcard HTML handling for APIs, missing assets or exports.
[Vue Router history](https://router.vuejs.org/guide/essentials/history-mode.html)

Complete component ownership at cutover prevents Vue/native scripts from competing over one subtree.
Remove native entries only after all consumers retire. SSR HTML alone cannot prove active hydration.

## Shared components without a redesign

Retain dark Bootstrap geometry, labels/order, responsive tables, focus and meaningful native controls.
Wrap repeated visual/accessibility behavior with explicit app-owned props/events, rather than one wrapper per tag or
a themed widget suite. Feature composites remain separate where survey/assignment/finance semantics differ.

The original choice uses Reka for dialog/confirmation/menu/combobox wrappers where primitives fit.
Dialogs/tabs use its focus/keyboard owners. Mixed native links and embedded controls use the shared disclosure
wrapper: public Reka menus introduce registered items/roving-hover focus, Popover introduces dialog/autofocus/
positioning behavior, and DismissableLayer is not a public export. Those differences do not fit unchanged native
navigation. This bounded fit assessment retains the conditional choice rather than silently substituting a stack.

[Reka accessibility](https://reka-ui.com/docs/overview/accessibility),
[dialog](https://reka-ui.com/docs/components/dialog)

Native inputs/checkboxes/selects/semantic tables remain appropriate.
Avoid simultaneous Vue and Bootstrap plugin DOM ownership. Exceptional legacy wrappers must isolate their subtree,
own listeners/transitions/focus and dispose fully.
[Bootstrap JavaScript](https://getbootstrap.com/docs/5.3/getting-started/javascript/)

BootstrapVueNext remains a reasonable alternative, not rejected by a stale maturity label.
Adopting a broad widget set still needs Surveyor's policy/draft/markup layer; any departure from the selected strategy
requires a demonstrated maintenance benefit and direct approval, without mixing libraries screen by screen.

## State, forms and localization

TanStack Query owns authorized snapshots, feature composables own unsaved drafts and Router owns URL state.
No initial Pinia mirror store. Capabilities remain server projections; every controller write reauthorizes.
Generic controls receive data/events/injected operations without feature endpoints or permission decisions.

Use normal bindings and field-owned normalization, generated constraints and shared command/recovery behavior.
No second validation language/schema-driven universal form engine.
[Refresh/conflicts](../frontend-migration/REFRESH_CONFLICT_DESIGN.md) owns identity retirement, polling, current-value comparisons and
financial/recommendation exceptions.

Shared i18next serves browser/server wording. The original provide/inject fallback was conditional on the primary
binding failing its proof; the spike selected it without established authorization. D1 restores i18next-vue.
Preload request-local central resources and prove locale isolation/hydration/reactivity.
[i18next-vue SSR](https://i18next.github.io/i18next-vue/guide/ssr.html)

## Build and development integration

Keep root package/lockfile and existing release shape. Vite emits separate client/SSR artifacts; native esbuild
retains its consumers. Explicit browser/bundler/server/SSR scopes prevent Node imports entering client output.
vue-tsc checks SFCs separately from Vite compilation.
[Vite backend integration](https://vite.dev/guide/backend-integration),
[Vite SSR](https://vite.dev/guide/ssr)

Express-hosted Vite middleware/HMR implements the original normal-development choice.
The earlier manual-refresh watch substitution was corrected. Serialized authored contract/catalog regeneration
restarts Express only after completion. Production runs coherent built artifacts, not Vite.
Externalized SSR dependencies remain production dependencies; generated outputs stay ignored.

D5 supersedes retained-old-asset deployment: current-folder replacement, ordinary session update detection,
compatible loaded edits, one clean idle reload and preserved mounted drafts for missing chunks/incompatible commands.
No additional operator protocol is introduced.

## Verification required for implementation

Use focused server/client/SSR/test compiler/build checks, mounted draft/read/command consumers, real persistence
where locking/authorization requires it and selected browser routes/focus/hydration/source integration.
Accessible primitives are not certification: preserve semantic labels, keyboard/focus, zoom/localized text and
small-screen behavior.
[Vue accessibility](https://vuejs.org/guide/best-practices/accessibility.html)

Compare affected native/pilot scenes with equal data/actors/viewport and disclose intended amendments.
Named shared operations and controller-owned method policy are implemented. Existing shared-action declarations
also feed native factories and v1 policy/capability consumers, rather than retaining separate copied grants.
Current source disposition and scope-specific results are in the
[review](../frontend-migration/PILOT_PARITY_REVIEW.md). No bundle-size/framework benchmark, complete migration or production cutover is claimed.
Documentation reports remain advisory.
