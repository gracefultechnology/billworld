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

## Dedicated tier (researched per-biller dossiers)

The most popular billers get a researched dossier, `billers/<billerId>.json`, which makes that biller `tier: 'dedicated'` (every other biller is `tier: 'family'`). The goal is 10 popular billers per catalog category, each validated and browser-tested green before the rest. A dossier can set the biller's own wording (`labels`, used through `kit.L()` in every template), ordered navigation (`nav`, placed in each template's `meta.navSlots`), sign-in rules (identifier, one- or two-step, MFA, password rule, lockout, required registration and guest-lookup fields), capability overrides with notes for things not available online (shown on the site and in help; the engine refuses them; `*-limitation` tasks expect the offline route), payment methods, AutoPay options, scheduling and amount limits, fees, real plans, card minimums, late fees, help articles, extra tasks with reference solutions, task suppressions and biller-specific browser expectations. It can also state rules the engine enforces: "greater of N% or $X" late charges, full-balance-only payments, a cap on pending scheduled payments, phone-number or exact-field guest lookups, separate card-AutoPay and pay-without-signing-in fees, a minimum on percentage card fees (`cardMinCents`), AutoPay drafted N days after the bill date (`daysAfterBill`), payments capped at the balance (`maxPaymentBalance`), plan changes that are offline only (`change_plan`), and customer-service or pay-by-phone numbers that replace the catalog's. Without a dossier, `vm.labels` is empty and every template renders its family wording; the generic fixes made while integrating the tier (for example the AutoPay label used as a noun in "Turn off …", forms hidden where a capability is offline, the energy-usage panel only on metered bills, captured public text quoted at most 200 characters) apply to every biller.

- Format, builder checklist and evidence rules: [`billers/README.md`](billers/README.md) (schema: `billers/schema.mjs`).
- `node billworld/fleet/billers/validate.mjs [id ...]` validates dossiers and proves every task of each biller.
- `FLEET_TIMEOUT=120000 node billworld/fleet/tests/dedicated.mjs --billers <id,...> --tag <unique>` (or `--category <c>`, `--dossiers all`) runs every standard and extended flow plus `dossier_contract` and `testExpectations`.
- `node billworld/fleet/billers/status.mjs [--next 10]` shows progress per category.
- Pilot: Consolidated Edison (`consolidated-edison-company-of-new-york-con-edis-1ac80c`). `FLEET_DOSSIERS=0` disables the tier.
- **Tier 2 is complete:** 568 dossiers, 28/28 categories at 20 green (`status.mjs --goal 20`), 20,024/20,024 browser
  flows. Agent solvability is measured in [Agent solvability](#agent-solvability-2026-10-10-measured-with-agentlab).
- **Tier 1 is complete:** 283 dossiers (10 per category in all 28 categories, plus 3 extras), every one valid and green:
  9,998/9,998 browser flows on 2026-10-10, run one category at a time. Per-category table, integrated requests and the
  open list: [`billers/README.md`](billers/README.md#tier-1-status-and-the-next-tier).
- **Next tier (remaining popular billers):** `status.mjs --category <c> --next 10 --goal 20` lists the next picks; the
  same build, review, integrate loop follows, one category at a time (`billers/README.md`). `dedicated.mjs` relaunches a
  crashed Chrome and retries the affected flow once, so a crash costs one flow, not the rest of the run.

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

## Agent solvability (2026-10-11, fresh blind audit)

A fresh blind audit attempted a new rotation of tasks in every category through `agentlab/act.mjs` (see
[agentlab/README.md](agentlab/README.md#measured-results-2026-10-11-fresh-blind-audit-of-every-hand-built-site-and-every-fleet-category)).
Auditors reported every environment defect they hit, even on passing tasks; each was fixed at the root and the affected
tasks were re-attempted blind.

| Measure | Fleet | With the hand-built sites |
|---|---:|---:|
| Fresh blind first pass (14 units, 28 categories) | **595 / 595** | 733 / 733 |
| Blind re-attempts after the defect fixes | **110 / 110** | 125 / 125 |
| Final, latest result per task | **595 / 595** | 733 / 733 (none still failing) |

Defects fixed from this audit (generic fixes, applied to every biller that shares the template or field):
- **Dates and notice rules.** Utility stop dates default to, and cannot be earlier than, 3 business days ahead; the stop
  page no longer promises a forwarding-address step (the final bill goes to the profile's mailing address).
  Property-tax installments follow per-county calendars (`billing.taxSchedule`).
- **Wording and labels.** Help text drops catalog research shorthand (`RESEARCH_PROCESS` filter in `help.mjs`, enforced
  by `validate.mjs`); labeled phone lists show customer service first; guest-pay notes never ask for SSN/ITIN; the bill
  email names the identifiers the guest form asks for (statement number, phone number, access code); the password
  label follows the site ("Account PIN"); the password hint appears once.
- **Policy-driven links.** Sign-up, payment-plan, e-statement, retention-offer and equipment-return links/steps follow the
  dossier (`registration`, `paymentPlan`, `billing.retentionOffer`, `billing.equipmentReturn`, `billing.cancelAt`);
  links that belong to a parent website are shown as plain text instead of mapped to portal pages.
- **New dossier fields:** `billing.retentionOffer`, `billing.equipmentReturn`, `billing.cancelAt`, `billing.taxSchedule`,
  `contact.locality` (city, state, ZIPs), and a registration access code (Texas Disposal Systems). All are in `billers/schema.mjs` and
  [`billers/README.md`](billers/README.md).
- **Harness.** `act.mjs new <label>` issues an owned run (key + wrapper) so two auditors can no longer share a runId.

## Agent solvability (2026-10-10, measured with `agentlab/`)

Every popular-biller category was attempted by blind agents through `agentlab/act.mjs` (instruction, credentials and
rendered pages only; grading revealed after the final answer). `report.mjs` counts the first finished attempt per task
and run.

| Measure | Result |
|---|---|
| First pass, 31 auditor runs (`aud-*`, 28 categories) | **1,191 / 1,205 tasks (98.8%)** |
| Re-attempts after the integration fixes (`agentfix-reatt`: every task that ever failed outside the proof runs, plus the restored date-of-birth and phone lookups) | **18 / 18** |
| Fresh sample after the fixes (`agentfix-fresh`: 20 never-attempted tasks, 20 categories, 13 task types) | **20 / 20** |
| Latest result per distinct task, all non-proof runs | **1,228 / 1,228** (none still failing) |

First pass by category (tasks passed / attempted): banks 40/40, credit-cards 43/43, credit-unions 43/43,
dental-vision-hearing 41/43, electric 43/43, gas 40/40, government 42/43, home-services 38/40, housing 43/43,
insurance 38/40, internet 43/43, loans 41/41, medical 44/46, medicare 41/43, mortgage 43/43, other 43/44,
pharmacy-dme 41/42, phone-landline 43/43, phone-wireless 40/40, propane-heating-oil 43/43, property-tax 42/43,
senior-services 41/41, storage-funeral 40/40, streaming-subscriptions 48/48, trash 44/44, tv 41/41, vehicle-tolls 46/46,
water-sewer 56/56. Latest per template: every template is 100% (telecom 168, streaming 157, utility-account 96,
loan-servicer 86, bank-billpay 84, insurance 77, patient-pay 74, … tasks). Latest per task type: all 19 types at 100%,
including guest-pay 61/61, register-and-pay 72/72, reset-then-pay 77/77, mfa-sms 69/69 and limitation 61/61.

**What the 14 first-pass failures were, and the generic fix for each:**
- **Guest lookups that asked for something the agent was never told** (7: Quest, Labcorp, Western Dental, Liberty
  Mutual, The General, Florida Blue ×2). Instructions now state the persona's date of birth and phone number whenever a
  dossier's guest-lookup or registration form asks for them (`tasks.mjs` `personaFacts`, printed by
  `infinity/export.mjs instructionFor`), and `tests/solve.mjs taskShapeErrors` fails any guest-pay / register-and-pay
  task whose required field is not on the bill notice, in the persona name or in `personaFacts`. Date of birth is back
  in the researched lookups of Quest, Labcorp, Banner, Liberty Mutual, The General, Progressive and State Farm
  (phone + date of birth).
- **Account-number sign-in without the account number** (Midland cancel-scheduled, failed twice): the sign-in hint and
  bill notice now cover every signed-in predicate (`scheduled_cancelled`, `registered`), and the instruction no longer
  claims "your username is your email address" for billers that sign in by account or phone number.
- **Abstention graded too strictly** (4: BENEFEDS, Michigan Treasury, Albertsons, LA County): a limitation answer that
  correctly says "not possible online" may also name the biller's own published customer-service line
  (`expected.okPhones`); an unknown number still fails. Every 10-digit number a capability note names is an accepted
  route.
- **Exact-substring answer grading** (Mutual of Omaha "three (3) business days"): `contains` ignores parenthesised
  digits, apostrophes, trailing punctuation and a.m./p.m. spelling.
- **Agent slips** (HomeServe: a wrapper pointed at another run; Oncourse: misread confirmation; CR&R: unticked
  confirmation checkbox). The harness now prints the run id on `start` and `answer`, notes an abandoned attempt, waits
  for POST→redirect pages before reporting messages, and reports browser-blocked submits with the field's element number.

**Other generic changes integrated from the auditors' cross-owner requests:** new online registrations start with an
empty wallet; the bill notice names the account number with the biller's own label ("Bill number (account number)")
and mentions paying without signing in only when guest pay exists; card `maxPaymentBalance` caps at the current
balance (restored for Merrick Bank and Credit One); schedule-payment tasks set the due date after the requested date;
loan payment intents ask for "the current amount due"; send-message asks for payment history when a biller mails no
paper; registration forms drop family identity fields the dossier does not list; guest-lookup copy names the fields the
form asks for; AutoPay wording follows `leadDays`; review steps warn when a scheduled date is after the due date;
scheduled dates show as "Oct 15, 2026"; annual plans (`billing.plans[].interval: 'year'`) show "/year"; a home-page
sign-in widget that posts the password signs in directly on two-step templates; "Save this method" is hidden for
guests; the bank field reads "Bank account number"; dedicated sign-in pages no longer use captured error-page titles;
service addresses follow single-city service areas and US territories.

Caveat on the post-fix runs: the re-attempts and fresh sample were driven through `act.mjs` only, but by the integrator,
who had read the Fleet source while fixing it (not the 20 fresh dossiers). Treat them as strong verification rather than
an independent blind score; the 98.8% first pass is the blind number.

**Gap closures (2026-10-11).**
- Answer kind `pattern` for dossier answer tasks (regular expressions, default case-insensitive, validated to compile
  and to reject an empty answer), next to `contains`.
- `billing.cardBrands`: accepted card networks are honored by the engine (`card_brand_not_accepted` names the accepted
  list), stated on every card-number field ("We accept Mastercard and Discover.") and in the Ways to pay article; the
  seeded saved/expired cards and the task wording follow the first accepted brand; browser drivers, solvers and the
  Infinity reference type a test card of an accepted brand (`testCardFor`).
- Capability notes on home and the account overview render as one compact "Ways to manage your account" notice with a
  "Learn more" link to the help article carrying each note, identical on every template; research-style notes are not
  rendered.
- Long flows: the MFA page names the masked inbox or phone the code went to on every template; resend, registration
  ("We sent a verification link to j•••@…") and reset ("We sent a verification code and a reset link to j•••@…")
  messages name the destination; reset finds the account by any identifier the biller signs in with (phone sign-ins
  could not reset before); register and reset pages state the password rule next to the field unless the page already
  does; a registration missing a dossier field names it; a guest lookup missing a required field names it, and a
  mismatch says to enter each detail exactly as printed on the bill.
- Cosmetic: the withdrawn-cancellation page says "cancellation request" and names the membership, lease, policy or
  account (not "stop-service request" for non-service kinds); AutoPay flashes use the biller's AutoPay label.

**Remaining known agent-hard spots** (all solvable today; worth watching in larger samples):
- Long multi-page flows: register-and-pay (≈35–47 steps), reset-then-pay (≈30), mfa/sms-pay (≈20–25) still dominate
  step counts; element numbers expire after every navigation, so agents must re-observe.
- Two-step sign-ins and MFA still need a trip to `/mail` or `/sms` and back to the verify page (the page now says
  which inbox or phone to check).
- Guest forms keep the family's extra lookup fields alongside the dossier's fields unless the dossier sets
  `guestLookupExact` (what is required is unchanged; errors now name missing fields).
- Limitation tasks whose notes appear on home, dashboard and help stay easy by design; tasks where the note names
  several numbers grade by "first or at most two numbers".

## Verification (2026-10-11, final integration)

Run after every repair from the fresh blind audit landed (scratch logs in the session's `scratchpad/final/`).

| Check | Result |
|---|---|
| `node billworld/fleet/billers/validate.mjs` | 568/568 dossiers valid |
| `npm run fleet:test` | 234/234 pass |
| `tests/sweep.mjs --shards 4 --out …/final/sweep.json` (all 59,477 billers) | 0 failures: http 752,022; authed 42,641; engine 59,477; tasks 820,958; links 881,636 |
| `browser.mjs --per-template 1 --concurrency 1` | 437/437 flows passed (27 billers: the 26 templates plus `generic`) |
| `tests/dedicated.mjs --category <c> --tag final-<c>` for all 28 categories, one at a time (concurrency 2) | 20,020/20,020 flows, 28/28 categories all green, 0 browser relaunches, 0 retries |
| `billers/status.mjs --goal 20` | 28/28 categories at 20 green; 560/560 picks, 568 green in total |
| Blind agents (`agentlab/`) | fresh first pass 595/595 (733/733 with the hand-built sites); re-attempts 110/110 (125/125); none still failing |

## Verification (2026-10-11, gap closures)

| Check | Result |
|---|---|
| `node billworld/fleet/billers/validate.mjs` | 568/568 dossiers valid |
| `npm run fleet:test` | 143/143 pass (new `tests/gaps.test.mjs`: pattern answers, card networks, compact notices, reset/MFA/register/guest messages, withdrawn wording) |
| `tests/sweep.mjs --shards 4` (all 59,477 billers) | 0 failures: http 751,720; authed 42,641; engine 59,477; tasks 820,960; links 880,655 |
| `browser.mjs --per-template 1 --concurrency 2` | 437/437 flows passed |
| `tests/dedicated.mjs --category <c>` for pharmacy-dme, streaming-subscriptions, electric (tags `fleetgaps-<c>`) | 640/640, 677/677, 751/751 flows passed; 0 relaunches, 0 retries |

## Verification (2026-10-10, tier 2 and agent-solvability integration)

| Check | Result |
|---|---|
| `node billworld/fleet/billers/validate.mjs` | 568/568 dossiers valid |
| `billers/status.mjs --goal 20` | 28/28 categories at 20 green; 560/560 picks, 568 green in total |
| `tests/dedicated.mjs --category <c>` for all 28 categories (tags `agentfix-<c>`, concurrency 2) | 20,024/20,024 flows, 568 billers, 0 browser relaunches, 0 retries |
| `npm run fleet:test` | 136/136 pass |
| `tests/sweep.mjs --shards 4` (all 59,477 billers) | 0 failures: http 751,720; authed 42,641; engine 59,477; tasks 820,960; links 880,655 (203 s) |
| `browser.mjs --per-template 1 --concurrency 2` | 437/437 flows passed |

## Verification (2026-10-10, dedicated tier integrated)

| Check | Result |
|---|---|
| `node billworld/fleet/billers/validate.mjs` | 283/283 dossiers valid (every task proven by the reference solver, no-op fails) |
| `tests/dedicated.mjs --category <c>` for all 28 categories (concurrency 2) | 9,998/9,998 flows, 283/283 billers green, 0 skipped, 0 browser relaunches; `status.mjs`: 280/280 picks green |
| `npm run fleet:test` | 135/135 pass |
| `node billworld/fleet/tests/sweep.mjs` (all 59,477 billers) | 0 failures: http 751,310; authed 42,641; engine 59,477; tasks 821,024; links 881,037 (111 s) |
| `browser.mjs --per-template 1 --concurrency 2` (27 templates, desktop, standard flows) | 437/437 flows passed (27 billers) |

## Verification (2026-10-05, family tier)

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
