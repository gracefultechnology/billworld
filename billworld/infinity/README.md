# Billworld extension for WebArena Infinity

The extension reuses the pinned Infinity evaluator and reports. Read [the review](REVIEW.md) for the reuse decisions, code findings and remaining work. Provenance is recorded in `upstream.json`; the upstream MIT notice is retained in `UPSTREAM_LICENSE`.

## Install

From the research repository root:

```bash
npm ci
python3 billworld/infinity/bootstrap.py
cd .upstream/webarena-infinity
uv sync --frozen
uv run python -m playwright install chromium
```

Infinity requires Python 3.12+ and uv for its full dependency environment. Install Chromium system dependencies only where required by the host OS. Bootstrap adds an app and a small optional lifecycle patch in an ignored checkout; it does not modify the original research catalog. Re-running bootstrap is supported. `--checkout /absolute/path` can target an existing dedicated checkout at exactly the pinned revision.

## Run an agent with the existing runner

From the upstream checkout, with the selected provider's API key configured:

```bash
BILLWORLD_RUN_KIND=agent BILLWORLD_AGENT_LABEL=my-agent-v1 BILLWORLD_MODEL_ID=resolved-model-id \
uv run python evaluation/run_eval_parallel.py \
  --web-app apps/billworld --model gpt --workers 1 --repetitions 1 --max-steps 50
```

The `gpt` choice uses the upstream model configuration; select/configure the intended model before publishing results. No provider/model run has been validated in this review. Reserve ports before launching: upstream server startup terminates existing listeners on its chosen ports. Use the local worker mode; the private adapter does not yet support remote hosts.

Workers run the existing Node billing service with independent SQLite databases, private grading ports and separate mock Google origins. Thirty-one released upstream-format tasks are generated from the current billing task manifests. Portal and mailbox sessions begin logged out. Fresh browsers and new episodes isolate each task. The public startup state route returns readiness only.

Runner descriptors under `billworld/data/infinity-*.json` contain private tokens. An evaluated agent must not receive access to this directory, the app source, graders or control ports. This local prototype is not a process/filesystem sandbox for an untrusted code agent.

## Validate the adapter without a model

With `requests` installed in the active Python environment:

```bash
python billworld/infinity/smoke.py
```

Or, from the upstream checkout after `uv sync`:

```bash
uv run python ../../billworld/infinity/smoke.py --checkout .
```

This executes the upstream `run_task` lifecycle using a scripted Puppeteer reference. It checks the selected UI journeys (thirty-one released tasks are wired), no-action rejection, agent/setup errors, timeout, cancellation, deadline rejection, repetition lineage, owned-worker crash recovery and rejection of public control/state mutation. Use `--lifecycle-only` for the failure/recovery suite without browser reference journeys. It writes screenshots, results and Infinity's HTML report under `billworld/artifacts/infinity/`. These are reference results, not autonomous-agent scores. Domain, browser and catalog tests remain documented in [the runtime README](../README.md).

## Email tools track

Set `BILLWORLD_ACCESS_MODE=browser_and_email_connector` when running the BrowserUseAgent family; the default is `browser_only`. The private harness provisions only an episode-scoped mailbox token. Five native MCP tools are registered for list, read, thread and flag updates and disconnected after each task. The VisionAgent family currently supports browser-only access. Private trial records include `accessMode`; `/report` defaults to `browser_only` and accepts `accessMode: "browser_and_email_connector"` for the other denominator. Keep scores from the two access modes separate.

With the pinned browser-use 0.11.9 and MCP 1.26.0 dependencies installed, `python billworld/infinity/smoke.py --connector` additionally checks native MCP registration and real list/read/update calls without invoking a model.

## Construction from catalog evidence

The [catalog workflow](../research/CATALOG_WORKFLOW.md) exports versioned evidence packets for the existing `infra/pipeline.py` construction process. Family candidates remain unverified and the exported packet is a draft construction input. First run `python3 -m billworld.infinity.prepare_generation --checkout /absolute/path/to/dedicated-build-checkout` from this repository. This installs the billing protocol across all pipeline phases while retaining the original upstream protocol. Use that checkout only for billing construction. Billing output must use the authoritative services and private adapter before it can be scored. No paid generation run has been validated.

## Integration contract and limits

Only apps with `harness.py` opt into private lifecycle hooks. Billworld implements `run_task` to declare trials before setup, apply deadlines, finalize failures and retain result artifacts. Its `prepare` and `verify_run` helpers bind the private episode to the task. Ordinary upstream apps retain their server reset and verifier behavior. Both built-in agent families gain a fresh-browser `reset_for_task(start_url)` method. A different AgentRunner must implement that method before running billing tasks.

Final answers use explicit JSON fields (`confirmation`, `billingDate`, `scheduledDate`, `statementFilename`) where requested; malformed or missing answers fail the corresponding predicate. Native step limits remain runner limits and are not equivalent to individual UI action counts. The private grading service enforces the task's 300-second wall-clock budget.

Private trial records and Infinity result files now carry environment/evaluator build fingerprints in addition to the package revision. `node billworld/build-fingerprint.mjs` exports the selected source/lockfile and snapshot-manifest input hashes for review. Keep that input manifest outside the evaluated agent's filesystem. Snapshot bodies still require `npm run audit:snapshots` and cold-read verification; fingerprints are not a hermetic deployment or binary attestation.

The private report accepts `environmentBuildId` and `evaluatorBuildId` filters (64-character SHA-256 strings; explicit null selects unrecorded legacy provenance). `byBuild` separates active and terminal counts and first-attempt outcomes. `buildCohortStatus: "mixed"` means the top-level aggregate combines builds and is descriptive. Retry series include both IDs; legacy records are not silently assigned current IDs. A resumed episode with recorded build IDs that differ from the worker's import-time fingerprint cannot finish as a successful completed trial. Runtime/browser/provider versions and deployment isolation still require separate recording and verification.

The pinned Gmail frontend is now vendored under `billworld/public/gmail/` and connected to authenticated episode messages through `bridge.js`. The copied source files remain unchanged; `provenance.json` records original hashes and index adaptations. `python3 billworld/infinity/vendor_gmail.py` rebuilds those files from the pinned checkout while preserving the bridge. `/mail` requires the separate mailbox password and supports inbox/search/read, thread display and persisted read/star/archive/trash/importance/spam flags. Recovery links are restricted to local portal reset and email-verification routes. Unsupported compose/settings/filter operations are unavailable.

An SDK-based stdio MCP connector now supplies email tools; see [mail connector setup](../MAIL_CONNECTOR.md). A separate mailbox origin, HTML bodies/attachments, Docker/remote deployment, held-out scenarios, UI action accounting and uncertainty estimates remain unfinished. Existing bills/auth flow fidelity limits still apply. Private reports persist run/attempt lineage, first-attempt strict success and best-of-observed-attempts separately. Native `run1`, `run2` directories identify repetitions; `BILLWORLD_RUN_ID` and `BILLWORLD_ATTEMPT_NUMBER` can override lineage. Record the actual model using `BILLWORLD_MODEL_ID`; the upstream model alias alone is insufficient. Infinity’s merged best-of-N HTML report is diagnostic; publish the private first-attempt metric and termination counts. Setup failures before episode creation and undispatched tasks still require whole-job accounting. Restart seals interrupted declared trials; continuous host supervision is not implemented.

Use `--artifacts-dir billworld/artifacts/infinity/<unique-run-name>` with the smoke runner to preserve separate full/scoped results; a nonempty explicit directory is rejected. The 0.15.0 full 26-task reference run is saved under `artifacts/infinity/0.15-full/`. The activation task reads its code through mock Gmail, creates credentials, signs in and pays the requested visit; it reports the same private-state predicates as other billing tasks.

The medical recovery task uses observed choice/contact screens, mock Gmail email-code verification and a synthetic post-code reset. Its private grader requires verified recovery before reset, the requested new password and subsequent login, with no new payments or recurring changes.

Release 0.16.0 adds Western Dental/PersonaPay as one explicitly mapped site. Tasks `task_m12`, `task_h16` and `task_h17` cover full bank payment, edited partial allocation and card overpayment. Graders verify server-side payment purpose, allocation, credit, identity verification, unchanged accounts/settings and reported confirmation. All twenty-nine references pass in `artifacts/infinity/0.16-full/`. The public login is captured; private checkout, allocation rounding, credit and posting remain synthetic. This is historical 0.16.0 validation. Release 0.17.0 adds `task_h18` (recurring enrollment) and `task_h19` (future payment) to the same runner. Public configuration supplies scheduling limits; private plan screens, eligibility, offer choices and execution are synthetic. eBill remains unfinished.

## Draft site integration

Bootstrap also installs `apps/billworld-construction`, with ten draft tasks: four Lockwood tasks (`task_c1` username login, `task_c2` Gmail recovery, `task_c3` synthetic card payment and `task_c7` registration/new-user login) and six Batavia tasks (`task_c4` email login, `task_c5` Gmail recovery and `task_c6` registration/account linking and `task_c8` synthetic bank payment and `task_c9` synthetic card payment and `task_c10` payment/history verification). It uses the same server, harness, verifier, reference script and upstream runner. Only this app explicitly enables construction workers. Its task inventory, per-task `site_cohort` metadata and private reports use the construction cohort; draft attempts are excluded from released denominators. The harness rejects mismatched worker/app cohorts. No released or certified catalog coverage is added.

```bash
python3 billworld/infinity/bootstrap.py
.upstream/smoke-venv/bin/python billworld/infinity/smoke.py --construction \
  --artifacts-dir billworld/artifacts/infinity/<unique-draft-run>
```

Use a Python environment with the pinned Infinity dependencies; the local `smoke-venv` path above is the existing review environment in this checkout. The documented `uv run python` route works with the full upstream environment. Select `--web-app apps/billworld-construction` for explicitly labeled draft agent research, preserving the same access-mode and provider configuration. Original private Lockwood screens and transaction fees remain unobserved; the draft card fee is declared synthetic.

Batavia uses the currently linked six-page city guide for login and recovery entry labels. The live tenant portal is HTTP 403; account continuation, reset-link format/lifetime and password rules are explicitly synthetic. Registration/account linking now follow the guide with synthetic validation and terms; billing remains unfinished. `research/batavia-auth-construction-validation.json` records domain/browser checks and the shared Infinity references. Batavia adds no released coverage or autonomous-agent score.

Batavia `task_c6` creates portal credentials, verifies the account number and full service-address prefix, reviews identity, saves paperless/email choices, accepts local terms, then logs out and signs in again. Session-bound, expiring verification grants and idempotent Add Account prevent blind or duplicate linking. Source layout and private validation remain uncertified; see `research/batavia-registration-construction-validation.json`.

The source-packet workflow now also exports verified static script/style bundles from `research_frontends.py`, with URL, page-body hash and biller provenance. `--biller-id` prioritizes a representative; `--third-party` includes observed CDN references. These raw production bundles are review inputs for Infinity's construction pipeline, never executable runtime assets. Static capture does not establish complete SPA dependency coverage, private behavior or fidelity.

Priority source capture now fills Batavia's nine and Lockwood's twenty-eight static frontend references before continuing the full catalog queue. Source packets use hash-verified candidate spans and selective capture reads, avoiding an all-catalog dictionary for every biller. Lockwood's packet also carries its public company password JSON. Its draft reset now enforces the observed eight-character minimum and required classes; local maximum/character interpretation and recovery continuation remain synthetic. All six construction references pass the existing Infinity lifecycle after this change. See `../research/frontend-priority-validation.json`; no released or certified coverage is added.

Lockwood `task_c7` adds account/phone lookup, matched-account confirmation, credential creation with the observed public password policy, explicit consent, completion receipt, new username login and account opening. The four stages follow captured public client code; private layouts, lookup responses and backend validation remain reconstructed. Registration grants are episode-bound, expiring and HttpOnly, with idempotent completion and protected utility state.

Current construction validation passes 194 domain/HTTP checks, 66 research checks, four registration Puppeteer scenarios and all seven Infinity references. The shared reference accepts required cookies before Register. No-action/error/timeout/cancellation/deadline checks, repetition lineage and owned-worker crash recovery also pass. Environment startup/recovery has a separate 60-second elapsed-time limit; task deadlines are unchanged. See `../research/cusi-registration-construction-validation.json`. This establishes construction behavior; no released coverage, independent fidelity certification or autonomous-agent score is added.

The full catalog collector has tested progress-count query improvements that avoid duplicate reference expansion. Captured source remains inert. See `../research/frontend-progress-query-validation.json` for validation and collector maintenance evidence; the full catalog queue is unfinished.

Batavia `task_c8` signs in, opens linked bills, reviews a new synthetic bank instrument, authorizes once and reports the receipt. The $3.50 fee, $500 bill-amount limit and immediate posting are construction fixtures; historical guide values do not establish current policy. Review cookies are HttpOnly and bind the trusted quote to the episode and login session. The shared ledger prevents duplicate/stale commits; the private grader checks exact bank identity, unchanged business state and view/review/payment order. See `research/batavia-payment-construction-validation.json` for dated validation. Current checkout layout, settlement, saved methods, card payment and AutoPay remain unfinished.

Batavia `task_c9` selects a new synthetic card, validates its checksum/expiry/security code, reviews the fixture fee and authorizes one payment. A declined card creates no payment or reservation; the visible Back to bills link permits a new review. The grader checks the full instrument fingerprint, holder name and expiry rather than the visible suffix alone. Full card numbers and security codes are not persisted; originals remain unobserved and this task adds no released/fidelity coverage.

Batavia `task_c10` additionally opens Payment History after paying and verifies the new record. History reads authoritative local records scoped to verified linked accounts, masks instruments and preserves pending status. The grader rejects history opened only before payment or by another portal profile. The existing bank/card tasks retain their prior requirements. Local history does not certify the live portal’s retention or channel completeness.

The eleventh construction task, `task_c11`, edits Batavia notification/paperless settings and reloads them. It remains excluded from released task and autonomous-score denominators. The capabilities are documented in the city-linked FAQ/guide; the local form and update timing are synthetic.

The twelfth construction task, `task_c12`, downloads the latest linked Batavia bill and returns `statementFilename`. It uses the same private lifecycle adapter, task budgets and reporting. The grader requires authorized statement issuance with the expected hash after login/Accounts, the correct filename, and no business or credential mutation. Server issuance does not prove that a remote browser saved the file; the scripted Puppeteer reference also waits for Chrome download completion and hashes the saved PDF in the task artifact directory. Statement layout/content are synthetic and remain outside released coverage and autonomous-agent scores.

Scripted references record browser mode/version in each `reference.json`. The default is `chrome`; `BILLWORLD_REFERENCE_BROWSER_MODE=headless_shell` selects the installed Puppeteer headless-shell binary for local validation. Startup has a separate 120-second allowance; task deadlines remain unchanged. These browser settings do not constitute autonomous-agent results and do not change the model runner.


## Private action budgets

Billworld agent runs now require a supported action meter. The BrowserUse runner reserves one action immediately before every registry tool dispatch, including Gmail MCP calls and the done tool. Vision runners reserve one action before each parsed GUI action reaches Playwright. A compound action is one dispatch, not a count of individual keystrokes or DOM events; model calls, automatic observations and browser setup are outside this action unit. Existing runner step limits and the private wall-clock deadline still apply independently.

The private server derives the limit from the task, persists each reservation and refuses the next dispatch after the limit. The lifecycle records `action_budget_exceeded`; completed billing predicates cannot override exhaustion. A failed meter connection stops the runner as an environment error. Units and counts are immutable from the model's final answer. The two units (`browser_tool_invocation`, `vision_action`) are separate report groups and can be filtered with `actionBudgetUnit`. Unmetered legacy runs and existing scripted UI references are labeled `unmetered`; they do not claim action enforcement. Unsupported runners cannot begin an autonomous Billworld agent phase.

The action hooks are a trusted scaffold boundary, not an OS sandbox. A tool may perform several internal operations, while one model step may request several tools. Compare runs using the same meter unit and scaffold. The general terminal aggregate may contain mixed units; use the unit filter for budget-comparable scores. Private metering does not attest original-site fidelity or replace the still-required isolated deployment.

The real-browser dispatch regression uses the patched native `VisionAgentBase.run` and `execute_action` with a deterministic test loop. It verifies successful login on the last allowed action, blocks the next logout before browser dispatch, preserves partial history and persists budget failure. It requires Python Playwright and reuses Puppeteer’s installed Chromium; it makes no model calls. Run with an empty artifact directory:

```sh
ANONYMIZED_TELEMETRY=false .upstream/review-venv/bin/python billworld/infinity/vision_budget_smoke.py --artifacts-dir billworld/artifacts/infinity/vision-budget-new-run
```

The verified 0.19.0 run and dependency versions are recorded in `billworld/research/vision-action-budget-validation.json`. The earlier `action-budget-validation.json` remains a historical record of the preceding mock-page validation.

Construction task `task_c13` exercises Batavia My Wallet using the existing Infinity adapter and Puppeteer reference. It requires card expiry editing, a specific new card, removal of the specified bank method and a final wallet read, with exact protected-state and credential checks. The original guide documents navigation; private forms and persistence are reconstructed. Wallet editing and saved-method checkout also have a dedicated browser regression. Construction scope is now thirteen tasks; released scope remains thirty-one.

Construction tasks `task_c14` and `task_c15` exercise Batavia Paymentus AutoPay enrollment and cancellation through the existing Infinity adapter. Both require login, account-scoped settings, review, explicit authorization and a final settings read. Private grading allows only the requested enrollment mutation and protects credentials, methods, preferences, other accounts and payments. Enrollment also requires acknowledgement of the documented warning against duplicate city bank-draft enrollment. Construction scope is fifteen tasks; released scope remains thirty-one.

Runtime 0.22.0 uses explicit synthetic AutoPay execution rules: one attempt per existing future invoice at due-date midnight UTC, only the unreserved balance, construction fees on successful attempts, no overdue catch-up, no automatic retry and no generation of future invoices. Cancellation retains submitted payments. Card expiry, missing methods/links and transaction limits yield failed attempts and mock email. These rules do not establish the original Paymentus private forms or timing, and do not activate or cancel the separate city-administered bank-draft service. Reference journeys validate integration, not autonomous agent success rates.

Construction task `task_c16` adds Greater Minnesota Gas / Starnik username login and account viewing on runtime 0.23.0. It reuses the captured legacy login layout, Billworld session storage and the existing Infinity lifecycle. The private account summary is synthetic and read-only. Registration and recovery remain inert public references, and this tenant exposes no payment, Google, generic recovery or generic login shortcut. Its grader requires username verification, login, subsequent account reading, a live primary session and exact preservation of account/credential/billing state. Construction scope is sixteen tasks across three tenants; released scope remains thirty-one tasks across nine sites. Evidence is in `research/starnik-auth-construction-validation.json`.

Runtime 0.24.0 adds construction task `task_c17`: retrieve GMG's username through mock Gmail, request a password-reset email, open its one-use link, set the specified password, sign in and read the account. The existing Gmail frontend and connector share these ordinary messages. Recovery entry forms and client password rules come from the captured Starnik bundle; delivery, uniform request responses, fifteen-minute expiry, grant supersession and session revocation are local rules. The private grader permits only the primary credential change and requires the ordered recovery/login/account events. Construction scope is seventeen tasks; released scope remains thirty-one. See `research/starnik-recovery-construction-validation.json`.

Runtime 0.25.0 adds construction task `task_c18`, GMG security-code registration through mock Gmail, username availability, credential creation and new-user login. Pending/resend and email-verification capabilities are separate. A pending-page cookie cannot skip email ownership. Resend supersedes the previous link; username uniqueness is checked again at commit. Construction scope is eighteen tasks across three tenants. The captured client supplies the stage order and credential rules, while delivery, lifetime, account lookup and setup layout remain local reconstructions. Only the fixture contact mailbox is supported. See `research/starnik-registration-construction-validation.json` for the full regression build and the later GMG-only visual-fix validation build.
