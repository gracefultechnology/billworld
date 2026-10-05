# Billworld implementation and benchmark plan

Billworld should be a reproducible collection of working biller simulations with a shared billing engine, distinct site experiences, mock identity and communication services, and independently checked task outcomes. The principal risk is building convincing pages that behave incorrectly or yield misleading agent scores.

This plan audits the research repository and defines the work needed to build the gym. The catalog audit is complete. Initial Juneau, Spotify, AVEC/SmartHub, Homer/Xpress, Duluth/Utility Access, Grand Valley Power/SmartHub, Swepsonville/AuthorityPay–InvoiceCloud, WVU Medicine/MyChart and Western Dental/PersonaPay slices now exist with local mailbox, recovery, billing state, mock Google identity where supported, independent grading, aggregate reporting and reference tests; see `billworld/README.md`. Billworld extends WebArena-Infinity's runner, task format, reports and Gmail frontend; see [the reuse review](billworld/infinity/REVIEW.md). Expand billing sites through that extension rather than building a second general benchmark framework. A resumable public research queue covers all 59,477 entries. Full catalog reconstruction, authenticated fidelity review and autonomous-agent benchmarking remain incomplete. Research date: October 3, 2026, America/New_York.

## What the repository contains

The counts below were recomputed directly from the 28 category JSON files using `python3 audit_billworld.py`. They match the entry totals in `COVERAGE.md`.

| Measure | Count | Meaning for Billworld |
|---|---:|---|
| Catalog entries | 59,477 | Biller records, not necessarily distinct websites |
| Detailed entries | 12,021 | Help links researched; authenticated behavior still unproven |
| Roster entries | 47,456 | Mostly discovery records needing further research |
| Entries with website | 42,810 | 16,667 have no website field |
| Entries with login URL | 10,923 | Login route missing from 48,554 records; absence does not establish lack of login |
| Entries with help center | 10,612 | Public documentation discovery remains substantial |
| Entries with processor description | 17,899 | Descriptions need normalization and evidence |
| Existing verified flags | 32,678 | Repository-level claims; no per-flow evidence attached |
| Distinct processor descriptions | 6,020 | These are free-text strings, not 6,020 proven platforms |
| Processor cross-reference rows | 2,485 | 2,411 use category labels absent from current category filenames |

For detailed entries, 7,985 have login URLs; 11,032 have pay links; 7,287 have autopay setup links; 5,591 have autopay cancellation links; 6,880 have history links; and 4,068 have paperless links. Across all entries, 7,097 use the same URL for autopay setup and cancellation. That may be legitimate documentation, but it does not prove the cancellation interaction.

At the initial audit, no application runtime, package manifest, downloaded bundles, screenshots, DOM captures, authenticated reference recordings, fixtures, task definitions, evaluators, or Puppeteer tests were present. Subsequent implementation added the first runtime and reference tests under `billworld/`, plus four public Juneau captures with loaded assets. Authenticated reference recordings and catalog-wide implementations remain absent. Existing research scripts aggregate and clean research; they do not establish flow fidelity.

`finalize.py` intentionally drops research metadata. Billworld needs a separate evidence store that survives these merges. `build.py` counts populated fields rather than checking flow correctness. Preserve the existing research records and add a dedicated catalog layer rather than changing what `verified` means retroactively.

### Audit artifacts

Run `python3 audit_billworld.py` to generate:

- `billworld-audit/summary.json`: counts, missing fields, candidate family counts, and cross-reference issues.
- `billworld-audit/catalog_backlog.csv`: all entries, source file, provisional ID, missing fields, and initial evidence status.
- `billworld-audit/pilot_candidates.csv`: 7,949 detailed entries with website and login fields, ranked by documentation link count. This ranking measures completeness only, not correctness, importance, or fidelity.

The candidate family classifier is a conservative substring heuristic over processor and login fields. Its output is a research queue, not proof of shared frontend code or identical behavior. It leaves 51,729 entries unclassified and preserves ambiguous multiple matches. Generated artifacts are ignored by Git; the script is reproducible. Replace provisional identity hashes with curated immutable IDs before production because names and service areas can change.

## Scope and proposed first release

Track the entire catalog, but build and validate a representative release before expanding. Proposed first release: 12–20 biller experiences spanning about 8–12 portal families, with 100–200 reviewed tasks after the first vertical slice. These are scope recommendations, not effort estimates or measured coverage.

Choose sites by distinctive interaction patterns, evidence quality, portal family, bill type, customer relevance, and research access. Do not select solely by customer estimates or the number of populated links. Use at least two tenants of important shared portals to expose configuration differences. Include one site where online completion is unavailable, so appropriate limitation reporting can be tested.

| Candidate | Purpose | Evidence status |
|---|---|---|
| Juneau utilities and InvoiceCloud | Guest invoice lookup, account registration, fees, recurring billing | Public FAQ fetched; authenticated UI not captured |
| AVEC and NISC SmartHub | Registration with account matching, recurring date, processor handoff | Public payment docs fetched; authenticated UI not captured |
| Con Edison | Branded utility homepage, guest and signed-in payment paths | Public payment page fetched; private flows unobserved |
| A second InvoiceCloud or SmartHub tenant | Check whether family implementation generalizes | Select after direct research |
| A Paymentus tenant | Payment portal configuration and biller handoff | Catalog candidate only |
| A Tyler municipal tenant | Municipal bill search and payment | Catalog candidate only |
| A KUBRA or ACI Speedpay tenant | Alternate payment engine | Catalog candidate only |
| An Epic MyChart hospital | Guest guarantor lookup versus signed-in patient billing | Catalog candidate only |
| A PersonaPay provider | Different medical statement and payment interaction | Catalog candidate only |
| A Synchrony or Bread Financial card | Minimum payment versus statement balance | Catalog candidate only |
| A telecom site such as Xfinity or AT&T | Multiple services, accounts, and authentication | Catalog candidate only |
| A Yardi RentCafe tenant | Property and lease account selection | Catalog candidate only |
| Spotify or another subscription site | Subscription billing and social identity if observed | Catalog candidate only; attempted Spotify account fetch failed |
| A government tax or Pay.gov experience | Tax periods, installments, reference numbers | Catalog candidate only |

A site may span several billers, and a biller may span several sites. Utilities consolidated on another bill, taxes paid through mortgage escrow, and discontinued or merged brands should not receive invented independent payment flows. Classify each record as active independent portal, shared tenant, consolidated billing, offline-only, successor, unresolved, or excluded with a reason.

## Catalog completion and evidence

Add a machine-validated schema and an explicit lifecycle: discovered → identity resolved → public evidence captured → authenticated behavior documented or declared inferred → flow specified → implemented → tested → fidelity reviewed → benchmark ready. A blocked stage must have a reason, evidence owner, next action, and retry policy. Report both distinct billers and distinct portal implementations at every stage.

Keep immutable `biller_id`, `portal_id`, `family_id`, tenant configuration, successor relationships, public dataset IDs, domain ownership evidence, and source record references. Resolve duplicates across categories without collapsing different products or accounts. Rebuild the processor cross-reference against canonical IDs; normalize names with an alias table and preserve the original text. Free-text processor mentions can refer to alternatives, guest checkout, or underlying processing rather than the primary account portal.

Each route and flow needs source URLs, final redirect URL, capture time, viewport and locale, content hash, route/state identifier, evidence file references, and an evidence label:

- **Observed public:** directly captured public page or interaction.
- **Observed authenticated:** captured using an authorized reference account or recording.
- **Documented:** official help describes behavior that has not been directly observed.
- **Inferred:** behavior inferred from a platform or related tenant.
- **Synthetic:** chosen specifically for the simulator or benchmark.

Store support as `supported`, `unsupported`, `unknown`, or `not_applicable`, separately from a missing URL. Never let a filled link or synthetic flow upgrade a source's evidence status. Report the percentage of task-critical states supported by direct observation; keep inferred tasks in a separately labeled benchmark cohort.

### Capture package for each site

Capture the homepage and navigation to account management; sign-in, enrollment, username recovery, password reset and challenges; dashboard and account selection; current bill and downloadable statement; guest payment; payment methods, review, submit and receipt; payment history and pending payments; scheduling, editing and cancellation; autopay setup/change/cancellation; paperless settings; task-relevant FAQs and help search; terms, cutoff times and fees; and useful validation/error states.

Collect rendered screenshots, HTML, DOM and accessibility trees, route transitions, loaded JS/CSS/fonts/images, public source maps if present, and network metadata where permitted. Record popups, frames, redirects, hash routes, cookies, lazy loading, browser history, disabled controls, labels, focus order, consent banners, responsive layouts, and session expiry. Retain relevant public PDFs and reproduce synthetic statements with searchable text. Link discovery must include subdomains and officially linked processor origins.

Public SPA assets are useful reconstruction material, but they do not guarantee recoverable original source or private business logic. Minified bundles can depend on private APIs, feature flags, server rendering, licensed packages, missing chunks, and live identity services. Choose per site between licensed asset reuse with local APIs, selected local replay, and reimplementation from observed behavior. Preserve interactions and error semantics as well as appearance. A blanket download-and-serve strategy is not sufficient.

Do public read-only research under the existing `SCHEMA.md` rules. Authorized accounts or user-provided recordings can provide authenticated evidence when available. Do not fabricate exact private screens from public screenshots. Separate capture infrastructure, which needs public-network access, from benchmark runtime, which must remain local. Track capture rate limits, robots/terms information, unavailable pages, provenance, and reuse permissions; resolve distribution rights for each copied asset before public release.

## Runtime architecture

Architecture decision: extend WebArena-Infinity and reuse its existing evaluation runner, AgentRunner interface, task format, worker orchestration and HTML reports. Add billing apps and shared domain services through a small private lifecycle adapter. The pinned checkout and first twenty-one tasks are implemented; see [the reuse review](billworld/infinity/REVIEW.md) and [extension instructions](billworld/infinity/README.md). A new general runner is unnecessary. The full catalog now has a source-linked family/coverage index and versioned construction packets for the existing generation workflow; see [the catalog workflow](billworld/research/CATALOG_WORKFLOW.md). Its pinned Gmail frontend now connects to the authoritative episode mailbox, with an SDK-based MCP email connector; BrowserUseAgent now receives episode-scoped MCP email tools in the optional connector track.

The current domain service uses Node 24 and SQLite, with separate mock Google and private grading origins, plus Puppeteer against a pinned Chromium build. Local HTTPS routing and hardened deployment isolation remain planned. Site frameworks should follow the captures rather than forcing every portal into the same layout.

Use a shared domain engine with site-specific components, routes, policy adapters, and content. Sharing business logic is useful; standardizing every button, navigation path, and error message would undermine the navigation benchmark.

Separate these components:

1. Public site shells and docs, preserving each site's navigation and terminology.
2. Authentication service with per-site capabilities and session behavior.
3. Mock Google identity provider with its own origin and account chooser.
4. Mock mailbox with browser UI and an agent connector over the same message store.
5. SMS inbox and other simulated challenge channels where the target site uses them.
6. Billing ledger, payment methods, autopay scheduler, documents, and payment processor adapters.
7. Episode controller for seeding, reset, virtual time, faults, resource limits, and traces.
8. Evaluator outside the agent's trust boundary, reading authoritative state and event history.

Use Infinity's lifecycle now: private episode preparation, fresh browser entry, agent execution and independent verification. A BrowserGym adapter can add Gym registration later if cross-benchmark experiments require it. Terminal success and truncation from time or action limits must be distinct. Individual attempt success is the primary metric; Infinity's merged repetition score is reported separately as best-of-N.

Use separate browser contexts and tenant namespaces for concurrent episodes. Reset database state, cookies, local/session storage, IndexedDB, service workers, cache, mailbox, identities, uploaded files, scheduler jobs, and payment idempotency state. Freeze or explicitly advance a virtual clock. Seed names, balances, invoice dates, account numbers and outcomes reproducibly; distinguish reproducible randomization from accidentally fixed OTP codes.

## Authentication and communication behavior

Mock Gmail and mock Google login are separate systems. Gmail delivers or displays messages; Google identity establishes an account and returns an identity assertion. A mock email connector alone cannot implement Sign in with Google.

Implement only the authentication capabilities that each site supports, with unknown capabilities marked unknown. The capability matrix should cover password versus account-number login, email magic link, username recovery, enrollment and account linking, email/SMS/TOTP challenges, device trust, backup codes, optional step-up verification, lockout, session timeout, reauthentication, and social login. Passkeys, authenticator enrollment, CAPTCHA, push approvals, Apple login, or other providers can become later cohorts when relevant evidence exists. Do not add a Google button to a site simply because Billworld supports Google identity.

For password recovery and OTPs, model single use, expiry, resend cooldown, invalid code, delayed delivery, superseded challenges, account association, and reset completion. New passwords must work afterward; old credentials and sessions should follow the configured policy. Include misleading old messages and multiple accounts so agents must select the correct recipient and challenge. For SMS or push-only sites, use the correct mock channel rather than replacing the challenge with Gmail.

The Google simulation should support account selection, login where required, consent where appropriate, cancellation, redirect versus popup, account linking, and local callback validation. Use an OIDC-like contract with state, nonce, issuer/audience validation and one-use authorization codes; use PKCE where the chosen integration requires it. Give the mock issuer its own local identity. Google's documentation explains state and nonce handling and the stable `sub` identifier; Billworld should exercise these behaviors locally rather than connect to real accounts. [Google OpenID Connect documentation](https://developers.google.com/identity/openid-connect/openid-connect).

The mail connector should offer documented search/list/read/thread/attachment/mark-read operations and practical Gmail-like query semantics for the declared subset. Return normal sender, recipient, subject, received time, thread, HTML/plain text and attachment metadata. Do not expose challenge IDs, grader flags, or hidden OTP fields as special convenience APIs. Browser UI and connector must read the same messages with identical delivery timing. A synthetic credential vault or fixture provides initial credentials and required account identifiers through the permitted agent interface. The evaluator cannot silently supply missing secrets during a run.

Messages and sites must agree on names, accounts, masked numbers, amounts, dates, locale and time zone. Email templates include registration verification, challenges, resets, new bills, scheduled payments, receipts, declined/returned payments and autopay changes. Restrict mailbox access to the episode's authorized persona.

## Billing semantics that pages alone cannot supply

Use integer minor currency units with explicit rounding rules, a payment ledger, invoice allocations, and durable transaction identifiers. Separate amount due, past due, minimum due, statement balance and current balance. Payment status should distinguish drafted, scheduled, submitted, pending, posted, failed, returned, cancelled and reversed. A success banner does not necessarily mean settlement or a zero balance.

Support the methods and limits relevant to each site: saved versus new bank/card, convenience fees, full/partial/other amount, minimum and maximum amounts, cutoff times, due dates, banking days, time zones, pending-payment deductions, duplicate submissions and insufficient funds. Some capabilities belong to a processor rather than the biller. Payment retries after a timeout need reconciliation and idempotency so the agent cannot pay twice.

Autopay needs distinct amount policies, start date, next run, funding source, enrollment state, confirmation, cutoff/cancellation rules, and interactions with an existing scheduled payment. Cancelling autopay must not automatically erase a pending debit unless that site's rule says it does. Removing a funding source may require another method or cancellation first. Subscription cancellation, autopay cancellation, payment cancellation, and account closure are different operations.

Bank bill-pay tasks involve payee lookup, delivery date versus send date and potentially mailed checks; credit cards involve minimum or statement balances; mortgages may involve escrow or principal-only allocation; medical bills may require guarantor and statement identifiers; taxes may require parcel IDs, tax periods and installments; telecoms may span multiple service accounts; rent may involve property and lease selection. Track these as policy adapters, not universal form fields.

Useful failure cases include invalid account lookup, registration before first bill, unavailable payment method, expired card, ACH validation, card decline, returned ACH, timeout after successful submission, duplicate click, old statement, overpayment, ambiguous account, stale session, outage and human-only completion. Every scenario needs intended behavior and testable state transitions.

The task-critical state must stay consistent across dashboard, invoice PDF, history, confirmation and mailbox. Updating a display without updating the ledger should fail validation.

## Task design and trustworthy scoring

Each versioned task needs a natural-language request, permitted actions and consent, starting URL or site-discovery requirement, persona, initial credentials, account identifiers, fixture seed, time/step/tool budget, difficulty, capability tags, evidence cohort, expected outcome predicates, forbidden side effects, and an evaluator version. Credentials and initial login states should vary intentionally; include both authentication-inclusive and preauthenticated tasks and score them separately.

Example: “Pay Juneau's current $84.32 water bill from checking ending 1048 with no convenience fee. Leave autopay off and report the confirmation number.” The seed supplies two invoices, an existing saved checking account, a credit card with a fee, and an older receipt email. An independent grader checks the correct invoice allocation, amount, method, fee, absence of extra payments, unchanged autopay, and reported confirmation number. The amount and identifiers here are synthetic examples.

Grade authoritative state and the action/event history. A final state can conceal a prohibited action later reversed; inspect the trajectory for unauthorized payments or disclosure. Evaluate reported values against recorded outcomes, accepting valid formatting variations. Keep task secrets, expected outcomes, seed metadata and grader endpoints out of agent-visible DOM, APIs, files and process environment. Explicitly decide whether agents may call ordinary site APIs or must use browser interactions.

Primary metric: first-attempt strict task success. The private report now implements this separately from best-of-observed-attempts, with started/active/terminal counts and persisted failure causes. Native repetition lineage and interrupted-worker recovery are tested; whole-job dispatch accounting, action budgets and uncertainty estimates remain unfinished. Require all goal predicates plus all side-effect constraints; partial credit is diagnostic and must not mask wrong-account or duplicate-payment errors. Report navigation/auth/payment/recovery success separately, safe abstention for deliberately impossible tasks, unauthorized-action rate, duplicate-payment rate, answer correctness, latency, actions/tool calls, tokens and cost when available. Keep environment errors separate from agent errors and report both counts and rates. Predefine rerun policy; do not silently discard failed runs.

Macro-average across portal families and task types, alongside task-level and biller-level scores. A thousand reskins of one portal must not dominate the headline result. Publish repeated seeded trials and confidence intervals with clustering by family/task when appropriate. Freeze model, agent scaffold, prompts, tools, observation mode, browser build, budgets and environment revision. Scores from browser-only and browser-plus-connector tracks need separate leaderboards.

Avoid train/test leakage across sibling brands and portal tenants. Split by portal family for structural generalization, by tenant for familiar-family generalization, and by scenario/seed for variation within a known site. Hidden evaluation tasks and perturbations should remain outside released training fixtures. Include paraphrased requests, varied balances and accounts, realistic UI changes and unsupported tasks. Publish known fidelity limits; simulator success alone does not establish real-site reliability.

WebArena-Verified provides a useful precedent for curated, versioned tasks and deterministic evaluators rather than unchecked reference answers. Billworld should additionally grade its authoritative billing state. [WebArena-Verified repository](https://github.com/ServiceNow/webarena-verified).

## Puppeteer verification and fidelity review

Verification has separate layers: correct simulator behavior, similarity to the source, valid task definitions, and agent performance. Puppeteer validates the simulator; it cannot establish original-site equivalence without independent reference evidence.

| Layer | Required evidence |
|---|---|
| Catalog and research | Schema validation, ID uniqueness, documented redirects, evidence classification and source hashes |
| Domain engine | Meaningful tests of fees, allocation, idempotency, settlement, auth expiry and scheduler behavior |
| Browser flow | Puppeteer navigation through visible controls with independent state assertions |
| Fidelity | Reference screenshots/routes/labels and human review of critical transitions |
| Evaluator | Known successful, unsuccessful and malicious trajectories graded correctly |
| Harness | Deterministic reset, concurrent isolation, bounded runs, offline operation and artifact replay |

Per site, test homepage → correct portal → sign-in → dashboard → bill → method → review → submit → receipt → history. Add logout and reload persistence. Test enrollment and password recovery, email/SMS challenges, observed social login, guest payment, scheduled payment edit/cancel, autopay enable/change/cancel, paperless and statement download where supported. Each unsupported feature gets an explicit capability expectation.

At minimum, exercise wrong password, expired/superseded OTP, wrong account, old email, declined payment, refresh/back/double submit, timeout after commit, existing pending payment, session expiry during checkout, fee restriction, delayed posting and cross-site redirects/popups. Use real controls in browser reference scripts; setup fixtures and privileged state reads stay outside the agent-visible interface.

Pin browser, locale, viewport, fonts and clock for screenshots. Compare key regions and navigation structure with reviewed tolerances; mask only known nondeterministic areas. Test accessibility names, focus, keyboard entry, downloads and frames. Prefer conditions on UI state and expected responses over arbitrary sleeps. Puppeteer's locator API provides action readiness behavior. [Puppeteer page interactions](https://pptr.dev/guides/page-interactions).

Record console errors, failed requests, screenshots, DOM/accessibility snapshots, redirects, traces, resulting state and evaluator output for failures. Sanitize reference captures to remove real personal data, credentials, cookies and tokens. Disable live analytics, outbound mail and real payment requests. Runtime network isolation must be enforced below the page layer, including new tabs, workers and service workers. Puppeteer interception is a useful diagnostic/guard but is not the sole containment boundary; every intercepted request needs a resolution. [Puppeteer request interception](https://pptr.dev/guides/network-interception).

Grader validation must include false-positive attacks: receipt text without ledger commit, wrong amount, wrong account, wrong funding source, duplicate payment, pending treated as posted, unauthorized autopay change, and direct access to private grading endpoints. Reference success scripts must pass; known failure scripts must fail. Add human review of task wording and solvability to catch impossible or ambiguous tasks before measuring agents.

## Definition of done

A site becomes benchmark ready only when its capability matrix and evidence labels are reviewed, required pages and help routes run locally, permitted flows persist correct state, negative scenarios behave as specified, its reference Puppeteer suite passes, fidelity deviations are documented, evaluators reject invalid outcomes, reset reproduces the fixture, and runtime has no real-service dependencies.

Proposed release acceptance gates:

- All declared reference tasks pass in five clean seeded runs on the pinned browser; known-failure and wrong-side-effect traces score failure. Five is an initial gate, not proof of zero flakiness.
- Zero observed duplicate payment commits in retry/double-submit tests, zero cross-episode data access, and zero permitted live-service requests in offline runtime tests.
- Every task has enough visible information and permitted credentials to solve it or an explicit expected limitation outcome.
- Every task-critical transition has an evidence label; directly observed and inferred cohorts are distinguishable in results.
- Capture and runtime versions, fixture seeds, task and grader versions, artifacts, and score aggregation can reproduce a published run.

## Delivery sequence and dependencies

| Phase | Deliverable | Exit gate |
|---|---|---|
| 0 Catalog audit | Current script, summary and complete entry backlog | Counts reconciled and limits documented; completed for this repository |
| 1 Catalog model and capture | Canonical IDs, normalized portals, 12–20 candidate dossiers, source captures | Scope selected; unknowns and access gaps explicit |
| 2 First vertical slice | Juneau-like guest and registered flows, mailbox, identity, ledger, reset, grader | One coherent task passes through browser and independent state grading |
| 3 Portal and auth diversity | SmartHub-like experience and an observed social-login site | Shared engine handles distinct policies and cross-origin authentication |
| 4 Benchmark pilot | 100–200 reviewed tasks, adversarial grader cases, reference scripts and baseline agents | Reproducible strict scores and documented fidelity limits |
| 5 Catalog expansion | Additional validated tenant experiences and new portal families | New sites meet the same gate; coverage reported by stage and family |
| 6 Publication if desired | Packaging, asset permission review, documentation, versioned releases | Reproducibility and distribution requirements met |

Treat phase 2 as a complete slice rather than finishing all homepages first. It exposes dependencies among UI, email, billing state and scoring while the implementation is small. Authenticated-source access may be the slowest dependency; inferred behavior can proceed in a clearly labeled cohort.

Estimate effort after one simple shared portal and one complex proprietary portal have been captured and implemented. Track capture hours, implementation hours, reviewer time, browser/storage costs, failure rate and maintenance per family and tenant. A 59,477-entry catalog does not justify an estimate of 59,477 identical builds. Assign ownership for research, site implementation, shared services, task design, grading and release review even if one person fills several roles.

Schedule drift monitoring only if requested. Recheck official routes and task-critical policies before a new release; pin existing releases rather than silently changing scored tasks. Maintain a changelog and migration notes for catalog, auth, billing, fixtures, tasks and graders.

## Questions and recommended answers

| Decision | Recommended answer | Why it matters |
|---|---|---|
| Does “all websites” mean every record or distinct portal experiences? | Track all records; implement distinct experiences and validated tenant variants incrementally | Scope and denominator must be explicit |
| What comes first? | 12–20 sites, then expand by measured interaction diversity | Makes a runnable benchmark possible while full catalog research continues |
| Is visual or behavioral fidelity primary? | Both for task-critical screens; behavior first, with explicit screenshot review | Agents react to affordances as well as state |
| Can authenticated screens be observed? | Authorized test accounts or recordings where available; inferred labels elsewhere | Public docs cannot establish exact private UI |
| Internal or public? | Internal first; resolve asset reuse and distribution before publishing | Capture and redistribution requirements differ |
| Which interfaces can agents use? | Browser-only and browser-plus-email-connector tracks, scored separately | Prevents unfair tool comparisons |
| Where do credentials come from? | Episode-scoped synthetic credential fixture or declared vault tool | Login must be solvable without hidden shortcuts |
| What does “password grants” mean? | Treat as password reset and magic-link recovery unless clarified | A protocol grant is different from recovery email |
| Is Google login required everywhere? | Only where directly supported; local mock identity provider | Avoids inventing source capabilities |
| What about non-email MFA? | Mock SMS/TOTP and later push/passkeys where needed | Gmail alone cannot cover all challenges |
| What does successful payment mean? | Task-specific ledger outcome with exact amount, account, method, fees and no prohibited effects | A clicked button or receipt text is insufficient |
| Can agents submit payments immediately? | Tasks carry explicit authorization; “prepare” and “execute” tasks differ | Measures compliance with the requested stopping point |
| Do bots face CAPTCHA? | Deterministic labeled mock scenarios, separate from core navigation scores | Avoids uncontrolled third-party behavior |
| What languages/devices? | Desktop English first, then mobile and other languages as separate cohorts | Defines captured routes, screenshots and score comparability |
| Are failures and impossible tasks included? | Yes, with known recovery or expected limitation outcomes | Realistic tasks require judgment and restraint |
| Do scores measure real-world reliability? | Simulator performance only until tested against independent real reference journeys | Faithful-looking clones can still omit important behavior |
| What are budget and deadline? | Calibrate after two representative slices; do not promise total catalog reconstruction yet | Evidence access and portal diversity dominate effort |

## Direct public research used in this plan

These public pages were fetched for this planning pass. They provide useful flow documentation, not authenticated UI recordings. Existing category verification flags were not changed.

- [Juneau utility FAQs](https://juneau.org/engineering-public-works/utilities-division/faq): guest invoice search and payment, registration, fees, sign-in and autopay instructions. This establishes documented flow structure; it does not show every private screen.
- [AVEC billing and payment options](https://avec.org/customer-service/billing-and-payment-options/): SmartHub handoff, account-matching registration requirements, scheduled payments and recurring-payment options. Exact challenge UI remains unobserved.
- [Con Edison payment options](https://www.coned.com/en/accounts-billing/payment-options): guest and account payment entry points and bank-account autopay documentation.
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect): identity callback validation and token semantics for designing the local identity simulation.
- [Puppeteer interactions](https://pptr.dev/guides/page-interactions) and [request interception](https://pptr.dev/guides/network-interception): browser verification mechanisms and their limits.
- [WebArena-Verified](https://github.com/ServiceNow/webarena-verified): task curation, versioning and deterministic evaluation precedent.

The InvoiceCloud marketing homepage was also fetched; it redirected to invoicecloud.net and did not establish tenant flow behavior. An attempted Spotify account-page fetch failed and supplies no positive evidence.

The catalog frontend inventory is complete for saved HTML (62,514 verified bodies); public static asset downloading continues across 714,102 unique URLs. Batavia and Lockwood source packets now include all nine and twenty-eight inventoried references, respectively. Single-biller packet reads use verified candidate spans and selective capture lookups. Lockwood's public company password JSON supplies its draft minimum and class requirements, replacing the older synthetic ten-character rule. The 128-character maximum, exact class interpretation and reset grant remain synthetic. Validation: 188 domain checks, 62 research checks, four CUSI browser scenarios and all six Infinity construction references. These are construction milestones; all 59,477 catalog records remain in scope, with nine released sites, thirty-one released tasks, no independent fidelity certifications and no autonomous scores. See `billworld/research/frontend-priority-validation.json`.

### Lockwood registration construction

The existing Infinity construction app contains seven draft tasks, including Lockwood registration/new-user login. It follows the captured account/phone entry and public four-stage client sequence, with reconstructed private continuation. Validation passes 194 domain/HTTP checks, 66 research checks, four registration Puppeteer scenarios and all seven Infinity construction references, including failure/deadline handling, repetition lineage and owned-worker crash recovery. The shared reference accepts required cookies before Register. Startup/recovery now has a separate 60-second elapsed-time limit; task deadlines are unchanged. The refreshed source packet has 28 static frontend assets and one public password configuration; original scripts remain reference-only. See `billworld/research/cusi-registration-construction-validation.json`.

The full catalog collector also has tested progress-count query improvements; see `billworld/research/frontend-progress-query-validation.json`. The queue remains unfinished. Released coverage remains nine sites and thirty-one tasks, with no independent fidelity certifications or autonomous-agent scores; all 59,477 catalog records remain in scope.

### Catalog-scale public asset loading

Workers now load reconstructed public snapshots on demand with hash/path checks and a bounded LRU cache, rather than retaining every captured page asset at startup. `npm run audit:snapshots` checks the full reconstructed set independently of request coverage. The current audit passes 37 captures and 1,739 files (89,516,181 bytes), and 203 domain checks plus four registration and four public-page browser scenarios pass. All 31 released and seven construction Infinity references also pass, including failure/deadline handling, repetition lineage and owned-worker crash recovery; see `billworld/research/lazy-snapshot-validation.json` for the completed run evidence and scope. Single local startup observations were 3.3 seconds after this change and 14.1 seconds before it; these are not controlled performance measurements. The full catalog and fidelity/measurement work remain unfinished.

### Catalog source progress without per-batch full scans

All 31 released and seven construction Infinity references pass after lazy snapshot loading. The frontend collector now uses an asset/scope covering index and existence queries for full totals, records initialization ownership, and separates each batch’s committed outcomes from explicitly dated full counts. Full counts default to every 25 batches and clean completion/stop. All 69 research checks pass; the verified successor completed multiple 100-asset batches without blocking on a full count. See `billworld/research/frontend-periodic-progress-validation.json`. Neither this source progress nor scripted reference success adds independent fidelity certification or autonomous-agent scores.

### Offline frontend dependency evidence

Source packets now carry hash-bound literal JavaScript/CSS dependency candidates from inert source parsing. Lockwood's 28 assets yield 401 references (295 unique URLs), and Batavia's nine yield 200 references (136 unique URLs). Four stylesheets have explicit partial parsing; embedded resources remain unresolved and child assets are not yet collected. Validation passes 208 JavaScript checks and 76 research checks, including cache invalidation, malformed/ambiguous source, redirect resolution, source tampering, frontier advancement and stale packet exclusion. See `billworld/research/frontend-dependency-validation.json`. Existing Infinity/browser validation remains dated in the snapshot report; this research change adds no runtime tasks, fidelity certifications or autonomous scores. All 59,477 catalog records remain in scope.

### Verified child source collection

Literal script/style child collection now advances in resumable biller-rooted batches, separate from direct HTML references. It rebuilds verified parent chains before export, handles cycles, reuses existing direct captures, records failed attempts for explicit retry and enforces finite depth/node limits plus directory ownership and disk reserve. Batavia's first batch captures 30 of 30 selected sources; 95 more candidates remain pending. Its refreshed Infinity construction packet includes these sources and separate parent-source hashes. All 81 research checks and the five parser regressions pass. See `billworld/research/frontend-child-capture-validation.json`. Computed chunks, source maps, resources and complete catalog reconstruction remain unfinished; no runtime tasks or certified coverage are added.

### Registered-profile recovery and Batavia source frontier

CUSI registration can store a login email different from the utility contact; reset links and password-change notifications now use that login email, with a fallback for older profiles. Domain checks preserve utility contact and prohibit access to an unowned mailbox. A Puppeteer journey passes UI registration, Gmail link opening, HttpOnly reset grant, old-password rejection and restored login with distinct contact/login addresses. All 210 JavaScript and 81 research checks pass; initial Chromium-startup and parallel MCP timeout failures are preserved with passing retries. Original private delivery behavior and alias ownership remain unverified. See `billworld/research/cusi-profile-recovery-validation.json`; the new full construction Infinity regression is recorded separately while running.

Four Batavia child-source batches capture 141 verified bodies and export their current chains into the Infinity packet. No eligible candidate is pending within the current traversal, but the depth-three bound is reached. This does not establish complete SPA dependency coverage. See `billworld/research/batavia-child-frontier-validation.json`. Full catalog reconstruction and agent/fidelity measurements remain unfinished; all 59,477 records stay in scope.

### Already-registered CUSI recovery branch

The captured registration family bundle contains an already-registered reset-email dialog gated by disabled multi-registration. The draft now follows matched account/phone lookup, account review/confirmation, recovery dialog, one email and the existing Gmail reset/new-password login flow. The tenant flag, modal layout and private delivery policy are unobserved and remain synthetic. Grants bind to purpose, episode, matched account, review stage and expiry; retries do not resend or replace credentials, and forged body IDs/tokens are ignored. The Puppeteer alternative journey satisfies the existing private password-recovery grader without adding a task. See `billworld/research/cusi-registered-recovery-validation.json` for checks and current regression status. The preceding profile-email seven-task Infinity regression has also completed. Released scope remains nine sites and thirty-one tasks, construction scope seven tasks; independent fidelity and autonomous scores remain zero.

Current validation passes 213 JavaScript checks, 81 research checks, the alternative Puppeteer recovery journey and all seven construction Infinity references including lifecycle/repetition/owned-worker recovery. The new transport test's initial cookie-jar error is retained with the passing corrected full run. The rendered registration Login button also passes visual inspection after its contrast correction. These checks establish local construction behavior, not original private-flow fidelity or autonomous-agent reliability.

### Build provenance for comparisons

Trials now persist process-import source/lockfile and declared-snapshot fingerprints; private scores and Infinity results carry environment/evaluator IDs separately from the package revision. Reports expose per-build outcomes, active counts, build filters and an explicit mixed/unrecorded status. Retry lineage no longer combines different fingerprints, and a restored episode with a recorded build mismatch is an environment error. This is selected filesystem-input provenance, not a hermetic image, loaded-module attestation or full body-integrity certification. Snapshot audit, OS/browser/provider versions, isolated deployment, held-out tasks and actual agent runs remain necessary. See `billworld/research/build-fingerprint-validation.json` for current evidence and validation status.

### Catalog classification without full candidate retention

Catalog classification now retains source-hash-bound static provider-host hints, with metadata-only freshness and explicit unreviewed status. It reads route candidates one biller at a time, projects capture classification fields and keeps only selected family/category representatives. Failed rebuilds preserve the prior snapshot; summaries bind the resulting index SHA. All 89 research checks pass, with 19 focused checks passing after the final source-change guard. Lockwood and Batavia construction packets are refreshed. A further 500-source dependency batch contains 454 parsed, 44 partial, one decode error and one parse error, with 1,399 literal references. See `billworld/research/static-provider-signal-validation.json` for dated evidence and rebuild status. These research changes add no runtime coverage or certification; all 59,477 records remain in scope.

The full rebuild completed and its index SHA matches the summary. Static provider-host hints occur in 2,875 records; 48,330 records still have no family signal. These hints remain unreviewed and grant no implementation or fidelity credit.

### Batavia bank payment construction

Infinity's construction app now has eight tasks, including Batavia linked-account bank payment. The shared ledger validates a new bank instrument, binds review to the episode/login session, requires authorization, protects pending balances and commits idempotently. The private grader checks exact funding instrument and holder name, bill/amount/fee, view/review/commit order, receipt and unchanged business state. The $3.50 fee, $500 bill-amount limit and immediate posting are explicit synthetic construction policy; current private checkout and settlement remain unverified. The 141 city child sources are Apptegy assets, not complete Paymentus portal source.

Validation passes 221 JavaScript checks, 89 research checks, three payment Puppeteer scenarios, four auth and five registration browser regressions. All eight Infinity construction references pass before final holder-name/wording refinement; the final task_c8 plus lifecycle, repetition and owned-worker recovery also pass. Initial browser-startup, old assertion and missing harness-map failures are preserved with passing fixes/retries. See `billworld/research/batavia-payment-construction-validation.json`. Released scope remains nine sites and thirty-one tasks; independent fidelity and autonomous scores remain zero. Card, wallet, AutoPay, statement documents and current private fidelity still require work across the full catalog.

### Batavia card payment construction

The same checkout now supports a new synthetic card and a ninth Infinity construction task. Card checksum, expiry and security code are validated; full card numbers and security codes are not persisted. Declines leave the bill unpaid and offer a visible route back to bills for another review. The grader checks full instrument identity, holder name and expiry, plus unchanged business state. Card capability is documented publicly, while private one-time checkout, the $3.50 fee, $500 bill-amount limit and immediate posting remain synthetic/unverified.

All 226 JavaScript checks, 89 research checks and 26 focused Paymentus checks pass. Two card Puppeteer scenarios and the three bank regression scenarios pass without page errors or external requests. All nine Infinity construction references pass, including lifecycle, repetition and owned-worker recovery, and their build IDs match current source inputs. The refreshed packet retains city/portal evidence boundaries. See `billworld/research/batavia-card-construction-validation.json`. Released coverage remains nine sites/thirty-one tasks with zero independent fidelity certifications or autonomous-agent scores; all 59,477 records remain in scope. Saved wallet, AutoPay, full statement/history/profile flows and catalog-wide reconstruction remain unfinished.

### Batavia payment history construction

Payment History now renders masked authoritative local records for verified linked accounts, preserving pending status, bill/account identity, fee/total and confirmation. A tenth Infinity construction task requires opening history after committing payment; existing payment tasks retain their requirements. All 230 JavaScript checks, 89 research checks, four history domain checks and three Puppeteer scenarios pass. All ten Infinity construction references pass with current matching build IDs, including lifecycle/repetition/worker recovery. The prior interrupted run has no summary and receives no pass credit. See `billworld/research/batavia-history-construction-validation.json`. Current original history layout, retention/channel coverage and full statement/profile/wallet/AutoPay fidelity remain unverified; no released or certified coverage is added.

The next finite dependency batch completed 1,000 inert source analyses: 913 parsed, 85 partial, one decode error and one parse error, yielding 3,352 literal references. See `billworld/research/catalog-dependency-batch-003-validation.json`; computed/runtime dependencies and catalog completeness remain unfinished. The static source collector exited at its configured capacity reserve after 751 batches. After external disk availability recovered to 24 GiB, its absent PID and terminal capacity exit were verified and a successor resumed without deleting evidence. `billworld/research/frontend-capacity-resume.json` records this restart; collecting source is not reconstructed runtime coverage.

### Batavia bill history construction

Bill History now lists synthetic linked-account invoice summaries with original amount, posted credit, pending reservations and remaining payable balance. Fees do not count toward bill credit; pending full payment does not label a bill settled or offer a duplicate payment. The private original statement PDFs, itemized content and current history retention/layout remain unverified or unfinished. The three official help/enrollment PDFs were already locally served with verified bytes and were not duplicated.

All 233 JavaScript checks, 89 research checks, three bill-history domain checks and five expanded history Puppeteer scenarios pass. All ten Infinity construction references pass with current matching build IDs, including failure handling, repetition and worker recovery. The bill-history screenshot was inspected and the source packet refreshed. See `billworld/research/batavia-bill-history-construction-validation.json`. No task count, released coverage or certification credit is added; all 59,477 billers remain in scope. A further finite 2,000-source dependency batch is running separately from the live static collector.

### Released regression and continuous source analysis

All 31 released Infinity browser references now pass after the shared Paymentus/history ledger changes, including negative attempts, failure lifecycle, repetition and owned-worker recovery. Their build IDs match the current source inputs. These are scripted reference results, not autonomous-agent scores.

The 2,000-source analysis batch completed: 1,835 parsed, 161 partial and four decode errors, with 11,609 literal references. A tested offline analysis supervisor now advances resumable 500-source batches as the static collector adds bundles. It records compact source/hash/status receipts, preserves full reports in SQLite, stops at disk reserve or after the current batch on signal, and distinguishes a live collector wait from terminal incomplete collection. All 95 research checks and six final focused supervisor checks pass. Both source jobs are verified live. See `billworld/research/dependency-supervisor-validation.json` and `catalog-dependency-batch-004-validation.json`; source progress adds no runtime/fidelity credit. The full 59,477-biller catalog, private fidelity, isolated deployment and autonomous measurements remain unfinished.


## October 5 statement-download milestone

Batavia now exposes the documented View Bill action from Accounts and synthetic historical statement downloads. Three fixed PDFs derive from the runtime invoice fixtures, retain original billed amounts after payment, and require a live linked-account session. The download checks fixture fields and document hashes; pending payments and processor fees remain separate in the ledger. The original private statement layout and service line items remain unobserved.

Infinity construction task `task_c12` adds filename reporting and authoritative download issuance checks, with unchanged business/credential state required. The server cannot prove remote filesystem persistence; its Puppeteer reference separately waits for Chrome download completion and verifies saved bytes. All 246 JavaScript checks, 103 research checks, four statement browser scenarios, 31 released references and 12 construction references pass on the current 0.18.0 build. Three PDFs were rendered, visually inspected and text/hash checked. See `billworld/research/batavia-statements-construction-validation.json`.

The first catalog child-source sweep finished all 928 candidates known when it started, attempting 11,154 sources and capturing 11,100. A subsequent sweep now considers 6,654 candidates after the primary capture/analysis queues advanced, with a 3 GiB disk reserve. These are bounded inert-source research counts, not reconstructed billers or source completeness. See `billworld/research/catalog-child-sweep-completion.json`. The full 59,477-biller goal remains active; independent fidelity certifications and autonomous-agent scores remain zero.


## October 5 DNS recovery milestone

A full fetch-failure audit found 132,023 direct DNS errors among 132,561 failed sources, concentrated during 14:00–16:00 UTC. Six affected hosts resolved on recheck. A controlled 30-source retry recovered 29 immediately; the remaining valid SharePoint-style path recovered after fixing HTTP percent encoding. The exact resolver/system cause is not established.

The main frontend collector now stops on a large cross-host DNS-failure batch. A bounded, locked recovery command requeued 131,913 additional failures in the observed window, retaining previous evidence and attempt history in a transactional audit. Successful captures, HTTP errors and unrelated failures were excluded. All 108 research tests pass. Primary capture, inert analysis and child-source collection resumed only after the previous processes were confirmed absent; main and child disk reserves are 3 and 4 GiB respectively. See `billworld/research/frontend-dns-recovery-validation.json`. Requeued work remains pending until a new successful capture; this adds no released sites, fidelity certifications or autonomous scores.


## October 5 private action-budget milestone

Supported Infinity agent runners now reserve task-budget actions through the private server before dispatch. BrowserUse tools (including Gmail MCP and done) and parsed vision actions have separately named units; these are not raw DOM events or model steps. The next dispatch beyond the limit is rejected, exhaustion blocks later domain mutations, and otherwise-correct billing work cannot receive a successful score after exhaustion. Unsupported autonomous runners and unavailable/invalid meter responses fail closed. Legacy and scripted UI references remain explicitly unmetered; report filters and retry-series grouping separate meter units.

All 250 JavaScript checks, 111 standard-environment research checks and four native SDK checks pass. One native SDK test skipped in the standard environment passes in the SDK environment. All 31 released and 12 construction UI references pass on matching 0.19.0 builds, alongside action-budget rejection, lifecycle, repetition and worker-recovery checks. Native BrowserUse tool dispatch was exercised. A subsequent real Playwright/Chromium vision check also passed: action 100 completed Batavia login, action 101 was blocked before logout reached the browser, partial history was saved, and the private lifecycle persisted budget exhaustion despite successful login predicates. See `billworld/research/vision-action-budget-validation.json`; this uses a scripted loop without model calls. See `billworld/research/action-budget-validation.json`. No autonomous score, independent fidelity certification or released site coverage is added.

## October 5 source-resource milestone

A separate bounded collector now fetches literal CSS/import-meta resource references from current hash-verified root and child sources, preserving parent hashes and parser revisions. It reuses public-GET/redirect/address/transport guards and adds directory ownership, explicit retries, body/type limits and a four-GiB reserve plus selected-batch capacity. Resource bytes remain inert research inputs. Source packets include verified resource bodies and provenance; changed/tampered sources lose their historical associations.

All 118 research checks ran: 117 passed and one optional native SDK check skipped. Thirteen focused resource/packet checks pass after final packet-contract changes. Batavia's bounded inventory captured 40 resources (13 WOFF2, 24 TTF, three SVG); its source traversal still reaches the depth-three limit. Lockwood's first 25 requests captured 14 resources, retained 11 unsupported responses and left 269 current candidates pending. EOT and application/font-sfnt support remain unfinished. Both construction packets were refreshed and all 54 exported resource hashes verified. See `billworld/research/source-resource-validation.json`.

This adds reusable research material, not executable replicas, complete SPA extraction, released sites/tasks, fidelity certification or autonomous-agent scores. Batavia city resources remain distinct from inaccessible authenticated Paymentus source. HTML images, computed/embedded resources, source maps and full catalog resource collection remain unfinished. The three existing catalog capture/analysis jobs remain live; all 59,477 billers stay in scope.

## October 5 legacy-font resource follow-up

The resource collector now recognizes SFNT MIME aliases and validates the EOT header/size/version/magic before accepting legacy font bytes as inert research material. A bounded offline reclassification command shares the collector lock, rehashes saved unsupported bodies, preserves original fetch attempts and records transactional before/after evidence. A tampered body rolls back the whole batch. Eleven previously unsupported Lockwood resources were recovered without network requests; the earlier validation report remains the historical first-pass record.

All 120 research tests ran: 119 passed and the optional native SDK test skipped. Eight focused checks pass, including truncated/invalid EOT, alias recognition, bounded/idempotent reclassification, history preservation and rollback. Lockwood's packet was refreshed and its exported resource hashes checked. A finite 269-request continuation is running with four workers and the existing disk reserve; do not credit its result until completion. See `billworld/research/resource-font-validation.json`. Full catalog reconstruction, source completeness, private fidelity and autonomous scores remain unfinished.

## October 5 catalog resource supervisor

A resumable resource supervisor now selects billers with current resource-bearing or import-bearing source analyses and applies the existing inert resource collector in bounded batches. It records source signatures, classifier/parser revisions, per-biller outcomes and terminal/stop/capacity states in a separate resource database and job file. Completed signatures are skipped only after current chain/body verification and a check for requeued pending assets. Failed/unsupported responses stay explicit and are not automatically retried. A graceful stop finishes the current batch and preserves the rest.

All 125 research checks ran: 124 passed and one optional native SDK check skipped. Five focused supervisor checks pass, including actual candidate selection, changed/tampered sources, finite-batch resume, fetch failure accounting, ownership/reserve guards and stop/resume. The current metadata candidate snapshot contains 29,146 billers, not complete or certified resource coverage. Launch is pending the verified-live Lockwood finite resource batch (PID 32869, session 35755); do not start a competing collector. See `billworld/research/resource-catalog-validation.json`. The full 59,477-biller reconstruction and autonomous/fidelity measurements remain unfinished.

## October 5 resource catalog launch

Lockwood's finite continuation completed 269 requests: 262 accepted resources, five unsupported responses and two HTTP 403s. Its current bounded inventory now contains 287 accepted resources and seven explicit failures/unsupported outcomes, with no pending candidates. The refreshed construction packet's 287 resource bodies all passed hash verification. This is source-candidate exhaustion, not complete original SPA extraction or runtime fidelity. See `billworld/research/lockwood-resource-frontier-validation.json`.

A real three-biller resource-supervisor pilot completed with six captured resources and five recorded HTTP 403s across eleven requests. Per-biller batch limits retained pending work; the pilot checkpoint was archived before launch. After confirming the finite process had exited, the broader resource sweep started with two workers, bounded batches and a six-GiB reserve plus worst-case batch capacity. Its current selection includes roughly 29,000 analyzed billers; cohort membership changes as the source jobs advance. See `billworld/research/resource-catalog-launch-validation.json` for PID/session and start evidence. The supervisor is running, not complete. All 59,477 billers, independent fidelity review and autonomous benchmarking remain in scope and unfinished.

## October 5 Batavia wallet construction

Batavia now exposes the documented My Wallet navigation with reconstructed profile-scoped masked methods and add/edit/remove forms. It reuses existing card/bank validation and wallet storage. Saved-method checkout derives instrument kind, identity and fee from the stored method; edits/removals invalidate unpaid reviews, while completed receipts retain their submitted details. Raw PAN/CVV and full bank numbers are not persisted by these operations. Exact original forms, duplicate rules, storage policy and update timing remain unobserved; default-method control, AutoPay and profile management remain unfinished for Batavia.

Construction task `task_c13` requires a precise card expiry edit, new card, bank-method removal and final wallet read. Its private grader checks the complete protected business baseline and credentials, other methods and login/view/change/reload order. Five domain checks and five Puppeteer scenarios cover successful changes, profile isolation, invalid/duplicate instruments, saved checkout, stale reviews, logout and forbidden mutations. All 255 JavaScript checks, 124 standard research checks plus one resolved optional skip in the four-test native SDK run pass. The first run's case-sensitive message assertion and stale twelve-task count were corrected and passing retries retained.

All 31 released and 13 construction Infinity references pass on matching 0.20.0 environment/evaluator builds, including failure lifecycle, action-budget probes, repetition and owned-worker recovery. The wallet screenshot was visually inspected and the construction source packet refreshed. See `billworld/research/batavia-wallet-construction-validation.json`. This adds one construction task, not released-site coverage, original fidelity certification or autonomous-agent scores. All 59,477 billers remain in scope.

## October 5 Accounts summary reconstruction

Batavia Accounts now presents the guide's Date Due, Amount Due, Pay Bill and account-level payment/bill history links. The local ledger separates posted credit from pending reservations and processor fees. Pending full payment retains Amount Due, shows zero available to pay and offers no duplicate-payment action; settled bills retain their latest statement link. Filtered bills and both histories require a linked account, while the global menu keeps the all-linked-account view. Earliest outstanding due date and cross-invoice aggregation are explicit synthetic rules; current original layout and timing remain unverified.

Four focused domain checks and three Puppeteer scenarios pass. All 259 JavaScript checks, 124 standard research checks plus the optional native check in the four-test SDK run, and all 31 released/13 construction Infinity references pass on matching 0.21.0 builds. The pending-payment screenshot was inspected and the Batavia source packet refreshed. See `billworld/research/batavia-account-summary-validation.json`. No task count, released coverage, fidelity certification or autonomous score is added.

The resource catalog sweep recorded `capacity_limited`; the third child-source sweep recorded `failed` after its inner capture guard raised `Dependency capture stopped at free-space reserve`. Their PIDs were confirmed absent and terminal job checkpoints copied into `billworld/artifacts/resource-catalog-capacity-001.json` and `child-source-capacity-003.json`. The main frontend and analysis jobs remained live at that observation. Do not restart stopped collectors until actual disk availability supports their reserves. The full catalog goal remains active.

## October 5 collector capacity recovery

The observed inner child-source reserve stop is now a typed pre-dispatch capacity condition. Both child-source and resource catalog supervisors preserve pending inventory and byte measurements, record `capacity_limited` with exit 2 and avoid fabricated attempts. Unexpected errors remain failures. The child-source guard includes the selected batch's maximum body bytes in addition to its reserve.

All 27 focused collector checks and 128 standard research checks pass; one optional native SDK check is skipped in that environment. New tests reproduce capacity falling between the outer/inner checks, verify atomic no-dispatch behavior, preserve pending counts and demonstrate successful resumption. After both prior PIDs were verified absent and actual free space exceeded eight GiB, child-source PID 91723 (session 18306, four-GiB reserve) and resource PID 91724 (session 90404, six-GiB reserve) were started. The source parser revision remains unchanged, so existing syntax evidence was not invalidated. See `billworld/research/capture-capacity-resume-validation.json`. Runtime remains 0.21.0 with the preceding 44 browser references; no new reconstruction/fidelity/agent-score credit is added.

## October 5 Batavia AutoPay construction

Runtime 0.22.0 adds account-scoped Paymentus AutoPay settings, reloadable review, explicit consent, confirmation, cancellation and deterministic due-date execution with mock email. The city guide documents AutoPay navigation; private forms and timing remain synthetic. The separate free city bank-draft service is not activated by this flow. The local scheduler attempts each existing future invoice once, respects posted/pending reservations, charges construction fees only on successful attempts and preserves submitted payments after cancellation. It does not catch up overdue bills, retry failures or generate future utility invoices.

Two construction tasks exercise enrollment/cancellation with ordered event and exact protected-state grading. Focused adversarial tests cover session/account ownership, duplicate confirmation, stale reviews, edited/expired methods, missing links, cap/decline failures, pending payments and cancellation. Validation results and matching runtime/evaluator identities are recorded in `billworld/research/batavia-autopay-construction-validation.json`. Construction coverage is fifteen tasks across two sites; released coverage remains thirty-one tasks across nine sites. Source capture, fidelity certification, isolated deployment, autonomous scoring and the full 59,477-biller catalog remain unfinished.

The resource supervisor's capacity-resume run stopped cleanly at its six-GiB reserve after 192 requests: 161 accepted resources, 18 unsupported bodies and 13 HTTP failures across eight visited billers. Pending resources remain checkpointed. Main frontend capture, inert dependency analysis and child-source capture continued at the latest observation. Evidence is retained; do not lower reserves or infer source completeness from these counts.

## October 5 Greater Minnesota Gas / Starnik evidence and public reconstruction

Added fourteen live public captures spanning the homepage, payment/help/AutoPay/FAQ pages, legacy ASP.NET login, migrated React registration and recovery, and Angular guest lookup. Eleven are accepted construction references. The fragmentless guest URL renders a file-not-found route; the legacy username-recovery URL redirects to password recovery; a duplicate homepage is excluded. These rejected captures remain recorded, with exact URLs and byte hashes. Observed registration requires security code/email/confirmation; guest lookup requires security code/service ZIP; username and password recovery use different identifiers. No original forms were submitted.

Eleven inert local pages now connect billing to login, signup, both recovery entries and the exact fragment-bearing guest lookup. Original scripts remain excluded and forms disabled. Source and local registration/guest screenshots were reviewed; disabled input styling differs intentionally, and responsive behavior, some fonts/resources and client-handler links remain unfinished. There is no runnable GMG account/payment task or new fidelity certification yet. The tenant manifest records documented fees and AutoPay timing separately from unobserved private continuations; do not inherit Batavia's Paymentus policies.

The browser check exposed minified CSS imports without whitespace after `@import`; the shared snapshot rewriter now handles those imports and tests quoted URLs containing semicolons. The packet exporter now honors reviewed rejection only when capture ID, exact requested URL and HTML hash match. A stale review cannot reject new bytes, and a review cannot promote a failed capture. The refreshed GMG construction packet contains eleven candidate pages while retaining fourteen capture records. See `billworld/research/gmg-public-construction-validation.json` for evidence and limits.

The resource collector resumed after capacity recovered, then stopped cleanly again at its reserve after 132 requests (95 accepted, 37 unsupported). Its checkpoint remains available; no competing collector or reserve reduction was introduced.

## October 5 Starnik username authentication construction

Runtime 0.23.0 activates Greater Minnesota Gas only in the construction cohort. Captured username/password controls now submit to a local tenant-specific endpoint backed by existing authoritative sessions. Account reads expose only the signed-in customer's identity and bills, with synthetic private layout/balances. Generic login, recovery, payment, AutoPay and Google API shortcuts are unavailable for this tenant. Registration, both recovery entry pages and guest lookup remain inert source references awaiting functional continuations.

A new Infinity task requires username login, subsequent account reading, a live primary session and unchanged credentials, accounts, balances, methods and payments. Focused domain checks cover incorrect credentials, email shortcuts, foreign/expired sessions, account isolation and protected-state mutations. Browser validation covers homepage/billing/login navigation, wrong-password errors, reload, HttpOnly cookie and logout. The first reference attempt used a nonexistent heading; the corrected reference follows a visible homepage billing link and observed form controls. Failed artifacts remain separate. See `billworld/research/starnik-auth-construction-validation.json` for aggregate matching-build evidence and exact validation scope. This adds one construction task, not a released site or autonomous score; the full 59,477-biller objective remains active.

## October 5 Starnik email recovery construction

Runtime 0.24.0 binds both captured GMG recovery forms to the authoritative mock mailbox. Username recovery accepts email; password recovery accepts the observed username format. The captured public React bundle supplies the reset password character/length checks and token-validation/reset stage sequence. It is inspected as inert text, never executed locally or used to submit original recovery requests. Email content, fifteen-minute expiry, one-use grants, superseding older requests and target-only session revocation are explicitly synthetic. Failed validation preserves the grant. The cookie-held grant survives a page reload while the URL is cleared.

The Gmail bridge now renders GMG reset links using the same constrained local-link handling as existing portal recoveries. A browser failure exposed the missing link handler and is retained separately from the corrected passing run. The new construction task requires username email, reset request, opened link, exact new password, fresh login and account read while protecting unrelated credentials and all billing state. Domain checks cover wrong/unknown identifiers, expiry, cross-episode tokens, supersession, replay, password rules and multi-session revocation. Public auth and private account/reset styles now use an approved local stylesheet instead of blocked inline styles.

Validation evidence is in `billworld/research/starnik-recovery-construction-validation.json`. GMG registration, guest and signed-in checkout, wallet, AutoPay, paperless and profile continuations remain unfinished. No original authenticated fidelity, released-site coverage or autonomous benchmark score is claimed. The full catalog goal remains active.

## October 5 Starnik account registration construction

Runtime 0.25.0 adds GMG registration from the captured security-code/email/confirmation form through ordinary mock Gmail verification, username availability checking, credential creation, completion and a fresh login/account read. The captured public client establishes stage order and username/password rules. Local fixtures use hashed security codes, a thirty-minute email capability, a distinct pending/resend capability, supersession of old requests, commit-time uniqueness checks and idempotent completion. A pending credential cannot verify or register. Alternate registration email addresses remain unsupported and are explicitly rejected before delivery; no production registration was submitted.

The new task permits only the target registration/username/credential changes and requires verification/check/create/login/read ordering. Six focused checks cover lookup/confirmation, pending-verification separation, cross-episode/expired links, resend, username races, credential rules and protected state. The browser exercises the captured entry, resend, Gmail, collision/check, setup, reload and new credentials. Visual review found floating-label overlap after filling captured React fields; local input/focus behavior fixes it, with screenshots taken after transitions settle. The existing public scripts remain inert.

All 283 domain tests, 130 research checks and four SDK tests pass. All 31 released and 18 construction references passed before the final label adjustment. Only Starnik JS/CSS changed afterward; all three GMG references and the dedicated browser journey were revalidated on that final environment build, while the evaluator build stayed identical. Exact build identities, changed files and historical/full versus current/scoped results are recorded in `billworld/research/starnik-registration-construction-validation.json`. Full-catalog reconstruction, original private fidelity, isolated deployment and autonomous evaluation remain unfinished.

### GMG guest lookup construction — 0.26.0

Bound the captured Angular security-code/service-ZIP form to episode-scoped synthetic lookup. Separate HttpOnly guest capability exposes only the verified account name, customer number and aggregate remaining balance; it cannot log in or reset credentials. Failed replacement lookup clears browser access. Synthetic grant expiry is 25 minutes. Captured client source supplies the next checkout sequence; original backend behavior and private visuals remain unobserved.

Validation: 286 domain tests, two guest browser scenarios without page errors or outbound requests, and all three affected GMG reference journeys passed. Lookup and balance screenshots reviewed. Other 46 reference tasks not rerun on this build. Evidence: `billworld/research/starnik-guest-construction-validation.json`. No new benchmark task: checkout/review/fee/commit/receipt and private payment grading remain unfinished.
