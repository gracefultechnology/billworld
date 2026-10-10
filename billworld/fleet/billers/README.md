# Dedicated billers (the dedicated tier)

Every Fleet biller renders from its **family template** + catalog record + captured public profile (`tier: 'family'`).
The most popular billers also get a researched, biller-specific **dossier**: `billers/<billerId>.json`. A valid dossier
makes that biller `tier: 'dedicated'`: its mock site uses the biller's own wording, navigation, sign-in rules, payment
rules, fees, plans and help, and its tasks follow what the real biller allows.

Goal: **10 popular billers per catalog category** (28 categories), each handled, tested and validated green before
moving on to the rest. `node billworld/fleet/billers/status.mjs` shows progress.

Builders write **only** dossier JSON (including the biller-specific `testExpectations` inside it). Never edit core
files or templates (`engine.mjs`, `server.mjs`, `kit.mjs`, `help.mjs`, `tasks.mjs`, `catalog.mjs`, `templates/*`,
`tests/*`). If a dossier cannot express something real, write it in `notes` and report it; do not work around it.

## Tier 1 status and the next tier

**Tier 1 (10 per category, 28 categories)** was built by one builder and one reviewer per category, then integrated:
every cross-owner request the dossier format could not express was applied once, generically, in the core or the
templates, so every dedicated biller benefits (see "Integrated requests" below). The coverage table below is the
measured state after the integration run (`tests/dedicated.mjs --dossiers all`).

<!-- coverage-table -->
Measured 2026-10-10 (integration round 2): `tests/dedicated.mjs --category <c> --concurrency 2 --tag integrate-dedicated-3-<c>`,
one category at a time, every standard and extended flow plus `dossier_contract` and `testExpectations`, desktop. 0
flows skipped, 0 browser relaunches. 283 dossiers (280 picks plus three extras: one each in medicare, property-tax and
streaming-subscriptions); `status.mjs`: 280/280 picks green, 283 green in total.

| Category | Dossiers | Green | Flows passed | Templates |
|---|---|---|---|---|
| banks | 10 | 10/10 | 330/330 | bank-billpay |
| credit-cards | 10 | 10/10 | 341/341 | card-servicer |
| credit-unions | 10 | 10/10 | 336/336 | bank-billpay |
| dental-vision-hearing | 10 | 10/10 | 357/357 | insurance |
| electric | 10 | 10/10 | 376/376 | kubra, paymentus, utility-account |
| gas | 10 | 10/10 | 373/373 | kubra, paymentus, utility-account |
| government | 10 | 10/10 | 350/350 | income-tax |
| home-services | 10 | 10/10 | 344/344 | invoice-portal, streaming |
| housing | 10 | 10/10 | 359/359 | rent-portal |
| insurance | 10 | 10/10 | 374/374 | insurance |
| internet | 10 | 10/10 | 366/366 | telecom |
| loans | 10 | 10/10 | 337/337 | loan-servicer |
| medical | 10 | 10/10 | 362/362 | mychart, patient-pay |
| medicare | 11 | 11/11 | 397/397 | health-plan |
| mortgage | 10 | 10/10 | 329/329 | loan-servicer |
| other | 10 | 10/10 | 342/342 | invoice-portal |
| pharmacy-dme | 10 | 10/10 | 321/321 | patient-pay |
| phone-landline | 10 | 10/10 | 372/372 | telecom |
| phone-wireless | 10 | 10/10 | 344/344 | telecom |
| propane-heating-oil | 10 | 10/10 | 362/362 | utility-account |
| property-tax | 11 | 11/11 | 391/391 | property-tax |
| senior-services | 10 | 10/10 | 347/347 | streaming |
| storage-funeral | 10 | 10/10 | 356/356 | invoice-portal, streaming |
| streaming-subscriptions | 11 | 11/11 | 357/357 | streaming |
| trash | 10 | 10/10 | 367/367 | invoicecloud, kubra, waste-hauler |
| tv | 10 | 10/10 | 373/373 | telecom |
| vehicle-tolls | 10 | 10/10 | 364/364 | dmv, toll-account |
| water-sewer | 10 | 10/10 | 371/371 | kubra, municipal-portal, paymentus, utility-account |
| **total** | **283** | **283/283** | **9998/9998** | |
<!-- /coverage-table -->

**Next tier (the remaining popular billers).** Same loop, one category at a time:

1. `node billworld/fleet/billers/status.mjs --category <c> --next 10 --goal 20` lists the next most popular billers
   without a dossier (`rankings/<c>.json` first, else `approx_customers`). Record the picks in `picks/<c>.json`
   with a one-line reason each.
2. Builder: research and write the dossiers (checklist below), validate, then `tests/dedicated.mjs --billers ... --tag
   build-<c>-<n>` until green. Anything the format cannot express goes in `notes` and in the builder's report as a
   cross-owner request; never work around it in templates.
3. Reviewer: re-check every claim against the cited public pages, fix the dossiers, screenshot desktop and mobile,
   re-run the category (`--category <c> --tag review-<c>-<n>`).
4. Integrator: apply the collected cross-owner requests generically (core, templates, tests), re-enable any dossier
   setting that was held back, then run `validate.mjs`, `npm run fleet:test`, `tests/sweep.mjs`,
   `tests/browser.mjs --per-template 1` and `tests/dedicated.mjs --dossiers all` until all are green, and update the
   table above. `status.mjs --goal 20` then shows the tier's progress.

Still open after tier 1 (requests that need new flows or pages rather than a rule; dossiers keep them in `notes`):
AutoPay schedules other than monthly (bi-weekly, twice a month), AutoPay enrollment by form or phone with a pending
state, due-date changes, pause/hold for subscriptions, plan downgrades that take effect next cycle (and upgrades online
while downgrades are phone-only), `pay_online` offline for an otherwise online portal, annual plan prices, a numeric-PIN
password, `controlDate`/`securityCode`/date-of-birth/Express-Pay-ID lookup and registration fields, an early-payment cap,
card-type-specific fees (credit only), a community picker for rent portals, and personas living in the biller's service
area.

### Integrated requests (tier 1)

- AutoPay label used as a noun everywhere ("Turn off <label>", "Keep <label>", headings, dashboard cards) in kubra,
  paymentus, doxo, utility-account, telecom, bank-billpay, loan-servicer; label keys are no longer used for action
  phrases (newspaper "Keep my subscription", waste-hauler "Pickup Schedule").
- Offline capabilities: forms plus their wizard chrome are removed, AutoPay enroll/turn-off forms follow `autopay` /
  `autopay_cancel`, utility-account and card-servicer/streaming pages explain instead of showing a form, telecom hides
  arrangement/paperless links and the date picker where they are not offered; notes on supported capabilities show on
  the feature page; notes scroll on phones.
- Wording a dossier could not reach: dedicated home headlines use the brand (captured hero promos skipped), sign-in
  button/heading follow `labels.signIn`, page headings use labels (telecom, loan-servicer, bank-billpay, streaming),
  hard-coded cutoffs ("5 p.m. ET", "6 p.m. ET", "3 business days", "12 months") are generic for dedicated billers,
  "or debit card" and wallet names appear only where cards/wallets are accepted, `brand.displayName` is the page name.
- Navigation: dark rails (bank-billpay, streaming) use the light dossier-nav style; a dossier nav that replaces the
  family nav keeps the sign-out link; municipal Quick pay and kubra "No account needed" only when guest pay exists.
- Engine/schema: `lateFeeMinCents`, `fullBalanceOnly`, `scheduled.maxPending`, `maxDaysAhead: 0` allows paying today,
  `fees.autopayCard*` / `fees.guest*` / `fees.notes`, `contact` and `pay_by_phone.phone` overrides, `change_plan`,
  `email_or_account`, guest lookup by `phone`, `guestLookupExact`, AutoPay day picker in utility-account.
- Round 2 (2026-10-10): `fees.cardMinCents` ("3%, minimum $1.50"), `autopay.daysAfterBill` (AutoPay drafted N days
  after the bill date, never after the due date; the family's "on each due date" wording follows it),
  `maxPaymentBalance` (payments cannot exceed the balance), `labels.accountName` (bank-billpay product name instead of
  "Consumer Loan"); full-balance-only billers no longer show "Pay another amount"; kubra AutoPay amount list and fixed
  field follow `autopay.policies`; card-servicer hides "Current Balance" AutoPay unless the dossier lists it and uses
  the AutoPay label in headings and buttons; paymentus cancel heading/button and utility-account dashboard rows use
  labels; utility-account, telecom and bank-billpay "ways to pay" text lists only supported channels; telecom hides
  AutoPay/paperless rows, sub-nav and aside links where a dossier says they are not offered, builds its home lead from
  capabilities, drops the "11:59 p.m." cutoff and the synthetic plan price for dedicated billers; waste-hauler AutoPay
  timing text; loan-servicer "Continue" on the first of two sign-in steps and no "monthly" when an AutoPay note
  exists; bank-billpay guest page drops its form when guest pay is offline; captured footers drop logo/social/"opens
  in new window" text; footer phones drop research annotations; a capability set to `unknown` with a note shows a
  neutral "contact us" page (Optimum TV, WOW!).
- Tests: solver picks the dossier's AutoPay amount; the contact-phone check uses only cleaned numbers; the AutoPay
  cancel control is found by "Cancel/Stop … pay"; captured public text is quoted at most 200 characters and never on
  a topic the dossier writes; untouched accounts grade as active service.

## Builder checklist

1. **Pick.** `node billworld/fleet/billers/status.mjs --category <category> --next 10` lists the most popular billers of
   the category without a dossier (from `billers/rankings/<category>.json`, else `approx_customers`). Take the next one
   nobody else has claimed. Find or confirm its id:
   `node -e "import('./billworld/fleet/catalog.mjs').then(m=>console.log(m.search('con edison').map(b=>[b.id,b.template,b.category])))"`
2. **Research public pages only.** Use the biller's own public site (and its official payment vendor's public pages):
   pay-your-bill, payment options, AutoPay, paperless, fees, payment plans/assistance, stop/cancel service, sign-in and
   registration pages, FAQs. **Never log in, never create an account, never submit any form on a real site** (no
   guest-pay lookups, no "check eligibility"). Note the URL, title and date of every page you use.
3. **Write the dossier** `billers/<billerId>.json` (start from `consolidated-edison-company-of-new-york-con-edis-1ac80c.json`):
   - `sources`: every page you used (`https`, the biller's own domain; add its payment vendor's domain to
     `officialDomains` only when the biller links to it as its official payment site).
   - Every claim points at a source (`capabilities.*.source`, `billing.fees.source`, `help[].source`, `auth.source`).
   - Content is **paraphrased** in your own words. Short UI labels (≤ 48 chars: "Pay Bill", "Auto Pay") may be verbatim.
   - No logos, images, colors copied from brand assets beyond a contrast-safe primary/accent hex, no URLs in help text.
   - Unknowns stay out: omit a field rather than guess. Use `evidence: "inferred"` only for reasoned guesses.
4. **Validate.** `node billworld/fleet/billers/validate.mjs <billerId>` → must print `OK`. It checks the schema, the
   catalog id, official sources, labels, nav help slugs, capability keys, predicate types, and runs every task the
   biller now has (family + dossier) through the engine: the reference solution must pass and a no-op must fail.
5. **Browser-test.** `FLEET_TIMEOUT=120000 node billworld/fleet/tests/dedicated.mjs --billers <billerId> --tag <you>-<billerId>`
   (unique `--tag`; concurrency stays ≤ 2; add `--quick` for a fast iteration, but only a full run counts as green).
   It runs every applicable standard and extended flow, `dossier_contract` and your `testExpectations`.
6. **Fix until green** — by changing the dossier only. Re-run 4 and 5. `status.mjs` shows `green` once the latest full
   run passed. Read the `warnings` (labels the family template does not show) and decide whether the label is worth it.

## Evidence rules

- Public pages only; never log in, register, start a guest payment or submit a form on a real biller site.
- Paraphrase help content; quote only short labels. Keep each help paragraph ≤ 900 characters, no URLs.
- No logos or brand imagery; `brand.primary`/`accent` must reach 4.5:1 contrast with white (validator enforces it).
- `documented_official` = stated on the biller's official pages; `observed_public` = visible in its public UI (e.g. the
  sign-in form shows an email field); `inferred` = reasoned from sources but not stated; `synthetic` = simulation choice.
- Fees, limits, plan names and prices must be the real published ones, or left out.

## Format (`billers/schema.mjs` is authoritative)

| Field | Meaning | Applied by |
|---|---|---|
| `id`*, `status`* (`"dedicated"`), `sources`* | fleet billerId; official pages `[{url,title,fetchedAt,kind}]`, kind `login\|pay\|autopay\|cancel\|help\|fees\|plans\|other` | catalog |
| `name`, `category`, `reviewedAt`, `notes`, `officialDomains` | bookkeeping | — |
| `template` | move the biller to another portal family (online templates only) | catalog |
| `brand` `{displayName, shortName, primary, accent, monogram}` | name used in pages, mail, tasks; colors (≥ 4.5:1 on white) | catalog, every page |
| `labels` | the biller's words for canonical concepts: `payBill viewBill autopay paperless history wallet cancel plan help signIn signOut register forgot guestPay dashboard statements contact profile arrangement amountDue dueDate accountNumber accountName username password home` | `kit.L()` in every template, help, tasks |
| `nav` `{public:[{label,page\|helpSlug}], account:[...]}` | ordered top-level navigation. Public pages: `home login register guest help`; account adds `dashboard bill statements pay history autopay paperless wallet cancel plan arrangement contact profile`. Pages you leave out appear under **More** so every flow stays reachable | server `withDossierNav` + template `meta.navSlots` |
| `auth.identifier` | `email \| username \| account \| phone \| email_or_username \| email_or_account`: what the engine accepts and the field label (`account` tasks get the account number from the bill notice) | engine, kit, tasks, driver |
| `auth.loginSteps` | `1` or `2` (two-step: identifier first, then password) | server (per-biller flow), kit |
| `auth.mfa` | `none \| email \| sms \| email_or_sms`: which MFA tasks exist; scenario `mfa:"default"` uses it | engine, tasks |
| `auth.passwordRule` `{pattern,message}` | registration/reset rule (must accept the fleet test passwords) | engine |
| `auth.lockoutAttempts` | failed sign-ins before a 15-minute lock (3-10, default 5) | engine, driver |
| `auth.registrationFields`, `auth.guestLookupFields` | required fields (missing ones are added to the family form); guest lookups may use `phone` as the identifier | engine, server |
| `auth.guestLookupExact` | `true`: the guest form asks for exactly `guestLookupFields` (the family's other lookup fields are removed and one identifier is enough, e.g. account number alone) | engine, server, kubra home text |
| `auth.socialProviders` | `["google"]` shows Sign in with Google; `[]` hides it | google.mjs |
| `capabilities.<key>` `{support, evidence, source, note, channel, phone}` | override any capability (`online_account registration password_reset view_bill statements pay_online guest_pay autopay autopay_cancel scheduled_payment paperless cancel_service payment_assistance payment_arrangement pay_by_phone pay_by_mail google_login change_plan`). `unsupported` + `note` (required) → the note shows on home, dashboard, help and the feature's page; the engine refuses it; a `*-limitation` task asks the agent to report the offline route (phone from `phone`, else the catalog phones) | catalog, engine, server, help, tasks |
| `billing.fees` `{bankCents, cardCents, cardPercent, cardMinCents, autopayCardCents, autopayCardPercent, guestBankCents, guestCardCents, notes, evidence, source}` | convenience fees charged by the engine (AutoPay card charges and pay-without-signing-in charges can differ; `cardMinCents` is the floor of a percentage fee); `notes` lists fees that exist but whose amount is not published (help only) | engine, help |
| `contact` `{phone, payPhone, source}` | customer-service / pay-by-phone numbers that replace the catalog's (footer, contact article, phone tasks). `capabilities.pay_by_phone.phone` also sets the pay-by-phone number | catalog, every page, tasks |
| `billing.methods`, `billing.guestMethods` | `["bank","card"]` subsets accepted online. Card-only billers (`["card"]`) get no saved checking account; generated tasks and reference solutions use the saved Visa, and `declined-retry` / `register-and-pay` (which need a bank account) are dropped | engine, kit, tasks, driver |
| `billing.autopay` `{policies, days, leadDays, daysAfterBill, methodTypes}` | AutoPay amount options, `"due_date"` or allowed days, draft days before due date or days after the bill date (0-28, capped at the due date), method types | engine, server, kit |
| `billing.scheduled` `{maxDaysAhead, maxPending}` | how far ahead payments may be dated (0 = today only; the date picker is hidden where the template supports it) and how many scheduled payments may be pending at once | engine, telecom |
| `billing.fullBalanceOnly` | online payments must equal the full balance; payment plans are refused; `pay-minimum`, `pay-partial-card` and `setup-payment-plan` tasks are dropped | engine, tasks, driver, help |
| `billing.minPaymentCents`, `maxPaymentCents`, `maxPaymentBalance` | single-payment limits (min ≤ $25, max ≥ $5,000); `maxPaymentBalance: true` refuses payments above the current balance | engine |
| `billing.plans` `[{id,name,cents,current}]` | real plan names/prices; the current plan must not be the cheapest | engine, tasks (`downgrade-plan`) |
| `billing.cardMinimum` `{percent, floorCents, plusInterest}` | card minimum-payment model | engine |
| `billing.lateFeeCents` / `lateFeePercent` (+ `lateFeeMinCents`) | late payment charge on past-due balances; with `lateFeeMinCents` the charge is the greater of the percentage or that amount | engine, help |
| `help[]` `{slug,title,paragraphs,steps,source,mode,topic}` | replaces the generated article with that slug (`mode:"append"` adds to it) or adds a new one; captured public text is never merged into a slug the dossier writes | help |
| `tasks.extra[]` `{slug,intent,scenario,predicates,answer,tags,evidence, solver\|solution}` | extra tasks; predicates from the engine's types; `solution` steps: `login pay autopay cancelAutopay paperless cancelService changePlan arrangement contact removeMethod reset answer` (`answer.text` may use `{{balance}} {{dueDate}} {{phone}} {{payPhone}} {{confirmation}}`); answer kinds `amount_due confirmation phone contact contains abstain` | tasks, tests/solve.mjs |
| `tasks.suppress[]` | built-in task slugs that do not apply to this biller | tasks |
| `testExpectations[]` `{page, slug?, signedIn?, contains?, notContains?, label?}` | biller-specific checks run by `tests/dedicated.mjs` | dedicated.mjs |

**Capability notes are customer-facing**: they appear on the live site as if the biller wrote them. Record research
remarks and inferences in `notes`, never in a capability note.

A capability `note` on a **supported** capability (a rule such as "no AutoPay while past due") shows on that feature's own page only. When a capability is unsupported online, the server removes that page's forms together with their wizard chrome (progress steppers, emptied boxes), the AutoPay enroll form when `autopay` is offline and the turn-off form and link when `autopay_cancel` is offline. `change_plan` unsupported gives a `plan-change-limitation` task instead of `downgrade-plan`.

Without a dossier nothing changes: `vm.labels` is empty, `vm.nav`/`vm.auth` are null and every default is the family's.
Dedicated tasks carry `tier: "dedicated"`; tasks the Infinity export cannot drive yet (dossier-only slugs,
limitation tasks, non-email sign-in) carry `exportable: false`.

## Commands

```bash
node billworld/fleet/billers/validate.mjs [id ...]                       # all dossiers, or the ids given
FLEET_TIMEOUT=120000 node billworld/fleet/tests/dedicated.mjs --billers id1,id2 --tag me-x   # or --category electric | --dossiers all
node billworld/fleet/billers/status.mjs [--category electric] [--next 10] [--json]
```

For many billers prefer one run per category (`--category <c>`) over `--dossiers all`, so a problem costs one chunk. If
the shared Chrome dies mid-run, a flow that failed because the browser went away (or was relaunched by the other worker
while it ran) is retried once on a relaunched browser before it counts; `browserRelaunches` and `retriedFlows` in
`results.json` report it, and each retried flow is marked `retried: true`.

Results: `fleet/.artifacts/<tag>/results.json` (run) and `fleet/.artifacts/dedicated/<billerId>.json` (latest full run per
biller, read by `status.mjs`). Set `FLEET_DOSSIERS=0` to run the whole fleet without dossiers.
