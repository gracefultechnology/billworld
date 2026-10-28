---
pretty_name: Billworld
license: other
license_name: billworld-unreleased
license_details: Redistribution terms for the captured reference assets are not settled. Task prompts and site metadata here are synthetic; the runtime's captured pages are not part of this export.
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
  - config_name: sites
    data_files:
      - split: sites
        path: data/sites.jsonl
---

# Billworld

Billworld is a benchmark for browser agents that pay bills. Each task runs on a local
simulation of a real U.S. biller's portal: invoice lookup, guest and signed-in payment,
AutoPay, scheduling, recovery, registration, statements and wallets. A private grader reads
the simulator's own billing state and event history, not the agent's words or the page text.

| | |
|---|---|
| Released tasks | 142 on 17 hand-built sites (`data/tasks.jsonl`, split `released`) |
| Core bill-pay split | 10 payment tasks on 10 sites, 9 portal families (`billpay-core-10`) |
| Portal families | InvoiceCloud, SmartHub, Xpress Bill Pay, Tyler Utility Access, AuthorityPay, Epic MyChart, PersonaPay, Edmunds, Paymentus, ePayUB/CUSI, Starnik, subscription |
| Grading | Strict private predicates per task: right invoice, account, amount, method, fee, exactly one new payment, unchanged settings, reported confirmation |
| Budgets | Per task, in seconds and in metered browser actions |

## Files

| File | Contents |
|---|---|
| `data/tasks.jsonl` | One row per released task: `reference_id`, `task_id`, `version`, `site_id`, `site_name`, `portal_family`, `category`, `prompt`, `budget_seconds`, `budget_actions`, `evidence_cohort`, `splits` |
| `data/sites.jsonl` | One row per site: family, implementation status, revision, released task count and the fidelity limits the site states about itself |
| `data/splits.json` | The reference IDs in each split |
| `results.schema.json` | The shape of a results submission |

`node billworld/benchmark/export.mjs` writes these files from the task manifests and
`infinity/app/tasks.json`; `npm test` fails when they are stale. Goals, graders, persona
credentials and captured assets stay in the runtime and are never exported.

## Running an agent

Any agent that drives a browser can run Billworld. The harness owns the episode; the agent sees
only the public task and the website.

1. Start the simulator: `npm start` (or `start()` from `billworld/server.mjs`), which serves the
   sites, a local Google identity, a mock Gmail at `/mail`, and an admin API on its own port.
2. For each task, `POST /episodes` with `siteId`, `taskId`, a seed (the row's position in
   `released`, starting at 1, keeps runs comparable) and `trial` metadata naming the agent. The
   reply gives the start URL and the synthetic persona (email, password, bank and card numbers)
   for the person the agent works for.
3. Give the agent the task `prompt` and the start URL. Persona values reach the agent only the
   way the agent's own design allows (typed by a person, held by a vault); record which.
4. Meter every browser action: `POST /actions/start` once, then `POST /actions/consume` per action
   (`unit: browser_tool_invocation`). The budget is enforced by the simulator, not the agent.
5. `POST /finish` with the episode, the agent's reported outcome (`confirmation`, or the date the
   task asks for) and `termination` (`completed`, `timeout`, `action_budget_exceeded`,
   `agent_error`, `environment_error`, `cancelled`). The score is immutable from then on.

The admin API, cohorts and lifecycle rules are described in
[the runtime README](../README.md#runner-and-evaluator-api).

## Scoring

A task passes only when every private predicate holds after the episode is finished. Report the
strict pass rate per split with every attempted task in the denominator (timeouts, budget
exhaustion and environment errors count as failures). Keep separate:

- `reference_script`: the scripted reference journeys. They show each task is solvable; they are
  not agent results.
- `grader_validation`: no-action and scripted controls. A no-action episode must fail every task.
- `agent`: one row per agent, model and access mode. State how much a person helped (questions
  answered, protected values typed, commit buttons pressed); assisted and autonomous results are
  different cohorts and are never pooled.

## Baselines (core split, `billpay-core-10`)

| Agent | Cohort | Assistance | Passed |
|---|---|---|---:|
| Scripted reference journeys | `reference_script` | none | 10 / 10 |
| No action | `grader_validation` | none | 0 / 10 (every task correctly fails) |

Agent results are added with the run that produced them: the simulator commit, the agent's own
commit, the model, the date, and the evidence directory.

## Limits

Every site states its fidelity limits (`data/sites.jsonl`): screens that could not be observed
are reconstructed and labelled synthetic. A Billworld pass is evidence about the simulated
portal, never about the real biller, a real payment or a real account.
