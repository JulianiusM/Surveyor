# DEC-007: Current application remediation boundaries
<!--
documentation-metadata
audience: maintainers; developers; AI agents
owner: project maintainers
status: current
last-verified: 2026-10-29
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

## Approved production remediation (2026-10-28)

The maintainer subsequently instructs full implementation of the immediately preceding **A1–A21** explanation
and its prose plan. These identifiers belong to that answer only. The original choices above remain historical;
the following bounded approvals supersede their named exclusions, not unrelated decisions.

| Request | Approved decision and direct amendments |
|---|---|
| A1 | Include provider-bearing account deletion, required local session clearing and prepared completion in the existing atomic identity operation; prepare mail before commit and report later delivery/provider outcomes separately without replay. |
| A2 | After reproducing the backend pairing defect, persist explicit swap/independent-move provenance through the shared recommendation owner and reviewed migration. Legacy reciprocal moves require explicit organizer resolution; reciprocal slots never establish intent. |
| A3 | After reproducing premature or failed destruction completion, correct the existing session-store adapter to await actual deletion and propagate errors once, retaining soft-delete and ordinary logout behavior. |
| A4 | Configurable login budgets: 30 client attempts and 10 failures per account per 15 minutes. The maintainer additionally requires one shared client failure budget across password values, usernames and email identifiers: changing an identifier must not restore attempts. Reuse resolved account identity for accepted aliases; never retain password values as counter keys. |
| A5 | Configurable local-signup budget, initially 10 client attempts per hour, through shared admission before expensive work/writes. |
| A6 | Configurable guest-creation budget, initially 20 client attempts per hour across all five feature entries. The maintainer additionally requires actual shared components/flow ownership and removal of any duplicate implementation discovered there. |
| A7 | Configurable identity-mail budgets, initially 10 client attempts per 15 minutes and three recipient/account attempts per hour, preserving privacy and preparation/finality. |
| A8 | Configurable guest-email lookup budget, initially 30 client attempts per 15 minutes. Preserve the admitted lookup contract. |
| A9 | Shared 50-Unicode-code-point guest-name bound before writes, preserving exact input and existing data. |
| A10 | The same authored bound for profile creation/rename within the existing lifecycle; no wider profile transaction redesign or trimming. |
| A11 | For newly provisioned provider accounts, project the first 50 Unicode code points for display-only User/Profile names. The maintainer requires A9–A11 and the prior login/name correction to share actual schemas, validation and components rather than duplicate implementations. |
| A12 | Assemble from the immutable tested application revision, allow only the version bump and abort publication if the selected branch advanced. |
| A13 | Build/package/validate before publishing branch/tag references together; preserve source/archive identity and report later asset-publication failure without moving/reusing tags. This is implementation authority, not a real release request. |
| A14 | Default maximum 366 inclusive Activity days for new plans or increased duration; existing longer plans may shorten without first meeting the cap. The maintainer additionally requires this maximum to be configurable through the existing settings module. |
| A15 | Saved plans exceeding the configured duration threshold use selectable calendar/print windows of at most 42 days, preserving saved data, participation and drafts. |
| A16 | Shared upload transport distinguishes expected client rejection from infrastructure server failure with bounded diagnostics, retaining admission, proof ownership, cleanup and single-attempt delivery. |
| A17 | Byte-exact primary provider issuer/subject lookup through the existing UserService, preserving email settings/projections and stored values; no automatic ownership reconciliation or schema change. |
| A18 | Serialize Finance management authorization and matching grant writers with Event-before-pool locks; recheck current authority in the write transaction and preserve financial rules and intentional method/public exceptions. |
| A19 | Activate the existing seven-part D04V isolated verification only if possible in this environment and with its official-release, matching-tagged-source, supported-runtime, disposable-data and controlled-side-effect prerequisites. No production/staging/shared deployment is authorized. |
| A20 | Preserve full diagnostic logging. Redact only actual secrets precisely **in place**, retaining original URL structure, nonsecret values and existing method/status/timing evidence. Removing logging, whole queries or whole URL details is prohibited; external/historical log actions remain separately scoped. |
| A21 | Above the configured Activity threshold, preserve requirement data in read-only pages of at most 100 rows; disallow whole-plan requirement editing/calculation until within that threshold, without discarding saved values. |

The approved prose plan also includes remaining behavior-preserving metadata consolidation, diagnostic reproduction,
current permission/session/flash inventory, complete live-caller adoption, appropriate production checks and independent
semantic review. These approvals do not certify execution or resolve unavailable environment prerequisites. Record
findings and concise verified dispositions in the backlog; implementation plans and questions remain in the final answer.

## Approved migration preservation repairs (2026-10-28)

The maintainer explicitly approves **A22** and **A23** from the immediately preceding final answer and requires
that neither database nor migration changes lose data. A22 repairs the pending item-owner references through the
existing shared migration helper, retaining populated compatible values and admitting incompatible physical storage
only when every child value is NULL. A23 preserves proven Profile ownership on the five entity roots and permits
legacy numeric ownership conversion only with unambiguous User-to-Profile evidence.

This amendment authorizes the reviewed pending-migration changes and preservation checks, including refusal before
mutation when a conversion, partial state or reversal cannot preserve information. It does not authorize guessed
ownership, account/profile merging, populated identifier coercion, destructive rollback, migration-history bypass,
released-archive edits or a production deployment. Preserve the original decisions above and use the existing paired
restore procedure whenever safe reversal cannot be established.

## Approved bounded session completion repairs (2026-10-29)

The maintainer explicitly approves **R1**, **R2** and **R3** from the immediately preceding production-audit
answer and instructs full implementation of its prose plan. These identifiers belong to that answer only.
Preserve the original choices above and the October 14 A2 correction recorded in the development guide.

R1 extends A3's destruction-only adapter correction to ordinary renewal: the existing expiry update must settle
before exactly one success or failure callback, preserving TTL, identity JSON, cookie policy and disconnect reporting.
Response bytes may already have been sent; renewal failure does not roll back a business commit.

R2 extends the existing identity-completion/staging owner only to document feedback consumption and persistence:
Vue bootstrap, private-link feedback, redirect carryover, retained Activity print's complete native flash consumption,
and notices saved after document/expiry logout. Guard the originating generation, omit superseded feedback without adopting
another actor, and prevent later stale autosave. Expiry feedback uses its completed logout's generation and retains
log-only delivery failure; the preceding ordinary logout is unchanged. No-feedback visits remain read-only and
public visits without feedback stay uninitialized. Ordinary expiry renewal and best-effort delivery remain.

R3 makes a bounded exception to the October 14 A2 native-edit persistence correction and A10's no-wider-profile-
transaction exclusion: current-profile name/default edits, ownership/generation checks, required Session refresh
and prepared acknowledgement share the existing completion transaction and its manager. Reuse the identity feature's
business ownership and UserService's established owner-before-Profile locking responsibility. Preserve exact names,
shared bounds, required API fields, internal omission/default semantics, account/guest rights, generation and wire
contracts. This deliberately replaces partial database/session failure with atomic completion for editing only.

These decisions do not authorize a general Session merger, ordinary provider/deactivation identity redesign,
profile-creation strengthening, release publication or shared deployment. The remaining audit and conditional A19
verification continue within their existing boundaries; successful tests do not certify those broader lifecycles.

## Approved deactivation ownership fence (2026-10-29)

The maintainer explicitly approves **R4** from the immediately preceding production-audit answer and instructs
full implementation and related review. This identifier names that answer's deactivation ownership decision only.

Before detaching a profile, the existing identity feature must check the captured owner's current ownership under
UserService's established owner-before-Profile locks and detach on the same short transaction manager. The existing
controller passes through only that known pre-detach ownership rejection; failures after detachment retain their
uncertain outcome. This prevents a former owner's admitted request from detaching a subsequently transferred profile.

Preserve R16's original choice: confirmation, account/guest rights, retained domain rows, later former-owner
cleanup/mail, remaining-profile selection or local sign-out and their partial failures keep their existing order
outside that short transaction. R4 does not authorize whole-workflow atomicity, a general Session merger or provider
redesign. Establish the real-persistence regression before dependent product changes and reassess any unreproduced
claim. The original decisions above remain historical; conditional A19 and its external prerequisites are unchanged.
