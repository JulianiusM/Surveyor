# Frontend visual baseline
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: current
last-verified: 2026-10-04
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: manual review of 34 Chromium desktop and mobile screenshots from synthetic fixtures; successful application build, persisted local packing check and native overview search without JavaScript; representative states only
source-anchors: scripts/capture-frontend-baseline.cjs; src/views/; src/public/js/; tests/factories/e2eCoreFactory.ts; tests/keywords/e2eCoreKeywords.ts; package.json; docs/TESTING_GUIDE.md; docs/documentation-remediation.yml
next-review: frontend-migration-slice-or-capture-fixture-change
-->

This is representative visual evidence for the [frontend migration baseline](../FRONTEND_MIGRATION_BASELINE.md).
Use it with the [behavior inventory](BEHAVIOR_INVENTORY.md), [route inventory](ROUTE_INVENTORY.md) and
[test coverage map](TEST_COVERAGE.md). Screenshots show appearance at selected states; they do not establish complete
feature, permission, interaction or accessibility coverage.

## Evidence and environment

The reviewed run is `test-results/frontend-baseline/2026-10-04T13-03-59-615Z/`, completed at
`2026-10-04T13:05:18.678Z`. Open its `index.html` gallery and click images to inspect their original size.
`manifest.json` records scene paths, actors, dimensions and capture results; `server.log` records the local server.
These are ignored local artifacts, not committed documentation assets. The maintained replay tool is
[`scripts/capture-frontend-baseline.cjs`](../../scripts/capture-frontend-baseline.cjs).

| Input | Recorded value |
|---|---|
| Application source | `7ff78998667e55df56390a8e8da88e8ace687771` |
| Build | `npm run build` completed successfully; log at `test-results/frontend-baseline/2026-10-04/build.log` |
| Runtime | Windows, Node `v24.13.0`, local MariaDB `10.4.32` |
| Browser | Playwright `1.62.1`, Chromium `151.0.7922.34`, headless |
| Desktop viewport | 1440 × 1000 CSS pixels |
| Mobile viewport | 390 × 844 CSS pixels; desktop Chromium resized, not physical-device emulation |
| Browser locale / timezone | `en-GB` / `UTC`; current application English labels and dark theme |
| App endpoint | Capture-owned child process on `http://127.0.0.1:3104` |
| Database | Existing disposable local E2E schema `cgd_e2e`, verified before writes; no reset, synchronization or migration |

The local Node and MariaDB versions differ from the documented CI environment. This run is local baseline evidence,
not a CI compatibility result. Other browser engines, device input models and themes were not exercised.

All 34 screenshots were captured and individually reviewed. Every capture reported its Bootstrap stylesheet loaded
and document width equal to viewport width. The monitored organizer and guest pages reported no uncaught page errors
or failed network requests. Anonymous and JavaScript-disabled contexts did not have those diagnostic listeners.
These observations do not establish that every asset or offscreen control works.

The capture manifest deliberately remains `captured-awaiting-visual-review`: the capture tool cannot certify human
image review. This document records the subsequent review without hand-editing generated output.

## Scene inventory and review

Each scene has `<scene>-desktop.png` and `<scene>-mobile.png`. Ordinary pages use full-page screenshots. Entity settings
and calculation previews use viewport screenshots so fixed-position dialogs retain their actual geometry. The separate
preview-actions scene scrolls the dialog to its action controls.

| Scene | Actor and state | Review result / limit |
|---|---|---|
| `login` | Anonymous, local login | Fields and recovery controls readable; mobile stacks cleanly |
| `overview` | Organizer, populated collections | Correct synthetic records and linked-child count; creation flashes cleared; mobile actions fit |
| `event-create` | Organizer, empty creation form | Fields, timezone, permissions and submission visible; mobile wraps |
| `survey` | Organizer, two date combinations | Desktop table readable; mobile shows initial horizontal position only; see IMP-019 below |
| `packing` | Organizer, three items, local checklist cleared | Shared item/capacity information and unchecked checklist visible |
| `packing-checked` | Same list, first local checkbox checked and page reloaded | Checked state survives reload at both sizes; shared assignment counts do not change |
| `drivers` | Organizer, one offered ride with three spaces | Desktop readable; mobile has internally scrolling columns |
| `activity` | Organizer, linked plan with one breakfast slot | Slot time and capacity visible; mobile captures partial columns |
| `event-participant` | Guest, existing Vegetarian registration | Registration update/cancel controls visible; setup flash and private return URL absent |
| `event-admin` | Organizer, two registrations, linked plan and open pool | Correct totals, collapsed linked collections and export action; mobile layout readable |
| `entity-settings` | Organizer, event settings dialog, initial position | Fields and navigation readable; mobile wraps Actions and retains Close; lower settings outside capture |
| `invoice-open` | Organizer, accepted 120.00 expense | Open status, management controls and preview action visible; mobile stacks |
| `invoice-preview` | Organizer, loaded calculation dialog | 120.00 due, 0.00 refund and two 60.00 shares; desktop includes complete dialog |
| `invoice-preview-actions` | Same preview, action area scrolled into view | Mobile includes both results, email toggle off, closure explanation, Cancel, Refresh preview and Close pool & calculate |
| `help` | Organizer, help home | Article readable at native scale; mobile topics precede article and contents list follows it; small embedded diagram has full-size link |
| `invoice-closed` | Organizer, saved calculation | Closed status, two payment-due shares, exports and recalculation visible; mobile ledger shows only part of the second payer |
| `overview-no-javascript` | Organizer, JavaScript disabled, native search submitted | Survey result and search query verified at both widths; filter controls visible but type-filter behavior not exercised |

There was no visible overlapping text in the reviewed states. Survey, packing, driver, activity and invoice tables
retain internal horizontal scrolling on mobile. Their initial-position screenshots do not demonstrate reachability
or usability of all offscreen controls. Those interactions need explicit evaluation in the relevant migration slice.

The English invoice view displays a German-formatted date in this environment. Treat this as evidence to account for
when designing shared locale resolution; the screenshots do not establish a consistent current localization contract.

Two implementation defects are separated from intended migration parity in the
[existing defect register](../documentation-remediation.yml): IMP-019 covers the absent survey description; IMP-034
covers the empty help browser title. The replacement should preserve the coherent working behavior described there,
not reproduce these omissions. Application remediation is outside this baseline change.

## Fixture recipe and replay

Read the [testing guide](../TESTING_GUIDE.md) before selecting a database. The capture requires installed dependencies,
Chromium, a built application, an already initialized disposable local E2E schema, and a seeded E2E administrator.
It uses `.env.e2e` or `E2E_DOTENV_FILE`, with process environment taking precedence. It does not initialize a missing
schema or create administrator credentials. The port must be free; `FRONTEND_BASELINE_PORT` can override the default.

From the repository root, with the verified disposable E2E target selected:

```powershell
npm run build
node scripts/capture-frontend-baseline.cjs
```

The tool checks the explicit local database target and grants before writes. Grant-name checks are a guard against
obvious misconfiguration, not proof that data is disposable; the selected E2E configuration must designate disposable
data. This run checked the existing account's test-schema grants before adding fixtures.

The capture starts its own built Express app against that target, without the normal server's startup archival or
file-retention jobs. It disables OIDC and points SMTP at an unused local port; the selected workflows do not request
mail. The child server and browser stop on completion or failure. Credentials and browser session state are not
written to the evidence directory.

Fixtures are added through existing production HTTP flows and E2E helpers:

1. Create and select a separate **Baseline organizer** profile to isolate overview records from other E2E fixtures.
2. Create **Autumn community weekend**, 9–11 October 2099 at Lakeside camp, with public viewing and registration.
3. Create **Choose our monthly meeting**, **Weekend equipment**, **Rides to camp**, and an event-linked
   **Weekend activities** plan. Packing includes an everyone-required item; the plan has a breakfast slot with capacity two.
4. Register the organizer and a no-email **Jamie Guest**, with different dietary selections.
5. Create **Shared food costs**, equal distribution, all participants assigned, emails off, and one 120.00 organizer expense.
6. Clear setup-only flash messages, capture open and preview states, then close using the current preview revision and
   capture the saved calculation. Exercise local packing persistence and native overview search separately.

The script adds records and retains them in the disposable schema. Repeated runs add further profiles and records;
earlier attempts are not cleaned automatically. Resetting an E2E schema can remove those fixtures. Images remain local
until the ignored evidence directory is removed. Use the tracked script to recreate evidence; replay reflects the
then-current source and may need fixture updates as the application evolves.

## Remaining visual and interaction coverage

The [test coverage map](TEST_COVERAGE.md) distinguishes existing assertions from migration gaps. This capture does not
replace those assertions and adds no mandatory CI check. Application unit, frontend, integration and E2E suites were
not executed for this baseline task.

Before cutting over a feature, select the missing states relevant to its behavior IDs, including:

- Empty, loading, validation failure, server failure, session-expiry and stale/conflicting shared-data states.
- Delegated and narrowly scoped permissions, read-only views, profile switching, guest entry and recovery, permission
  selection, archival, restore, personal hiding and hard-deletion confirmation.
- Activity requirements, availability, manual/external assignments, recommendation review and stale-job outcomes.
- Invoice evidence uploads and uncertain results, refunds, takeovers, long participant lists/notes, calculation history,
  payment transitions and actual download/print/PDF output.
- Hidden overview regions, native type filtering, survey native voting, help search, keyboard/focus behavior,
  screen-reader output and offscreen mobile table controls.

Periodic refresh and conflict reconciliation are future requirements, not current browser behaviors validated here.
Their acceptance scenarios belong in the contract and frontend foundation work that follows this inventory.
