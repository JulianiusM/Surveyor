# Staged frontend readme amendments
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-14
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: digest-guarded frontend amendments preserve complete reviewed candidate guidance; unchanged production procedures stay in their existing owners; no runtime or cutover execution claimed
source-anchors: docs/frontend-migration/documentation-boundary.json; docs/frontend-migration/check-documentation-boundary.mjs; docs/policies/DOCUMENTATION_POLICY.md; docs/policies/DEVELOPMENT_POLICY.md; src/frontend/; package.json
next-review: next-authorized-migration-slice-or-cutover
-->

These amendments retain the reviewed frontend guidance without copying unchanged production procedures.
The [profile](../PROFILE.md) governs preparation and review; its [manifest](../documentation-boundary.json)
owns destination mapping and exact operations. Payload links use their mapped production location.
Surrounding notes use this file's location. Preparing complete temporary output does not authorize cutover.

## Introduction — amendment-01

<!-- delta:amendment-01 -->
Surveyor is a collaboration application for recurring-date surveys, events, activity schedules, packing lists, rides,
and event cost sharing. TypeScript, Vue and Express provide request-local server rendering and browser interaction;
MariaDB stores application records and sessions. Existing controllers own shared business behavior and database
services own persistence.

<!-- /delta:amendment-01 -->

## Choose the right documentation — amendment-02

<!-- delta:amendment-02 -->
| Use Surveyor | [In-app user guides](docs/user-guide/en/README.md) |

<!-- /delta:amendment-02 -->

## 5. Start the development server — amendment-03

<!-- delta:amendment-03 -->
This performs a full build, starts the TypeScript server under Nodemon with Express-hosted Vite middleware/HMR,
and starts the existing browser watcher plus serialized API/catalog generation. Confirm startup with:

<!-- /delta:amendment-03 -->

## Common development commands — amendment-04

<!-- delta:amendment-04 -->
| `npm run server` | Build once, then run Express/Vite HMR, the existing browser watcher and authored-input generation together. |

<!-- /delta:amendment-04 -->

## Common development commands — amendment-05

<!-- delta:amendment-05 -->
| `npm run server:client` | Run only the existing esbuild browser-code watcher. |
| `npm run server:frontend` | Watch authored API contracts, locale catalogs and the permission registry; publish readiness after ordered generation. |
| `npm run build` | Generate database/API/catalog consumers, compile server, browser and Vue client/SSR output, compile Sass, and copy views/assets into `dist/`. |

<!-- /delta:amendment-05 -->

## Common development commands — amendment-06

<!-- delta:amendment-06 -->
| `npm run generate` | Regenerate the TypeORM index and shared API/localization consumers without connecting to a database. |
| `npm run typecheck:frontend` | Check the Vue client and SSR TypeScript scopes. |
| `npm run typecheck:tests` | Check the Vue-aware test import graph. |

<!-- /delta:amendment-06 -->

## Common development commands — amendment-07

<!-- delta:amendment-07 -->
| `npm run test:quick` | Select the configured database-free Vitest project: unit/client checks and scoped Express/Vite server integration. |
| `npm test` | Run all Vitest suites, including MariaDB integration tests. |
| `npm run test:frontend:browser` | Build and run isolated real-browser client checks; no system database is supplied by this runner. |
| `npm run test:all` | Run Vitest, build, isolated client-browser checks and built-application E2E. |

<!-- /delta:amendment-07 -->

## Repository map — amendment-08

<!-- delta:amendment-08 -->
src/frontend/                         Vue app, components, composables and feature views
contracts/api/v1/                     authored wire schemas
src/locales/                          shared browser/server catalogs
src/types/                            shared declaration contracts (.d.ts)
src/public/js/                        existing browser modules and shared pure helpers

<!-- /delta:amendment-08 -->

## Repository map — amendment-09

<!-- delta:amendment-09 -->
tests/frontend/                        client helpers/mounted Vue and isolated browser checks
tests/integration/                     database-backed workflows and genuine isolated server-component integration

<!-- /delta:amendment-09 -->

## Test and release automation — amendment-10

<!-- delta:amendment-10 -->
Vitest runs the unit, client and integration suites configured in `vitest.config.mts`. The isolated client-browser
runner uses built assets through `playwright.frontend.config.ts`. Built-application E2E uses `playwright.config.ts`
and owns the prepared database and compiled server through `npm run e2e:init`; it never reuses an arbitrary server.

<!-- /delta:amendment-10 -->

## Test and release automation — amendment-11

<!-- delta:amendment-11 -->
The CI workflow currently runs for manual dispatch, reusable workflow calls, and pushes or pull requests on `master`, `dev`, and `ts-migration`. It uses Node.js 24.15.0 and MariaDB 10.11, installs dependencies, runs application Vitest tests with coverage, builds the application, and then runs the separate Chromium client and system checks.

<!-- /delta:amendment-11 -->
