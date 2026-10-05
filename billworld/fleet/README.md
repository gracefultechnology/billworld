# Billworld Fleet: every catalog biller as a runnable mock site

Fleet turns all **59,477** records in `categories/*.json` into mock billing websites you can address by URL. One authoritative billing engine backs them, with a shared mock mailbox, a mock phone (SMS), a mock Google sign-in and a private grader. Fleet complements the hand-built, evidence-heavy slices in `billworld/` (Juneau, Spotify, AVEC, Homer). Those slices stay the high-fidelity reference sites; Fleet supplies breadth. Revision: `fleet-0.2.0`.

## How a biller becomes a site

1. **Template.** `catalog.mjs` gives each record a stable id (`<slug>-<hash>`) and resolves it to one of **26 portal templates** (plus the `generic` reference template). Rules apply in this order:
   1. A documented URL on a family host (`HOST_RULES`).
   2. The `payment_processor` field: the earliest mention that is not negated within 40 characters. A warning about doxo is not a doxo signal.
   3. The login URL or the notes.

   Generic tokens (amr, epic, yardi, "patient billing", and so on) count only in the processor field or the login URL, and a family is used only for the kinds it actually bills. Otherwise the bill type and entity choose a category template.

   After that, the observed public profile can move a category biller to a family (see below). Every biller records its `signal`:

   | Signal | Billers | Meaning |
   |---|---:|---|
   | `category` | 31,015 | bill type and entity choose the template |
   | `processor_or_route` | 9,988 | catalog research names the portal family |
   | `observed_public_domain` | 1,638 | a captured page of the real site lands on, links to or posts to the vendor |
   | `unresearched_roster` | 16,420 | offline: the record was never researched; capabilities are `unknown`, not `unsupported` |
   | `informational` | 222 | offline: the record does not bill customers (capabilities `not_applicable`) |
   | `consolidated_billing` | 171 | offline: billed on another bill |
   | `no_public_website` | 23 | offline |
   | `documented_no_online` | 0 | offline: notes say there is no online account or payment |

2. **Capability profile.** Each biller gets a capability profile (`supported | unknown | unsupported | not_applicable`), and each capability carries an evidence label. A missing link never becomes a positive claim, and a negative statement in the notes lowers a claim to `unknown` (`documented_notes_negative`). Capabilities include `payment_arrangement` and `google_login`.

   | Evidence cohort | Labels | Score separately? |
   |---|---|---|
   | documented | `documented_link`, `documented_notes`, `documented_field`, `documented_notes_negative` | yes |
   | observed | `observed_public` (a captured page of the real site shows it) | yes |
   | inferred | `inferred_category`, `inferred_family`, `inferred_from_login` | yes |
   | synthetic | `synthetic_flow` | |
   | limitation | the offline signals above, `not_observed`, `unknown` | |

   `pay_online` evidence across the catalog breaks down as follows:
   - inferred_category: 19,754
   - observed_public: 13,456
   - documented_link: 8,688
   - documented_notes: 644
   - documented_notes_negative: 99
   - offline signals: 16,836

   Every generated task carries `evidence` and `cohort` (`tasks.mjs evidenceCohort`).
3. **Fees.** Fees come from the research notes when stated. Otherwise they are synthetic and labeled that way.
4. **Contact and help.** `biller.contact` holds the cleaned phone, pay phone, mail address and service area, plus digit lists. Research provenance such as "(context: …)", "fetched …" or URLs is stripped. Sites, help pages, PDFs and graders use only these cleaned values. `help.mjs` builds the help center from the record:
   - ways to pay, phone, pay-by-phone and mail address
   - AutoPay, cancellation, and assistance and senior programs
   - FAQ sentences from the notes
   - real excerpts from the observed profile

   Help articles use each template's own nav labels and never invent in-person or automated-phone claims.

| Template | Billers | Template | Billers |
|---|---:|---|---:|
| offline | 16,836 | income-tax | 933 |
| municipal-portal | 8,782 | invoice-portal | 874 |
| patient-pay | 5,707 | card-servicer | 821 |
| bank-billpay | 4,413 | invoicecloud | 812 |
| property-tax | 4,352 | dmv | 742 |
| mychart | 2,736 | streaming | 702 |
| utility-account | 2,469 | loan-servicer | 685 |
| rent-portal | 2,385 | paymentus | 672 |
| telecom | 2,097 | health-plan | 548 |
| smarthub | 1,082 | insurance | 517 |
| newspaper | 434 | waste-hauler | 316 |
| kubra | 255 | xpress | 189 |
| toll-account | 86 | doxo | 32 |

`generic` has no catalog billers. The browser suite runs it with borrowed billers that it reassigns in-process.

Each template has its own URL structure, navigation, terminology and step order, based on public research of the real portal family. For example:
- SmartHub uses `/ui/billing/pay-my-bill` with a three-step wizard and an account-and-surname Pay Now.
- Invoice Cloud uses ASPX-style paths and invoice search, then Process Payment.
- Xpress uses a bill cart, then checkout, then review.
- MyChart offers Guest Pay by guarantor or statement.
- Card and bank sites use a two-step login and statement, minimum or current amounts.
- Streaming has retention offers and plan changes.

Each template's `meta.evidence` and `meta.sources` record what was observed and what was synthesized. Logos are monograms; no third-party brand assets are served.

## Observed public profiles

`profiles/` holds per-biller profiles extracted from the research captures (`billworld/research-data`, read-only): real page titles, nav and footer labels, hero heading, theme color, login-form facts (field kinds, button wording, social providers, register, forgot and guest links) and help excerpts.
- `profiles.jsonl.gz` is loaded lazily as `biller.profile`, which is non-enumerable.
- `index.json` is an eager sidecar with family signals and observed capabilities, used for template resolution.

**Rebuild:** `node billworld/fleet/profiles/build-profiles.mjs [--workers 2]`. This takes about 15 s with the page cache in `profiles/.cache`. The build also cleans capture artifacts out of titles and headings: titles repeated back to back, doubled words such as "HomeHome", icon-font ligature words and `%PLACEHOLDER` text.

**Disable:** set `FLEET_PROFILES=0` to run without profiles. Resolution then falls back to research only.

| Coverage | Billers |
|---|---:|
| joined to research-data (id hash) | 59,477 / 59,477, 0 stale routes |
| with captured HTML / profiles written | 39,677 / 39,489 |
| website profile / with 3+ nav labels | 37,658 / 30,177 |
| login profile / login form found in the page | 12,058 / 5,751 |
| help excerpts | 16,617 |
| payment-vendor domain observed | 11,524 |
| social sign-in observed (Google 87, Apple 55, Facebook 29, Microsoft 26) | 104 |
| template changed by observation | 925 |

How templates use the profile (every field is optional, escaped and filtered for junk text):
- **Titles and headings.** Templates show the real title and hero heading.
- **Navigation.** Real nav labels link only to matching simulated pages. Anything else is plain text, so there are no dead links.
- **Theme color.** The theme color is darkened to reach 4.5:1 contrast.
- **Login wording.** Login wording follows the observed field, but only when the research ties the biller to that template's family.
- **Help excerpts.** Help shows "From the X website" excerpts. Excerpts are dropped if they contain a phone number not in the contact fields, a dollar amount or percentage, a URL or an email address.

## Flows every online biller supports

- **Account access**
  - Sign in, with optional MFA by email or SMS. MFA pages offer **Resend code**, which supersedes the old code, with a 30 s cooldown and at most 5 resends.
  - Registration with email verification.
  - Password reset with single-use, superseded and expiring codes, plus lockout.
  - Sign in with Google, where the biller has evidence for it.
- **Bills and payments**
  - Bill and statement PDFs, with previous balance, credit applied and total due, plus statement history.
  - Seeded payment history: 11 posted payments, marked `seeded:true`. They never count as the agent's payments.
  - One-time payments by saved or new bank account or card, for full, minimum, statement, installment or other amounts.
  - Fees, scheduled payments with cancellation, decline handling and duplicate-submit idempotency.
  - Guest or quick pay where supported, with each template's own lookup fields.
- **Account settings**
  - AutoPay enroll, change and cancel, with full, minimum or fixed policies. AutoPay runs on the due date, or on the chosen day.
    - Enrolling after a bill is issued starts with the next bill.
    - rent-portal and loan-servicer AutoPay is bank-only (`AUTOPAY_BANK_ONLY`).
  - Paperless billing.
  - Wallet add and remove, with in-use protection.
- **Service changes**
  - Cancellation: reason, then a retention offer (subscription and telecom), then confirm, with undo. Utilities stop service.
  - Plan change, payment plans, secure messages, profile and a searchable help center.

A virtual clock runs a 30-day bill cycle and processes scheduled payments, posting and AutoPay. Every action sends the matching email to the episode mailbox at `/mail`. Sign-in codes for `mfa:'sms'` go to the phone at `/sms`.

## Run

```bash
npm run fleet:start          # directory http://127.0.0.1:3200/, /mail, /sms; admin API :3201; mock Google :3202
npm run fleet:test           # node:test suites (engine, catalog, server, authed, channels, flowplan, infinity export)
npm run fleet:sweep          # all 59,477 billers: public pages, signed-in pages, engine lifecycle, every task, links
npm run fleet:browser -- --per-template 3 --concurrency 2 --tag mine          # Puppeteer flows per template
npm run fleet:browser -- --flows-extended --per-template 1 --tag mine-ext     # + wallet, plans, expiry, lockout, Google, SMS...
npm run fleet:browser -- --viewport mobile --per-template 1 --tag mine-mob    # 375px layout checks
```

Sweep options are `--limit N`, `--template a,b`, `--stride K`, `--skip http,authed,engine,tasks,links` and `--out file`. Without `--out`, results go to `fleet/.sweep/results.json`. Browser results and failure screenshots go to `fleet/.artifacts/<tag>/`. On a shared machine, always pass a unique `--tag` and keep concurrency at 2 to 3.

**Open-world mode (the default).** Any `/b/<billerId>/` URL opens without setup. Demo episodes use portal password `Billworld-2026!` and mailbox password `Mailbox-2026!`.

**Episodes from the admin API.** Episodes created with `POST /episodes` get a per-episode mailbox password in `credentials.mailbox.password`. The same password is the mock Google password, in `credentials.google`.

**Benchmark mode.** Set `BILLWORLD_FLEET_OPEN_WORLD=0`, or call `start({ openWorld: false })`. Only `/enter/<ep>/<token>` links then start an episode. A lost or invalid episode cookie shows an explicit "session ended" page, and an unknown episode on `/enter` returns 403.

**Environment variables:**
- `BILLWORLD_FLEET_ADMIN`: the admin token. Without it, a token is generated and written to `<dataDir>/admin-token` with mode 0600. It is never printed.
- `BILLWORLD_FLEET_DATA`: the episode snapshot directory. The default is `billworld/data/fleet`.
- `PORT`, `ADMIN_PORT` and `GOOGLE_PORT`.

Cookies are scoped per port (`bwf_ep_<port>`).

**Programmatic start options:** `start({ port, adminPort, host, dataDir, adminToken, quiet, openWorld, maxOpenEpisodes, openEpisodeTtlMs, google, googlePort, googleHost, socialOverrides })`.
- `google: false` turns the mock IdP off.
- `socialOverrides: { [billerId]: ['google'] }` forces Google sign-in on or off for chosen billers.

**Security:**
- Every response sends `X-Frame-Options: DENY`, and HTML pages get a strict CSP.
- Forms need a CSRF token that is independent of the session id.
- Sign-out links carry `?_csrf=`.
- Two-step login keeps the user id out of the URL.
- Malformed cookies, paths, Origin headers and entry targets return 4xx, never 500.

### Channels

- **Mail:** `/mail` is a webmail inbox with search operators, threads, flags, trash and pagination. The episode connector serves the same mailbox at `/connector/*` (bearer token plus the `x-billworld-episode` header). `mail-mcp.mjs` is a stdio MCP server with Gmail-style tools and SMS tools and no grading tools. `POST /episodes` returns its launch command in `connector.mcp`. Mail ids are monotonic per episode (`mail-1`, `mail-2`, …).
- **Phone:** `/sms` lists text messages to the persona's phone. It opens with the episode cookie, and the connector serves it at `/connector/sms`. Use the scenario `mfa:'sms'`, per biller or as `default`. The engine texts the code natively (`engine.sms()`, `sms_sent` event), and MFA pages say "We texted a 6-digit code to (•••) •••-1234".
- **Google:** a mock OpenID provider runs on its own origin (`GOOGLE_PORT`). It covers:
  - chooser, password and consent screens, with consent remembered on return
  - cancel
  - PKCE, state, nonce, audience and signature checks
  - one-use codes
  - decoy and unregistered accounts

  The button appears only on billers with evidence (`profile.login.socialProviders` includes google; 86 billers carry `google_login: supported/observed_public`) or with a `socialOverrides` entry. Google sign-in links to an existing registered account and skips the biller's own MFA.

### Admin and grader API (bearer token, separate port)

| Endpoint | Purpose |
|---|---|
| `POST /episodes {seed, billerId, scenario, taskId, mailPassword, kind}` | Creates an isolated episode. Returns the entry URL, persona, credentials (portal, mailbox, Google, phone), `connector` and `channels`. `taskId` binds a generated task: the task's scenario seeds the episode and `/finish` grades only its predicates. Scenarios: `registered`, `mfa` (`email` or `sms`), `autopay`, `paperless`, `forgotPassword`, `scheduledPayment`, `declineSavedCard`, `expiredCard`, `amountCents`, `pastDueCents`, `plan`, `cancelPending`, `billNotice`, `dueInDays`. |
| `GET /episodes`, `DELETE /episodes/:id`, `POST /episodes/:id/reset` | Lists, deletes or re-seeds an episode. Reset keeps the id and every credential. |
| `GET /tasks?billerId=` | Generated tasks for this host, including `google-login-pay` only where Google sign-in renders. |
| `POST /evaluate {episodeId, predicates?, answer?}` | Strict grading against the ledger and event log. With no predicates, it uses the bound task's. |
| `POST /finish {episodeId, answer?, metadata?}` | Immutable final score. On a task-bound episode, caller predicates are ignored. Without a task, empty predicates return 400. A second call returns the first record. The result records `taskId`, `predicateSource`, `revision` and `taskRevision`. |
| `POST /advance {episodeId, milliseconds}` | Advances virtual time: schedules, posting, AutoPay, service end. |
| `GET /state`, `/account`, `/mailbox`, `/biller` (with `profile`), `/templates` | Private state for runners and debugging. Never give these to an agent. |

## Tasks and grading

`tasks.mjs` generates **821,022 tasks** from each biller's capabilities:

| Cohort | Tasks |
|---|---:|
| inferred | 439,217 |
| observed | 200,614 |
| documented | 164,355 |
| limitation | 16,836 |

There are 27 task types, generated where the biller's capabilities support them:
- **View and pay:** view-bill, pay-bank, pay-minimum, pay-partial-card, schedule-payment, cancel-scheduled, declined-retry.
- **AutoPay:** autopay-enroll, autopay-switch-to-card (not on bank-only AutoPay templates), autopay-cancel.
- **Settings and wallet:** paperless-on, remove-old-card.
- **Account changes:** setup-payment-plan, send-message, cancel-service, accept-retention, undo-cancellation, downgrade-plan.
- **Sign-in and recovery:** reset-then-pay, mfa-pay, sms-mfa-pay, google-login-pay (86 billers with observed Google sign-in), register-and-pay, guest-pay.
- **Information and limitations:** help-phone, offline-limitation, not-a-biller.

Predicates: `payment`, `no_payment`, `autopay`, `autopay_unchanged`, `paperless`, `service`, `retention_accepted`, `scheduled_cancelled`, `password_changed`, `logged_in`, `registered`, `method_removed`, `payment_plan`, `message_sent`, `event`, `event_sequence`, `no_event`, `answer` and `no_unrequested_changes`.
- Every task also asserts `no_payment {scope:'others'}`.
- `no_unrequested_changes` fails the task on any side effect the task did not allow, such as AutoPay, paperless, methods, plan, service or messages.
- Amounts are compared in cents against the balance at episode start.
- Payment method and source are pinned.
- Receipt-only success, wrong amounts, duplicates and seeded payments do not pass.

Answers: the runner passes the agent's final message as `answer` to `/evaluate` or `/finish`.
- `amount_due` and `phone` answers pass only when the right value is the first one reported or the answer names at most two distinct values. Listing every number on the page does not pass.
- `contact` also accepts the mailing address.
- `abstain` requires an explicit abstention and no payment.

**Webarena-infinity export:** see [`infinity/README.md`](infinity/README.md). Run `node billworld/fleet/infinity/export.mjs`, then `node billworld/fleet/infinity/run-reference.mjs --suite real-tasks --per-template 1000 --negatives all`.
- The export makes stratified test, dev and train suites, with held-out families and per-cohort caps.
- `google-login-pay` is excluded from exports, because it needs the IdP's second origin.
- Exports are snapshots. Re-export after any Fleet change.

## Verification (2026-10-05, this revision)

| Check | Result |
|---|---|
| `npm run fleet:test` | 126/126 pass |
| `node billworld/fleet/tests/sweep.mjs` (all 59,477 billers) | 0 failures: http 750,779/750,779 pages; authed 42,641/42,641 signed-in checks; engine 59,477/59,477 lifecycles; tasks 821,022/821,022 (shape, no-op fails, reference solver satisfies every predicate); links 880,846/880,846 (about 2 min on 8 shards) |
| `browser.mjs --per-template 3 --concurrency 3` (desktop, standard flows, 27 templates incl. generic) | 1,318/1,318 flows passed (81 billers) |
| `browser.mjs --flows-extended --per-template 2 --concurrency 3` | 1,798/1,798 flows passed (66 billers), including 64 `google_signin` and 52 `sms_mfa` |
| `browser.mjs --viewport mobile` | `--viewport mobile --per-template 1`: 463/463 flows passed (27 billers, 375 px, includes `mobile_layout`) |
| `infinity/run-reference.mjs`, every exported task, export `f585c208f9f5b874` | test 603/603, dev 244/244, train 509/509; 1,563/1,563 no-op and wrong-answer attempts rejected |
| `infinity/smoke.py` through upstream `run_task` | 78/78 reference tasks (26 templates, 25 task types); 90/90 negatives rejected |
| `node --test tests/channels.test.mjs` | 11/11, including task-bound `sms-mfa-pay` and `google-login-pay` over HTTP with the real mock IdP |

## Honest limits

- **Signed-in screens.** Template flows are researched from public pages and vendor docs. Authenticated screens of real portals were not observed, so signed-in layouts are reconstructions (`meta.evidence.synthetic`). Fleet sites are faithful to the portal family; they are not per-biller pixel copies.
- **Per-biller variation.** Variation comes from the catalog (name, service area, phones, addresses, fees, notes, capabilities) and from observed public profiles (title, navigation, hero, theme color, login wording, help excerpts). Tenant-specific configuration is limited to what the research recorded.
- **Profile coverage.**
  - Captures are server HTML only. Pages built in JavaScript give no login fields or excerpts, and about 6,300 login pages show no form.
  - Vendor detection uses a fixed list of about 100 domains.
  - Some real titles are still messy captures.
  - Only Google gets a sign-in button; Apple, Facebook and Microsoft are recorded but not rendered.
- **Scoring cohorts.** Score `inferred_*` capabilities and tasks as a separate cohort from `documented_*` and `observed_public` ones.
- **Reference solvers.**
  - The engine-level solvers in `tests/solve.mjs` prove every task type except `google-login-pay`; that one needs the IdP and is proven over HTTP in `channels.test.mjs`.
  - The Infinity reference proves tasks can be solved through the public site. It does not prove a browser agent can solve them; the Puppeteer suite covers that.
- **Channels.**
  - Mock Google's in-flight sign-ins live in memory, so a restart drops them.
  - `/sms` has no separate sign-in: the episode cookie stands in for the phone.
- **State and isolation.** State is in memory, with optional JSON snapshots per episode. Untrusted agents still need hardened network isolation at the deployment level, and they must never see the admin port, `/state` or `infinity/build/private-tasks.json`.
