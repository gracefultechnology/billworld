# WVU Medicine / MyWVUChart construction input

The catalog record is `biller_e8f5dad7794eeb4e8b7f`. Version 0.11.0 registers a first slice in the existing Infinity extension; historical construction checkpoints below describe the earlier stages. Preserve the original catalog record.

The official [payment guide](https://wvumedicine.org/billing-and-insurance/pay-a-bill/) links signed-in Billing → Account Summary and guest payment. It also offers zero-interest plans and financial assistance and links a separate Home Medical Equipment payment service. Those are documented capabilities; their private continuation is unobserved. The catalog's autopay URLs lead to guest payment and cannot prove recurring support.

Public screenshots establish a username-or-Epic-ID first login screen with Continue. The password field in downloaded HTML is initially hidden. Activation has a two-part code and alternatives for Epic ID or signup with information. Epic ID needs its own identity model if implemented; a mock Google button would invent a provider. Public guest lookup visibly requires Account #, Guarantor last name and CAPTCHA. Its instructions allow a guarantor or visit account number and say to drop the alpha character. Hidden SSN, date-of-birth and Hospital/Physician fields in the guest HTML do not establish visible requirements.

Reuse the existing ledger, quote/commit/idempotency, episode isolation, mailbox/MCP service, Infinity lifecycle, verifiers and report pipeline. Add a MyChart frontend and explicit tenant policy; keep all captured scripts reference-only. The homepage, payment guide, FAQ, understanding-billing and financial-assistance pages should be reconstructed with local captured assets and supported navigation. Preserve source styles and layout rather than substituting the utility portal.

The [portal FAQ](https://mywvuchart.com/MyChart/Authentication/Login/StandardFile?option=Faq) documents optional email/text verification, two-step recovery, single-use activation codes and ten-minute idle logout. The rendered challenge sequence and code lifetimes remain unobserved. Reuse the mock mailbox for email delivery; text verification needs its own supported channel.

## Medical billing model required before tasks

Separate the guarantor (responsible payer) from patient identity and visit accounts. A guarantor may owe several visit balances; facility and professional charges may appear together on the consolidated statement. The first task should identify a specific synthetic visit account and its balance. Guest lookup by that visit number must authorize only the intended obligation. Guarantor lookup can expose permitted visit balances, but paying one must not silently settle all of them. No real patient records or diagnoses are needed.

Use at least two unpaid visits for the primary guarantor, a historical paid visit and an unrelated guarantor. Bind lookup grants, quotes and commits to the resolved guarantor/visit scope. Any aggregate payment needs explicit allocation with cents that sum exactly to the payment; do not treat an arbitrary selected invoice as the whole guarantor balance. Keep medical-equipment billing outside the main portal until its separate flow is researched.

The initial payment continuation, local CAPTCHA, fees, posting, error wording and authenticated screen layout will be synthetic unless supported by additional evidence. Label them before adding a task. Do not infer password recovery from the shared utility email-reset implementation or infer a payment-plan policy from “zero-interest” alone.

## Proposed acceptance checks

- Homepage → payment guide → guest portal uses local links and assets, with no production requests.
- A visit-number lookup authorizes only that visit; guarantor lookup and last-name matching use explicit local rules.
- The selected visit is paid once with the requested amount, funding source and fee; other visits, other guarantors, saved methods and recurring settings remain unchanged.
- Wrong last name, unknown account, expired lookup/review, cross-episode grants, double submit and retry after commit cannot cause an incorrect or duplicate payment.
- Login begins on the observed username-first screen; any password or Epic-ID continuation has a recorded evidence label.
- Public registration, recovery and portal help are reviewed before deciding their local workflows. Loading-only pages must never be treated as usable screen references.
- Puppeteer reference journeys navigate visible controls, then private state assertions and the existing Infinity grader verify the resulting obligation and prohibited side effects.
- Add tasks to the existing Infinity adapter only after reference/domain checks pass. Publish no autonomous success rate from reference scripts.

Capture field metadata version 2 records visibility, disabled/required state, IDs and button text. Older capture metadata lacks these flags; use screenshots and visible text rather than assuming every DOM field was visible. A browser fixture verifies that hidden, transparent, ancestor-hidden and deferred password inputs are distinguished from observed controls.

## Reviewed capture checkpoint

Eleven requested pages returned HTTP 200. Nine are candidate public UI/help references with verified HTML and asset hashes; recovery is an empty shell and signup has visually hidden controls. Both are excluded from construction references. The signup route redirected to `/MyChart/app/signup`; contact-entry markup alone is insufficient to establish a rendered or working registration flow. The portal FAQ screenshot and text are usable.

The capture set contains 255 unique assets, including 134 scripts across usable and unusable pages. Original scripts remain reference-only. The versioned construction packet copies nine candidate pages and records both exclusions. See [capture validation](wvu-validation.json). Twenty-seven research tests and the field-visibility/readiness browser checks pass; runtime coverage remains seven prototypes and twenty-one tasks.

## Domain and page construction checkpoint

The draft domain now seeds two unpaid primary-guarantor visit accounts, a historical paid visit and another guarantor. Lookup grants explicitly carry visit IDs; quote validation prevents access to another visit, and the grader checks unchanged other balances. Medical clock advancement expires grants without generating utility invoices. Scheduling and AutoPay remain unavailable. These functions are exercised through a test-only registry fixture; WVU still registers no production runtime or task.

Seven medical cases and all 110 domain tests pass. The research suite now has 29 passing tests, including rejection of unusable captures and prevention of accidental municipal script reuse. Six public page reconstructions are staged with checked file hashes and no original scripts/frames. Missing assets and unsupported destinations are recorded; visual/browser review and local interaction controls are pending. See [construction validation](wvu-construction-validation.json). The next work is the source-matched MyChart frontend, public-page navigation, Puppeteer journeys and Infinity tasks.


## 0.11.0 runtime checkpoint

Eight captured pages are served locally. MyChart guest lookup distinguishes guarantor from patient and restricts a visit-number grant to that obligation. Username-first login, password and optional email MFA reach a synthetic account summary; the mock Gmail UI delivers the code. Review and receipt survive reload. Lookup grants, review capabilities, sessions and receipts are episode-bound, and the private grader requires the selected visit to be paid once while the other visit balances and recurring settings stay unchanged.

All 113 domain checks (ten medical), thirty research checks, six MyChart browser scenarios and three scoped Infinity reference tasks pass. Five municipal browser scenarios also pass after the shared snapshot-serving change. See [construction validation](wvu-construction-validation.json). The registry now contains eight first slices and twenty-four tasks; the earlier twenty-one Infinity tasks retain their prior revision evidence.

Original JavaScript remains reference-only. Local captured CSS imports are retained, unavailable imports are removed, and captured image URL encoding is preserved. The initial guest/login branding and marketing colors were visually checked. Missing resources, unsupported links and the homepage header layout still need fidelity review. Private password/payment/MFA screens, amounts, matching, CAPTCHA, zero fee and immediate posting are synthetic. Epic ID, activation, signup/recovery, text verification, payment-plan enrollment, assistance application and separate HME payment remain unfinished. No autonomous score or independent fidelity certification is claimed.


## 0.12.0 public-page fidelity and interactions

The reconstruction builder now emits sanitized inline stylesheets at their original positions rather than appending them after external styles. This restored the captured homepage header, background colors and button styling. Captured images load eagerly for local full-page views; uncaptured images remain transparent placeholders with their missing URLs recorded. The homepage was manually compared with its full-page source screenshot at 1365px. This is limited visual review, not independent certification.

Local public code now implements the source-markup FAQ single-answer accordion and mobile menu/submenu state. Five browser scenarios verify desktop header ordering and the captured Peak Health image, desktop billing dropdown, mouse/keyboard FAQ open/close, understanding/assistance navigation, and mobile homepage → billing guide → guest lookup. All 24 declared Infinity reference tasks were rerun and passed on 0.12.0, alongside 113 domain tests, 31 research tests, six medical browser scenarios and five municipal regression scenarios. Original production scripts still never execute. Recovery, registration, activation and private flows retain the earlier evidence limits.


## 0.13.0 activation journey

The observed two-part activation form is now bound to the local service. The portal FAQ documents code delivery by email, expiry and single use. A synthetic fixture sends the code through the existing mock Gmail/connector service. Verification consumes it and issues an episode-scoped, HttpOnly setup grant; setup creates credentials without logging in automatically. The user then follows the existing username-first login and pays the specified visit. Generic registration cannot bypass the activation grant. Unobserved account setup, username/password rules, 24-hour code expiry, ten-minute setup expiry and five-failure limit remain explicitly synthetic.

Five new domain cases cover single use, episode separation, expiry, persisted failed attempts, forbidden bypass, username collisions, correction and the registration/login/payment grading sequence. Four browser scenarios cover the complete Gmail journey, reviewable setup reload, incorrect-code correction, missing setup access, Cancel, identity collision and reused-code rejection. All 118 domain checks, 32 research checks, 15 WVU browser scenarios and 25 Infinity references pass on 0.13.0. The full Infinity summary/report now lives in a separate directory so scoped validation cannot overwrite it.

Activation was recaptured read-only after fixing the collector to retain SVG sprites reported by Chrome as `other`. All 11 HTML captures and their assets were hash checked: 256 unique assets, including 134 reference-only scripts. A sprite URL matching the captured fragment used to drop that fragment; local reconstruction now retains it, and a browser rendering assertion verifies the globe glyph. The preceding capture is backed up. Signup without a code, recovery, Epic ID, SMS, payment plans and private assistance/HME flows remain unfinished. See the current construction validation for exact scope.


## 0.14.0 official billing documents

The payment and understanding-billing guides now link to local, unmodified official PDFs: financial-assistance policy, billing/collections policy and sample-statement guide. The document manifest records source URLs, download dates, bytes and SHA-256 hashes. All 17 source pages were rendered for inspection; the first page of each document was visually inspected. This preserves reference documents and does not simulate qualification, collections or private assistance submissions. PDF filenames are not treated as publication/revision dates.

The server verifies each document hash before serving it. The source reconstruction maps the original links to the local PDF endpoints. Puppeteer follows all three visible links, checks HTTP status and MIME type, and reads their browser-fetched bytes against the source hashes. Chromium's internal PDF-viewer resources are recorded separately from external network requests. Six public-page scenarios pass, including the existing desktop, accordion and mobile payment navigation. The source construction packet also includes the original PDF bytes.

A diagnostic navigation from the original login page produced a visible account-recovery choice screen that distinguishes MyWVUChart from Epic ID. No identity was entered or reset requested. This screen alone does not establish recovery continuation; the runtime recovery capability remains unfinished. Asset-body collection has a bounded wait so an unavailable production resource cannot indefinitely prevent saving capture metadata.


## 0.15.0 email recovery

Read-only navigation through login → local/Epic-ID choice → MyWVUChart recovery established the next public form: email address or phone number previously used for two-step verification, then Send code. No contact or code request was submitted to production. The original direct-route empty shell remains excluded; choice and contact entries are now usable references. Thirteen requested captures contain eleven candidate references, plus the three unmodified policy/statement PDFs.

The local email flow sends a code through mock Gmail, verifies it into a single-use HttpOnly reset grant, displays the recovered username and accepts a matching new password. Reset invalidates existing sessions; it does not automatically sign in. The agent subsequently uses the observed username-first login. Unknown/unenrolled contacts receive a neutral challenge with no mail or account disclosure. Generic utility reset links are unavailable for medical accounts. Post-code UI, contact enrollment, code/grant lifetimes and attempt limits are synthetic. SMS and Epic ID recovery remain unavailable.

Four domain scenarios cover proof, single use, forbidden bypass, neutral responses, enrolled contacts, persisted lockout, expiry, episode separation, resend replacement, validation, session invalidation and private grading. Four Puppeteer scenarios cover the actual Gmail journey, reloadable stages, incorrect code/password correction, neutral unknown-contact behavior, start-over, SMS rejection and Cancel. All 122 domain checks, 33 research checks, 20 WVU browser scenarios and 26 Infinity references pass on 0.15.0. These are reference/simulator checks, not autonomous-agent scores or independent fidelity certification.

Visual comparison found a stylesheet bundle absent from the capture despite its observed HTTP 200 response. A public GET retrieved the exact bundle; the supplemental manifest records URL/hash/bytes and the three affected captures. Its local reuse restores the source two-column recovery layout, with a browser geometry assertion and an empty-contact disabled Send code button. Capture now retries unavailable public stylesheet bodies without cookies/form data and records asset errors. CSSOM preservation also supports future insertRule styles; these three pages contained no inline CSSOM styles. Original production scripts remain reference-only.

The offline catalog refresh now extracts route candidates from 29,415 hash-checked HTML bodies for 19,258 biller records, totaling 599,571 candidate associations. These links still require tenant/ownership/content validation; they do not establish implemented or certified coverage.
