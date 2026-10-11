# Agentlab: blind agent harness for Fleet

Agentlab lets an LLM agent attempt a Fleet benchmark task the way an evaluated agent would. During an attempt the agent sees only three things: the task instruction, the credentials the instruction grants, and the rendered pages. Grading runs privately. Its result is revealed only after the agent submits its final message.

| File | Role |
|---|---|
| `sample.mjs` | Deterministic task sample: `[{taskId, billerId, type}]` |
| `act.mjs` | **The only interface an agent uses.** Sends one command to the run's daemon and starts the daemon if needed. |
| `session.mjs` | Daemon, one per run. It runs its own Fleet server in benchmark mode (only `/enter` links start episodes) and its own headless Chrome, and it holds the run's private grader access. |
| `report.mjs` | Aggregates results by category, template, task type, evidence cohort and tier, and lists failures with their last observation. |
| `lib.mjs` | Shared helpers, including the task-type groups |

Each run keeps its files in `fleet/.agentlab/<runId>/` (gitignored):

| File | Contents |
|---|---|
| `daemon.json` (0600) | daemon pid, control port and token |
| `state.json` (0600) | the active task |
| `admin-token` (0600) | the run's grader token |
| `data/` | episode snapshots; a restarted daemon resumes from them |
| `trajectory.jsonl` | every command with its output, URL and timing |
| `results.jsonl` | one graded record per finished attempt |
| `screenshots/` | screenshots taken on request |
| `chrome-profile/` | the run's Chrome profile |
| `daemon.log` | daemon output |

## Rules for auditor agents (read before every attempt)

1. **Use only `act.mjs`.** Do not use curl, a browser or any other tool against the Fleet server, the mock Google origin or the daemon port.
2. **During an attempt, never read:**
   - Fleet source (`billworld/fleet/**`), dossiers (`billers/*.json`, `billers/picks/`), `tasks.mjs`, templates, profiles or the catalog (`categories/*.json`)
   - research data
   - the admin API, `/state`, `/tasks`, `/biller` or `infinity/build/private-tasks.json`
   - `.artifacts/`, `.sweep/`, or any file in `.agentlab/<runId>/` other than screenshots that `act.mjs screenshot` printed for you
   - the database or episode snapshots
3. **Work only from the instruction and the pages.** If the site does not show something, you do not know it. Do not guess field names, URLs or codes from prior knowledge of Fleet. Typing a same-site URL with `goto` is allowed (for example `/mail` or `/sms`), but navigating by the visible links is the intended path.
4. **One attempt per task counts.** The grading output after `answer` shows the predicates and expected values. Do not re-attempt a task you have seen graded and report that attempt as a first try. `report.mjs` counts only the first finished attempt per task and run.
5. **Use your own run and your own scratch folder.** Keep any wrapper script under `scratchpad/<your label>/`, never at the scratchpad root, where another auditor's wrapper can redirect your commands. Each auditor uses its own unique `runId`, for example `aud-<you>-<category>`. Different runs are fully isolated. Within one run, commands are serialized, so drive one task at a time.
6. **Write a real final message.** `answer "..."` is your final message to the user. State what the instruction asks for, such as a confirmation number, an amount and due date, a phone number, or that something is not possible online.
7. **Report harness problems separately.** Report anything that looks like a harness problem, such as a crash, a timeout or an element that cannot be clicked, as a harness issue, not as a site failure. Quote the `act.mjs` output.

## Usage

All paths below are relative to the repo root (`/Users/shawwalters/billpay-research`).

```bash
# 1. Pick tasks (deterministic; types rotate so each category covers every task type it supports)
node billworld/fleet/agentlab/sample.mjs --category electric [--per-biller 3] [--seed s] > /tmp/electric.json
node billworld/fleet/agentlab/sample.mjs --template smarthub [--max-billers 20] [--tier dedicated|family|all]
node billworld/fleet/agentlab/sample.mjs --billers id1,id2 [--per-biller 3] [--no-cover] [--types payment,limitation] [--with-meta]

# 2. Attempt a task (the agent runs only these)
A="node billworld/fleet/agentlab/act.mjs myrun"
$A start peco-energy-company-peco-3554e5:pay-bank   # prints INSTRUCTION + START URL
$A observe                                          # URL, title, page text (6k chars), numbered elements
$A more                                             # next 6k chars of page text
$A click 12          [--observe]                    # any action takes --observe to print the new page too
$A type 14 "avery.garcia@billworld.test"            # clears the field first; dates: YYYY-MM-DD or MM/DD/YYYY
$A select 7 "Checking account ending in 6771"       # dropdown option by its visible text
$A check 20 / uncheck 20
$A press Enter
$A goto /mail        # also /sms, any same-site path, or the mock Google origin; external sites are blocked
$A back | forward | reload | tabs | switch 2 | close
$A screenshot [viewport]                            # saves a PNG and prints its path (full page by default)
$A status | instruction | help
$A answer "Paid $97.32 from checking; confirmation PE296106527."   # finishes and grades: PASS/FAIL + predicates
$A stop                                             # stop this run's daemon (Chrome + server)

# 3. Aggregate
node billworld/fleet/agentlab/report.mjs [--runs r1,r2] [--json] [--all-attempts] [--include-abandoned] [--failures N]
```

In zsh, `$A` does not split into words. Use `act(){ node billworld/fleet/agentlab/act.mjs myrun "$@"; }` instead.

### What the agent sees

- **`start`:**
  - The instruction, built by `infinity/export.mjs instructionFor`, exactly as the Infinity export gives it. It contains:
    - the intent
    - the persona name and email
    - the portal password, except on reset, guest, help and offline tasks
    - the `/mail` location and that episode's mailbox password
    - the `/sms` phone number on SMS tasks
    - what the final message must state
  - The start URL. When a dossier biller signs in by phone number, the instruction also gives the persona's phone number.
- **`observe`:**
  - URL, title and tab list.
  - The visible page text (`innerText`, 6,000 characters per chunk).
  - A numbered list of the visible interactive elements. Each entry shows the role, the accessible name (aria-label, label, placeholder or text), the current value (passwords masked), checked, selected and disabled state, the radio group legend, dropdown options and link targets.
  - No field names, DOM ids, hidden inputs or page source.
  - PDF statements are shown as their text.
- **Actions:** after each action the agent gets the new URL and title, plus any alert, error or flash messages on the page.
  When the browser's own form validation blocks a submit (for example an unticked required checkbox or an empty required
  field), the output lists the field under "Messages on the page" with its element number and the browser's message,
  e.g. `[13] "Date of birth": Please fill out this field.`
- **Run name:** `start` and `answer` print the run id (`RUN <runId> | TASK …`, `RESULT: … run <runId> …`), so a wrapper
  pointed at the wrong run is visible at once. A `start` that abandons an unfinished attempt says so in a `NOTE:`.
- **Facts only the customer knows:** when a biller's guest lookup or registration form asks for a phone number or a
  date of birth, the instruction states the persona's value (`tasks.mjs` `personaFacts`, printed by
  `infinity/export.mjs instructionFor`).
- **Element numbers:** valid only for the page they were observed on. After a navigation, the agent must run `observe` again; a stale number is refused.

### Robustness and speed

- **Speed:** each `act.mjs` call takes about 60 ms. An action with a page load takes about 0.3–0.5 s, and `start` takes about 0.3 s once the daemon is up. Starting the daemon takes about 2 s; it loads the 59,477-biller catalog once.
- **Timeouts:** each command has a 45 s limit (`AGENTLAB_CMD_TIMEOUT_MS`) and the client waits up to 90 s. A hung page is stopped and the error is reported.
- **Restarts:**
  - If the daemon dies, the next `act.mjs` call starts a new one on the same Fleet port, and the episode is restored from `data/`. A Chrome left behind from this run's profile is killed.
  - If Chrome crashes, it is relaunched.
  - In both cases the agent gets a `NOTE:` that it is back on the start page. Site state is kept, but it may need to sign in again.
- **Idle exit:** an idle daemon exits after 30 minutes (`AGENTLAB_IDLE_MS`).
- **Concurrency:**
  - Every run has its own server, ports, Chrome and files.
  - Concurrent `act.mjs` calls on one run are serialized, and a spawn lock prevents duplicate daemons.
  - On a shared machine, keep at most 2 active runs per agent.
- **Network:** requests to any origin other than this Fleet server and its mock Google IdP are blocked and reported.
- **Restarting a task:** `start` while a task is unfinished seals the old attempt as `abandoned`. `report.mjs` excludes abandoned attempts unless you pass `--include-abandoned`.

### Task types (`sample.mjs` / `report.mjs`)

| Type | Task slugs |
|---|---|
| `payment` | pay-bank, pay-minimum, pay-partial-card, declined-retry |
| `scheduled` | schedule-payment |
| `cancel-scheduled` | cancel-scheduled |
| `autopay-enroll` | autopay-enroll, autopay-switch-to-card |
| `autopay-cancel` | autopay-cancel |
| `paperless` | paperless-on |
| `cancel-service` | cancel-service, accept-retention, undo-cancellation |
| `limitation` | `*-limitation`, offline-limitation, not-a-biller |
| `plan-change` | downgrade-plan |
| `reset-then-pay` | reset-then-pay |
| `mfa-email` | mfa-pay |
| `mfa-sms` | sms-mfa-pay |
| `google-login` | google-login-pay |
| `register-and-pay` | register-and-pay |
| `guest-pay` | guest-pay |
| `view-bill` | view-bill |
| `help` | help-phone |
| `dossier` | the dossier's `tasks.extra` |
| `account-other` | setup-payment-plan, send-message, remove-old-card |

How the rotation works:
1. Each biller takes up to `--per-biller` of the types it supports that the sample has used least so far.
2. A coverage pass then adds one task for each supported type the rotation missed. Turn it off with `--no-cover`.

## Proof (2026-10-10)

These attempts ran through `act.mjs` only. Every command was an `act.mjs` call, as an agent would make it.

| Run | Task | Result |
|---|---|---|
| proof1 | `peco-energy-company-peco-3554e5:pay-bank` (payment) | **PASS**: payment, autopay_unchanged, answer(confirmation), no_unrequested_changes, no_payment. The daemon was restarted mid-task and the attempt resumed. |
| proof2 | `pseg-public-service-electric-and-gas-company-101d1c:reset-then-pay` (recovery by mail: Forgot password, then the reset email in `/mail`, then the reset link, then sign-in and pay) | **PASS**: password_changed, event_sequence 3/3, payment |
| proof1 | `txu-energy-6d5e4c:cancel-service-limitation` (limitation answer: the help article gives the phone number to call) | **PASS**: no_payment, answer(contact) phone matched, no_unrequested_changes |
| proof2 | `comed-commonwealth-edison-4c6870:view-bill` (answer read from the statement PDF) | **PASS**. Chrome was killed and the daemon was killed with `-9` during this attempt; both recovered. |
| proof3 | `consolidated-edison-company-of-new-york-con-edis-1ac80c:sms-mfa-pay` (code read from `/sms`) | **PASS** |
| proof1 | no-op answer `"Done."` on pay-bank, `"I could not find anything."` on the limitation task, `"Done."` on georgia-power view-bill | all **FAIL** (payment, answer and logged_in predicates fail) |

## Measured results (2026-10-10)

| Runs | Tasks | Passed |
|---|---:|---:|
| First pass, all auditor runs (`aud-*`, 28 categories) | 1,205 | 1,191 (98.8%) |
| `agentfix-reatt`: every task that had failed outside the proof runs, plus restored date-of-birth / phone lookups | 18 | 18 |
| `agentfix-fresh`: 20 never-attempted tasks across 20 categories | 20 | 20 |
| Latest result per distinct task (all non-proof runs) | 1,228 | 1,228 |

`node billworld/fleet/agentlab/report.mjs --runs agentfix-reatt,agentfix-fresh` reproduces the last two rows; the
by-category, by-template and by-type tables and the analysis of the 14 first-pass failures are in
[`../README.md`](../README.md#agent-solvability-2026-10-10-measured-with-agentlab). The post-fix runs were driven by the
integrator through `act.mjs` only, after reading the Fleet source, so they verify the fixes rather than give an
independent blind score.

