---
pretty_name: Billworld
license: other
license_name: billworld-unreleased
license_details: Not yet licensed for redistribution. The license and any public release await an owner decision; redistribution terms for the captured reference assets are not settled. Task prompts and site metadata here are synthetic; the runtime's captured pages are not part of this export.
language:
  - en
task_categories:
  - other
tags:
  - web-agents
  - browser-agents
  - bill-payment
  - benchmark
  - accessibility
size_categories:
  - n<1K
configs:
  - config_name: tasks
    data_files:
      - split: released
        path: data/tasks.jsonl
      - split: billpay_core_10
        path: data/billpay_core_10.jsonl
  - config_name: sites
    data_files:
      - split: sites
        path: data/sites.jsonl
---

# Billworld

Billworld is a benchmark for browser agents that pay bills. Each task runs on a local
simulation of a real U.S. biller's portal: invoice lookup, guest and signed-in payment,
AutoPay, scheduling, recovery, registration, statements and wallets. A private grader reads
the simulator's own billing state and event history, and compares any value the agent reports
(a confirmation number, a date, a filename, a balance) with that state, never with the page text.

| | |
|---|---|
| Released tasks | 142 on 17 hand-built sites (`data/tasks.jsonl`, split `released`) |
| Core bill-pay split | 10 payment tasks on 10 sites, 9 portal families (`data/billpay_core_10.jsonl`, split `billpay_core_10`) |
| Portal families | 12, named as exported: AuthorityPay/Muni-Link with InvoiceCloud QuickPay handoff, Edmunds, Epic MyChart, InvoiceCloud, Municipal Online Payments / Tyler Utility Access, Paymentus, PersonaPay, SmartHub, Spotify account, Starnik, Xpress Bill Pay, ePay Utilities/CUSI |
| Grading | Strict private predicates per task: right invoice, account, amount, method, fee, exactly one new payment, unchanged settings, and reported values that match state |
| Budgets | Per task, in wall-clock seconds and in metered browser actions |

## Files

| File | Contents |
|---|---|
| `data/tasks.jsonl` | One row per released task: `reference_id`, `task_id`, `version`, `site_id`, `site_name`, `portal_family`, `category`, `prompt`, `budget_seconds`, `budget_actions`, `outcome_fields`, `evidence_cohort`, `splits` |
| `data/billpay_core_10.jsonl` | The same rows for the ten core tasks, in split order |
| `data/sites.jsonl` | One row per site: `site_id`, `site_name`, `portal_family`, `implementation_status`, `revision`, `released_tasks`, `fidelity_limits` |
| `data/splits.json` | The reference IDs in each split, in order |
| `results.schema.json` | The shape of a results submission (hand-written) |
| `run.mjs`, `score.mjs` | The reference runner and scorer |

`outcome_fields` names the keys of the outcome the task's private grader reads (`confirmation`,
`billingDate`, `scheduledDate`, `statementFilename`, `postedBalanceCents`, `pendingPaymentCents`,
`remainingBalanceCents`); an empty list means the grade rests on state alone. It carries key names
only, never the expected values. In `data/sites.jsonl`, `revision` is absent for four sites that do not
declare one (charlotte-county-utilities, inframark, lockwood, onswc), and `fidelity_limits` is empty for
three that state none (charlotte-county-utilities, inframark, onswc); an empty list is not a claim of
full fidelity.

`node billworld/benchmark/export.mjs` writes only the data files above, from the task manifests
(`billworld/tasks/*.json`), the site manifests (`billworld/sites/*.json`) and `infinity/app/tasks.json`; this card and the schema are edited by hand. `npm test` fails when the
data files are stale. Goals, graders, the episode's persona and captured assets stay in the runtime
and are never exported. Some prompts state synthetic values the task itself supplies (a sign-in, a
test routing number); they are fixtures, not real credentials.

## Setup

Node 24 or later, from a checkout of `gracefultechnology/billworld` with its captured assets:

```sh
npm ci
npm test
```

## Running

`run.mjs` runs any agent command over a split. It starts the simulator in-process, and for each
task in split order creates an episode, starts the action meter, runs the command, enforces the
time budget, finishes the episode and writes `results.json` (valid against `results.schema.json`)
into `--out` (default `billworld/data/benchmark-runs/<time>`, which also holds the supervisor's
SQLite database and each agent's stderr).

```sh
node billworld/benchmark/run.mjs --split billpay_core_10 \
  --agent-cmd 'node my-agent.mjs' --agent my-agent --agent-version 1.2.0 --model my-model
node billworld/benchmark/score.mjs billworld/data/benchmark-runs/<time>/results.json
```

The command gets one JSON object on stdin and prints one JSON object, its outcome, on stdout:

```json
{"prompt": "...", "startUrl": "http://127.0.0.1:.../enter/...", "persona": {"credentials": {}},
 "outcomeFields": ["confirmation"], "budget": {"seconds": 300, "actions": 100, "unit": "browser_tool_invocation"},
 "meterUrl": "http://127.0.0.1:.../meter/..."}
```

Before each browser action the agent POSTs `{"name": "click"}` (`name` matching `[A-Za-z0-9_.:-]{1,100}`)
to `meterUrl` and stops when the reply is `{"allowed": false}`. A malformed request gets `{"error"}` with
no `allowed` key; it spends nothing and is not a stop. The outcome is the last JSON object on stdout (a
pretty-printed object is fine; only the last 1 MiB of stdout is kept). Only the `outcomeFields` keys of it
are graded, and only with the grader's type: strings for `confirmation`, `billingDate`, `scheduledDate` and
`statementFilename`, integers for the `*Cents` keys; a value of another type counts as not reported. The
runner settles when the command exits and then kills its process group, so processes it leaves behind
do not outlive the trial. The smallest
agent does nothing and reports nothing; it fails every task, which is the no-action control:

```sh
node billworld/benchmark/run.mjs --split billpay_core_10 --agent no-action --cohort grader_validation \
  --agent-cmd "node -e \"process.stdin.resume();process.stdin.on('end',()=>console.log('{}'))\""
```

`--task task_m1` (repeatable) runs part of a split; `score.mjs` still counts the tasks without a
trial as failures. `score.mjs` validates the file against the schema, checks each trial's `taskId`
and `taskVersion` against `data/tasks.jsonl`, warns when `billworldCommit` is not in the checkout or
its task data differ, and prints the pass rate with a Wilson 95% interval per split and per
category from each task's first attempt. A run from a checkout with uncommitted changes under `billworld/`
is marked `billworldDirty: true`, and `score.mjs` warns that it did not run exactly `billworldCommit`.

### Admin API (for your own harness)

`npm start` binds the sites to `127.0.0.1:3100` and the admin API to `127.0.0.1:3101`
(`BILLWORLD_PORT`, `BILLWORLD_ADMIN_PORT`). The admin token is `BILLWORLD_ADMIN_TOKEN` when set and
otherwise random per start; `npm start` saves it with the runner fixtures in `billworld/data/*-runner.json`
(owner-only), and `start()` from `billworld/server.mjs` returns `{baseUrl, adminUrl, adminToken,
googleUrl, close}`. Every call is `POST` JSON with `Authorization: Bearer <admin token>`. The token,
the admin URL and the episode reply's `task` never go to an agent.

1. `POST /episodes` with `siteId`, `taskId`, `seed` (the task's 1-based position in the `released`
   list of `data/splits.json`, which keeps runs comparable) and `trial` metadata (`kind`, `agent`,
   optional `model`, `runId`, `attemptNumber`, `accessMode`). The reply gives the start URL and the
   synthetic persona (`credentials` and site-specific credential objects), and also the **private
   task with its goal**, the entry and connector tokens and the trial: pass the agent the start URL
   and persona only.
2. `POST /actions/start` with `{episodeId, unit}` (`browser_tool_invocation` or `vision_action`;
   the episode must have declared a trial), then `POST /actions/consume` with `{episodeId, name}`
   (`name` matching `[A-Za-z0-9_.:-]{1,100}`) before each action. The reply is
   `{allowed, unit, limit, used, exhausted}`. The simulator counts the budget and fails the score
   once it is exceeded; it cannot stop the agent, so the harness must stop it when `allowed` is false.
3. `POST /finish` with `{episodeId, outcome, metadata}`. `outcome` carries the task's
   `outcome_fields` (`confirmation`, `billingDate`, `scheduledDate`, `statementFilename`,
   `postedBalanceCents`, `pendingPaymentCents`, `remainingBalanceCents`); `metadata.termination` is
   `completed`, `timeout`, `action_budget_exceeded`, `agent_error`, `environment_error` or
   `cancelled`. When the episode declared no trial, `metadata` must also carry `kind` and `agent`.
   The score is immutable from then on; a late or over-budget `completed` is recorded as a timeout or
   budget failure.

`/evaluate` grades without finishing and `/report` summarises cohorts; see
[the runtime README](../README.md#runner-and-evaluator-api).

## Determinism

Fixtures (accounts, invoices, saved methods, payment history) are fixed by the site and task and are the
same for every seed. The seed goes only into the confirmation numbers most sites issue, as part of
their value (Tuscaloosa's are random); passing the `released`-list seed keeps those numbers comparable
across runs. One-time codes, entry and session tokens and other secrets are random
per episode. The simulated calendar starts at a fixed date, 2026-10-03, so due dates and schedule
windows repeat across runs. Budgets are wall-clock: the time budget starts when the episode is
created, so a slow machine can time out where a fast one does not.

## Scoring

A task passes only when every private predicate holds after the episode is finished. Report the
strict pass rate per split with every task of the split in the denominator: timeouts, budget
exhaustion, environment errors and tasks without a trial count as failures. Keep separate:

- `reference_script`: the scripted reference journeys. They show each task is solvable; they are
  not agent results.
- `grader_validation`: no-action and scripted controls. A no-action episode must fail every task.
- `agent`: one row per agent, model and access mode. State how much a person helped (questions
  answered, protected values typed, commit buttons pressed); assisted and autonomous results are
  different cohorts and are never pooled.

## Baselines (core split, `billpay_core_10`)

| Agent | Cohort | Assistance | Passed |
|---|---|---|---:|
| Scripted reference journeys | `reference_script` | none | 10 / 10 (provenance pending: needs a recorded run) |
| No action | `grader_validation` | none | 0 / 10 expected (provenance pending: needs a recorded run) |

A row is final only with the run that produced it: the simulator commit, the agent's own commit, the
model, the date, the `results.json` and the evidence directory.

## Intended use and out of scope

Billworld measures whether a browser agent can complete bill-payment tasks exactly and safely on
simulated portals, and compares agents, models and amounts of human help under fixed budgets.

Out of scope: running agents against real billers, real accounts or real payment systems, collecting
real credentials, and reading a pass as evidence about a real portal. Use it only against the local
simulator.

## Personal information

There is none. Every persona (Alex Morgan, `alex@billworld.test`, accounts, bank and card numbers,
passwords) is synthetic, and the card and bank numbers are test values. Personas belong to the
simulator's fixtures, not to real customers of the billers.

## Limits

Every site states its fidelity limits (`data/sites.jsonl`): screens that could not be observed
are reconstructed and labelled synthetic. A Billworld pass is evidence about the simulated
portal, never about the real biller, a real payment or a real account.

## Versions

Each task row has the manifest's `version`. Each finished
episode records the simulator's `environmentRevision` (the package version) and its task version,
and a results file names the `billworldCommit` it ran at. Compare results only at the same task
versions.

## License

Not yet licensed (`license: other`, `billworld-unreleased`). The license and any public release
await an owner decision.

## Citation

```bibtex
@misc{billworld,
  title        = {Billworld: a benchmark for browser agents that pay bills},
  author       = {{Grace Technology}},
  howpublished = {\url{https://github.com/gracefultechnology/billworld}},
  note         = {Unreleased; citation to be confirmed}
}
```

## Maintainers

Grace Technology (`gracefultechnology` on GitHub). Report issues at
https://github.com/gracefultechnology/billworld.
