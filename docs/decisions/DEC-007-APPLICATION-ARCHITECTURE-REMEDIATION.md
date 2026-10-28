# DEC-007: Current application remediation boundaries
<!--
documentation-metadata
audience: maintainers; developers; AI agents
owner: project maintainers
status: current
last-verified: 2026-10-28
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: direct maintainer decisions and scope; not implementation or execution certification
source-anchors: docs/policies/DEVELOPMENT_POLICY.md; docs/policies/DOCUMENTATION_POLICY.md; docs/decisions/DEC-006-FRONTEND-FRAMEWORK.md; docs/backlog/documentation-remediation.yml; src/backend/; src/frontend/; .github/workflows/ci.yml
next-review: explicit-maintainer-policy-amendment
-->

The maintainer's 2026-10-28 reply explicitly approves the nineteen requests below from the immediately preceding
R1–R21 explanation, leaves R4 for rework, and rejects R12. These identifiers refer to that explanation only; earlier
requests reused some identifiers. The earlier instruction to review and realign the plan expressly withheld
implementation approval. This later reply supplies the bounded implementation authority.
The maintainer subsequently approves the revised R4 rule recorded below; R12 remains rejected.

## Current application and ownership

The frontend cutover is complete. Review current executable owners, callers and tests without past-commit or
former-frontend comparisons. The earlier migration-only comparison and preservation requirements in DEC-006 remain
historical and do not govern current application work. Current approved requirements and deliberate feature
differences still apply.

Controllers coordinate requests and responses. Feature modules own shared business implementation. Services own
DBAL queries, locks, transactions and persistence. The maintainer expressly applies this distinction to every
affected change. Matching Packing and Drivers controls must adopt one actual shared component implementation;
copying or relocating duplicates does not satisfy the decision.

The backlog contains backlog items only. Decisions, policies and feature references belong in their canonical
locations; plans must be presented directly in the conversation. This supersedes the former backlog classification
that included durable decisions and implementation packages. Durable requirements previously embedded there are
owned by DEC-001 through DEC-006, the development/documentation policies and the relevant feature guides. Old run
transcripts and implementation sequences are transient evidence, not additional maintained decision records.

## Approved scope

| Request | Decision |
|---|---|
| R1 | Build current SSR/client artifacts before CI integration fixtures. Preserve the three application test stages and their assertions/deadlines. |
| R2 | Reconcile the disposable CI database account to grants on the two literal integration/E2E schemas. The removed local-development grant inspector remains rejected; no replacement local checker is authorized. |
| R3 | Correct only the built-in OIDC callback default to the mounted `/users/oidc/callback`; preserve explicit configuration. |
| R5 | Make `/guest/recovery` a rendered, hydrated recovery-request entry even when local login is disabled. Reuse the existing form, command and one-time completion; preserve privacy and bounded returns. |
| R6 | Hide account-only profile deactivation from guest profile editing. Preserve Delete account and backend rights. |
| R7 | Honor validated positive whole-number registration-link Uses instead of forcing one; preserve expiry, revocation and exhaustion authority. |
| R8 | Serialize registration capacity checks under the Event root lock in the existing transaction, before pool/token work. Re-read membership/count and allow existing-member updates when full. |
| R9 | Apply the existing saved-note normalization to absent/empty dietary-note comparisons; preserve meaningful notes and deadline/date checks. |
| R10 | Project Packing title/capacity edit availability from actual mutation capabilities. Do not expand mutation grants. |
| R11 | Derive Drivers Take/Remove availability from existing self-assignment authority through the actual shared component adopted by Packing and Drivers. |
| R13 | Discover a Drivers list when the profile owns a driver row or has a passenger assignment. Preserve the distinct-passenger counter, visibility checks and deduplication. |
| R14 | Show the effective accepted amount in participant Close invoice confirmation; leave organizer confirmation, accounting and close authority unchanged. |
| R15 | Use the bundled `bi-bag-check` Packing icon. |
| R16 | Complete the final-profile account-deleted deactivation branch through ordinary local clear/save and Home completion, without selecting a nonexistent remaining profile. Preserve detached Profile/domain data and existing DB/mail order; no whole-workflow transaction or provider termination. |
| R17 | Authorize profile migration-token issuance against current captured ownership under the operation lock and prepare its completion before commit. No recipient-profile rotation or general admission persistence. |
| R18 | Recheck the submitted transfer token and expiry under the existing transfer lock immediately before consumption. |
| R19 | Include transfer, required former-owner DB cleanup and prepared completion in one operation. Prepare mail before commit and deliver afterward. Do not select or rotate the recipient's active profile/context. |
| R20 | Atomically complete token-free local User/Guest deletion, required local session persistence and prepared receipt through the existing identity completion owner. Preserve domain cascades/proof ownership. Provider-bearing deletion is outside this approval. |
| R21 | Preserve local-clear-first logout. After confirmed local persistence, provider destination/discovery failure returns local signed-out confirmation plus an unconfirmed-provider warning. Retire browser private state; do not restore identity, replay logout or claim provider termination. |

## Unapproved and rejected scope

R4's proposed UTF-16 minimum and ASCII letter/digit composition were not approved. The maintainer requires an
explanation and revised proposal. Existing JavaScript length counting and UI guidance are implementation facts,
not a database encoding requirement or authority for a new password policy. No password admission/hash change is
authorized by the nineteen approvals.

**Subsequent direct approval of revised R4 (2026-10-28):** the maintainer explicitly approves the revised request
presented after those nineteen implementations. Newly registered and reset passwords require at least 15 Unicode
code points, with no letter/digit composition requirement, and may contain at most 72 UTF-8 bytes to avoid bcrypt's
silent truncation. One shared credential policy supplies business admission, authored API validation and displayed
guidance. Exact entered passwords, the existing hash algorithm and existing-password login remain unchanged;
trimming, normalization, prehashing and credential migration are outside this approval. The byte ceiling limits some
Unicode passphrases below the recommended 64-character allowance; this bounded admission update is not a claim of
full NIST compliance. This supersedes only R4's pending state and does not approve the earlier UTF-16/ASCII proposal.

R12's explicit assignee display on Everyone Packing items is rejected: named assignees could cause others to skip
their own packing obligation. No replacement display, deletion of assignments, counter change or assignment-rule
change is authorized. Existing records remain intact.

Broader session/flash redesign, provider-bearing deletion finality, unrelated profile edit/create strengthening,
operational deployment rehearsals and other open backlog items retain their separate scope. Approval here does
not certify implementation, tests, a hosted CI run or deployment; those require their own evidence.

## Production-review decisions (2026-10-28)

The maintainer's subsequent production-review reply resolves the R1–R5 requests from the immediately preceding
production-check answer. Those identifiers are local to that answer and do not replace the earlier R1–R21 mapping.
The original decisions above remain recorded.

For R1, provider email trust remains an operator decision. Automatic email linking is explicitly controlled by
`OIDC_LINK_BY_EMAIL`, default false. An operator's opt-in is respected without imposing an additional
`email_verified` requirement. For R2, replacing an existing provider binding requires a separate
`OIDC_ALLOW_EMAIL_REBINDING` setting, also default false and effective only when email linking is enabled. The existing
identity feature owns the decision; the existing DBAL transaction serializes candidate binding checks and writes.
Exact provider-identity login and unrelated session/provisioning behavior retain their scope. Operator guidance
explains both choices and their consequences instead of making provider trust an application-wide prohibition.

The maintainer approves R3's 50-Unicode-code-point maximum for the local account registration username and display
name, without introducing trimming or changing storage. One authored registration-name schema owns the rule consumed by
generated browser/server validation and the existing identity business guard. Native controls must not impose a
stricter UTF-16-unit cap. Guest registration, profile creation/editing and provider display-name policy remain
separately scoped; this approval does not lift the earlier exclusion for unrelated profile strengthening.

The maintainer approves R4's shared civil-date boundary correction: complete date keys and terminating inclusive
Activity/Event loops at the accepted upper-year endpoint. Preserve shared UTC ownership, ordinary invalid-date
errors, reversed/leap-day behavior and stored date contracts. This does not approve a maximum Activity duration or
calendar pagination policy.

R5 authorizes this review's production-dependency vulnerability audit and its registry metadata export. It supplies
no approval for dependency changes or a blanket future export permission.
