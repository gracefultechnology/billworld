# Billworld implementation and benchmark plan

Billworld should be a reproducible collection of working biller simulations with a shared billing engine, distinct site experiences, mock identity and communication services, and independently checked task outcomes. The principal risk is building convincing pages that behave incorrectly or yield misleading agent scores.

This plan audits the research repository and defines the work needed to build the gym. The catalog audit is complete. Initial Juneau, Spotify, AVEC/SmartHub, Homer/Xpress, Duluth/Utility Access, Grand Valley Power/SmartHub, Swepsonville/AuthorityPay–InvoiceCloud, WVU Medicine/MyChart and Western Dental/PersonaPay slices now exist with local mailbox, recovery, billing state, mock Google identity where supported, independent grading, aggregate reporting and reference tests; see `billworld/README.md`. Billworld extends WebArena-Infinity's runner, task format, reports and Gmail frontend; see [the reuse review](billworld/infinity/REVIEW.md). Expand billing sites through that extension rather than building a second general benchmark framework. A resumable public research queue covers all 59,477 entries. Full catalog reconstruction, authenticated fidelity review and autonomous-agent benchmarking remain incomplete. Research date: October 3, 2026, America/New_York.

## Status (2026-10-11)

This section supersedes the release counts in the dated milestone notes below. Those notes are history; when they say "nine sites and thirty-one tasks" or list construction-only Lockwood, Batavia or GMG tasks, they describe earlier releases.

- **Hand-built sites:** 17, all `first_slice`: Juneau, Spotify, AVEC, Homer, Duluth, GVP, Swepsonville, WVU Medicine, Western Dental, Lockwood, Batavia, Greater Minnesota Gas, Inframark, ONSWC, Charlotte County, Malden and Tuscaloosa. Together they have 142 released Infinity tasks. No construction-only tasks remain. The site table is in `billworld/README.md` under "Sites and status".
- **Fleet:** all 59,477 catalog billers are served through 26 portal-family templates. 568 researched dossiers are all green, with at least 20 per category in all 28 categories (560/560 picks). See `billworld/fleet/README.md`.
- **Verification (2026-10-11):**
  - `npm test`: 472/473 pass, with 1 skipped by design.
  - Research tests: 142 OK.
  - All 47 `test:browser*` scripts exit 0.
  - Infinity smoke: 147/147, covering all 142 tasks plus 5 lifecycle checks.
  - `fleet:test`: 234/234.
  - Dossier validation: 568/568.
  - Fleet sweep of all 59,477 billers: 0 failures.
  - Fleet browser test: 437/437.
  - Dedicated tests: 20,020/20,020 flows across 28 categories.
- **Blind agents (2026-10-11):**
  - The fresh blind first pass scored 733/733: 138 hand-built tasks and 595 Fleet tasks.
  - Tasks re-attempted after the reported environment defects were fixed scored 125/125.
  - No task is still failing.
- **Still open:**
  - Private screens of real portals are reconstructions labeled synthetic.
  - No independent source-fidelity certification has been done.
  - Held-out task splits are not built yet.
  - Deployment-level isolation for untrusted agents is not built yet.
  - Fleet tier 3 (more dossiers per category) is next.

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

### GMG guest checkout construction — 0.27.0

Added bank/card entry, server-calculated review, authorization, idempotent payment and receipt. Uses documented free bank payment and card 2.75%/$1.50 minimum; nearest-cent rounding, oldest-due allocation, immediate posting and processor validation are explicitly synthetic. No raw card/CVV/routing/account number retained in domain state. Review is bound to the verified guest; commit rechecks balance and card expiry. Optional mock receipt email, decline fixture and replay handling implemented. Private original layout unobserved.

292 domain tests passed before final CSS-only control fix. Both payment browser journeys and three affected GMG reference journeys passed on final build; zero browser errors/outbound requests. Other 46 references not rerun. Evidence: `billworld/research/starnik-payment-construction-validation.json`. Next: guest-payment benchmark tasks and exact-state graders, then authenticated checkout/wallet/AutoPay. Full catalog and autonomous benchmarking remain unfinished.

### GMG guest payment benchmark — 0.28.0

Added `task_c19` bank and `task_c20` card payment to the WebArena-Infinity construction overlay. Private graders require exact account/invoice, amount, fee, instrument, billing details, one commit, receipt viewing, subsequent zero-balance read and unchanged unrelated state. Review, commit and receipt events bind to the same private quote. Negative tests reject altered credentials, AutoPay, other accounts, historical payments, extra payments, wrong instruments, missing receipt mail, broken ordering and extra login.

Validation: 295 domain tests, 130 research tests (one optional SDK skip), four native SDK tests and all 51 scripted reference tasks passed on matching build IDs (31 released + 20 construction). These are not autonomous scores or fidelity certification. Evidence: `billworld/research/starnik-payment-grader-validation.json`. Catalog collector checkpoints preserved and all four collectors resumed after terminal disk-space stops; analyzer had failed writing its final checkpoint with ENOSPC. Reserves unchanged.

### GMG authenticated feature source evidence

Captured and hash-verified 21 literal public React chunks (syntax parsed without execution). Fourteen source findings cover wallet review/authorization and unavailable states; AutoPay method eligibility, account-specific terms, TextPay conflicts and separate ACH warning/setup; connected-account confirmation; eBill customer-service branches; posted/pending history and show-all behavior; invoice PDF downloads; and the backend-supplied Pay Bill destination. Evidence: `billworld/research/starnik-authenticated-client-evidence.json`.

Do not infer that modern authenticated checkout is the guest flow: the billing tile consumes `payBillPath` from backend data, and current public login remains legacy. Original authenticated destination/feature flags remain unobserved. Implement the observed wallet and account-management sequences with clearly synthetic private data while retaining this uncertainty. No runtime/task/fidelity increment. Initial follow-up stopped at the disk reserve; five follow-up chunks captured after capacity recovery. All four catalog collectors resumed only after old processes were verified absent, retaining checkpoints and reserves.

### GMG transaction history — 0.29.0

Added account-scoped authenticated transaction history with posted invoice/payment rows, running balances, separate pending payments, and Show All. Synthetic bill dates (20 days before due), initial 20-row pagination and private layout are explicit. Guest, foreign and expired sessions cannot access history; selecting another account is rejected. History is read-only and permitted by existing auth-task graders.

Validation: 299 domain tests, dedicated browser checks without page errors/outbound requests, five existing GMG reference journeys on matching build IDs, and visual review of history. Other 46 references not rerun. Evidence: `billworld/research/starnik-history-validation.json`. No new benchmark task; invoice PDF, multiple-account linking, wallet, AutoPay and original private fidelity remain unfinished.

### GMG history interpretation benchmark — 0.30.0

Added `task_c21` / `gmg-read-history-balances-v1`. A synthetic pending $10 payment distinguishes posted balance ($84.32), pending total ($10), and remaining balance ($74.32). Agent must sign in and visit history, report exact integer cents and preserve all business state. Adapter forwards only safe integer summary fields; rejects boolean/string/fractional values and ignores agent-supplied state/events.

Validation: 302 domain tests, 131 research tests passed (one optional skip), four native SDK checks and all 52 reference journeys passed on matching build IDs (31 released + 21 construction). Full research initially exposed a capacity-recovery test depending on actual host free space; recovery and unexpected-error fixtures now explicitly simulate ample capacity, with all four focused checks passing. Production reserves unchanged. Evidence: `billworld/research/starnik-history-grader-validation.json`. Scripted references remain unmetered and do not constitute autonomous scores. Wallet, AutoPay, private fidelity and full catalog remain unfinished.

### GMG wallet add/remove — 0.31.0

Implemented authenticated wallet listing, bank/card entry, masked review, explicit save authorization, idempotent persistence and confirmed deletion. Ten-minute review capability is session/account/episode bound in an HttpOnly cookie. Duplicate instruments rejected at prepare and commit; raw PAN/CVV/routing/account numbers never retained. Removal is guarded against AutoPay/scheduled references and replay cannot restore removed methods. Shared instrument/billing validation extracted without changing guest payment rules.

306 domain tests, two dedicated bank/card browser journeys and six existing GMG reference tasks passed on matching build IDs; zero browser errors/outbound requests. Wallet screenshots visually reviewed. Other 46 references not rerun. Evidence: `billworld/research/starnik-wallet-validation.json`. Edit, unavailable states, saved-method checkout, AutoPay integration and wallet task/grader remain unfinished, as do full catalog and original private fidelity.

### GMG wallet edit — 0.32.0

Added own-method detail/read, editing, review and explicit authorization. Method ID stays stable, version increments once, prepare and commit both check version, and concurrent edit/deletion invalidates stale reviews. Payment kind and card brand stay fixed as in the observed edit UI. Local branch requires full instrument re-entry; backend masked-update flags remain unobserved. Review Back returns to the edited method instead of Add; unsaved form preservation remains unfinished.

309 domain tests, two bank/card browser add-edit-delete journeys and six existing GMG reference tasks passed on final matching build IDs, with zero browser errors/outbound requests. Edit review screenshot inspected. Evidence: `billworld/research/starnik-wallet-edit-validation.json`; source flags: `billworld/research/starnik-wallet-edit-client-evidence.json`. Other 46 references not rerun. Wallet grader, saved checkout, AutoPay, private fidelity and full catalog remain unfinished.

### GMG wallet benchmark — 0.33.0

Added `task_c22` / `gmg-manage-wallet-v1`: update existing Visa expiry, add Savings, remove obsolete Checking, and reload. Private grader checks exact instrument digests, expiry/version, billing details, requested method set, quote-linked reviewed save events, removal and final read, while protecting all credentials, billing and other accounts. Fixture seeds only this task with the two existing synthetic methods.

311 domain tests, 131 research tests (one optional skip), four native SDK checks and all 53 reference journeys passed on matching build IDs (31 released + 22 construction). Final wallet screenshot reviewed. Evidence: `billworld/research/starnik-wallet-grader-validation.json`. Catalog checkpoints preserved and collectors resumed after capacity recovered with reserves unchanged. Scripted references are not autonomous scores; saved checkout, AutoPay, private fidelity and full catalog remain unfinished.

### GMG AutoPay enrollment and execution — 0.34.0

Added saved-method selection, eligibility, terms, explicit confirmation, persistent enrollment and confirmed disable. Ten-minute HttpOnly review capability is session/account/episode-bound; commit rechecks method version, eligibility and prior account/conflict state. TextPay acknowledgment disables TextPay; a separately acknowledged ACH warning preserves ACH because original backend cancellation behavior is unobserved. No payment occurs during enrollment.

GMG now uses its own scheduler instead of the generic monthly invoice generator. It attempts each existing invoice once three days before its due date, subtracts posted/pending reservations, applies documented bank/card fees, records failures and sends mock confirmation mail. Midnight UTC, settlement, no catch-up/retry and no generated future bills are explicit construction rules.

317 domain tests, two dedicated browser journeys and all seven existing GMG reference tasks passed on matching build IDs. No browser errors or outbound requests; enrollment screenshot visually reviewed. Other 46 references, research and SDK suites were not rerun for this scoped change. Evidence: `billworld/research/starnik-autopay-validation.json`. No AutoPay benchmark task/grader or autonomous score yet; signed-in saved-method checkout, original private fidelity and full catalog remain unfinished.

Catalog child collector stopped with a source hash mismatch; saved its failure checkpoint. Rechecking the next candidate found no mismatch, and its full signature revalidated. Resumed only after confirming the old PID absent, retaining the 4 GiB reserve. Cause remains unconfirmed; audit: `billworld/artifacts/catalog-hash-mismatch-audit.json`. Main source/analyzer/resource collectors were already live and not duplicated.

### GMG AutoPay benchmarks — 0.35.0

Added task_c23/gmg-autopay-enable-v1 and task_c24/gmg-autopay-cancel-v1. Enable fixture includes saved Checking/Visa, active TextPay and separate ACH. Agent must select Checking, review terms and conflicts, activate and verify final status. Cancel fixture begins enrolled; cancellation must preserve saved methods, ACH and all other billing/identity state. Private graders check exact enrollment, ordered login/view/review/change/final read, quote linkage, conflict state and baseline-protected accounts/invoices/payments. Wrong methods, missing review, state-only shortcuts, repeated toggles and unrelated changes fail.

320 domain tests, 131 research tests (one optional skip), four native SDK checks and all 55 reference journeys passed on matching build IDs (31 released + 24 construction). Enable screenshot visually reviewed. Evidence: `billworld/research/starnik-autopay-grader-validation.json`. These are scripted, unmetered references, not autonomous scores. Execution timing remains separately validated by 0.34.0 scheduler/browser tests; signed-in saved-method checkout, private fidelity and full catalog remain unfinished. All four catalog collector PIDs were confirmed live during this turn; no duplicates started.

### GMG signed-in saved-method checkout — 0.36.0

Added own saved-method selection, partial/full amount entry, masked amount/fee review, explicit authorization, idempotent posting, mock email receipt and history visibility. Review cookie is HttpOnly; quote is session/account/episode bound with ten-minute expiry. Charge rechecks the method snapshot and available invoice balances. Local allocation is oldest-due first, pending reservations are excluded, and the documented card fee is charged once across allocations. Declines do not mutate payments or balances. Original BillingTile's backend-supplied payBillPath remains unobserved, so this signed checkout and its routes/layout are explicitly synthetic.

325 domain tests, 134 research tests (one optional skip), two bank/card browser journeys and nine existing GMG reference tasks passed; the references match the final build IDs. Other 46 references and SDK checks were not rerun. Receipt screenshot reviewed. Evidence: `billworld/research/starnik-signed-payment-validation.json`. Saved-method payment benchmark grading, original private fidelity and full catalog remain unfinished.

Also replaced shared capture-body truncation writes with temporary-file publication plus atomic replace. Concurrent writers could previously expose incomplete bytes to hash readers. Three tests cover publication visibility, failed replacement preserving old bytes, and concurrent same-hash writers/readers. This establishes and fixes the race but does not prove every historical mismatch had that cause. Next 500 active unparsed source bodies revalidated with zero mismatches; this is not a full-store audit. All collector checkpoints were saved, live PIDs received graceful stop, exit was confirmed before restart, and 3/2/4/6 GiB reserves were preserved. Audit/checkpoint files: `atomic-body-parser-input-audit.json`, `atomic-body-collector-checkpoint.json` in artifacts.

### GMG saved-payment benchmarks — 0.37.0

Added task_c25/gmg-saved-bank-payment-v1 (full $84.32, $0 fee, zero remaining) and task_c26/gmg-saved-card-payment-v1 (partial $20, $1.50 minimum fee, $64.32 remaining). Both seed existing Checking/Visa methods. Private graders require exact posted authenticated payment and saved instrument, quote-linked login/open/prepare/review/commit/receipt/final-balance sequence, mock receipt email, one charge, and preservation of credentials, wallet, AutoPay, other accounts and original billing records. Mutation tests reject wrong methods/fees, extra payments, missing receipt/review, altered state and unexpected side effects.

328 domain tests, 134 research tests (one optional skip), four native SDK checks and all 57 reference journeys passed on matching build IDs: 31 released + 26 construction. Partial-card final screenshot reviewed. Evidence: `billworld/research/starnik-signed-payment-grader-validation.json`. Four catalog collector PIDs confirmed live after atomic-publication restart. Stored frontend inventory snapshot: 241,455 captured and 469,645 pending sources at 2026-10-05T18:56:17Z; these include inactive associations and are not replicated-site/flow coverage. Original private checkout, multi-account linking, paperless, profile management, statements, autonomous scores and full catalog remain unfinished.

### GMG eBill preferences and benchmarks — 0.38.0

Implemented captured eBill option codes (1 electronic only, 2 electronic plus paper, 3 paper only), alternative-option picker with UPDATE/CANCEL, binary direct toggle, disabled customer-service state and separate read-only PDF eBill information. Profile paperless is true only for electronic-only delivery. Save is own-account/session scoped with synthetic optimistic version checking and observed no-change warning semantics. Actual GMG flags and private layout remain unobserved; default fixture offers all three options. PDF delivery/email changes remain customer-service-only, independent of ordinary eBill settings.

Added task_c27/gmg-paperless-v1 and task_c28/gmg-ebill-paper-v1 with exact preference/version/paperless grading, ordered login/view/change/final read, and protection for PDF flags, payments, AutoPay, credentials, other accounts and original invoices. Mutation tests reject extra changes and incorrect combined-delivery semantics.

335 domain tests, 134 research tests (one optional skip), four native SDK checks, three dedicated browser scenarios and all 59 final-build reference journeys passed (31 released + 28 construction). Screenshot inspection found text-input styling affecting radios; corrected the radio layout, reran browser scenarios and all references, then inspected the corrected screenshot. Evidence: `billworld/research/starnik-ebill-validation.json`; source evidence: `billworld/research/starnik-ebill-client-evidence.json`. Four collector PIDs remain live after atomic-publication fix. Statement downloads, multi-account linking, profile management, original private fidelity, autonomous scores and full catalog remain unfinished.

### GMG authenticated statements and benchmark — 0.39.0

Added View Bill PDF links from account summary and authenticated `/invoice/download/ID`, matching the observed client endpoint pattern. Three immutable synthetic statements cover primary current/historical invoices and the secondary account. Exact account/invoice fields and PDF hashes are manifest-bound; changed/new records fail closed rather than serve stale statements. Cross-account/guest/expired access and direct static-file access denied. PDF amount remains the original bill total, independent of current payments. Source client uses blob/open-in-new-tab; local implementation uses direct attachment download, an explicit remaining fidelity difference.

Added task_c29/gmg-download-current-bill-v1. Grader requires login/account view/exact authorized issuance, correct filename and unchanged business/credential state; issuance cannot attest a remote agent filesystem write. Puppeteer separately waits for Chrome download completion and verifies saved bytes/hash. PDF skill used; all three PDFs rendered and visually reviewed, with extracted fields verified.

340 domain tests, 134 research tests (one optional skip), four native SDK checks, three dedicated browser scenarios/four verified downloads, and all 60 matching-build reference journeys passed (31 released + 29 construction). Evidence: `billworld/research/starnik-statements-validation.json`. Four collector PIDs confirmed live. Original private statement layout/service line items, multi-account linking, profile management, autonomous scores and full catalog remain unfinished.

### Starnik provider reuse audit — runtime unchanged at 0.39.0

Added structural Starnik host recognition and a reproducible provider cohort audit with current category-source hash checks, strict host boundaries, separate claim/static-only evidence, and no transferred runtime credit. Rebuilt all 59,477 catalog records: 225 Starnik candidates, including 212 associated with Inframark. Vendor homepage references and shared hosts still require biller identity and capability verification.

Captured 12 public pages for ONSWC/Inframark without submitting production forms. Three tenants share the same visible legacy login controls, auth navigation and 16 byte-identical assets. Six additional signup/recovery pages load GMG's exact React entry bundle. This supports frontend reuse, not backend equivalence. Expanded Inframark's public FAQ establishes operator-level online card fees of 3% and eCheck fees of $1, versus GMG's 2.75%/$1.50 minimum card and zero bank fee; per-district exceptions and AutoPay timing remain unverified. Auth continuation screenshots still require visual review.

138 research tests passed with one optional skip; final process exited zero. Runtime/evaluator fingerprints match the previously validated 0.39.0 build, so no new runtime coverage or autonomous score is claimed. Four catalog collectors were confirmed live with their existing reserves. Evidence: `billworld/research/starnik-provider-reuse-validation.json`, plus tenant login/auth/policy comparison records. Next: separate GMG-specific fixtures, fees, branding and snapshot routes from shared Starnik services before constructing a second tenant. Full catalog and private fidelity remain unfinished.

### Starnik tenant fee policy — 0.40.0

Removed hardcoded GMG fee disclosures from signed checkout and AutoPay review. Both use validated tenant policy shared with charge calculation. Missing, negative, fractional or nonnumeric fee configuration is rejected; exact integer arithmetic preserves nearest-cent half-up rounding and rejects unsafe fees. No new tenant coverage introduced.

343 domain tests, four native SDK checks, two browser policy variants and all 60 matching-build scripted references passed (29 construction, 31 released). Browser scenarios exercise GMG and a synthetic alternate-fee policy on the GMG fixture; checkout and AutoPay disclosures match configuration. Two screenshots visually reviewed, zero browser errors or outbound requests. Initial browser test opened review without preparing enrollment; failure retained, test corrected to follow selection and passed. Evidence: `billworld/research/starnik-fee-policy-validation.json`. Research suite unchanged and not rerun. Four collectors confirmed live. Branding, credentials, source routes and AutoPay timing still need tenant separation. Full catalog, private fidelity and autonomous scores remain unfinished.

### Starnik tenant AutoPay timing — 0.41.0

Removed GMG three-day assumptions from AutoPay terms and confirmation/execution email text. Explicit tenant timing (integer 0–365 days, a local bound) now drives account disclosure, review, enrollment and scheduler. Missing timing shows enrollment unavailable; no default is inferred. Review binds the chosen timing and rejects configuration changes before commit. Active scheduler rejects a timing/enrollment mismatch instead of silently moving a payment date; cancellation remains available even if configuration disappears. No active enrollment means time can still advance without known timing.

347 domain tests, four native SDK checks, four timing browser scenarios and all 60 matching-build scripted references passed (29 construction, 31 released). Tests cover due-date/one-day/five-day execution, missing policy, stale reviews, no silent retiming, rollback and cancellation. Two runtime screenshots visually reviewed; zero browser errors/outbound requests. Evidence: `billworld/research/starnik-timing-policy-validation.json`. Research suite unchanged and not rerun.

Also visually reviewed and hash-verified all six previously captured ONSWC/Inframark signup/password/username recovery screens, recorded in `billworld/research/starnik-tenant-auth-visual-review.json`. They share the two-panel auth layout; signup carries tenant title, recovery screens omit it. This source review does not certify local reconstruction or private behavior. Four catalog collectors confirmed live. Branding, credentials and source routes still need tenant separation; full catalog, private fidelity and autonomous scoring remain unfinished.

### Starnik tenant branding — 0.42.0

Added explicit tenant brand configuration for account name, mock-mail display name and payment/AutoPay confirmation prefixes. Shared auth, recovery, payment and AutoPay subjects and account heading now use configuration; private receipt grading uses the same tenant name. GMG retains existing labels. Missing/malformed config is rejected instead of inheriting GMG. Browser account titles use textContent, including markup-like names.

350 domain tests, four native SDK checks, two branding browser scenarios and all 60 matching-build scripted references passed (29 construction, 31 released). Alternate synthetic branding is covered through recovery mail, account API, payment receipt/private grading and scheduled AutoPay confirmation. One alternate account screenshot visually reviewed, zero browser errors/outbound requests. Evidence: `billworld/research/starnik-brand-validation.json`. Research suite unchanged and not rerun.

Captured the guest link published in Inframark FAQ: `/starnikERP/#/rp_guestpay` navigates to `/starnikERP/#/rp_guestpay/rp_guestpay`, HTTP 200, with Account Security Code/Service Zip Code/VERIFY controls. Screenshot reviewed and 30 captured asset bodies hash-verified; all 30 hashes match GMG capture metadata. No verification or payment submitted. Evidence: `billworld/research/starnik-inframark-guest-evidence.json`. Four catalog collectors confirmed live. Credentials and source route configuration still need separation; no new tenant is counted. Full catalog, private fidelity and autonomous scores remain unfinished.

### Starnik tenant credential fixtures — 0.43.0

Moved primary/secondary usernames, passwords, security codes and service ZIPs to explicit synthetic tenant configuration. Seeding validates required fields and uniqueness, hashes passwords/security codes, and uses configured identity in the welcome email. Fixture metadata now returns the configured primary credentials. Missing or duplicate identities never inherit GMG values. Shared synthetic personas, mailbox emails and invoice fixtures remain unchanged.

353 domain tests, four native SDK checks, two credential browser scenarios and all 60 matching-build scripted references passed (29 construction, 31 released). Alternate credentials cover login, recovery, verified registration and guest lookup; tests reject old GMG credentials/codes and wrong ZIP, and verify raw passwords/security codes are absent from stored state. One guest account screenshot visually reviewed, zero browser errors/outbound requests. Evidence: `billworld/research/starnik-fixture-validation.json`. Research suite unchanged and not rerun. Four collectors confirmed live. Source routing and snapshots still need tenant separation before the second runtime; no new tenant coverage or autonomous score is claimed. Full catalog remains unfinished.

### Starnik tenant source routing — 0.44.0

Replaced GMG-specific snapshot IDs and route tables in the server with explicit tenant snapshot_routes. Public routes select their own captured page; private continuations use that tenant's interactive login shell. Missing/malformed configuration rejects instead of falling back to GMG. Source-link rewriting uses configured IDs. Added observed short guest-fragment normalization to the canonical nested route.

356 domain tests, four native SDK checks, two route browser scenarios and all 60 matching-build scripted references passed (29 construction, 31 released). Tests cover alternate tenant IDs, continuation selection, malformed paths, configured help alias, unknown-route 404 and guest-fragment normalization. Guest screenshot visually reviewed, zero browser errors/outbound requests. Evidence: `billworld/research/starnik-routes-validation.json`. Research suite unchanged and not rerun.

Captured Inframark operator homepage from its observed FAQ link (59 assets), reviewed its screenshot, and prepared seven source pages (home, login, signup, both recovery entries, guest lookup, expanded payment FAQ) with HTML and all captured asset-body hashes revalidated. Files: `billworld/research/inframark-public.json` and `inframark-source-preparation.json`. Original scripts remain inert source, no production forms submitted. Homepage lazy assets/completeness and district-specific policies remain unverified. Next: build the seven inert snapshots and register/test the second Starnik construction tenant. Four catalog collectors confirmed live; no new tenant is counted yet. Full catalog, private fidelity and autonomous scoring remain unfinished.

### Inframark second Starnik tenant — 0.45.0

Built seven inert snapshots (operator home, expanded payment FAQ, login, signup, both recovery entries, guest lookup) and registered Inframark with its own source routes, mock branding, usernames/passwords/security codes, and published operator fees ($1 eCheck, 3% card). No published card minimum is modeled as zero, an explicit local assumption; district exceptions unverified. AutoPay timing is absent and enrollment unavailable. Statement links now depend on an exact tenant/account/invoice document match, so Inframark cannot expose GMG PDFs. Shared private account, wallet, preferences and settlement remain synthetic.

Added task_c30 homepage-to-login, task_c31 full guest bank payment and task_c32 full guest card payment with shared private graders. Initial adapter mapping omission and hidden-link selection failures retained; fixed mapping and visible-link reference navigation. A later released AVEC reference selected a saved method before its option existed; added an explicit availability/value wait and reran the released suite.

Visual review exposed missing responsive homepage logos/icons: builder now uses a captured srcset candidate when fallback src was not fetched. Two tests cover captured fallback selection and rejecting uncaptured URLs. Rebuilt Inframark pages, reviewed restored homepage, and verified all 158 snapshot files. Other source/resource/menu/initial-control fidelity gaps remain.

360 domain tests, 140 research tests with one optional skip, four native SDK checks, seven public browser pages plus authenticated account/unavailable-AutoPay checks, and all 63 final matching-build references passed (32 construction, 31 released). Eight screens visually reviewed, zero browser errors/outbound requests. Evidence: `billworld/research/inframark-construction-validation.json`. Catalog rebuilt across 59,477 entries: only `biller_79d57f82caebe2d84035` in category `other` maps to Inframark construction. Released count stays 9, fidelity-certified count stays 0. Four construction environments now total 32 tasks. Full catalog, district policy verification, original private fidelity, complete auth benchmarks and autonomous scores remain unfinished.


### Inframark auth benchmarks — 0.46.0

Added construction tasks task_c33 (registration through mock Gmail verification, username check, account creation and login) and task_c34 (username recovery, email password reset and login). Reused Starnik runtime and private graders; recovery instructions exclude existing credentials. Shared auth contracts now run against GMG and Inframark. Counts: 34 construction + 31 released tasks; catalog coverage unchanged.

Validation: 371 domain tests, 140 research passes plus one optional skip, four SDK checks, and all 65 scripted references on matching environment/evaluator builds. Two released attempts exposed SmartHub selection races; retained failures and added route-settling/readiness checks to the reference. Concurrent SPA rerender timing remains a runtime follow-up. Original private auth and mail remain simulated; scripted results are not autonomous scores. Evidence: billworld/research/inframark-auth-validation.json. Full catalog goal remains active.


### SmartHub navigation race fixed — 0.47.0

Fragment navigation emitted both popstate and hashchange, causing duplicate dashboard renders that reset payment inputs. Runtime now deduplicates navigation events and rejects stale session responses; SmartHub also discards stale dashboard/guest responses and logout redirects. A Puppeteer regression fails on the prior runtime (two dashboard requests) and passes for AVEC and GVP with preserved bank/amount, deliberately delayed old responses, and Back/Forward navigation. Removed the temporary network-idle reference workaround after it timed out; failure artifacts retained.

Validation: 371 domain tests, 140 research passes plus one optional skip, four SDK checks, and all 65 matching-build scripted journeys. Catalog/task counts unchanged. Other frontend modules do not yet have equivalent downstream stale-response guards. Evidence: billworld/research/smarthub-navigation-validation.json. Full catalog goal remains active.


### Old North State Water source preparation

Expanded ONSWC evidence to nine public captures: homepage/customer service, login, signup, username/password recovery, FAQ, rates, and legacy signup redirect. Built inert snapshots; Puppeteer loaded all nine with no page errors or outbound requests and verified 140 compiled files. Source asset bodies also hash-verified. Local homepage, FAQ and water rates visually reviewed; rates inspection waits for finite CSS animation completion.

FAQ documents a processing fee without its amount and directs ACH Auto Draft enrollment through customer service. Do not inherit GMG/Inframark fee or timing rules. Water rates describe due date, past-due interval and monthly late charges; wastewater tab and private calculations remain unverified. Legacy signup redirects to /RP/signup. Public FAQ/tab/menu behavior, policy documents, unknown-fee handling and runtime/tasks remain next work. No catalog runtime/released coverage added. Evidence: billworld/research/onswc-source-preparation.json.


### ONSWC FAQ and rates controls — 0.48.0

Observed original public FAQ and rate-tab interactions through the browser. Added dedicated local document behavior: one FAQ answer remains open, water/wastewater panels switch, and keyboard/ARIA support is explicit. Original scripts remain excluded. Original tabs report both selections true; the local correction is an accessibility improvement, not exact behavioral parity.

The visible wastewater policy publishes late charges after 15 days; water publishes 25 days. Preserve separate policy evidence. Actual Billworld server loads nine rebuilt snapshots, verifies 140 compiled files and behavior hash, and passes mouse/keyboard interaction checks without page errors or outbound requests. 371 domain tests and 140 research tests passed, with one optional skip. Full reference suite and SDK not rerun for these document controls. Menus, missing glyph/assets, policy documents, unknown fees, tenant runtime/tasks and full catalog remain unfinished. Evidence: billworld/research/onswc-controls-validation.json.


### Explicit unknown Starnik fees — 0.49.0

Added documented_policy.payment_fee_status = unverified (without numeric fee fields) as an explicit construction gap. Signed and guest balances remain readable, but forms/quotes and AutoPay enrollment are unavailable. Pending signed/guest charges recheck the fee at submission; an unknown or changed fee cannot use an old quote. Completed receipts retain idempotent replay. This is a construction limitation, not observed original payment unavailability.

Validation: 374 domain tests, 140 research passes/one skip, four SDK checks, unknown-fee Puppeteer scenario, and all 65 matching-build references. ONSWC runtime remains next work; no new catalog/task credit. Evidence: billworld/research/starnik-unknown-fees-validation.json.


### ONSWC construction runtime — 0.50.0

Activated ONSWC for its single explicit water-sewer record with tenant credentials/branding, nine source references and three Infinity auth tasks (task_c35 login, task_c36 registration, task_c37 recovery). Reuses Starnik, private grading and mock Gmail; recovery prompts omit old credentials. Fees remain unverified and checkout unavailable locally; Auto Draft timing/statements are unavailable. Private account/auth continuation and invoices remain synthetic.

Validation: 386 domain tests, 140 research passes/one skip, four SDK checks, dedicated ONSWC browser checks without page errors/outbound requests, and all 68 matching-build reference journeys (37 construction, 31 released). Five construction tenants; nine released sites unchanged. Catalog-index refresh PID 68036/session 81392 was still live at the last observation; verify it and refresh provider-reuse metadata in the next continuation. Evidence: billworld/research/onswc-construction-validation.json. Full catalog goal remains active.

### ONSWC catalog follow-up and index diagnostics

The previous ONSWC catalog refresh completed and its single construction mapping was verified in both the catalog and Starnik provider report. All 59,477 records were scanned; 225 Starnik candidates remain research associations with zero transferred runtime credit. See billworld/research/onswc-catalog-validation.json.

Added optional catalog build phase events (CLI stderr, flushed) and set-based per-biller signal deduplication preserving complete evidence equality and first-seen order. Validation: 16 targeted tests and 141 research passes plus one optional skip. The timed production build PID 78300/session 43149 remains active at last observation; capture metadata loaded 72,395 records in about 128 seconds before frontend association processing. Poll that exact job before considering a restart, then refresh provider metadata after publication. Log: billworld/artifacts/catalog-index-progress.log. No speedup, new runtime coverage or autonomous benchmark success is claimed. Evidence: billworld/research/catalog-index-diagnostics-validation.json. Full catalog goal remains active.

### Completed index diagnostics and source collection resume

The timed catalog build completed successfully in 1,078 seconds and published all 59,477 records. Capture metadata took about 128 seconds, frontend association processing about 435 seconds, and record construction about 497 seconds on this run. Starnik provider metadata was refreshed against the new index digest. These observations include machine contention and are not a before/after performance comparison. Updated evidence: billworld/research/catalog-index-diagnostics-validation.json.

On October 6, all four previous collector processes were confirmed absent before resuming checkpoints with unchanged bounds/reserves. Successors: frontend PID 2944/session 46179; analyzer PID 2969/session 18979; child collector PID 2996/session 62856; resource collector PID 3016/session 9541. Logs use atomic-resume-011; all four were verified live and advancing. Do not restart based on stale status files or slow observations. Evidence: billworld/research/catalog-collectors-resume-011.json.

### ONSWC privacy and terms documents

Captured the two official PDFs with explicit length/hash verification and visually reviewed all 15 pages. Reused the existing catalog document compiler and SnapshotStore; the nine rebuilt snapshots now bind 158 files. ONSWC homepage, billing, FAQ and rates footers expose working local document links. Original PDF bytes are preserved; embedded PDF hyperlinks still retain source destinations, and a source privacy-table overlap remains unchanged.

Validation: 13 builder tests, nine snapshot-store tests, eight Puppeteer policy-link byte/hash checks, two visible homepage PDF clicks, ONSWC runtime browser, and all nine public reference pages/controls. No outbound requests or page errors in passing browser runs. Preserved and resolved an incomplete initial privacy download, an isolated screenshot timeout, and a PDF-viewer network-idle test timeout. Full reference/domain suites were not rerun for this document-only addition. No new catalog/task coverage or autonomous success credit. Evidence: billworld/research/onswc-documents-validation.json. Full catalog goal remains active.
