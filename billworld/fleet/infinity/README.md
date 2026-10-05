# Billworld Fleet × WebArena-Infinity

This directory connects Fleet's generated tasks to the pinned WebArena-Infinity runner, the same way `billworld/infinity/` connects the hand-built slices. It adds no files to `billworld/infinity/` or to the upstream checkout. It uses the lifecycle hook (`harness.py` + `AgentRunner.reset_for_task`) that `billworld/infinity/bootstrap.py` already installs there.

| File | Role |
|---|---|
| `export.mjs` | Builds Infinity suites from `tasks.mjs` `generateTasks` for a cohort you choose: public suites plus one private grading file. |
| `control.mjs` | Task-bound episode service. It creates episodes per exported task, grades the stored predicates and the final answer, and keeps the first finish record. |
| `worker.mjs` | One Fleet server per Infinity worker port, with `openWorld:false`, plus the private control service. It writes a descriptor (mode 0600) for the harness. |
| `app/server.py`, `app/harness.py`, `app/verify.py` | The Infinity app contract. `server.py` starts the worker. `harness.py` owns prepare, run, finish and `result.json`. |
| `install.py` | Writes a self-contained app directory (default `build/app`) with the suites and paths. It checks the upstream hook. |
| `reference.mjs` | Scripted HTTP reference that uses only the public site and the mailbox. Not an agent. It also has `noop` and `wrong` modes for negative checks. |
| `run-reference.mjs` | Node-only adapter check: control service, reference, then `/finish`. Needs no Python. |
| `smoke.py` | Runs the same reference through Infinity's own `tasks.run_task` and the Fleet harness, with lifecycle and grader-binding checks. |
| `report.mjs` | Summarizes `result.json` files by split, evidence cohort, split axis, template and task type. Cohorts are never pooled. |

## Export

```bash
node billworld/fleet/infinity/export.mjs            # default benchmark split -> billworld/fleet/infinity/build/
node billworld/fleet/infinity/export.mjs --templates smarthub,paymentus --slugs pay-bank,mfa-pay --evidence documented --per-stratum test=20
```

Outputs:
- `real-tasks.json`: the test split. Infinity loads it by default.
- `dev-tasks.json` and `train-tasks.json`: use `--task-suite dev-tasks|train-tasks`.
- `private-tasks.json` (mode 0600): seed, scenario, predicates, answer spec and a digest per task.
- `manifest.json`: counts and configuration, without predicates.

The default export (salt `fleet-infinity-v1`, Fleet `fleet-0.2.0`, catalog of 2026-10-05) has 603 test, 244 dev and 509 train tasks. Test covers all 26 templates.

**Splits.** These follow the plan's leakage rules:
- **Family axis:** four portal families are held out, chosen by salted hash. Currently invoice-portal, mychart, streaming and property-tax. They appear only in test.
- **Tenant axis:** every other biller goes to train (70%), dev (10%) or test (20%) by a hash of its tenant group. The group is the parent company when the catalog records one, otherwise the biller itself. Sibling brands therefore never straddle splits.
- **Seed axis:** each task has its own fixed seed, which sets the persona, balances, account numbers and mailbox password.

**Stratification.** For each split, at most N tasks are drawn per (template, evidence cohort). The defaults are test=8, dev=4 and train=8. The draw is round-robin over task types and prefers distinct billers.

**Evidence cohorts.** Each task's `evidence` label maps to one of:
- `documented` (`documented_*`)
- `observed` (`observed_*`, from research captures)
- `inferred` (`inferred_*`)
- `synthetic`
- `limitation` (offline, roster, informational and similar)

Score each cohort separately.

**Filters:**
- `--templates`, `--slugs`, `--evidence`, `--billers` and `--splits` select a cohort.
- `--salt` resamples the tasks.
- `--holdout-families n` sets how many families are held out.
- `--include-infeasible` keeps tasks on the known-infeasible list (see Limits).

**Public vs private.** Public records hold `id`, `difficulty` (easy/medium/hard by task type), `instruction` and `verify` plus descriptive metadata: `fleet_task_id`, `template`, `evidence_cohort`, `split`, `split_axis` and `task_type`. Predicates, expected answers, scenarios and seeds exist only in `private-tasks.json`.

**The instruction** is the Fleet intent plus the permitted credentials:
- The persona name and email.
- The portal password. It is omitted for reset, guest, help and offline tasks, where knowing it would skip the step under test.
- The mailbox location (`/mail` on the same site) and the per-task mailbox password.
- What the final message must state.

## Adapter lifecycle

1. Infinity starts `server.py --port P` for each worker. This launches `worker.mjs`, which runs the Fleet public server on P (closed world: only `/enter/<ep>/<token>` links start an episode) and the private control service on an ephemeral 127.0.0.1 port. The worker writes `.runtime/worker-P.json` (mode 0600, token never printed).
2. `harness.prepare` sends `POST /episodes {taskId, trial}`. The worker regenerates the task from the current catalog and checks it against the export digest, which covers the intent, template, kind, predicates, answer and scenario. On a mismatch it refuses with `task_drift`, and the fix is to re-export. It then creates the seeded episode, pins the mailbox password, seeds the ledger and stores the binding: predicates, answer spec, digest, `exportId`, `FLEET_REVISION`, grader version and deadline. The agent gets only the start URL (the entry link) and the instruction.
3. The agent runs in a fresh browser (`reset_for_task(start_url)`), under the task's 600 s budget.
4. `harness.verify_run` sends `POST /finish {episodeId, answer: <agent's final message>, metadata}`. If the final message is JSON with an `"answer"` string, that field is used. The worker records the answer with `world.submitAnswer` and grades only the stored predicates. A run succeeds only if every predicate passes, termination is `completed` and the deadline was met. `stateSuccess` is reported separately. The first record is final: a repeated `/finish` returns it with `replay:true`, and the engine refuses further actions on a finished episode.
5. `result.json` adds `fleet_task_id`, `template`, `task_type`, `evidence_cohort`, `split`, `split_axis`, `termination`, `failure_reasons`, per-predicate results, `export_id`, `fleet_revision` and `grader_version`. An episode left unfinished by a crash is sealed as `environment_error` at the next `prepare` on that worker.

## Run an LLM agent through Infinity's runner

```bash
npm ci                                                   # repo root
python3 billworld/infinity/bootstrap.py                  # once: pinned checkout + lifecycle hook (Codex-owned)
node billworld/fleet/infinity/export.mjs                 # suites + private grading file
python3 billworld/fleet/infinity/install.py              # -> billworld/fleet/infinity/build/app
cd .upstream/webarena-infinity && uv sync --frozen && uv run python -m playwright install chromium
BILLWORLD_RUN_KIND=agent BILLWORLD_AGENT_LABEL=my-agent-v1 BILLWORLD_MODEL_ID=<resolved model id> \
uv run python evaluation/run_eval_parallel.py --web-app ../../billworld/fleet/infinity/build/app \
  --model gpt --workers 2 --base-port 8101 --max-steps 50 [--task-suite dev-tasks] [--difficulty hard] [--task-id fleet-pay-bank-…]
node ../../billworld/fleet/infinity/report.mjs ../../billworld/fleet/infinity/build/app/results
```

Before running:
- Configure the provider key that `--model` needs.
- Reserve the ports first: upstream kills listeners on its chosen ports.
- Expect each worker to load the 59,477-biller catalog in about 2–4 s. Upstream's `wait_for_server` allows 10 s, so use few workers on a loaded host.

Publish first-attempt results per evidence cohort and split from `report.mjs`. Infinity's best-of-N HTML report is diagnostic only. Only the browser-only access mode exists for Fleet; the mail-connector track (`mail-mcp.mjs`) cannot attach to the fleet mailbox yet.

## Validate without a model

```bash
node billworld/fleet/infinity/run-reference.mjs [--suite real-tasks|dev-tasks|train-tasks] [--per-template 1000] [--negatives all]
.upstream/smoke-venv/bin/python billworld/fleet/infinity/smoke.py --artifacts-dir /abs/empty/dir --per-template 3
node --test billworld/fleet/tests/infinity-export.test.mjs
```

**Results on export `17a50c0fd2f6ec0e`:**
- `run-reference`, every exported task: test 603/603, dev 244/244 and train 509/509 pass. All 1,569 no-op and wrong-answer attempts fail.
- `smoke.py` through upstream `run_task`: 78/78 reference tasks pass, covering 26 templates and 24 task types (25 documented, 25 observed, 25 inferred, 3 limitation; 12 on the family axis, 66 on the tenant axis), and 92/92 negatives are rejected. The lifecycle checks behave as intended:
  - an agent crash records `agent_error`;
  - a browser-setup crash records `environment_error`;
  - a timeout, a cancellation and a missed deadline each record their own termination;
  - caller-sent predicates are ignored;
  - a repeated `/finish` returns the first record;
  - an unknown task id is rejected;
  - the public port exposes no control routes.

## Limits

- **The reference is HTTP-level, not a browser.** It proves each task is solvable through the public site and that grading is correct. It does not prove the pages work with a browser agent; Fleet's Puppeteer suite (`tests/browser.mjs`) covers that. Its privileged knowledge is the task type and the template route table.
- **Answer grading is lenient.** The engine's answer grader accepts a final message if any number in it matches. A message listing several amounts, dates or phone numbers can pass `amount_due` or `phone` tasks. This is reported to the engine owner.
- **One task is excluded as infeasible.** `KNOWN_INFEASIBLE` drops `autopay-switch-to-card` on rent-portal and loan-servicer, whose AutoPay forms are bank-only, until tasks.mjs or those templates are fixed.
- **Exports are snapshots.** A catalog or generator change invalidates the affected tasks: the worker logs the number of drifted tasks and `/episodes` refuses them. Re-export after Fleet changes. Results from different `export_id`s must not be pooled.
- **Some features are not available yet:**
  - Only the browser-only track is supported; the email-connector track is not.
  - Episodes have no clock triggers, so tasks cannot test session expiry during an agent run.
  - There are no Google login tasks.
  - Only local workers are supported.
  - This is not a process or filesystem sandbox. The agent must not be able to read `build/private-tasks.json`, `.runtime/` or this repository.
- **The tenant split is coarse.** Sibling grouping uses only `parent_company`. Billers that share a portal host but have no recorded parent fall into different groups.
