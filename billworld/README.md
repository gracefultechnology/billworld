# Billworld runtime and research pipeline

This release implements nine explicit billing slices: Juneau/InvoiceCloud, Spotify, AVEC/SmartHub, Homer/Xpress Bill Pay, Duluth/Utility Access, Grand Valley Power/SmartHub, Swepsonville/AuthorityPay–InvoiceCloud, WVU Medicine/MyChart and Western Dental/PersonaPay. Juneau covers invoice lookup, guest and registered payments, password login, enrollment, history, AutoPay settings, recovery and optional synthetic email MFA. Spotify adds email-first login, local Google identity, payment-method replacement, cancellation and a partner-billing limitation. Homer adds separate profile registration, Gmail email verification, organization/account linking and paperless enrollment before the documented checkout. SQLite persists episode state, payment commits and final scores. The full catalog benchmark and authenticated source fidelity remain incomplete.

Billworld now extends a pinned WebArena-Infinity checkout, reusing its task lifecycle and reports. See [the reuse review](infinity/REVIEW.md) and [extension instructions](infinity/README.md). Thirty-one billing tasks are wired through the upstream evaluator; validation dates and scopes are recorded below. The pinned upstream Gmail frontend is integrated with the authoritative episode mailbox at `/mail`; an SDK-based [MCP email connector](MAIL_CONNECTOR.md) exposes the same messages.

## Run locally

Requires Node 24 or later. From the repository root:

```bash
npm ci
npm run capture
npm run capture -- --site spotify
npm run capture -- --site avec
npm run capture -- --site homer
npm start
```

`npm run capture` fetches four Juneau public reference pages; `--site spotify` captures six Spotify pages. `--site avec` captures seven AVEC/SmartHub public routes; its main website currently returns HTTP 403 to the browser. It saves screenshots, HTML, DOM, accessibility trees, network metadata and content-addressed assets without submitting forms. Homer capture includes nine public routes and installs the Xpress logo, Homer crest and login background. The official PDF is separately hashed in the evidence manifest and exported with construction packets. Juneau capture installs the captured city logo; AVEC capture installs its login background and logo for local reference use. The capture directory and reference assets are ignored by Git; redistribution permissions are unresolved.

`npm start` binds the site to `127.0.0.1:3100`, its private grader to `127.0.0.1:3101`, and the mock Google service to a separate localhost origin on an available port. It prints the nine prototype site URLs and registration fixtures. Open an episode URL before browsing its routes. Runner-only credentials and admin access are saved in `billworld/data/*-runner.json` with owner-only permissions. Do not provide those files or the admin token to an evaluated agent.

The initial persona is `alex@billworld.test`, with portal password `Billworld-2026!` and mailbox password `Mailbox-2026!`. Customer number is `1001048`; synthetic checking has routing number `021000021`, account `000001048`, and holder Alex Morgan. These are local fixture values, not credentials or payment instructions for a live site.

## Verification

```bash
npm test
npm run test:browser
npm run test:browser:smarthub
npm run test:browser:xpress
npm run test:research
npm run test:browser:duluth
npm run test:browser:wallet
```

Engine tests cover monetary rules, idempotency, account access, recovery, MFA, settlement, Google callback/token validation, subscription rules and scoring. Browser tests navigate both sites, including a Google round trip to another origin, consent cancellation, wrong identity, card replacement and partner billing. Research tests check source synchronization, URL normalization and preservation of captured evidence. Screenshots and machine-readable results are saved under `billworld/artifacts/browser/`.

Reference scripts passing these checks establishes simulator behavior. It does not establish source equivalence or the performance of an autonomous agent. Browser version and test outcomes are recorded in `results.json`.

## Runner and evaluator API

All control endpoints are on the separate admin port, require `Authorization: Bearer <admin token>`, and accept POST JSON:

| Endpoint | Input | Result |
|---|---|---|
| `/episodes` | `seed`, optional `siteId`, `taskId`, `registered`, `emailOtp`, `pending`, `partnerBilling`, private `trial` metadata | New isolated episode, start URL, task and persona credentials |
| `/evaluate` | `episodeId`, `confirmation`, `billingDate` or `scheduledDate` | Strict task success and independent predicate results without finalizing |
| `/finish` | `episodeId`, `outcome`, `metadata` (including `termination`) | Persist an immutable final score and prohibit later mutations |
| `/report` | optional `kind`, `agent`, `accessMode` | Started/active/terminal counts, termination causes, first-attempt and retry rates, site/task/family summaries |
| `/advance` | `episodeId`, `milliseconds` | Advance virtual clock, execute due scheduled/recurring debits and check expiry |
| `/settle` | `episodeId` | Post pending payments for a settlement scenario |

Creating a new episode is the reset operation: it produces fresh billing, accounts, sessions, challenges, mailbox and tokens. Use a fresh browser context as the browser reset. Existing episodes remain in the database; lifecycle deletion and storage quotas are still needed before large-scale runs.

Twenty-one versioned tasks cover Juneau payment, AutoPay enrollment, scheduled payment, synthetic email-MFA payment, synthetic password recovery, Spotify card replacement, AVEC/SmartHub bill payment, Homer signed-in payment Homer registration/linking/payment, and Duluth password-payment, registration/linking/payment and Google-payment. GVP adds payment, temporary-password registration and AutoPay tasks; Swepsonville adds guest payment, CID registration, recovery, bank-draft request and deposit payment tasks. Homer registration grading requires email verification followed by account linking before the authenticated payment, with paperless enabled. Guest payment cannot satisfy either signed-in Homer task. Recovery requires the requested password and subsequent sign-in without billing changes. MFA grading rejects guest-payment shortcuts and verification after payment. Payment grading checks invoice, account, amount, method, fee, posting, unchanged AutoPay, exactly one new payment and confirmation. The additional Juneau tasks check saved enrollment or schedule/date without an immediate payment. Spotify grading requires primary-account Google login, the correct replacement card, active Premium, no extra payment and the reported billing date. Grading reads private state and event history rather than trusting page text.

Finish metadata requires `kind` (`agent`, `reference_script` or `grader_validation`) and an `agent` label. Example: `{ "episodeId": "...", "outcome": { "billingDate": "2026-10-20" }, "metadata": { "kind": "agent", "agent": "my-agent-v1" } }`. Final scores are immutable; replaying finish returns the original score. The default report includes only agent trials. Reference tests use a separate cohort and are not autonomous-agent results. Empty cohorts report a null success rate. Declare `trial` metadata on episode creation to persist an attempt before browser startup. Its lineage is immutable. A deadline watcher seals expired trials; late mutations are rejected. Harness exceptions and cancellation persist failed scores, and worker restart seals interrupted declared trials as environment errors. Reports expose active attempts and terminal fraction so an incomplete cohort cannot silently become a final score. First-attempt strict success and best-of-observed-attempts are separate metrics; failed terminal trials, including environment errors, remain in the denominator. Action-count limits, whole-job dispatch accounting, external supervision and uncertainty estimates remain unfinished.

## Mock email connector

The agent-facing connector uses the site port, an episode-scoped mailbox bearer token, and `X-Billworld-Episode: <episodeId>`:

- `GET /connector/messages?q=...` lists or searches messages. Supported query subset: free text, quoted phrases, `from:`, `to:`, `subject:` and `is:unread`.
- `POST /connector/mark-read` with `{ "id": "mail-..." }` updates read status.

Messages contain sender, recipient, subject, text, thread ID, received time, unread state and an empty attachment list. Browser inbox and connector read the same store. Codes and links occur in ordinary message text; there is no hidden challenge shortcut. Message/thread retrieval, persisted flag changes and an MCP connector with pagination are implemented; HTML bodies, attachments and delivery delay remain future work. See [connector setup and tool contracts](MAIL_CONNECTOR.md).

Mailbox authentication is separate from portal authentication. Spotify supports the new local Google identity service; Juneau's support remains unknown and no Google button was added. Google account selection, password validation, consent/cancellation, one-use codes, callback state, PKCE and signed identity claims are checked. Google uses a different hostname/origin; site cookies use SameSite=Lax to permit the top-level callback, with same-origin checks on mutations. The optional Juneau email OTP scenario remains synthetic.

The primary mock Google password is `Google-2026!`. Spotify fixtures also supply a synthetic replacement Mastercard ending 4444. Both the Google credential and card are returned only in runner fixtures. Unlinked identity enrollment, Google account linking, Apple/Facebook authentication, saved identity sessions, temporary card holds, receipts and private source fidelity remain unfinished.

## Catalog research queue

```bash
python3 billworld/research_catalog.py init
python3 billworld/research_catalog.py fetch --limit 24 --workers 3
python3 billworld/research_catalog.py status
```

Browser capture can now use catalog records directly:

```bash
python3 billworld/capture_catalog.py biller_00f388d611ae6baa4e79 --plan-only
python3 billworld/capture_catalog.py biller_00f388d611ae6baa4e79 --kinds website,login_url
node billworld/capture.mjs --site duluth
```

The catalog command preserves SPA fragments, deduplicates identical browser URLs while keeping route associations, and records source hashes and missing routes. It accepts only supplied public routes and never invents a login URL. Browser collection retains screenshots, rendered HTML, DOM/accessibility, network metadata and bounded frontend assets. It does not submit production forms. Construction packets now copy rendered HTML with hash verification alongside downloaded assets.

The queue imports every category record, preserves its original navigation URLs and provenance hashes, deduplicates HTTP fetch URLs, and saves progress in ignored `billworld/research-data/`. Initial counts: 59,477 entries, 143,749 supplied route associations and 72,395 distinct fetch URLs. Three populated URLs were rejected by normalization. Missing fields remain gaps, not unsupported-feature claims.

Fetches use public GET requests only, per-host pacing, bounded response sizes, public-address checks and persisted checkpoints. The default batch balances categories and selects help/payment URLs. Use `--kinds website,login_url` for another route group, or `--retry` to include transport failures. HTTP errors are retained for review rather than automatically retried. Response bodies are hashed; script and task-link candidates are recorded without declaring them correct or loading private accounts.

An `http_captured` result only means a response body was saved. Content matching, client-side rendering, authenticated behavior and implementation fidelity require further review and browser captures. Current snapshot: 1,581 saved response bodies, 171 HTTP errors, forty-eight fetch failures and eight oversized responses; 70,587 URLs remain pending. Existing category verification flags remain unchanged. `research/catalog-status.json` is a dated snapshot; `research-data/status.json` reflects the current queue.

## Catalog coverage and construction packets

`python3 billworld/catalog_index.py` indexes all 59,477 records, keeping route-host signals, processor claims and captured evidence separate. `research/family-coverage.json` lists 42 candidate families and representative records for review. Only the nine explicitly mapped prototype sites count as runtime coverage; no independent fidelity certification is claimed.

`python3 billworld/source_packet.py <biller-id>` exports an evidence packet for Infinity’s existing app-generation workflow, with source hashes, capture status, local reference files and a billing construction contract. It excludes failure pages as UI references. See [the catalog workflow](research/CATALOG_WORKFLOW.md). Tuscaloosa’s municipal homepage and billing documentation are captured; its Paymentus portal returned HTTP 403 and is not implemented. Duluth/ComfortSystems has 12 public captures, including Tyler identity login, registration, account unlock, guest lookup and help, plus 30 official guide images. Its first slice implements email-first/password and mock Google login, email-code registration, exact full-name linking, guest checkout, paperless, bank/card review/payment, history, scheduling/edit/cancel, AutoPay and saved-method add/edit/remove/default controls. Fees, posting, recovery completion and later identity screens remain synthetic; other social providers, multi-account support and the complete municipal homepage are unfinished. Run `npm run test:browser:duluth`. See [Duluth evidence](sites/duluth.json).

## Evidence and remaining scope

Homer/Xpress Bill Pay implements the captured personal-registration, login, recovery and guest lookup forms, plus guide-based account linking, paperless choice, cart, bank/card checkout, confirmation, history, scheduling/edit/cancel, AutoPay and saved-method add/edit/remove/default controls. Registration cannot bypass email verification; unlinked profiles cannot read invoices or mutate billing. Six Puppeteer scenarios and six domain tests cover the flow, including guest-task rejection, expired/cross-episode links, wrong-account linking and declined cards. Run `npm run test:browser:xpress`. Production fees, clock, identity and settlement policies are synthetic; mobile login, SMS, multiple payers, business profiles, wallet editing, statement PDFs and the complete municipal homepage are unfinished. See [Homer evidence](sites/homer.json).

Release 0.16.0 validation passed 140 domain/grader tests, thirty-four research tests and all twenty-nine Infinity references. Release 0.17.0 passes 154 domain/grader tests, thirty-four research tests, thirteen PersonaPay browser scenarios and all thirty-one Infinity references. It adds recurring-plan and future-payment enrollment, consented cancellation and separate dental installment execution. Western Dental adds captured account-number/ZIP/DOB login, local account help, card/ACH payment, weighted or edited allocation, partial payments, overpayment credit and reloadable receipts. Its private checkout and account data remain synthetic. Nine first slices and thirty-one tasks are registered. Current reference results and HTML report are preserved in `artifacts/infinity/0.17-full/`; prior releases remain in their original directories. These are simulator/reference checks, not autonomous-agent scores or independent source-fidelity certification. See `research/personapay-runtime-validation.json` for browser and grading evidence; eBill and independent source-fidelity review remain unfinished.

AVEC/SmartHub now supports password sign-in, first-step registration plus documented SSN/phone matching, recovery through Gmail, guest account/surname lookup, bank/card payment, history, configurable AutoPay and scheduled creation/edit/cancel. Its captured login background and public field structure are reused; authenticated layouts, zero-fee handling, identity values and execution rules are synthetic. The public marketing homepage, PayPal and Apple Pay remain unfinished. See [the AVEC evidence manifest](sites/avec.json). Run `npm run test:browser:smarthub` for its five Puppeteer reference scenarios.

Site files record capabilities and fidelity limits; `research/juneau-public.json`, `research/spotify-public.json` and `research/avec-public.json` record public capture manifests and reviews. The captured Juneau processor page is server-rendered ASP.NET; downloaded JavaScript alone is not its complete implementation.

Current limits:

- Juneau public landing layout is reconstructed; the municipal homepage is still a functional navigation subset. Authenticated visual fidelity is unverified.
- Password reset, optional OTP, AutoPay cancellation, rounding and settlement are synthetic. Source registration is email/password creation; the simulator additionally constrains email to the seeded persona.
- Synthetic monthly invoicing/AutoPay, scheduled payment creation/edit/cancel/execution and subscription renewal/cancellation run through a deterministic virtual scheduler. Source fidelity for execution policies remains unverified.
- Statement PDFs, paperless, saved-method editing, other Juneau bill types and alternate challenge channels remain unfinished.
- Twenty-one tasks and aggregate reporting exist, with an Infinity lifecycle adapter. UI action accounting, autonomous model validation, held-out task splits and full benchmarks remain unfinished.
- UI assets and requests are local. Reference browser tests prohibit external requests, but deployment-level egress restrictions and a filesystem/process sandbox are still required for untrusted agents. Keep agent access away from runner credentials, task goals and the database.
- HTTP is loopback-only with SameSite/HttpOnly cookies. Local Google has a separate origin; production-style HTTPS, hardened rate limits/lockouts and credential-vault integration remain unfinished.
- All other billers still require research and implementations. Shared engine code does not prove that portal-family variants are faithful.

Follow the full [Billworld plan](../BILLWORLD_PLAN.md) for catalog expansion, capture requirements, independent fidelity review and release gates.

Public HTML route discovery: `python3 billworld/discover_routes.py` checks source-body hashes and extracts unverified login, payment, registration, help and billing navigation candidates. Rebuild the coverage index afterward. Candidates retain source URL, labels, capture timestamp and hash; they do not replace original catalog routes or grant runtime coverage. The index and Infinity construction packets include them for further review. Card expiry is checked at scheduled/AutoPay execution for Duluth; updating a saved expiration affects its future schedule, and expired attempts fail once without reducing the balance. This is declared synthetic behavior.

Grand Valley Power has eight public browser captures, 334 unique hash-verified assets and a documented registration guide in a versioned Infinity construction packet. Its SmartHub branding and policies are recorded in [GVP reconstruction evidence](research/GVP_RECONSTRUCTION.md). Its first runtime slice adds signed-in payment, temporary-password registration through Gmail with forced password change, AutoPay on the 18th, guest payment and paperless enrollment. The 0.6.0 registry had six sites and sixteen tasks. Authenticated layouts, identity questions and execution details remain explicitly synthetic.

Run `npm run test:browser:gvp` for GVP reference journeys. Its synthetic registration question asks the current bill amount; the documented temporary-email/password-change sequence is enforced on the server. AutoPay rolls weekends forward from the 18th using a declared UTC calendar, with production holidays unobserved.

GVP public help now preserves separate `/ways-pay`, `/SmartHub` and `/paperless` destinations. Ways to Pay has eight navigable payment-option tabs; the guides link to local login, registration and guest checkout. Public content comes from saved captures, while the shared help layout remains synthetic.

To reconstruct GVP’s captured public homepage locally, run `python3 billworld/build_public_snapshot.py` after its public capture, then restart the server. The builder verifies captured HTML/assets and writes an ignored, versioned-by-hash reference bundle. It reuses original public HTML/CSS/fonts/images, routes billing links locally, removes scripts and form submission, and disables unfinished destinations. Missing source assets and unsupported links are listed in the generated manifest. This is a static homepage reconstruction; live news, site search, original scripts and full marketing navigation remain unfinished.

Swepsonville now has thirteen public captures spanning the municipality, AuthorityPay/Muni-Link auth, InvoiceCloud utility/deposit entry and a Jotform bank-draft form, plus two hashed official policy PDFs. Its [reconstruction evidence](research/SWEPSONVILLE_RECONSTRUCTION.md) records the handoffs and tenant-specific rules. Its 0.7.0 first slice adds CID registration and subsequent sign-in, Gmail recovery and InvoiceCloud guest utility payment. Run `npm run test:browser:swepsonville`. The 0.7.0 registry contained seven prototypes and nineteen Infinity tasks. Activation, password rules, private layouts, fees and settlement are synthetic. Bank-draft activation/cancellation, deposits, complete municipal pages and separate portal origins remain unfinished.

## Fleet: catalog-wide mock sites

`billworld/fleet/` serves every one of the 59,477 catalog records as a mock biller site. Each record maps to one of 26 researched portal-family templates, all backed by one billing engine, a shared `/mail` inbox and a private grader. A catalog sweep checks all billers' pages, engine lifecycles and generated tasks; Puppeteer flows run per template. Fleet coverage is family-faithful and labeled by evidence; the hand-built slices above remain the higher-fidelity references. See [fleet/README.md](fleet/README.md).

Swepsonville bank-draft requests now use the captured public form fields, typed signature, checking/savings options and local source logo. `npm run test:browser:bankdraft` verifies pending submission, confirmation, receipt reload, invalid routing, explicit consent, savings and idempotent retry. Source matching, consent checkbox, review state, acknowledgement email and receipt authorization are synthetic. Submitting does not pay an invoice or activate AutoPay; exact approval, execution date and cancellation remain unimplemented. The registry has seven prototypes and twenty declared tasks.

Swepsonville deposits now have the four observed entry fields and separate synthetic payment obligations. Run `npm run test:browser:deposits`. The $150 local Town Hall amount, identity checks, continuation, quote/review/receipt, zero fee and immediate posting are synthetic. Paying a deposit cannot satisfy the utility invoice task. The registry has seven prototypes and twenty-one declared tasks. Production deposit continuation remains unobserved.

Swepsonville homepage, Utilities and FAQ now reuse hash-checked captures and local assets. Run `npm run test:browser:municipal`. Local dropdowns, responsive quick-link carousel and FAQ expansion/search work; portal help links load the reconstructed pages. Original scripts, CMS login, search, calendar and external widgets remain disabled, and missing assets/unsupported links are listed in each snapshot manifest. All five Swepsonville tasks now traverse this homepage through Infinity.

WVU Medicine/MyWVUChart has a reviewed research packet for the next medical slice; see [the reconstruction plan](research/WVU_RECONSTRUCTION.md) and [capture validation](research/wvu-validation.json). Nine of eleven public captures are usable candidates. Signup and recovery are excluded as unrendered interfaces. No WVU runtime or task is registered. The capture collector now records visible versus hidden fields and checks React workflow readiness; 27 research tests and `npm run test:browser:capture` pass for these changes.


WVU Medicine/MyWVUChart now has local captured homepage, billing/help pages, username-first password login, email MFA through mock Gmail and visit-scoped guest/signed-in payment with reloadable review/receipt. Run `npm run test:browser:mychart`. The guarantor, patient and visit account are distinct, and paying one visit preserves the others. Downstream private layouts, CAPTCHA, fees and posting are synthetic. Epic ID, signup without a code, recovery, SMS, payment plans, assistance applications and HME billing remain unimplemented. See [construction validation](research/wvu-construction-validation.json).

WVU public reconstruction now retains inline stylesheet positions alongside captured CSS links, preserving the original cascade. Local FAQ accordions and mobile billing navigation work with mouse/keyboard controls. Run `npm run test:browser:wvu-public`. Rebuilt older source snapshots also pass municipal browser regression and the full Infinity reference suite. Captured images load eagerly; unavailable images remain transparent placeholders and are listed in manifests.

WVU activation now reuses the captured two-part code form. A mock Gmail message supplies an episode-scoped single-use code; synthetic account setup chooses a username/password before subsequent sign-in and visit payment. Run `npm run test:browser:mychart-activation`. Code/setup expiry, attempt limits and credential rules are explicitly synthetic. Generic registration cannot bypass activation. The capture pipeline retains SVG sprites reported as `other`, and reconstruction preserves symbol fragments.

WVU billing guide and understanding-billing links serve three unmodified official PDFs with startup hash validation and browser link/byte checks. The construction packet has eleven usable public page references, including observed recovery-choice and contact-entry screens, plus the three PDFs. Local email recovery is implemented; its post-code continuation remains synthetic. See `research/wvu-documents.json` and `research/wvu-construction-validation.json`.

MyWVUChart email recovery uses the captured login-help choice and previously enrolled email/phone entry. Mock Gmail delivers a single-use email code. Verification issues an HttpOnly episode-bound reset grant, displays the username, resets the password and invalidates sessions. Recovery codes/grants expire in ten minutes and allow five code attempts; those limits and post-code UI are synthetic. Generic utility reset links cannot bypass medical verification. SMS and Epic ID recovery are unavailable. Run `npm run test:browser:mychart-recovery` for the Gmail and negative browser scenarios.

## Construction previews

Lockwood Missouri ePayUB/CUSI is available through `node billworld/preview-construction.mjs lockwood` (default port 3110) or the explicit Infinity construction app. It uses the same server, mailbox and grading services, with construction fixtures and private runner files. Captured username login and Email Link recovery work, alongside synthetic bill/card review and receipt continuation. Original private billing layouts, fees, bank verification and registration continuation remain unfinished. Default workers reject construction episode entry and connector tokens, and the released registry remains nine sites and thirty-one tasks. Runner reports default to `siteCohort: "released"`; choose `siteCohort: "construction"` explicitly for draft outcomes. Run `npm run test:browser:cusi`. See `research/cusi-construction-validation.json` for dated validation and synthetic policies.

CUSI construction payment continuation: `npm run test:browser:cusi-payment` exercises captured username login, current bill viewing, synthetic card review/authorization and receipt delivery through the reused Infinity Gmail UI. The Lockwood preview has three construction tasks. Its $2.50 card fee and private screens are explicitly synthetic, and ACH verification remains unsupported until the tenant deployment is specified. See `research/cusi-payment-evidence.json` and `research/cusi-payment-construction-validation.json`. These additions do not change released site/task counts.

All three Lockwood tasks now run through the same Infinity evaluator, lifecycle and reports in `apps/billworld-construction`. Both directions of score separation are verified: three draft references yield zero released trials, and 31 released references yield zero draft trials. The construction card grader also checks the full instrument fingerprint and cardholder name. See `research/infinity-cusi-construction-validation.json`.

Public catalog reconstructions now reuse `build_public_snapshot.py --capture <safe-capture-id> --manifest <evidence-manifest>`. New billers no longer need their IDs added to the parser/server. Only usable captured pages and hash-verified PDFs are linked; source scripts and forms remain inert. The local `catalog-public.js` supports captured collapse accordions. Charlotte County Florida has three reconstructed public pages and two official PDFs; its Paymentus capture returned HTTP 403, so no auth/payment task or runnable coverage is added. Run `npm run test:browser:catalog-public`, or preview with `node billworld/preview-public.mjs biller_7b18707708e2ec35fd63-website` on port 3112. See `research/charlotte-county-construction-validation.json`.

Batavia now has two construction-only auth tasks in the existing Infinity construction app. `npm run test:browser:paymentus-auth` exercises the documented email/password screen, protected Accounts shell, logout and recovery through the reused Gmail frontend. The private grader requires sign-in after the delivered reset and rejects billing/settings changes. Guide-based entry screens and synthetic private continuation are kept separate from original-site fidelity. Registration and billing remain unimplemented. Preview with `BILLWORLD_PREVIEW_PORT=3113 node billworld/preview-construction.mjs batavia-utilities`; this is separate from the nine-site released worker. See `research/batavia-auth-construction-validation.json`.

Batavia registration/account linking adds a third construction task (`task_c6`) to the same Infinity app. Run `npm run test:browser:paymentus-registration`. The documented sequence includes alphanumeric service-address prefix verification, Paperless Yes/No, notification choices, terms consent and Account Created; validation, review-grant lifetime, sample addresses and terms are synthetic. The grader checks new-password login after linking, exact preferences and unchanged billing/other identities. Payments remain unfinished. See `research/batavia-registration-construction-validation.json`. Earlier auth-only reports retain their dated scopes.

Catalog frontend research now inventories hash-verified static script/style references and downloads them through a resumable public-GET queue. Infinity construction packets include reference-only source bundles with page/biller provenance. See [the catalog workflow](research/CATALOG_WORKFLOW.md) and [the collection validation snapshot](research/frontend-catalog-validation.json). This adds source evidence; released coverage remains nine sites and thirty-one tasks, with six separate construction tasks and no independent fidelity certifications.

### Public snapshot loading and integrity

Workers index reconstructed capture directories at startup and read manifests and bodies on demand. Every cold body read verifies its SHA-256 and path containment before serving. The LRU cache retains at most 16 MiB of bodies, 256 body entries and 64 manifests; larger bodies are verified and served without retention. Existing approved local-behavior checks remain in place. Downloaded production source bundles remain inert research evidence.

Run `npm run audit:snapshots` after rebuilding captures and before evaluating a changed snapshot set. The audit refreshes manifests and checks every declared body without filling the body cache. Corruption of an unused file is detected by this audit; runtime loading detects corruption when that file is requested. An unfinished directory without a manifest adds no served or audited capture coverage.

`research/lazy-snapshot-validation.json` records the current integrity, domain/browser checks, startup observations and passing full Infinity suites (31 released and seven construction references). Snapshot integrity does not certify original-site fidelity.

Offline frontend dependency analysis now adds verified literal JS/CSS candidates to Infinity construction packets. Run `python3 -m billworld.research_dependencies --limit 100 --output billworld/research-data/frontends/dependency-batch.json`; repeated global scans advance past current analyses. Original source stays inert. Lockwood and Batavia packets include 28 and nine analyzed assets, with partial CSS parsing labeled. Child downloads, computed dependencies and independent source-fidelity review remain unfinished. Validation passes 208 JavaScript and 76 research checks; see [dependency evidence](research/frontend-dependency-validation.json) and [the catalog workflow](research/CATALOG_WORKFLOW.md).

Literal child script/style collection is now available through `python3 -m billworld.research_dependency_capture --biller-id <id> --limit 30 --third-party --output billworld/research-data/frontends/child-batch.json`. Repeated batches follow captured children's imports within explicit bounds. Batavia's first batch captures 30 sources and exports verified parent chains into its Infinity packet; 95 candidates remain pending. Validation passes 81 research checks and five parser regressions. See [child collection evidence](research/frontend-child-capture-validation.json). These source captures do not add executed replicas or fidelity certification.

CUSI recovery now sends reset links and password-change notices to the registered login profile email, falling back to utility contact email for earlier profiles. The utility contact and mailbox ownership stay separate. Run `npm run test:browser:cusi-profile-recovery` for registration with different contact/login emails, Gmail recovery, old-password rejection and restored login. Validation passes 210 JavaScript and 81 research checks plus this browser journey; see [profile recovery evidence](research/cusi-profile-recovery-validation.json) for initial startup/parallel-test failures and the passing retries. Alternative mailbox aliases and the original private delivery policy remain unverified.

Batavia's later source batches capture 141 child assets and refresh the Infinity packet with exact copied bytes and current parent chains. The three-level traversal bound is reached; deeper and computed dependencies remain unfinished. See [the dated frontier evidence](research/batavia-child-frontier-validation.json).

CUSI registration now handles an already enrolled account through a recovery dialog and the shared Gmail reset flow. The captured family client contains this branch when multi-registration is disabled; the local tenant flag, private dialog layout and backend policy remain synthetic. The server requires the matched account/phone and a reviewed, confirmed, episode-bound registration cookie. Repeated submissions send one email, and browser-supplied account IDs/tokens cannot select another identity. Run `npm run test:browser:cusi-registration-recovery`. See [registered-account recovery validation](research/cusi-registered-recovery-validation.json) for current checks and Infinity regression status.

## Mock mailbox attachments

The shared mailbox supports attachment metadata in message/thread responses, `has:attachment` search, Gmail download links and the episode-scoped `gmail_get_attachment` MCP tool. Message projections omit attachment bytes; explicit retrieval returns base64 bytes and SHA-256 through the connector, or a noncached download through the authenticated browser. Fixtures must supply a unique attachment ID within each message, filename, MIME type, byte count, content hash and canonical base64 payload. The one-MiB limit and safe MIME/filename checks apply on retrieval.

This adds shared capability; existing biller messages remain unchanged because original-site attachment behavior is not yet established. Synthetic attachment fixtures verify visible downloads, reload, logout and browser/connector byte parity with `npm run test:browser:mail-attachments`. HTML bodies, attachment preview, uploads and oversized attachment streaming remain unfinished.

## Batavia preference construction flow

The Paymentus construction site now supports the documented account-level notification editing entry and reversible paperless choice. The local combined form saves Paperless Billing, Email notification and SMS notification for an authenticated linked account. Its private layout, immediate update and delivery effects are synthetic; it sends no real notifications. The guide describes up to 48 hours for live paperless changes, which this local form does not reproduce.

`batavia-notifications-v1` adds a separate construction task through Infinity. Its private grader requires login, viewing the target settings, the requested change and a subsequent reload/read; it protects other accounts, credentials, invoices, payments, methods, schedules and AutoPay. The UI reference also tests paper mail restoration, independent channels, unlinked-account rejection and logout. Run `npm run test:browser:paymentus-preferences`.

## Batavia statement downloads

Accounts now offers the documented **View Bill** action for the latest linked bill; Bill History also exposes past statements. These are three explicitly synthetic PDFs built from the same seeded invoices, without invented service line items. Each preserves the original amount after posted or pending payments. The authenticated route validates the current link, invoice/customer fields and PDF hash, sends noncached attachment bytes, and records authorized issuance. Changed fixtures require regenerated PDFs rather than stale documents. No public static route exposes the private fixture files.

`npm run test:browser:paymentus-statements` verifies actual Chrome download completion, exact saved bytes, history, bank payment, unchanged original statement, foreign-account rejection and logout. `batavia-download-current-bill-v1` is construction task `task_c12` in the existing Infinity app. Its grader checks the authorized response, task order, reported filename and unchanged business/credential state. It does not attest remote agent filesystem persistence; the Puppeteer reference checks that separately. The statement milestone added the twelfth construction task, outside the 31 released-task score denominator.

The checked-in PDFs and hash manifest are runtime assets. Rebuild with a Python environment containing ReportLab: `python3 billworld/build_paymentus_statements.py`. PDF generation is a build step; the running Node environment has no Python requirement. After rebuilding, update any task's private expected document hash if it changed, render/review all PDFs, and rerun the download tests. See `research/batavia-statements-construction-validation.json` for dated evidence and remaining fidelity limits.

### Batavia wallet construction

`node billworld/tests/paymentus-wallet-browser.mjs` exercises My Wallet navigation, profile-scoped masked methods, add/edit/remove forms, saved-card checkout, review invalidation and logout. Bank/card validation and storage reuse the existing wallet implementation. New checkout instruments are not automatically saved; saved instruments are selected explicitly. Editing/removing a method invalidates unpaid reviews, while completed receipts retain their submitted details. The published guide documents wallet navigation, but original forms, storage/duplicate rules and update timing remain unverified.

`batavia-manage-wallet-v1` is the thirteenth Infinity construction task (`task_c13`). Its private grader requires the exact card edit/add/removal, login/view/change/reload ordering, unchanged other methods/business state and unchanged credentials. It adds no released coverage. See `research/batavia-wallet-construction-validation.json` for current verification.

### Batavia account summary

Accounts now shows the guide's Date Due, Amount Due, Pay Bill and More/history controls. Amount Due subtracts posted bill credit, while pending reservations are shown separately and reduce the amount available to pay. Processor fees are not bill credit. The summary uses the earliest outstanding due date, falling back to the latest bill's date after settlement; this local aggregation/timing is synthetic. View Bill continues to target the latest statement after payment. Pay Bill and both history links carry an account filter that the server validates against the signed-in profile's linked accounts. The global menu continues to show all linked accounts.

`node billworld/tests/paymentus-account-summary-browser.mjs` validates posted and pending outcomes, guide navigation, account filters, logout and the existing payment grader. See `research/batavia-account-summary-validation.json`. No new task or released-site coverage is claimed for this change.

### Swepsonville synthetic review identity

The local guest utility payment review displays the account number and invoice
number from the authorized public lookup, matched to the quote's invoice ID. A
quote without a matching lookup invoice returns to account lookup. This makes
the synthetic confirmation reviewable by a person and by a checked payment
reader. It does not add private evaluator data, change grading, or claim these
private screens match the live biller's UI. Existing benchmark runs retain their
original source/build fingerprints; results from this version are distinct.
