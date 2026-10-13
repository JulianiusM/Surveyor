# Staged frontend Help governance amendment
<!--
documentation-metadata
audience: maintainers; documentation contributors; operators; AI agents
owner: documentation maintainers
status: migration-pending
last-verified: 2026-10-13
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: explicit canonical user-guide and whole-article same-language asset decisions recorded; common classification/trust/approval authority remains in live policies
source-anchors: docs/policies/DOCUMENTATION_POLICY.md; docs/decisions/DEC-004-HELP-MARKDOWN-TRUST-MODEL.md; src/controller/helpController.ts; docs/user-guide/en/; docs/user-guide/de/; tests/unit/help-documentation.spec.ts; tests/unit/help-localization.spec.ts; docs/frontend-migration/FRONTEND_FOUNDATION_DESIGN.md
next-review: frontend-production-cutover
canonical-merge-target: docs/policies/DOCUMENTATION_POLICY.md
production-reference: 2dfa257 native behavior; editorial cleanup authorized on 2026-10-12
-->

Merge this delta into the existing [policy](../../policies/DOCUMENTATION_POLICY.md) and reconcile
[DEC-004](../../decisions/DEC-004-HELP-MARKDOWN-TRUST-MODEL.md) at authorized cutover. Live policy owns common
classification, source/trust and approval boundaries; this amendment owns pilot-specific delivery consequences.

The approved 2026-10-12 restoration gives all Help one canonical `docs/user-guide/` tree. Native English remains
directly at that root; the pilot reads reviewed adjacent catalog directories such as `en/` and `de/`.
Staged maintainer drafts are never searched, rendered or served. Neither locale input nor a browser request can choose
a filesystem root. Release documentation copying remains advisory; operators deploy matching reviewed content.

The trust model is unchanged: release-shipped source review, permitted metadata comment, Markdown/URI/image validation
and fixed containment. No user/tenant/editor/upload/database/network/plugin content is admitted. Enabling an untrusted
source still requires reopening DEC-004 and implementing the corresponding threat model, sanitization and URI policy.

Complete localized Help is preferred. The Oct12 amendment allowed individual figure fallback. The explicit Oct13
Req. 2A/2B decision confirms this canonical path and replaces that partial-page behavior: a missing locale corpus,
article or required figure may select only the complete corresponding reviewed English article with its own assets.
Each article's authored local references stay in its language; asset requests cannot independently choose English.
Preserve the selected interface locale, label actual article/TOC language, and display
the localized fallback notice and English navigation/search markers. Missing topics enter results once; available
translations remain preferred. Unsafe, malformed or unreadable existing translated source fails instead of falling
back. Native source/presentation behavior is unchanged.

Synthetic application fixtures independently test native/root and pilot/catalog selection within that fixed tree,
containment, rejection and fallback consumers.
Offline reports check maintained content/inventory/packaging; a source-string search cannot certify the runtime trust
boundary. Corpus/visual reports remain optional and never become application assertions or delivery prerequisites.

Editorial consolidation may retire completed plans and repeated run history, transferring unique native contracts to
existing canonical owners and retaining decisions/open IDs. Technical pilot amendments remain staged until migration
finishes; editorial permission does not authorize native UI or behavior changes.
