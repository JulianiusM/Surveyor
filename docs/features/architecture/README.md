# Architecture diagram reference
<!--
documentation-metadata
audience: maintainers; developers; architecture reviewers
owner: architecture maintainers
status: current
last-verified: 2026-10-28
verification-baseline: docs-baseline-2026-09-06-ci-repair
verification-scope: structural; source-derived diagram publication and canonical navigation; no live deployment or database verification
source-anchors: docs/features/architecture/DIAGRAMS.md; docs/ARCHITECTURE.md; src/backend/; src/frontend/; contracts/api/v1/; package.json
next-review: architecture-or-delivery-change
-->

The [diagram collection](DIAGRAMS.md) covers Surveyor’s application context, runtime containers, backend and frontend components, data relationships, workflows, trust boundaries, build and deployment. Its 32 Mermaid diagrams were derived from executable application source and configuration. Each diagram links to the source owners used to check it.

Use the [Architecture guide](../../ARCHITECTURE.md), [Database guide](../../DATABASE.md), [Operations guide](../../OPERATIONS.md) and [Development guide](../../DEVELOPMENT.md) for the governing responsibilities and operating procedures. The diagrams complement those guides. Source-derived structure does not replace approved design decisions, required business relationships or an installation’s verified schema.

## Choose a view

| View | Diagrams |
|---|---|
| [System and component structure](DIAGRAMS.md#system-and-component-structure) | [System context](DIAGRAMS.md#system-context); [Containers and runtime dependencies](DIAGRAMS.md#containers-and-runtime-dependencies); [Backend components and responsibility boundaries](DIAGRAMS.md#backend-components-and-responsibility-boundaries); [Whole application feature map](DIAGRAMS.md#whole-application-feature-map); [Browser and SSR component architecture](DIAGRAMS.md#browser-and-ssr-component-architecture); [Source package dependencies and shared contracts](DIAGRAMS.md#source-package-dependencies-and-shared-contracts) |
| [Data model](DIAGRAMS.md#data-model) | [Whole database with 38 tables and 66 foreign keys](DIAGRAMS.md#whole-database-with-38-tables-and-66-foreign-keys); [Identity and access data](DIAGRAMS.md#identity-and-access-data); [Event attendance and finance](DIAGRAMS.md#event-attendance-and-finance); [Packing and drivers lists with surveys](DIAGRAMS.md#packing-and-drivers-lists-with-surveys); [Activity planning data](DIAGRAMS.md#activity-planning-data); [Application references beyond foreign keys](DIAGRAMS.md#application-references-beyond-foreign-keys); [ORM class inheritance](DIAGRAMS.md#orm-class-inheritance) |
| [Request and identity boundaries](DIAGRAMS.md#request-and-identity-boundaries) | [SSR document rendering and browser reads](DIAGRAMS.md#ssr-document-rendering-and-browser-reads); [Protected command and completion boundaries](DIAGRAMS.md#protected-command-and-completion-boundaries); [Ordinary identity completion and external delivery](DIAGRAMS.md#ordinary-identity-completion-and-external-delivery); [Trust boundaries and private data flow](DIAGRAMS.md#trust-boundaries-and-private-data-flow) |
| [Activity workflows](DIAGRAMS.md#activity-workflows) | [Activity recommendation generation](DIAGRAMS.md#activity-recommendation-generation); [Activity recommendation review and application](DIAGRAMS.md#activity-recommendation-review-and-application); [Activity generation job states](DIAGRAMS.md#activity-generation-job-states); [Persisted recommendation status and workspace handling](DIAGRAMS.md#persisted-recommendation-status-and-workspace-handling) |
| Current identity and attendance operations | [Profile capability issuance and transfer](DIAGRAMS.md#profile-capability-issuance-and-transfer); [Local and provider logout completion](DIAGRAMS.md#local-and-provider-logout-completion); [Event registration capacity and token consumption](DIAGRAMS.md#event-registration-capacity-and-token-consumption) |
| [Finance and file workflows](DIAGRAMS.md#finance-and-file-workflows) | [Finance calculation and notification](DIAGRAMS.md#finance-calculation-and-notification); [Invoice pool lifecycle](DIAGRAMS.md#invoice-pool-lifecycle); [Individual invoice lifecycle](DIAGRAMS.md#individual-invoice-lifecycle); [Invoice proof ownership and recovery](DIAGRAMS.md#invoice-proof-ownership-and-recovery); [Invoice retention and proof cleanup ordering](DIAGRAMS.md#invoice-retention-and-proof-cleanup-ordering) |
| [Application lifecycle and delivery](DIAGRAMS.md#application-lifecycle-and-delivery) | [Entity lifecycle and personal visibility](DIAGRAMS.md#entity-lifecycle-and-personal-visibility); [Build and release architecture](DIAGRAMS.md#build-and-release-architecture); [Deployment and startup lifecycle](DIAGRAMS.md#deployment-and-startup-lifecycle) |

## Read and export

Open DIAGRAMS.md in a Markdown viewer with Mermaid support. The fenced blocks are the maintained diagram source; tables, sequence messages and state transitions remain text that reviewers can compare in Git. Entity relationship and class views retain the complete table/reference and inheritance coverage, while smaller domain views make the same relationships easier to follow.

For optional image exports, a separately installed Mermaid CLI can read the Markdown file directly. From the repository root, create the ignored artifacts/architecture directory if needed, then run:

```bash
mmdc --input docs/features/architecture/DIAGRAMS.md --output artifacts/architecture/DIAGRAMS.md --outputFormat svg
```

This produces an exported Markdown file and its SVG images under artifacts/architecture. PNG or PDF can be selected with the CLI’s output format option. Renderer exports are disposable review artifacts; edit the Mermaid blocks rather than maintaining another source or committing generated images. Diagram export is optional and is outside application build, test, CI and release acceptance.

## Keep the reference current

When an approved application change affects a diagram, trace its source links through the affected routes, business owners, persistence, generated contracts and callers. Update the relevant Mermaid blocks and their descriptions together. For data changes, check inherited ORM relations and migrations as well as the concrete entity. Re-render affected blocks and review their meaning; a successful render establishes syntax, not business correctness.

Keep backlog items in the [remediation backlog](../../backlog/documentation-remediation.yml), approved decisions in decision records, and implementation plans directly in the conversation. Record new verification scope in document metadata without replacing a registered baseline merely to clear a report. Preserve deliberate feature differences, including Survey’s independent permission/participation model and Finance’s placement within Event.
