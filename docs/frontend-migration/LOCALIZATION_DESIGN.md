# Shared localization design
<!--
documentation-metadata
audience: maintainers; frontend developers; API developers; documentation contributors
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-19
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: typed catalog grammar and existing Activity named-slot deviation inspected against the deferred ADR choice; specific adoption approval remains pending; superseded inherited-prose exception and Help/fallback/query-locale boundaries retained
source-anchors: src/locales/; scripts/generate-locales.mjs; src/modules/localization/; src/frontend/app/context.ts; src/frontend/app/createApp.ts; src/controller/helpController.ts; docs/user-guide/en/; docs/user-guide/de/; docs/frontend-migration/FRONTEND_FOUNDATION_DESIGN.md
next-review: frontend-production-cutover
-->

One catalog per language and one typed shared translator supply Vue/server/API wording.
Use i18next with the primary i18next-vue binding. Approved D1 restores that choice after the initial adapter deviation;
request isolation, hydration and reactive locale changes remain acceptance boundaries.
[Foundation](FRONTEND_FOUNDATION_DESIGN.md) owns the original decisions and dated amendments.

## Authorized documentation boundary (2026-10-08)

Native feature guide prose/images remain the comparison reference during coexistence. Language choice is global
user guidance, not implementation information repeated in feature help. The maintainer's 2026-10-14
[amendment-staging decision](FRONTEND_FOUNDATION_DESIGN.md#authorized-amendment-staging-and-risk-mitigation-2026-10-14)
restores changed-section/fragment staging. Current approved guidance supplies unchanged content; complete temporary
output is reconciled and independently reviewed before verbatim authorized cutover. Governance/authoring rules stay active;
runtime Help belongs directly in its canonical tree.

The current direct correction explicitly promotes existing new EN/DE Help into reviewed release-owned runtime
corpora under `docs/user-guide/en/` and `docs/user-guide/de/`. This supersedes their earlier staging location
without changing native English `docs/user-guide/`. Staged maintainer documents are never application input.
[English language guide](../user-guide/en/LOCALIZATION.md) and
[German language guide](../user-guide/de/LOCALIZATION.md) belong to those runtime corpora.

## Implemented pilot boundary

English/German JSON catalogs own pilot UI/API messages. Generation discovers supported languages, checks complete
keys/parameters/plurals against authored API message policy, and emits ignored LocalizationTypes declarations and
shared runtime resources/manifest. A second language registry/backend dictionary is unnecessary.

The immutable typed translator owns locale and message lookup, wrapping an application/request-local initialized
i18next instance. Vue uses the shared provider/i18next-vue binding; API Problems use the same catalogs.
The typed translator supports plain text/cardinal plurals and a shared explicit-UTC formatter for read receipts/Retry
instants. Entity civil dates/deadlines retain their existing meaning.

The full-pilot source review found that Activity progress emphasis and the recommendation hint badge already use
i18next-vue's `TranslationComponent` with named slots. This conflicts with the
[ADR's deferred status](../decisions/DEC-006-FRONTEND-FRAMEWORK.md#deferred-localization-and-domain-integration-targets);
no specific approval for these consumers was found. They supply explicit application nodes rather than catalog HTML,
but that implementation does not authorize a supported extension. A separate direct decision is pending.

The preference currently lives in a server-issued browser cookie. PUT /api/v1/locale returns resolved session
presentation without persisting User/Guest preference or changing active profile.
Principal persistence, full Pug/email/PDF/invoice catalog integration, rich slots/context/ordinal grammar, full
regional formatting and additional scripts/fonts remain future work.

The runtime Help source now selects catalog `help.directory` under fixed `docs/user-guide/`.
EN/DE article bodies, figures and labels were moved source-preserving; required metadata records promotion.
Native English corpus/URLs/behavior remains unchanged. Final release/source/consumer verification is distinct from
this relocation and belongs to the [review](PILOT_PARITY_REVIEW.md).

## Library and ownership decisions

| Content/contract | Authoritative owner |
|---|---|
| UI/API text and declared message parameters | Complete `src/locales/<locale>.json` catalogs. |
| Literal Problem code/messageKey/typed wire params | Authored OpenAPI; locale generation checks matching catalog parameters. |
| Translator/resolver/formatting | Shared localization module; typed immutable request/recipient/app context. |
| Vue reactive binding | i18next-vue around that shared core, not a Vue-only catalog. |
| Long Help articles/anchors/search | Reviewed locale corpus under `docs/user-guide/<locale>/`. |
| Figures/captions/alt text | Reviewed assets/labels belong to the article's language; an incomplete translated article selects the entire English article and its own assets with visible disclosure. |
| Generated key/parameter/locale contracts | Ignored `src/types/LocalizationTypes.d.ts` and generated runtime manifest. |

Catalog assets contain application text, not user records/secrets. DTO fields containing user-authored text are never
translation keys. A catalog/runtime change cannot grant authorization or alter business records.

Each SSR request owns locale/app/router/query state. Preload central resources before rendering; do not mutate
a global language singleton across requests or register component-local server resources.
The original binding's SSR guidance required proof, not inferred compatibility.
[i18next-vue SSR guidance](https://i18next.github.io/i18next-vue/guide/ssr.html)

## Catalog format and adding a language

Use the English catalog's namespaces, language metadata, complete logical keys and declared parameters.
Generation discovers catalogs and derives locale choices automatically.
API parameter policy remains in OpenAPI; ordinary UI parameter declarations belong to the catalog rather than
duplicated call-site interfaces. Reject duplicate keys, malformed metadata, missing variants/parameters and raw markup.

The [Development catalog guidance](staged/DEVELOPMENT.md#localization-and-runtime-help) owns the current plain-text/
cardinal-plural grammar and browser-cookie preference scope. The
[active decision record](../decisions/DEC-006-FRONTEND-FRAMEWORK.md#deferred-localization-and-domain-integration-targets)
preserves original unsupported extensions as intended future choices. Fallback uses the shared resolver/default
catalog; call sites do not carry independent English defaultValue text or raw validator messages.

To add a supported language:

1. Add a complete catalog with matching logical keys/parameters, supported locale metadata and its fixed Help directory.
2. Prefer reviewed complete runtime articles with stable anchor metadata and equivalent localized assets/captions/alt
   text. A missing corpus/article or required figure may select the complete reviewed English article and its own
   assets; an individual figure cannot borrow another language. Verify the localized notice/English
   markers rather than require untranslated placeholder files.
3. Generate through the normal package workflow and verify typed/core/actual-consumer scope appropriate to the change.
4. Inspect every changed image independently; keep provenance outside user prose/pixels.

Generated output is never hand-edited or committed. Canonicalize tags and admit only the generated manifest.
A request can choose a supported language, never a filesystem root or arbitrary resource source.

## Locale scope and request resolution

Current requests resolve explicit supported X-Surveyor-Locale, server browser preference/negotiated Accept-Language
and the shared default as applicable. Malformed explicit preference commands fail their contract; passive negotiation
can fall back safely. Bootstrap exposes resolved choice; components do not parse HttpOnly cookies.

The original principal-preference, guest-to-account inheritance and recipient/queued-output decisions now have one
durable owner in [DEC-006](../decisions/DEC-006-FRONTEND-FRAMEWORK.md#deferred-localization-and-domain-integration-targets).
They remain intended and unimplemented. Current cookie-only behavior does not fulfill those future targets or
authorize their persistence/output changes.

Pass localization context through renderer data/explicit helpers, retaining explicit timezone policy.
Localized representations declare Content-Language/applicable Vary and private caching; Vary never authorizes data.

## API errors, validation and notifications

OpenAPI correlates stable code, literal messageKey and typed params. Known variants determine machine behavior;
localized detail is presentation only. Locale generation checks key/parameter consistency.
Unknown future errors can display validated safe detail without acting as known authority/expiry/retry outcomes.

Store keys/params and receipt identity for reactive translation, rather than rendered English strings.
The approved identity-completion adaptation applies this rule to transfer, deactivation and account/guest deletion:
existing controller branches supply typed outcome facts, including conditional former-owner cleanup; generated
completion notices use the shared catalogs and existing Vue notice lifetime. Native wording and business sequencing
remain unchanged. The [dated amendment](FRONTEND_FOUNDATION_DESIGN.md#approved-catalog-based-identity-completion-notices-2026-10-16)
retains the superseded inherited-prose exception and its approval provenance.
Locale changes neither replay commands nor renew/restore expired feedback. Raw input/validator/SQL/stack/file data
must not become catalog parameters or error details accidentally.

Existing email/PDF/shared invoice wording owners remain until their separate localization slice.
Reuse them directly instead of copying financial wording/presentation into Vue.

## Safe text, rich content and value formatting

Plain interpolation is escaped at Vue/server boundaries. Do not concatenate HTML or translate user input as keys.
Future rich content has named approved slots/components, not executable HTML from catalogs.
Help remains trusted reviewed Markdown under DEC-004 with fixed source/URI/image validation, not arbitrary content.

Preserve canonical numeric/date values independently of localized display.
Money/factors retain current exact arithmetic; language cannot round stored numbers again.
Machine civil dates/local deadlines retain their field-owned timezone/parsing meaning.
Successful-read/Retry receipts are instants displayed in selected language with explicit UTC across SSR/browser.

## Language switches and long-form Help

Activate a language only when its required catalog is available. Failure keeps current working language and Retry.
Retire reversed/obsolete locale reads; a previous language cannot overwrite the latest selection.

Translate in place while retaining dirty values, focus/selection, validation, open dialogs, IDs/pagination and
reviewed tokens. Dirty numeric input keeps its original parsing context until resolved; switching language does not
reinterpret decimal punctuation or deadlines. Locale-independent state keeps one current authority, while
language-owned Help/Overview representations have scoped keys.

After confirmed locale change, cancel/invalidate only the named language-owned families from the existing query-key
owner. Do not cancel Packing machine/edit/picker projections or their in-flight authority recovery merely to translate
labels. Matching uses the shared family definitions rather than tuple positions or another registry; identity/read
denial still retires the appropriate projections independently of language. Mounted command-recovery tests must prove
that a locale switch does not cancel the fresh machine read needed to restore its edit baseline.
`belongsToLocalizedQueryFamily` in the existing query-key owner matches the Help/Overview families without introducing
another registry of language-owned data.

Each available translated article owns its complete body/headings/titles/TOC/search snippets and stable fragment IDs.
Translated heading anchors are declared/validated from that article, not derived by loading another language.
Authored links/assets retain the selected locale and native/pilot URL family.
The direct Oct12 decision superseded the earlier complete-corpus-only implementation and permitted individual figure
fallback. The explicit Oct13 Req. 2B amendment retains fallback but supersedes that partial-page choice: a missing
localized corpus, article or referenced raster figure selects the complete corresponding article from
`docs/user-guide/en/`, with every asset resolved only from that article's own language. An English replacement must
itself be complete. Authored local references cannot name another language; asset responses never choose one.
The selected interface
locale remains unchanged. Help page data declares the actual `contentLocale` and `fallbackToEnglish`; navigation/search
summaries mark English entries. The localized fallback notice is visible in SSR, hydration and client navigation,
and article/TOC language and asset URLs identify the actual source. Mixed navigation/search includes absent translated
topics once, without replacing available translations. Existing unsafe, malformed or unreadable localized content
fails its normal validation/read rather than disappear behind an English substitute.

User prose/pixels contain tasks, exact labels and observable behavior only.
Framework/API/storage/permission/source/generation/provenance information belongs in maintainer records/ignored
evidence. Native inherited prose stays unchanged under the native-reference boundary.
Changed runtime content receives source-level review; staging never supplies articles/images/search.

## Verification

Protect catalog completeness/typed parameters/literal interpolation, request/recipient isolation and reactive
locale behavior at their real boundary. Synthetic Help fixtures specify source roots/security/anchors independently.
Selected SSR/mounted/browser consumers prove hydration, stale locale suppression, retained drafts and article/image
navigation. Optional content/visual reports inspect maintained prose without gating application delivery.
Current focused results and unrun deployment/live-provider/email limits belong only to the [review](PILOT_PARITY_REVIEW.md).
