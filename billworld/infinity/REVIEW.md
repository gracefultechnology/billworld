# WebArena Infinity reuse for Billworld

Billworld should extend WebArena-Infinity with billing environments and shared auth/email services. Its existing evaluator, agent interface, reports, app layout and generation workflow cover much of the infrastructure we were about to build. The remaining substantial work is the billing catalog and faithful site behavior. A small compatibility overlay is now implemented and tested; a separate general agent runner is unnecessary.

This review covers the supplied notes, repository structure, all thirteen main app/task inventories, evaluator and browser lifecycle, generation pipeline and design/audit guides. Gmail, Gmail accounts, PayPal and Xero received the detailed code review relevant to billing. It does not claim every downloaded manual, asset or verifier was individually reviewed. The pinned source is [commit 1ca7781](https://github.com/web-arena-x/webarena-infinity/tree/1ca77813bf8d8e4011aa3fb1f740f70d78bd522d). There are 1,620 real tasks across the thirteen upstream main apps, excluding ablations and the separate Billworld additions.

Rechecked on October 4, 2026 (America/New_York): upstream `HEAD` still matches the pinned revision. The source inventory and the supplied comparison notes support using Infinity as the base. Adding another general runner, inbox frontend or generation framework is unnecessary for the current scope.

## Decision for the current request

Use Infinity as the benchmark host and add billing sites through the existing Billworld extension. Keep its runner, agent integrations, task format, reports, Gmail frontend and construction workflow. Add site-specific pages and policy adapters to the shared Billworld services. Do not turn each biller into a separate copy of the runner, Gmail or identity provider.

The fresh review confirmed the remote revision, enumerated all thirteen upstream main apps and their 1,620 tasks, re-read the environment protocol, inspected Gmail/PayPal/Xero state and payment code, and checked construction and evaluator lifecycle code. The clean-source overlay test passed again: installing twice yields identical files and all three patched evaluator modules compile. These checks establish reuse compatibility, not original-site fidelity or autonomous-agent performance.

Current release validation and task counts are recorded in `research/runtime-validation.json`; prior validation artifacts retain their own revisions and scopes. Nine explicit billing slices are implemented, with source fidelity still uncertified. The original catalog has 59,477 records; generic templates and fetched URLs are discovery material, not completed replicas.

## Current integration review (October 5, 2026)

Remote HEAD still resolves to the pinned `1ca77813bf8d8e4011aa3fb1f740f70d78bd522d`. Reading the pinned Git objects confirms thirteen main apps and 1,620 upstream tasks. The clean-source overlay test passes again: two installations produce identical files, the three evaluator modules compile, and the generated task inventories contain 31 released tasks and 10 separately scoped construction tasks.

The latest saved regression evidence records all 31 released references passing through Infinity in `research/dependency-supervisor-validation.json`. All ten construction references pass in `research/batavia-bill-history-construction-validation.json`. These are previously completed scripted validations; this review reran the overlay compatibility test, not all browser journeys. Nine released billing slices, two construction sites and their tasks remain partial coverage of the 59,477-record catalog. There are no autonomous-agent results or independent source-fidelity certificates.

Continue with the same extension. Each catalog addition supplies evidence, tenant-specific frontend/routes, policy configuration, private verifier predicates and Puppeteer journeys. The benchmark-wide priorities are a billing-specific generation contract, agent/control isolation, held-out tasks, measured action and cost budgets, and an actual agent baseline. Authenticated source evidence remains a separate requirement: successful local tests cannot certify unobserved original flows.

## Smallest useful addition for each biller

| Deliverable | Reuse from the current extension | New site work |
|---|---|---|
| Source evidence | Catalog collector, browser capture, asset hashing and source packets | Review actual homepage, provider handoffs, login, registration, recovery, billing and help; record inaccessible/private routes |
| Website | Shared static serving, navigation and compatible portal-family components | Reconstruct the observed tenant's pages, labels, identifiers, layouts and help; list unsupported routes |
| Auth and email | Password/session/challenge services, local Google identity, Gmail frontend and scoped connector | Enable only observed providers and registration/recovery steps; distinguish synthetic rules |
| Billing | Authoritative invoices, payment methods, quote/commit, idempotency and event history | Implement evidenced fees, settlement, schedule, recurring and cancellation rules for that tenant |
| Benchmark tasks | Infinity task JSON, episode fixtures and private lifecycle/verifier adapter | Add realistic instructions and exact outcome predicates, including changes that must not occur |
| Acceptance | Puppeteer reference infrastructure and negative domain checks | Complete each supported journey from the declared starting state, reload/retry it, and test incorrect and duplicate operations |
| Evaluation | Infinity agents, parallel runner, trajectory/result files and HTML report | Freeze site/task versions, reserve worker ports, isolate private controls, and publish first-attempt metrics with failure counts |

A shared processor family can save component and policy implementation work. It does not establish equivalent tenant behavior: guest checkout, required account identifiers, account activation, fees and recurring-payment controls may differ. Every biller still needs a coverage and evidence record even when its implementation mostly uses existing components.

For construction, keep `infra/pipeline.py`, but use a billing-specific copy of its generation prompt/protocol in the disposable build checkout. The stock `generate-app.md` requires `docs/environment-protocol.md`, whose whole-state `PUT /api/state` requirement conflicts with Billworld's ledger contract. An evidence packet alone is not enough to remove that conflicting requirement. Run `python3 -m billworld.infinity.prepare_generation --checkout /absolute/path/to/dedicated-build-checkout` to replace the generation protocol reference and add the billing contract to all seven construction phases before a paid generation run. The helper preserves the original protocol, validates the pin, refuses unexpected edits and records source/replacement hashes. Preserve the original protocol for existing upstream apps.

The remaining work is predominantly site reconstruction and validation. Deployment isolation, a separate mailbox origin, held-out scenario design, full-job failure accounting, measured action/cost totals and autonomous-agent evaluation remain benchmark-wide gaps. AWS, Mailpit, another OAuth framework and BrowserGym are optional until a concrete requirement calls for them. No additional framework is needed to begin expanding the billing catalog.

## What adding a billing site means

Keep upstream's existing apps intact and use `apps/billworld` as the extension entry point. Each added biller needs a source-evidence packet, a site manifest, its own navigation and pages, a policy adapter for the shared billing/auth/mail services, task definitions, private outcome predicates and Puppeteer reference journeys. The existing registry loads implemented site and task manifests; a portal-family match in the catalog alone does not register a working site.

Use `source_packet.py` to prepare documentation for Infinity's construction pipeline, then connect generated pages to the authoritative services. Retain the upstream task format and run the resulting tasks through the same evaluator and reports. Generated browser-state payment logic must be replaced before a site can pass the billing release checks. Faithful site research and reconstruction remain the main expansion work; the runner integration is already present.

PayPal and Xero are reusable design/component references, not mandatory dependencies for every biller. Use their components where the target flow matches; a utility portal should retain its observed navigation and payment steps. The nine implemented billing slices are Juneau/InvoiceCloud, Spotify, AVEC/SmartHub, Homer/Xpress Bill Pay, Duluth/Utility Access and Grand Valley Power/SmartHub and Swepsonville/AuthorityPay–InvoiceCloud and WVU Medicine/MyChart and Western Dental/PersonaPay. Other researched sites are not runtime coverage.

## What to reuse

| Component | Decision | Billworld adaptation |
|---|---|---|
| Parallel evaluation runner | Reuse | Existing worker queue, repetitions, resume, result files and HTML reports |
| AgentRunner and model integrations | Reuse | Add an optional fresh-browser lifecycle hook for billing episodes |
| Task JSON and Python verifiers | Reuse | Keep upstream format; use private server-owned state and structured final answers |
| Gmail inbox UI | Reused | Pinned frontend now reads authenticated episode messages and persists permitted mailbox flags |
| Gmail accounts and contacts | Selective reuse | Useful account/settings UI; its 2FA settings do not supply an actual challenge/login service |
| PayPal wallet | Selective reuse | Card/bank/payment/review component patterns; preserve the actual target biller's navigation |
| Xero invoicing | Selective reuse | Invoice/status/history/repeating-invoice patterns, where applicable; this is merchant accounting rather than a universal consumer bill portal |
| Generation, task design and audit guides | Reuse | Feed reviewed source evidence and capabilities into templates; require billing invariants and independent fidelity review |
| Verifier sanity checks | Reuse concept | Add negative/adversarial checks and independent UI reference journeys |
| serve_all discovery | Reuse for catalog/demo | New app directories are discoverable; evaluated environments must omit test panels |
| AWS and S3 deployment | Defer | Local development works without adopting cloud infrastructure |
| Existing trajectory dataset | Optional development material | Keep it separate from held-out Billworld evaluation tasks |

The [MIT license](https://github.com/web-arena-x/webarena-infinity/blob/1ca77813bf8d8e4011aa3fb1f740f70d78bd522d/LICENSE) supports code reuse with its notice retained. A copy is stored in `UPSTREAM_LICENSE`. It does not establish redistribution rights for captured third-party branding, source bundles or help content.

## Findings that change the original plan

**Infinity supplies generated functional replicas.** Its app pipeline consumes application descriptions and documentation. It is useful construction machinery, but does not establish that a replica uses the original site's SPA source or reproduces its private flows. Keep our screenshots, DOM, accessibility trees, public captures and observed/documented/synthetic labels as an independent evidence layer. Downloading browser assets does not reconstruct the original backend. See the [generation pipeline](https://github.com/web-arena-x/webarena-infinity/blob/1ca77813bf8d8e4011aa3fb1f740f70d78bd522d/infra/pipeline.py).

**Gmail is an inbox, not Google identity.** The upstream Gmail app loads a fixed `CURRENT_USER` and browser-persisted messages. The accounts app models security settings but does not provide password verification, OAuth callbacks, recovery or OTP delivery between sites. Reuse its visible email experience while preserving our separate identity/password/session service. See [Gmail state](https://github.com/web-arena-x/webarena-infinity/blob/1ca77813bf8d8e4011aa3fb1f740f70d78bd522d/apps/gmail/js/state.js).

**Browser-pushed state is unsuitable as the billing ledger.** The documented protocol accepts the whole browser state with `PUT /api/state`, snapshots the first push, and allows verifiers to read it. This fits its intended UI-only agent setting. For Billworld, payment commits, challenges, account ownership, time and balances must remain authoritative on the server. Do not make payment completion depend on a browser writing a “paid” flag. See the [environment protocol](https://github.com/web-arena-x/webarena-infinity/blob/1ca77813bf8d8e4011aa3fb1f740f70d78bd522d/docs/environment-protocol.md).

**PayPal offers payment UI, not a complete payment system.** Its credit-payment modal supports minimum/full amounts. The state function directly subtracts a PayPal balance and reduces outstanding credit; AutoPay toggles a setting. That code does not implement our biller-specific review tokens, idempotency, pending settlement, due-date execution or fee policies. Reuse appropriate components and connect them to the billing engine. See [PayPal payment logic](https://github.com/web-arena-x/webarena-infinity/blob/1ca77813bf8d8e4011aa3fb1f740f70d78bd522d/apps/paypal-my-wallet/js/state.js).

**The native reset is insufficient for scored login.** Upstream workers keep a browser session between tasks and use server reset/SSE to restore application data. Billing episodes need fresh cookies, browser storage and identities, along with independent mailbox and ledger state. Our optional hook creates a new episode and restarts the browser before entering it. Explicit login remains part of each task.

**The stock verifier does not receive the final answer.** Its interface is `verify(server_url)`. Billworld tasks may require a confirmation number or reported billing date, so our optional hook receives both task and `AgentResult`. It passes only expected answer strings to the private grader. Existing apps retain the original verifier/reset path. See the [task lifecycle](https://github.com/web-arena-x/webarena-infinity/blob/1ca77813bf8d8e4011aa3fb1f740f70d78bd522d/evaluation/tasks.py).

**Merged repetition scores are best-of-N.** A task passes the upstream merged report if any repetition passed. Use individual attempts for the primary success rate, then report best-of-N separately with N and retry policy. Also report site/portal-family macro averages, failure reasons, time, actions, model version and costs. The successful-trajectory dataset is useful for development but cannot establish an unbiased success rate. See the [parallel runner](https://github.com/web-arena-x/webarena-infinity/blob/1ca77813bf8d8e4011aa3fb1f740f70d78bd522d/evaluation/run_eval_parallel.py).

**Documentation and defaults need checking against code.** Some guides mention absent sequential entry points and an older 300-second harness timeout; the reviewed runner uses 600 seconds and has an absent default app directory. Pass `--web-app apps/billworld` explicitly. Our tasks retain a 300-second private grading budget. Setup invokes sudo for browser system dependencies, so use platform-appropriate installation rather than blindly executing that script on macOS. Model/provider API compatibility was not tested.

**Generation is a development workflow, not a release gate.** The pipeline invokes Claude Code with permission-skipping flags, can clean generated artifacts, and treats a missing sanity script as a skipped success. Use it in a disposable build checkout, preserve reviewed evidence, and require named passing checks before accepting an environment. Do not revise held-out tasks in response to the same evaluated model's failures.

## The implemented adapter

`bootstrap.py` installs an exact upstream revision into ignored `.upstream/webarena-infinity` and applies a repeatable overlay. It adds `apps/billworld`, with a `server.py` launcher and upstream-format task JSON. Only three evaluator files change: `tasks.py`, `agents.py` and `vision_agents.py`.

The optional `harness.py` prepares private episodes and grades final outcomes. The public compatibility `GET /api/state` returns only `{ "ready": true }` for upstream browser startup. It does not disclose a world snapshot, and no public state-write or benchmark-reset endpoint was added. A worker's private admin port/token is read from a runner-only file. The browser receives an opaque episode entry URL and synthetic persona credentials.

Twenty-one tasks are wired: Juneau one-time payment, Juneau AutoPay enrollment, Juneau scheduled payment, Spotify payment-method replacement through mock Google login, email-MFA payment, and password recovery. The Juneau MFA and recovery tasks are explicitly synthetic. AVEC adds a bill-payment task; Homer adds signed-in payment and registration/Gmail-verification/linking/payment tasks. Duluth adds email-first payment, registration/email-code/linking/payment, Google-payment and saved-method management tasks. GVP adds signed-in payment, registration with a temporary email password and mandatory password change, and AutoPay enrollment. Swepsonville adds guest utility payment, CID registration, recovery, pending bank-draft request and separate deposit payment tasks. Billing, scheduling, recovery and Google validation stay in the existing domain services. The current billing UI covers Juneau/InvoiceCloud, Spotify, AVEC/SmartHub, Homer/Xpress Bill Pay, Duluth/Utility Access, Grand Valley Power/SmartHub and Swepsonville/AuthorityPay–InvoiceCloud. Gmail's pinned frontend now reads the authenticated episode mailbox; copied source hashes and MIT attribution are retained. A separate bridge replaces browser persistence and state pushes with permitted server operations.

Validation completed:

- Nine reference journeys passed on 0.4.0. The 0.5.0 scoped runs pass three Duluth payment/registration journeys and one saved-method journey through upstream `run_task`, private verification, result serialization and HTML report generation.
- A no-action journey is rejected; public state mutation and reset are rejected.
- Release 0.10.0 records 103 domain tests, 26 research tests, five municipal scenarios, six Swepsonville regressions and five Swepsonville Infinity references. Prior site journeys retain the validation dates and scopes in `research/runtime-validation.json`; they were not all rerun on this revision.
- Bootstrap is tested from pristine pinned source, applied twice, hash-compared and compiled.
- The lifecycle suite persists agent/setup failures, timeout, cancellation and deadline rejection; preserves ordinary upstream app behavior; separates repetition metrics; and recovers an owned worker after SIGKILL. Four Duluth reference journeys pass through separately scoped lifecycle runs; dates and scopes are recorded in `research/runtime-validation.json`.

These are integration/reference results. No autonomous model evaluation, paid generation run, full parallel-model run or original-site fidelity certification has been performed. The adapter currently supports local workers. Whole-job dispatch accounting, external process supervision, remote worker credentials, container process cleanup, deployment isolation and VisionAgent connector integration need further work. The stock runner's process startup also kills listeners on a requested port; reserve worker ports and replace that behavior with owned-process management before shared-host deployment.

## Email reuse and remaining work

Make the authoritative episode mailbox the single delivery source. Adapt Gmail's frontend to fetch authenticated messages, render safe bodies and issue read/archive/search operations. Browser and connector views must expose the same messages, recipients and timing. Preserve challenge expiry and single-use checks in auth; Gmail must not create or validate codes itself. Use a separate mailbox origin and worker-scoped routing, with reset that clears all browser and server state.

Inbox/search/read, thread retrieval, persisted flags and an SDK-based MCP connector with pagination are implemented. Attachment metadata and retrieval now share episode-scoped ownership, content hashes and one-MiB limits across Gmail and its connector. Existing released messages are unchanged; seeded attachment scenarios are synthetic. Delayed/out-of-order messages and HTML rendering remain unfinished. The BrowserUseAgent connector track registers five MCP tools through its native MCPClient and disconnects them after each task. Registration and real tool calls are validated without a model; autonomous model use remains untested.

The catalog still needs authoritative family mapping, public and authenticated evidence, site implementations, source-matched navigation/help, independent fidelity review and held-out tasks. Expand the nine released slices and separately scoped construction sites to further evidenced portal tenants. A catalog record is not an implemented environment; shared processor branding alone does not prove identical behavior. Track biller coverage, portal-family coverage and supported-flow coverage separately.

Release checks must include human-solvable UI journeys, incorrect-account/method/amount/duplicate failures, fees and cutoff rules, pending versus posted payments, scheduled edit/cancel, recurring cancellation, recovery/OTP, partner-billing limitations, reset leakage and durable traces. Keep unavailable capabilities explicit. Score permitted refusal/limitation outcomes for tasks that cannot be completed online.

Deployment must separate evaluated agents from private tokens, files, databases, app source and grading ports. Loopback binding and owner-only files are useful for this local prototype, but do not isolate an arbitrary code-executing agent under the same operating-system user. Restrict allowed origins/network traffic and agent tools according to the declared browser-only or browser-plus-connector track.

## Other projects in the supplied notes

[BrowserGym](https://github.com/ServiceNow/BrowserGym) and [AgentLab](https://github.com/ServiceNow/AgentLab) are useful if we later need Gym registration and cross-benchmark experiments. They are optional adapters after Infinity integration, not prerequisites for adding billers. [WebArena-Verified](https://github.com/ServiceNow/webarena-verified) is a good precedent for versioned deterministic evaluation and structured answers; it does not supply our billing ledger.

[Mailpit](https://github.com/axllent/mailpit) becomes useful if the implementation sends SMTP mail. It does not supply Google login or a Gmail connector. [mock-oauth2-server](https://github.com/navikt/mock-oauth2-server) can replace protocol machinery if we need broader OIDC conformance, but a password-authentication policy and faithful user journey still need implementation. Replacing our current mocks is optional until a concrete interoperability requirement arises.

REAL, MiniWoB, WorkArena, TheAgentCompany and VisualWebArena can supply design comparisons. OpenApps and AppWorld require separate licensing/scope review before importing code or data. None is necessary to implement this extension, so avoid accumulating parallel frameworks. The supplied recommendation to reuse Infinity is the right immediate direction.

## Decisions with defaults

Use Infinity as the base; keep the research repository and billing domain code as the extension package initially. Preserve existing upstream apps and add billing environments rather than migrating every app's state model. Use browser-only tasks first, with explicit login and mock inbox; add the connector track separately. Treat source-observed fidelity and synthetic stress scenarios as separate cohorts. Use single-attempt success as the headline metric and best-of-N as an additional metric. Adopt these defaults unless the project scope changes.

## Latest saved-method extension

Duluth now supports add, edit, remove and default-method selection through authoritative wallet operations, with a thirteenth Infinity task. The official guide documents these controls and adding a new card when its number changes. Local method validation, duplicate detection, masking, unsubmitted-quote invalidation and blocking removal while AutoPay or a schedule uses a method are declared synthetic policy. Card expiration is now checked at execution, and future scheduled saved methods resolve the current expiration as synthetic local policy. Nine wallet domain checks, two Puppeteer journeys and the scoped `task_h8` upstream reference pass. This adds a biller flow to the existing runner; it does not add a second general framework. PayPal was inspected as a pattern reference; no PayPal wallet source component was imported.

## Grand Valley Power extension

The 0.6.0 slice adds GVP through the existing SmartHub frontend and Infinity lifecycle. Three new reference tasks pass: signed-in payment, registration through Gmail with a temporary password and mandatory password change, and AutoPay enrollment. Six GVP Puppeteer journeys and five AVEC regression journeys pass, along with 88 domain and twenty-four research tests. Prior thirteen Infinity tasks retain their original validation revisions. GVP public branding and policies are sourced; its private identity question, password lifetimes, authenticated layouts, immediate posting and weekend-only calendar are synthetic. Six prototypes and sixteen declared tasks are runtime coverage, with no autonomous-agent score or independently certified site fidelity.

## Swepsonville extension

Release 0.7.0 adds CID registration followed by sign-in, Gmail recovery and InvoiceCloud guest utility payment through the same Infinity lifecycle. Six Swepsonville browser journeys, 94 domain tests, twenty-four research tests and three scoped Infinity references pass. The first desktop registration reference exposed cookie-banner obstruction; visible cookie acceptance and source auth style corrections resolve it. Prior sixteen reference tasks retain their earlier validation revisions. Seven prototypes and nineteen declared tasks are current coverage; bank-draft submission, deposits, separate portal origins and full municipal pages remain unfinished.

## Bank-draft request extension

Release 0.8.0 adds `task_m9` for Swepsonville’s public enrollment form through the existing runner. One new Infinity reference, three bank-draft browser scenarios, six Swepsonville regressions, 97 domain tests and twenty-four research tests pass. There are seven prototypes and twenty declared tasks; prior nineteen Infinity references retain earlier scopes. A pending application is distinct from active AutoPay or a payment. Typed signature and published draft window are observed; acknowledgement, consent checkbox, validation and review lifecycle are synthetic. Activation, exact dates and cancellation remain unfinished.

## Deposit payment extension

Release 0.9.0 adds `task_m10` through the same Infinity runner. The scoped upstream reference, three deposit browser scenarios, nine Swepsonville/bank-draft regressions, 103 domain tests and twenty-four research tests pass. Source entry fields and Town Hall amount instructions are observed; the $150 obligation, identity matching, continuation and settlement are synthetic. Purpose-separated ledger entries prevent a deposit payment from satisfying a utility invoice. Prior twenty Infinity tasks retain earlier validation scopes. Seven prototypes and twenty-one declared tasks remain partial coverage of the catalog.

## Municipal page reconstruction

Release 0.10.0 replaces Swepsonville’s municipal summaries with captured homepage, Utilities and FAQ markup/styles/assets. A small local script implements menu, carousel and FAQ controls; original scripts do not execute. Five municipal scenarios, six Swepsonville regressions, 103 domain tests, twenty-six research tests and all five Swepsonville Infinity references pass. Original source hashes and local script hashes are checked when serving. Other municipal routes/widgets and some uncaptured asset variants remain unfinished. This expands the same Infinity-hosted environments without adding a separate benchmark framework.

The 0.12.0 full reference rerun passes all 24 declared Billworld tasks through the pinned Infinity lifecycle and private verifiers. This includes three medical tasks and regression coverage for all earlier tasks; it is scripted environment validation, not an autonomous model score.

On 0.13.0, all 25 declared billing references pass in a preserved output directory, including MyWVUChart code activation, synthetic account setup and subsequent login/payment. Capture now retains SVG sprite responses labeled `other` and local reconstruction preserves their symbol fragments. This adds environment coverage, not an autonomous score or fidelity certification.

CUSI construction continuation (October 4, 2026): Lockwood now has three draft tasks, including a synthetic card bill payment backed by the same ledger, quote/commit and Infinity Gmail receipt services. The family documentation is reviewed separately from the captured tenant auth pages; neither proves tenant private-layout fidelity or its fees. The draft fee is explicitly simulated and the three tasks remain excluded from released Infinity coverage and score denominators.

The three CUSI draft references now pass the reused Infinity lifecycle in `artifacts/infinity/cusi-construction-cohorts/`; all 31 released references also pass in `artifacts/infinity/released-construction-overlay-regression/`. Authoritative reports verify both directions of score separation (3/0 draft/released and 31/0 released/draft). No-action, failure, cancellation, repetition and owned-worker recovery checks pass for both apps. The evidence is recorded in `research/infinity-cusi-construction-validation.json`; it adds no source-fidelity or autonomous-agent score.
