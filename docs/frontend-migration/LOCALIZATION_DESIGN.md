# Shared localization design
<!--
documentation-metadata
audience: maintainers; frontend and backend developers; translators; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-07
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: step-three shared English/German UI/API catalogs and independent help articles and figures, locale-owned stable fragments without cross-corpus reads, generated message contracts, request-fixed translation, native help and Vue SSR/SPA; focused synthetic help and locale tests; invoice, other Pug, email, PDF, principal preference persistence and full-application localization remain planned
source-anchors: src/locales/en.json; src/locales/de.json; scripts/generate-locales.mjs; src/modules/localization/translator.ts; src/frontend/app/context.ts; src/frontend/app/createApp.ts; src/routes/api/v1.ts; src/modules/api/problem.ts; tests/unit/frontend-localization.spec.ts; tests/unit/frontend-generation.spec.ts; tests/fixtures/frontend-contracts.mts; src/modules/invoice/locales/en.ts; src/modules/invoice/wording.ts; src/modules/invoice/presentation.ts; src/modules/invoice/settlementEmail.ts; src/modules/invoice/exports.ts; src/types/InvoicePoolTypes.d.ts; src/types/EmailTypes.d.ts; src/modules/email.ts; src/modules/lib/pdf.ts; src/modules/renderer.ts; src/controller/helpController.ts; src/modules/database/entities/user/User.ts; src/modules/database/entities/user/Guest.ts; tests/unit/invoice-presentation.spec.ts; docs/DOCUMENTATION_POLICY.md
next-review: invoice-catalog-migration-or-localization-scope-expansion
-->

Use one application catalog per language, consumed by the Vue application, scoped Vue server rendering, Express
responses, transitional Pug views, email and PDF presentation. Select **i18next** as the common formatting and message
lookup engine. The pilot uses a small Vue provide/inject adapter over the shared core; **i18next-vue** remains an
option for future rich component messages. Keep domain logic, API machine values and recorded user content independent
of translated wording. The bounded implementation below does not yet provide application-wide localization.

## Implemented pilot boundary

[English](../../src/locales/en.json) and [German](../../src/locales/de.json) now each own the pilot's UI and API problem
text. [Generation](../../scripts/generate-locales.mjs) discovers complete language files, checks text/placeholder and
cardinal-plural consistency, derives API parameter types from OpenAPI, and emits ignored declarations under
`src/types/LocalizationTypes.d.ts` plus shared runtime resources/manifest under
`src/modules/localization/generated/`. No hand-maintained locale registry or second backend catalog is needed.

[createTranslator(locale)](../../src/modules/localization/translator.ts) returns an immutable `{locale, t}` context
with generated key/parameter types, runtime argument checks and plain-text output. Each call owns an initialized
i18next instance. The [Vue context](../../src/frontend/app/context.ts) exposes it through the
[application provider](../../src/frontend/app/createApp.ts); [API problems](../../src/modules/api/problem.ts) use the
same catalogs. The pilot implements plain text and cardinal plurals. Rich slots, grammatical context/ordinal forms,
shared regional/date formatters and additional script/font support remain work for later slices.

The [locale command](../../src/routes/api/v1.ts), `PUT /api/v1/locale`, issues a browser-scoped HttpOnly preference
cookie and returns the resolved session view. It does not persist a User/Guest preference or change the active
profile. Principal-owned preferences below remain the target for a later entity/migration change. Native pilot
language selection affects that response's presentation. The same generated locale manifest selects the complete
help corpus for the API, native help and both Vue entries. Invoice wording, other transitional Pug, email and PDF
have not moved to the new catalog.

English keeps the ten articles under `docs/user-guide/`; German supplies all ten under `docs/user-guide/de/`.
Each catalog declares `help.directory` relative to the trusted guide root. A new language adds a complete catalog
and its translated corpus, then runs generation; it does not require a language branch in either frontend or backend.
Large help documents remain maintained Markdown rather than JSON string literals. The centralized locale definition
binds these resources together so API results, native help and SPA cannot independently select different languages.

Document lookup retains the existing fixed source allowlist and Markdown trust validation. Each article owns its body,
headings and stable fragment IDs; translated articles declare those IDs in a `heading-anchors` metadata line such as
`1:guide; 2:first-task`. The loader checks levels and unique safe IDs against that article and never reads another
language's article to derive its anchors. Titles, TOC labels, related links, search matches and snippets come from the
selected corpus. Each corpus also owns its figures under its own `assets/` directory. Image and full-size URLs carry
the selected locale, and missing local assets fail instead of borrowing another language's image. Authored help links
retain the article's language even if their source URL contains a different locale query. UI language selection remains
an explicit user action. Vue discards article data belonging to an earlier locale. No-JavaScript GET links/forms preserve
the selected locale. These rules keep recovery and advanced sections available within every complete language corpus.

The focused [translation](../../tests/unit/frontend-localization.spec.ts),
[contract](../../tests/unit/frontend-contracts.spec.ts) and [generation](../../tests/unit/frontend-generation.spec.ts)
checks passed: concurrent fixed locales, typed parameters, literal untrusted interpolation, clean deterministic
generation, complete synthetic-language discovery and rejection of malformed catalogs. The
[compile fixture](../../tests/fixtures/frontend-contracts.mts) checks actual generated declarations with the installed
TypeScript compiler. These checks establish the shared core, not full UI, email/PDF, font or accessibility parity.

## Existing foundation and remaining work

The current [invoice catalog](../../src/modules/invoice/locales/en.ts) already centralizes many complete messages,
including plural variants. [Wording helpers](../../src/modules/invoice/wording.ts) support named interpolation and
resolve unsupported locales to English. [Invoice types](../../src/types/InvoicePoolTypes.d.ts) derive keys from that
catalog, but parameters are a generic string/number record rather than a per-message contract. The language registry
is manually authored, and the exported `invoiceLabels` object is evaluated once using English.

[Invoice presentation](../../src/modules/invoice/presentation.ts), [settlement email](../../src/modules/invoice/settlementEmail.ts)
and [PDF exports](../../src/modules/invoice/exports.ts) reuse that wording. Their shared calculation and audience
selection should remain the owners of those decisions. Introducing localization is not a reason to duplicate their
financial logic in Vue. Current money display uses fixed decimal formatting; the PDF date helper uses the host's
default locale. Neither establishes request-specific localized output today.

Other application messages still live in controllers, Pug, browser modules and the [email renderer](../../src/modules/email.ts).
The [User](../../src/modules/database/entities/user/User.ts) and [Guest](../../src/modules/database/entities/user/Guest.ts)
entities have no locale preference field. Persisted preferences therefore require entity changes and a reviewed
migration in a later implementation step. No database change is included here.

## Library and ownership decisions

i18next supplies plural rules, context selection, named interpolation, fallback and translators bound to a language.
Its Vue binding supports Vue 3 and namespace-based loading. Using that same engine in Node avoids maintaining a
second interpretation of message syntax for API responses and background output.
See the official [Vue introduction](https://i18next.github.io/i18next-vue/introduction.html) and
[i18next API](https://www.i18next.com/overview/api).

Use the native i18next JSON-v4 plural/context syntax initially. It covers the existing catalog's requirements without
an additional ICU plugin or a second placeholder grammar. Select whole sentences for grammatical context; do not
assemble a sentence from translated nouns, statuses or English suffixes. For a language requiring different phrasing,
the catalog owns each complete form. Runtime names, counts and dates remain parameters. Gender or grammatical context
must be explicit input with a neutral default; never infer a person's gender from their name. These rules follow
[i18next's whole-message guidance](https://www.i18next.com/principles/best-practices),
[plural handling](https://www.i18next.com/translation-function/plurals) and
[context selection](https://www.i18next.com/translation-function/context).

| Responsibility | Single owner in the target implementation |
|---|---|
| Human-facing wording, locale name and direction | `src/locales/<locale>.json`, one maintained file per locale |
| Full help articles | Fixed trusted corpus selected by the same catalog's `help.directory`; matching article IDs and canonical anchors |
| API error codes, literal message keys and typed wire parameters | The canonical OpenAPI 3.1 contract; generated API declarations and validators are consumers |
| UI-only message parameter shapes | English catalog metadata, once; generated declaration types are consumers |
| Locale negotiation, catalog loading and plain-text translation | A small framework-neutral module under `src/modules/localization/` |
| Vue reactivity and rich component slots | One application composable/component around the Vue binding |
| Request/recipient/output context | Express boundary or the named email/export operation; never the process default language |
| HTML, email and PDF structure | Existing owning renderers and shared components, supplied with localized text |
| Currency, attendance, permissions and financial rules | Existing domain/controller modules and versioned API contracts |

Keep the wrappers small: the typed `createTranslator(locale).t(key, parameters)` interface, shared value formatters, locale loading and
the Vue bridge. Features should not initialize i18next, negotiate languages or implement replacement regexes.
The installed toolchain is owned by [package.json](../../package.json) and its lockfile. Browsing documentation alone
does not establish compatibility with this repository's TypeScript, build and SSR configuration.

### Scoped SSR and hydration

The planned native-navigation routes use scoped Vue SSR, then hydrate the same components. Each SSR request must
create its own Vue app and i18next instance, with catalogs loaded before rendering. Ordinary Express operations can
use an initialized resource owner with `getFixedT(resolvedLocale)` behind the application wrapper; callers cannot
override that wrapper's language through arbitrary translation options. Never call `changeLanguage` on a
process-global instance from an HTTP request or mail job.

The official [i18next-vue SSR page](https://i18next.github.io/i18next-vue/guide/ssr.html) describes its guidance as largely
theoretical and excludes component-local messages and server-side reactive rerendering. Central preloaded resources
fit those constraints, but a real render/hydration proof is required. Do not use component `<i18n>` blocks or
`i18nOptions.messages`; those would also create a second catalog owner. If the binding proves unsuitable, a small
Vue provide/inject adapter over the same core preserves this design without changing catalogs or API shapes.

Bootstrap the exact resolved catalog locale, formatting locale, direction, catalog build identifier, time-zone context
and initial server-rendered data. Hydration must use that snapshot before consulting browser language preferences.
Load the required catalog before mounting. A user-language switch is a later deliberate transition, not an automatic
first-render correction. Where Node/browser `Intl` differences could change a server-rendered value, hydrate its
supplied initial display value and reformat only through an explicit client update; test the actual chosen formatters.
Time-dependent displays also need the same initial reference instant. Native no-JavaScript responses receive the same
request translator and complete labels.

## Catalog format and adding a language

Use `src/locales/en.json` as the base catalog and contract source for UI-only messages. All locale files have metadata
and a `resources` object whose keys are namespaces such as `shared`, `survey`, `event`, `activity`, `invoice`, `api`,
`validation` and `email`. Namespace boundaries organize one file; they do not create independent frontend and backend
translations. A representative fragment is:

```json
{
  "locale": "en",
  "nativeName": "English",
  "direction": "ltr",
  "resources": {
    "packing": {
      "remaining_one": "{{count}} place remains.",
      "remaining_other": "{{count}} places remain."
    },
    "shared": {
      "welcome": "Welcome, {{name}}."
    }
  },
  "uiContracts": {
    "packing:remaining": {"parameters": {"count": "number"}, "plural": true},
    "shared:welcome": {"parameters": {"name": "string"}}
  }
}
```

This fragment illustrates a future feature namespace; the pilot uses default `ui` and explicit `api` namespaces.
Simple messages without parameters need
no contract metadata. Parameterized UI messages declare their parameters once in English; translated files supply
their text forms but do not repeat `uiContracts`. Context values, and any allowed rich slot names, are also declared
once there. API-owned messages obtain their parameter shapes from OpenAPI instead and must not redeclare them here.

Use semantic, namespaced keys such as `packing:remaining`; message keys are not the displayed English sentence.
Preserve existing invoice keys under `invoice:` during the first conversion. Do not rename them merely for style.
The generator normalizes plural/context suffixes to logical message keys and checks collisions; a feature calls the
logical key with a numeric `count`, not a manually chosen `_one` key. Require the locale's applicable cardinal plural
forms, including `other`; `_zero` can supply deliberate zero wording. Different languages need different forms, so
completeness is not a raw equality comparison with English's physical suffix keys.

The locale build step discovers `src/locales/*.json` in a deterministic order, validates them, and produces
one manifest for both builds. The pilot bundles all discovered resources and records supported tags, native names,
direction and a catalog build hash. Future lazy loading can add generated load locations to this owner. Vite's
[glob import facility](https://vite.dev/guide/features#glob-import) can discover matching files without a hand-maintained
import registry. Discovery is limited to release sources, never to a client-provided path. Generated outputs follow
the repository's existing rule: regenerate them, do not hand-edit or commit ignored build products.

Adding another complete language file with messages and metadata makes its pilot labels available after the normal build
and deployment. It requires no route, enum, language menu or backend registry edit. The application language menu
comes from the same manifest. Catalogs are release artifacts; adding a file to a running installation is not a supported
runtime hot-loading mechanism. A language outside the deployed font/script capabilities may additionally require
shared font or shaping support, as described below; a catalog alone cannot supply those capabilities.

### Generated declarations and fallback

Generate `src/types/LocalizationTypes.d.ts` for message keys, the per-key parameter map, locale identifiers and
translation interfaces. Generate i18next's resource augmentation from the same catalog, if the selected binding needs
it. Do not manually recreate a key union or parameter map in frontend code. API-owned parameters reference the
generated API declarations, for example `src/types/api/v1.d.ts`; no interface is copied between the two outputs.

i18next supports declaration augmentation, but importing ordinary JSON alone does not give all the literal information
needed for strict interpolation inference. Its documentation explicitly discusses generated declarations. The
application wrapper should enforce its generated parameter map, keeping library-specific selector/generic choices
inside the adapter. This also avoids exposing rapidly changing type options to every feature.
See [i18next TypeScript support](https://www.i18next.com/overview/typescript).

Resolve a supported exact tag, then a compatible available language/script parent, then English. Do not drop a script
subtag in a way that silently chooses a different script. Use the **resolved catalog locale** for message plural rules;
an unsupported Russian request falling back to English must not apply Russian plural categories to English messages.
A supported regional request can retain its region for number/date formatting while using its base-language catalog.
This preserves the current [invoice fallback assertions](../../tests/unit/invoice-presentation.spec.ts).
The underlying fallback behavior is documented in [i18next's fallback guide](https://www.i18next.com/principles/fallback).

Production may fall back to English for missing keys or a failed optional locale load, but the wrapper reports the
missing key once and uses a known safe generic message if even the base key cannot be resolved. Do not expose raw keys,
undefined parameters or raw validator messages as normal UI text. Configure `returnNull: false`,
`returnEmptyString: false` and `saveMissing: false`; call sites must not carry their own English `defaultValue` strings. Completeness
checks should catch an incomplete shipped language before that fallback is needed.

## Locale scope and request resolution

The interface preference belongs to the **User** for a full account and the **Guest** for a recoverable guest identity.
It is not owned by the active participation profile, event or invoice pool. Switching family profiles therefore keeps
the operator's chosen interface language. A guest-to-account transition may inherit the guest preference when the
destination has none; it must not overwrite an explicit existing account preference. These are proposed preference
semantics requiring later persistence and API implementation.

| Situation | Resolution and persistence |
|---|---|
| SPA API request | An explicitly supplied, supported `X-Surveyor-Locale` selects the response language for this request; it does not silently change an account preference. |
| Explicit output-language selection | An authorized export can accept a validated locale override. Language selection never grants additional access or changes the selected business records. |
| Normal authenticated page/request | Use the principal's saved preference, then a valid browser locale cookie, then negotiated `Accept-Language`, then English. |
| Anonymous page or authentication error | Use the explicit supported request locale where supplied, then the browser cookie, negotiated `Accept-Language`, then English. |
| Language menu action | Update the local UI only after the catalog is available. An authenticated preference command also saves the User/Guest preference; the server issues the browser preference cookie. A failed preference save is recoverable without losing the current form. |
| Email | Resolve the recipient's User/Guest preference; use the initiating locale only for an identity-creation message when no preference exists, then English. Never use the organizer's current language for other recipients. |
| Background PDF or queued mail | Capture the effective locale and formatting context when the output job is created so retries do not unexpectedly change wording. Translate separately for each recipient where appropriate. |

Canonicalize tags and match only the generated manifest; malformed/unsupported preference writes return the versioned
validation error. Passive browser negotiation safely falls back. Keep the anonymous cookie limited to a locale tag,
with a bounded lifetime, `Path=/`, `SameSite=Lax` and Secure on HTTPS. It contains no identity, token or authorization
claim. Prefer a server-issued HttpOnly cookie and expose the resolved choice through bootstrap, rather than having
components parse cookies. Existing return URLs and authentication tokens must survive language preference changes.

An immutable localization context accompanies each request or output operation: catalog locale, formatting locale,
direction and explicit time-zone policy. Pass it through established renderer `data` and explicit helper arguments;
do not invent another feature-state channel in `res.locals`. SSR uses a request-local instance. Async email batching
binds each recipient's translator before awaiting delivery, preventing concurrent French and English mail from
sharing mutable language state. Newly created identities can persist the explicit registration language.

Responses containing translated content declare `Content-Language`. Locale-dependent representations must use the
applicable `Vary` headers and locale-aware server cache keys. Authenticated bootstrap, private HTML and private API
data retain appropriate private/no-store behavior; `Vary` is not authorization. Static catalog assets may be shared
and content-hashed: catalogs contain application text, never user records or secrets.

## API errors, validation and notifications

The versioned OpenAPI contract owns each error variant's stable `code`, literal `messageKey`, typed `params` and
localized problem `detail`. Model variants together so a capacity error cannot carry another error's parameter shape.
The locale build checks that every contracted key exists and uses only the corresponding parameters. Machine context
such as an item UUID may remain a required API parameter without appearing in the sentence; locale files must agree
on the placeholders they actually display. UI-only metadata
must not independently define those same wire shapes. Parameters exposed by the API are deliberate, bounded public
values; omit validator internals, submitted secrets and inaccessible foreign-record titles.

The backend always supplies a useful localized `detail`, including for non-SPA clients. A Vue client can retranslate
a known, validated key/parameter pair through the same catalog after a language switch. For a newer or unknown error,
render the server's safe text detail; never look up arbitrary keys or interpolate unvalidated arbitrary objects.
Keep code and status authoritative for control flow. No branch, test or retry decision should inspect translated prose.
Field-error paths and field names remain stable contract data, with translated labels and messages at presentation.

Controllers continue to own business checks and context-specific errors. Translate at the response boundary rather
than requiring database services to receive a locale or throw UI-specific errors. Map validation failures to named
contract errors with explicit parameters. The invoice adapter currently protects Joi's `{{#label}}` placeholders from
its own single-brace interpolation; moving directly to i18next's double braces would change that behavior. Replace
that seam with structured validation codes and localized field labels. Until converted, preserve its literal Joi
template explicitly; do not feed it through two competing interpolators.

The same approach applies to success notices and structured activity warnings. Their stable identities and provenance
remain machine data; their sentences come from shared resources. API literals such as `LAST`, `maybe`, `REQUIRED`,
permission bits and invoice state codes are never translated in storage or wire payloads.

## Safe text, rich content and value formatting

The shared `t` helper returns **plain Unicode text**, not HTML. Configure its private i18next instance with
interpolation escaping disabled only because every output sink owns escaping exactly once. This differs from
i18next's default HTML-oriented interpolation escaping; see its
[interpolation documentation](https://www.i18next.com/translation-function/interpolation).

| Output | Rendering rule |
|---|---|
| Vue | Ordinary text interpolation or text props; never `v-html` for translated/user text. |
| Transitional Pug | Escaped interpolation and explicit mixin arguments; never unescaped translation output. |
| Legacy browser modules | `textContent` and DOM attributes through their safe owning helpers. Audit existing `innerHTML` construction before supplying raw translated parameters. |
| JSON and plain-text email | Plain text; HTML entity encoding here would corrupt display or double-escape it later. |
| HTML email | The existing shared email renderer escapes labels/values and validates action URLs. Localize footer, greeting, subject and preheader through the same catalog. |
| PDF | Text runs and explicit document/link structures. Do not pass translations or user parameters to an HTML parser. |

Disallow raw HTML, executable markup, unescaped interpolation syntax and translation nesting in ordinary catalog
messages. A person's input containing braces or a message-like string remains literal data and must not become a
second translation/template evaluation. URL destinations and their allowlists belong to code, not translators.

Where a sentence needs a link or emphasis, prefer structured content already used by email/PDF or an explicitly typed
rich message. The Vue binding supports [named component slots](https://i18next.github.io/i18next-vue/guide/component-interpolation.html)
that let translators reorder a trusted link within a sentence. Restrict those messages to declared slot names; components
own tags, attributes and routes. Supply untrusted names and other values as text nodes/slots, never by first interpolating
them into the string passed to component interpolation. Parse/catalog-select the trusted message structure **before**
inserting those values, so a name such as `{helpLink}` cannot become a slot. Equivalent server/output adapters use that same
declared token structure and escaped text runs; do not maintain a separately worded HTML version. Keep rich messages
out of generic API error details and plain-label helpers.

Use shared explicit `Intl` formatters for display numbers, lists, dates and times. i18next also exposes
[Intl-based formatting](https://www.i18next.com/translation-function/formatting), but keep the app's format choices in
one helper so browser, Pug, mail and PDF agree. Format values for the selected output context before inserting them
into text when a message parameter is a display string. Retain these distinctions:

- A civil date such as attendance `YYYY-MM-DD` is not a midnight instant in the browser's zone. Parse its calendar
  parts or use a date-only formatter; do not shift it through local/UTC conversion.
- A saved instant and a deadline's local input plus IANA zone are different values. Locale does not choose the zone.
  Preserve the event's existing deadline interpretation, dual-zone presentation and explicit fallback policy.
- Financial values remain the original canonical numbers/decimal contract values. Display formatting must not change
  rounding, totals, payment direction, currency semantics or stored snapshot values. Never choose a currency or
  convert an amount from the language. Keep editable wire values independent of localized thousand/decimal separators.
- Names, descriptions, invoice notes and historical messages already saved as authored text remain verbatim. Translating
  application labels must not rewrite evidence or change another person's content.

Set document `lang` and `dir` from locale metadata; shared components use logical spacing and direction-aware layouts.
Translated text can expand, so avoid fixed-width assumptions for buttons, validation, tables and dialogs. RTL needs a
verified shared style path, not a per-language component fork. The current [PDF owner](../../src/modules/lib/pdf.ts)
registers Roboto fonts. Font glyph coverage, shaping, line breaks and RTL output must be verified for each supported
script, including email clients. This design does not claim that adding an Arabic/CJK catalog alone makes current PDF
rendering support those scripts. Establish reusable font/shaping support in the foundation; language additions within
that capability remain catalog-only.

## Language switches, data refresh and content outside catalogs

A locale switch changes presentation in place. Do not remount the entire route or overwrite form values to translate
labels. Preserve dirty drafts, focus, selection, validation state, open dialogs, selected IDs, pagination and reviewed
revisions. A count or civil date already being edited keeps its machine value. A dirty numeric draft also retains its
original parsing context until commit or cancellation: switching language must not reinterpret a comma/decimal point
or shift a deadline input. Recompute derived labels and known validation messages from stored keys/parameters; do not
retain only a rendered English string in component state.

Fetch a new catalog before activating it. On failure retain the current working language and let the user retry.
Guard against reversed responses from two quick switches. Locale-independent entity data remains in its existing
identity-scoped cache; server-localized projections include locale and catalog version in their cache identity. An
older localized read must not replace newer-language presentation. A locale change is not permission to repeat a
mutation, invalidate an invoice preview or discard an edit conflict. Profile/logout transitions still apply the
stronger identity clearing rules from the [edge-case baseline](EDGE_CASES.md).

The normal API and UI labels can be added through one language file. Long-form help is a deliberate exception:
trusted release-shipped Markdown remains under `docs/user-guide/`, following the
[help trust policy](../DOCUMENTATION_POLICY.md). Future translated guide files use a locale-aware resolver inside that
fixed tree, the existing validation boundary and stable topic IDs. Adding a UI catalog must not require translating
all help before that language is usable: show the available base-language guide with a localized language notice and
correct content `lang`. Translate help shell/search controls in the common catalog; translate guide prose and
screenshots as separate maintained content. Missing translated guides fall back predictably without arbitrary disk
lookup or remote imports. Localized headings need stable explicit section identifiers or a generated topic/anchor
mapping so a language switch does not break a contextual deep link.

## Migration and verification

1. Establish catalog discovery, generation, the typed wrapper and request/recipient context with English first.
   Add a development-only expanded/RTL test locale as a generated fixture, not as an incomplete selectable language.
   Prove one SSR/hydration route and one API error consume the same catalog.
2. Move the English invoice entries mechanically into the `invoice` namespace, converting single-brace placeholders
   and plural objects into native i18next resources. Preserve English output, message intent and all role-specific
   wording. Replace the hardcoded registry and module-level labels with context-bound helpers. Remove the old catalog
   after its adapter reads the new owner; never keep two manually maintained copies.
3. Thread that context through invoice presentation, exports, settlement mail and validation without changing
   calculation or authorization logic. Keep any temporary `invoiceText` adapter as a key/parameter adapter only.
   Preserve saved notes. Use existing invoice presentation assertions as regression evidence while adding exact
   per-key parameter and non-English cases.
4. Extract the shared shell and each migrated feature's controls, errors, accessible labels, empty states, dialogs,
   validation and outputs. Transitional Pug and browser modules consume the same keys as their Vue replacements.
   Finish each route's string inventory before advertising it as localized; mixed migration state must be recorded.
5. Ship the first complete additional language through one catalog file, then verify its UI, errors, email and exports.
   Add broader script/font support where the selected language requires it, without creating another message owner.

Catalog/compiler checks protect executable resources and generated contracts. They can be required
application build/CI checks; this is separate from the repository's **advisory documentation reports**, which remain
non-blocking. Do not add assertions against this prose or maintained guide wording to application suites.

| Check | Required evidence during implementation |
|---|---|
| Catalog integrity | Valid canonical locale metadata; no duplicate keys; complete logical keys; correct plural/context variants; valid declared rich slots; no raw markup/nesting; deterministic discovery. |
| Parameter contracts | Unknown/missing/wrong-type parameters fail type checking; OpenAPI error variants match catalog keys and placeholder names; locale variants may reorder/omit a selector in a particular form but cannot invent parameters. |
| Fallback | Exact/base/script fallback; unsupported language uses the fallback catalog's plural rules; failed optional load retains usable UI; no raw key or missing parameter displayed. |
| Concurrency and SSR | Concurrent requests and recipients use independent locales; first server/client render agrees; catalog/version mismatch recovers; switching locale preserves dirty fields and rejects old localized responses. |
| Rendering safety | Names with HTML, braces, slot markers, quotes and control characters remain data across Vue, Pug, plain/HTML email and PDF; URLs remain code-owned and validated. |
| Output parity | Existing English invoice sentences, signed balances, notes, all email sections and export labels retained; a complete second catalog produces consistent output across the browser and backend. |
| Dates and layout | Civil dates near zone boundaries, DST deadline displays, region-specific formatting, long text, native form fallback, RTL when supported, and PDF font/shaping/page-break inspection. |

The implemented pilot evidence is listed above. The remaining table entries describe acceptance evidence for later
scope: invoice/output migration, persistent principal preferences, rich messages, fonts and full rendering parity
must be verified when introduced. Passing the core tests does not establish those capabilities.
