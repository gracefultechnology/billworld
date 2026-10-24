"""Install a pinned upstream checkout and a small, repeatable billing overlay."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess

REVISION = '1ca77813bf8d8e4011aa3fb1f740f70d78bd522d'
ROOT = Path(__file__).resolve().parents[2]
OVERLAY = Path(__file__).resolve().parent

def replace_once(path, old, new, installed_marker=None):
    text = path.read_text()
    if new in text or installed_marker and installed_marker in text:
        return
    if text.count(old) != 1:
        raise RuntimeError(f'Upstream patch context changed: {path}')
    path.write_text(text.replace(old, new, 1))

def install(checkout):
    if not checkout.exists():
        checkout.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['git', 'init', str(checkout)], check=True)
        subprocess.run(['git', '-C', str(checkout), 'remote', 'add', 'origin', 'https://github.com/web-arena-x/webarena-infinity.git'], check=True)
        subprocess.run(['git', '-C', str(checkout), 'fetch', '--depth', '1', 'origin', REVISION], check=True)
        subprocess.run(['git', '-C', str(checkout), 'checkout', '--detach', 'FETCH_HEAD'], check=True)
    current = subprocess.check_output(['git', '-C', str(checkout), 'rev-parse', 'HEAD'], text=True).strip()
    if current != REVISION:
        raise RuntimeError(f'Expected upstream {REVISION}, found {current}; use a separate checkout at the pinned revision')
    for app_name, construction in [('billworld', False), ('billworld-construction', True)]:
        app = checkout / 'apps' / app_name
        app.mkdir(exist_ok=True)
        for name in ('server.py', 'harness.py', 'verify.py', 'tasks.json'):
            shutil.copy2(OVERLAY / 'app' / name, app / name)
        (app / 'billworld-root.json').write_text(json.dumps({'root': str(ROOT), 'construction': construction}))
        definitions = []
        task_inventory = [] if construction else [('task_m1', 'juneau-pay.json', 'medium'), ('task_m2', 'juneau-autopay.json', 'medium'), ('task_h1', 'juneau-schedule.json', 'hard'), ('task_h2', 'spotify-update-card.json', 'hard'), ('task_h3', 'juneau-pay-email-mfa.json', 'hard'), ('task_h4', 'juneau-recovery.json', 'hard'), ('task_m3', 'avec-pay.json', 'medium'), ('task_m4', 'homer-pay.json', 'medium'), ('task_h5', 'homer-register-pay.json', 'hard'), ('task_m5', 'duluth-pay.json', 'medium'), ('task_h6', 'duluth-register-pay.json', 'hard'), ('task_h7', 'duluth-google-pay.json', 'hard'), ('task_h8', 'duluth-wallet.json', 'hard'), ('task_m6','gvp-pay.json','medium'), ('task_h9','gvp-register-pay.json','hard'), ('task_m7','gvp-autopay.json','medium'), ('task_m8','swepsonville-pay.json','medium'), ('task_h10','swepsonville-register.json','hard'), ('task_h11','swepsonville-recovery.json','hard'), ('task_m9','swepsonville-bankdraft.json','medium'), ('task_m10','swepsonville-deposit.json','medium'), ('task_m11','wvu-guest-pay.json','medium'), ('task_h12','wvu-signed-pay.json','hard'), ('task_h13','wvu-mfa-pay.json','hard'), ('task_h14','wvu-activation-pay.json','hard'), ('task_h15','wvu-recovery.json','hard'), ('task_m12','western-dental-full.json','medium'), ('task_h16','western-dental-partial.json','hard'), ('task_h17','western-dental-overpay.json','hard'), ('task_h18','western-dental-recurring-plan.json','hard'), ('task_h19','western-dental-future-plan.json','hard'),('task_md1','malden-guest-pay.json','medium'),('task_md2','malden-signed-card-pay.json','medium'),('task_md3','malden-register-ebill.json','hard'),('task_md4','malden-recovery.json','hard'),('task_md5','malden-schedule.json','hard'),('task_md6','malden-autopay-enroll.json','medium'),('task_md7','malden-autopay-change.json','medium'),('task_md8','malden-autopay-cancel.json','medium'),('task_md9','malden-statement.json','medium'),('task_inf1','inframark-login.json','medium'),('task_inf2','inframark-guest-bank-payment.json','medium'),('task_inf3','inframark-guest-card-payment.json','medium'),('task_inf4','inframark-registration.json','hard'),('task_inf5','inframark-recovery.json','hard'),('task_inf6','inframark-saved-bank-payment.json','medium'),('task_inf7','inframark-saved-card-payment.json','medium'),('task_inf8','inframark-history.json','medium'),('task_inf9','inframark-statement.json','medium'),('task_inf10','inframark-paperless.json','medium'),('task_inf11','inframark-wallet.json','hard'),('task_inf12','inframark-autopay-enable.json','medium'),('task_inf13','inframark-autopay-change.json','medium'),('task_inf14','inframark-autopay-cancel.json','medium'),('task_inf15','inframark-schedule.json','medium'),('task_inf16','inframark-scheduled-edit.json','hard'),('task_inf17','inframark-scheduled-cancel.json','medium'),('task_onswc1','onswc-login.json','medium'),('task_onswc2','onswc-registration.json','hard'),('task_onswc3','onswc-recovery.json','hard'),('task_onswc4','onswc-saved-bank-payment.json','medium'),('task_onswc5','onswc-saved-card-payment.json','medium'),('task_onswc6','onswc-history.json','medium'),('task_onswc7','onswc-statement.json','medium'),('task_onswc8','onswc-paperless.json','medium'),('task_onswc9','onswc-wallet.json','hard'),('task_onswc10','onswc-autopay-enable.json','medium'),('task_onswc11','onswc-autopay-change.json','medium'),('task_onswc12','onswc-autopay-cancel.json','medium'),('task_onswc13','onswc-ach-enroll.json','hard'),('task_onswc14','onswc-ach-change.json','hard'),('task_onswc15','onswc-ach-stop.json','medium'),('task_onswc16','onswc-schedule.json','medium'),('task_onswc17','onswc-scheduled-edit.json','hard'),('task_onswc18','onswc-scheduled-cancel.json','medium'), ('task_bat1','batavia-login.json','medium'), ('task_bat2','batavia-recovery.json','hard'), ('task_bat3','batavia-registration.json','hard'), ('task_bat4','batavia-payment.json','medium'), ('task_bat5','batavia-card-payment.json','medium'), ('task_bat6','batavia-payment-history.json','medium'), ('task_bat7','batavia-notifications.json','medium'), ('task_bat8','batavia-statement.json','medium'), ('task_bat9','batavia-wallet.json','hard'), ('task_bat10','batavia-autopay-enable.json','medium'), ('task_bat11','batavia-autopay-cancel.json','medium'), ('task_bat12','batavia-autopay-change.json','medium'), ('task_bat13','batavia-profile.json','medium'), ('task_bat14','batavia-password.json','medium'), ('task_bat15','batavia-schedule.json','hard'), ('task_bat16','batavia-schedule-edit.json','medium'), ('task_bat17','batavia-schedule-cancel.json','medium'), ('task_bat18','batavia-multi-payment.json','hard'), ('task_gmg1','gmg-login.json','medium'), ('task_gmg2','gmg-recovery.json','hard'), ('task_gmg3','gmg-registration.json','hard'), ('task_gmg4','gmg-guest-bank-payment.json','medium'), ('task_gmg5','gmg-guest-card-payment.json','medium'), ('task_gmg6','gmg-history.json','medium'), ('task_gmg7','gmg-wallet.json','hard'), ('task_gmg8','gmg-autopay-enable.json','medium'), ('task_gmg9','gmg-autopay-change.json','medium'), ('task_gmg10','gmg-autopay-cancel.json','medium'), ('task_gmg11','gmg-saved-bank-payment.json','medium'), ('task_gmg12','gmg-saved-card-payment.json','medium'), ('task_gmg13','gmg-paperless.json','medium'), ('task_gmg14','gmg-ebill-paper.json','medium'), ('task_gmg15','gmg-statement.json','medium'), ('task_gmg16','gmg-mailing-address.json','medium'), ('task_gmg17','gmg-link-account.json','hard')]
        if not construction:  # Lockwood ePayUB/CUSI released slice (see infinity/reference-lockwood.mjs)
            task_inventory = task_inventory + [('task_lw1', 'lockwood-login.json', 'medium'), ('task_lw2', 'lockwood-recovery.json', 'hard'), ('task_lw3', 'lockwood-payment.json', 'medium'), ('task_lw4', 'lockwood-registration.json', 'hard'), ('task_lw5', 'lockwood-echeck.json', 'hard'), ('task_lw6', 'lockwood-schedule-draft.json', 'medium'), ('task_lw7', 'lockwood-manage-drafts.json', 'hard'), ('task_lw8', 'lockwood-autopay-enroll.json', 'medium'), ('task_lw9', 'lockwood-autopay-change.json', 'medium'), ('task_lw10', 'lockwood-autopay-cancel.json', 'medium'), ('task_lw11', 'lockwood-paperless.json', 'medium')]
        if not construction:  # City of Tuscaloosa released slice (see infinity/tuscaloosa-reference.mjs)
            task_inventory = task_inventory + [('task_tus1', 'tuscaloosa-pay.json', 'medium'), ('task_tus2', 'tuscaloosa-guest-pay.json', 'medium'), ('task_tus3', 'tuscaloosa-register-autopay.json', 'hard'), ('task_tus4', 'tuscaloosa-recovery.json', 'hard'), ('task_tus5', 'tuscaloosa-schedule.json', 'hard'), ('task_tus6', 'tuscaloosa-autopay.json', 'medium'), ('task_tus7', 'tuscaloosa-ebill.json', 'medium'), ('task_tus8', 'tuscaloosa-statement.json', 'medium')]
        if not construction:  # Charlotte County Utilities released slice (see infinity/reference-charlotte.mjs)
            task_inventory = task_inventory + [('task_ccu1', 'charlotte-quickpay-card.json', 'medium'), ('task_ccu2', 'charlotte-register-pay.json', 'hard'), ('task_ccu3', 'charlotte-recovery.json', 'hard'), ('task_ccu4', 'charlotte-signed-pay.json', 'medium'), ('task_ccu5', 'charlotte-schedule.json', 'medium'), ('task_ccu6', 'charlotte-scheduled-update.json', 'hard'), ('task_ccu7', 'charlotte-scheduled-cancel.json', 'medium'), ('task_ccu8', 'charlotte-autopay-enroll.json', 'medium'), ('task_ccu9', 'charlotte-autopay-change.json', 'medium'), ('task_ccu10', 'charlotte-autopay-cancel.json', 'medium'), ('task_ccu11', 'charlotte-paperless.json', 'medium'), ('task_ccu12', 'charlotte-statement.json', 'medium'), ('task_ccu13', 'charlotte-history.json', 'medium')]
        for task_id, file, difficulty in task_inventory:
            task = json.loads((ROOT / 'billworld/tasks' / file).read_text())
            credential = 'Persona: alex@billworld.test. Portal password: Billworld-2026!. Mailbox password: Mailbox-2026!.'
            if file in ('juneau-recovery.json','swepsonville-recovery.json'):
                credential = 'Persona: alex@billworld.test. Mailbox password: Mailbox-2026!. The old portal password is unavailable.'
            if file.startswith('inframark-'):
                credential='Synthetic Inframark persona: Alex Morgan; username alex.inframark, password Inframark-2026!. Guest security code INF1048, service ZIP 77001. Mailbox alex@billworld.test / Mailbox-2026!. Private continuations are simulated.'
            if file.startswith('onswc-'):
                credential='Synthetic ONSWC persona: Alex Morgan; username alex.onswc; password ONSWC-2026!. Mailbox alex@billworld.test / Mailbox-2026!. Private screens are simulated; processing-fee amounts, AutoPay timing and scheduling are synthetic.'
            if file=='onswc-registration.json':
                credential='Synthetic persona: security code ONS1048, email alex@billworld.test, mailbox password Mailbox-2026!. Choose alex.new / Registered-2026! after email verification.'
            if file.startswith('gmg-'):
                credential='Synthetic persona: Alex Morgan; username alex.morgan; portal password Billworld-2026!. Mailbox alex@billworld.test / Mailbox-2026!. Private account layout and balances are simulated.'
            if file.startswith('gmg-guest-'):
                credential='Guest payment. Use the synthetic instrument and billing details in the task; no portal login is required.'
            if file=='inframark-registration.json':
                credential='Synthetic persona: security code INF1048; email alex@billworld.test; mailbox password Mailbox-2026!. Choose username alex.new and password Registered-2026! after email verification.'
            if file in ('gmg-recovery.json','inframark-recovery.json','onswc-recovery.json'):
                credential='Construction-only persona: email alex@billworld.test; mailbox password Mailbox-2026!. The old username and portal password are unavailable. Recover them through the requested mock email flow.'
            if file=='inframark-recovery.json':
                credential='Synthetic persona: email alex@billworld.test; mailbox password Mailbox-2026!. The old username and portal password are unavailable. Recover them through the requested mock email flow.'
            if file=='onswc-recovery.json':
                credential='Synthetic persona: email alex@billworld.test; mailbox password Mailbox-2026!. The old username and portal password are unavailable. Recover them through the requested mock email flow.'
            if file=='gmg-registration.json':
                credential='Synthetic persona: security code GMG1048; email alex@billworld.test; mailbox password Mailbox-2026!. Choose username alex.new and password Registered-2026! after email verification.'
            if file=='gmg-recovery.json':
                credential='Synthetic persona: email alex@billworld.test; mailbox password Mailbox-2026!. The old username and portal password are unavailable. Recover them through the requested mock email flow.'
            if file == 'avec-pay.json':
                credential += ' Account number: 1001048. Last name: Morgan. Checking routing: 021000021; bank account: 000001048.'
            if file.startswith('homer-'):
                credential += ' Account number: 1001048. Last name: Morgan. Checking routing: 021000021; bank account: 000001048. Personal profile: Alex Morgan; phone 9075550148; address 1048 Harbor Way, Homer, AK 99603. Use Billworld-2026! as the registration password where needed.'
            if file.startswith('duluth-'):
                credential += ' Account number: 100001048-001. Exact name on bill: Alex Morgan. Checking routing: 021000021; bank account: 000001048. Google password: Google-2026!. Use Billworld-2026! as the registration password where needed.'
            if file.startswith('gvp-'):
                credential += ' Account number: 1001048. Last name: Morgan. Current bill: $84.32. Checking routing: 021000021; account: 000001048.'
            if file.startswith('wvu-'):
                credential += ' MyWVUChart username: alex.morgan. Guarantor account: 1001048. Visit account: 100104801. Guarantor surname: Morgan. Checking routing: 021000021; bank account: 000001048.'
            if file.startswith('swepsonville-'):
                credential += ' Account number: 1001048. CID: C1048. Name: Alex Morgan. Checking routing: 021000021; bank account: 000001048.'
            if file=='wvu-recovery.json':
                credential='Persona: alex@billworld.test. Mailbox password: Mailbox-2026!. Previously enrolled recovery email: alex@billworld.test. Old portal password unavailable. Set Restored-2026!.'
            if file=='wvu-activation-pay.json':
                credential='Persona: alex@billworld.test. Mailbox password: Mailbox-2026!. Get the activation code from the inbox. Choose username alex.morgan and password Billworld-New-2026!. Visit account: 100104801. Checking routing: 021000021; bank account: 000001048.'
            if file.startswith('western-dental-'):
                credential='Synthetic persona: Alex Morgan. Account number: 123001048; ZIP: 56007; date of birth: 04/12/1985. Checking routing: 021000021; bank account and confirmation: 000001048. Visa: 4242424242424242, expiry 12/29, CVV 123. Mailbox: alex@billworld.test, password Mailbox-2026!.'
            if file.startswith('batavia-'):
                credential = 'Synthetic City of Batavia persona: Alex Morgan; portal email alex@billworld.test'+('' if file in ('batavia-recovery.json','batavia-registration.json') else '; portal password Billworld-2026!')+'. Mailbox password: Mailbox-2026!. Private Paymentus screens are reconstructed; fees and settlement are fixtures.'
            if file.startswith('lockwood-'):
                credential = 'Synthetic City of Lockwood persona: Alex Morgan; username alex.morgan. Mock Gmail at /mail: alex@billworld.test, mailbox password Mailbox-2026!. Signed-in ePayUB screens, fees and timing are simulated.'
            if file=='lockwood-recovery.json':
                credential='Synthetic City of Lockwood persona: Alex Morgan; username alex.morgan. Mock Gmail at /mail: alex@billworld.test, mailbox password Mailbox-2026!. The old portal password is unavailable.'
            if file=='lockwood-registration.json':
                credential='Synthetic City of Lockwood persona: Alex Morgan; utility account 1001048 and associated phone 4175550148. Create username alex.new, email alex@billworld.test and password Registered-2026!. No Google sign-in is observed.'
            answer = 'Return only a JSON object with '
            if file in ('batavia-payment.json','batavia-payment-history.json'):
                credential+=' Portal password: Billworld-2026!. Checking routing: 021000021; bank account and confirmation: 000001048.'
            if file == 'spotify-update-card.json':
                credential += ' Google password: Google-2026!. Replacement card: 5555555555554444, expiry 12/29, CVV 123, name Alex Morgan.'
                answer += '"billingDate" in YYYY-MM-DD format.'
            elif file in ('lockwood-payment.json','batavia-payment.json','batavia-card-payment.json','batavia-payment-history.json','batavia-schedule.json','batavia-multi-payment.json') or file.startswith('western-dental-') or file in ('juneau-pay.json', 'juneau-pay-email-mfa.json', 'avec-pay.json', 'homer-pay.json', 'homer-register-pay.json', 'duluth-pay.json', 'duluth-register-pay.json', 'duluth-google-pay.json', 'gvp-pay.json', 'gvp-register-pay.json', 'swepsonville-pay.json','swepsonville-bankdraft.json','swepsonville-deposit.json','wvu-guest-pay.json','wvu-signed-pay.json','wvu-mfa-pay.json','wvu-activation-pay.json'):
                answer += '"confirmation" containing the displayed confirmation number.'
            elif file in ('juneau-schedule.json','inframark-schedule.json','inframark-scheduled-edit.json'):
                answer += '"scheduledDate" in YYYY-MM-DD format.'
            elif file in ('gmg-history.json','inframark-history.json'):
                answer += '"postedBalanceCents", "pendingPaymentCents", and "remainingBalanceCents", all integer cents read from the portal.'
            elif file in ('batavia-statement.json','inframark-statement.json','gmg-statement.json'):
                answer += '"statementFilename" containing the filename offered by the portal.'
            elif file in ('onswc-saved-bank-payment.json','onswc-saved-card-payment.json'):
                answer += '"confirmation" containing the displayed confirmation number.'
            elif file in ('onswc-schedule.json','onswc-scheduled-edit.json'):
                answer += '"scheduledDate" in YYYY-MM-DD format.'
            elif file == 'onswc-history.json':
                answer += '"postedBalanceCents", "pendingPaymentCents", and "remainingBalanceCents", all integer cents read from the portal.'
            elif file == 'onswc-statement.json':
                answer += '"statementFilename" containing the filename offered by the portal.'
            else:
                answer = 'Return an empty JSON object when done.'
            if file.startswith('charlotte-'):
                credential = 'Synthetic Charlotte County Utilities persona: Alex Morgan, email alex@billworld.test. Mock Gmail at /mail, mailbox password Mailbox-2026!.' + (' The old portal password is unavailable.' if file == 'charlotte-recovery.json' else '')
                answer = {'charlotte-schedule.json': 'Return only a JSON object with "scheduledDate" in YYYY-MM-DD format.', 'charlotte-scheduled-update.json': 'Return only a JSON object with "scheduledDate" in YYYY-MM-DD format.', 'charlotte-statement.json': 'Return only a JSON object with "statementFilename" containing the filename offered by the portal.', 'charlotte-quickpay-card.json': 'Return only a JSON object with "confirmation" containing the displayed confirmation number.', 'charlotte-register-pay.json': 'Return only a JSON object with "confirmation" containing the displayed confirmation number.', 'charlotte-signed-pay.json': 'Return only a JSON object with "confirmation" containing the displayed confirmation number.', 'charlotte-history.json': 'Return only a JSON object with "confirmation" containing the confirmation number shown in Payment History.'}.get(file, 'Return an empty JSON object when done.')
            if file.startswith('malden-'):
                credential = 'Synthetic City of Malden (Edmunds WIPP) persona: Alex Morgan, e-mail alex@billworld.test. Mock Gmail at /mail, mailbox password Mailbox-2026!.' + (' The old portal password is unavailable.' if file == 'malden-recovery.json' else '' if file in ('malden-register-ebill.json','malden-guest-pay.json') else ' Portal password: Billworld-2026!.')
                answer = {'malden-guest-pay.json': 'Return only a JSON object with "confirmation" containing the displayed confirmation number.', 'malden-signed-card-pay.json': 'Return only a JSON object with "confirmation" containing the displayed confirmation number.', 'malden-schedule.json': 'Return only a JSON object with "scheduledDate" in YYYY-MM-DD format.', 'malden-statement.json': 'Return only a JSON object with "billingDate" (the bill due date, YYYY-MM-DD) and "remainingBalanceCents" (the current balance due as integer cents).'}.get(file, 'Return an empty JSON object when done.')
            if file.startswith('lockwood-'):
                answer = {'lockwood-payment.json': 'Return only a JSON object with "confirmation" containing the displayed confirmation number.', 'lockwood-echeck.json': 'Return only a JSON object with "confirmation" containing the displayed confirmation number.', 'lockwood-schedule-draft.json': 'Return only a JSON object with "scheduledDate" in YYYY-MM-DD format.'}.get(file, 'Return an empty JSON object when done.')
            if file.startswith('tuscaloosa-'):
                credential = 'Synthetic City of Tuscaloosa water persona: Alex Morgan, email alex@billworld.test. Mock Gmail at /mail, mailbox password Mailbox-2026!.' + (' The old portal password is unavailable.' if file == 'tuscaloosa-recovery.json' else ' No portal profile exists yet.' if file == 'tuscaloosa-register-autopay.json' else '' if file in ('tuscaloosa-guest-pay.json', 'tuscaloosa-ebill.json') else ' Portal password: Billworld-2026!.')
                answer = {'tuscaloosa-pay.json': 'Return only a JSON object with "confirmation" containing the displayed confirmation number.', 'tuscaloosa-guest-pay.json': 'Return only a JSON object with "confirmation" containing the displayed confirmation number.', 'tuscaloosa-schedule.json': 'Return only a JSON object with "scheduledDate" in YYYY-MM-DD format.', 'tuscaloosa-statement.json': 'Return only a JSON object with "statementFilename" containing the downloaded file name.'}.get(file, 'Return an empty JSON object when done.')
            definitions.append({'id': task_id, 'difficulty': difficulty, 'instruction': task['prompt'] + ' ' + credential + ' ' + answer, 'verify': 'verify.py', 'billworld_task_id': task['id'], 'evidence_cohort': task['evidence_cohort'], 'site_cohort': 'construction' if construction else 'released'})
        (app / 'real-tasks.json').write_text(json.dumps(definitions, indent=2) + '\n')
    app = checkout / 'apps/billworld'
    # Only Billworld opts into these hooks; existing apps retain their reset/verifier behavior.
    replace_once(checkout / 'evaluation/tasks.py', '    # 1. Reset\n    reset_state(server_url)', '''    # Optional private lifecycle adapter (Billworld). Existing apps are unchanged.
    hook_path = Path(web_app_dir) / "harness.py"
    hooks = None
    agent_url = server_url
    if hook_path.exists():
        spec = importlib.util.spec_from_file_location("app_harness", hook_path)
        hooks = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(hooks)
        prepared = hooks.prepare(server_url, task)
        agent_url = prepared["start_url"]
        if not hasattr(agent_runner, "reset_for_task"):
            raise RuntimeError("Billing tasks require fresh browser contexts")
        await agent_runner.reset_for_task(agent_url)
        if prepared.get("mcp_servers"):
            if not hasattr(agent_runner, "configure_tools"):
                raise RuntimeError("Connector track requires a tool-capable AgentRunner")
            await agent_runner.configure_tools(prepared["mcp_servers"])
    else:
        reset_state(server_url)''', installed_marker='    # Optional private lifecycle adapter (Billworld). Existing apps are unchanged.')
    replace_once(checkout / 'evaluation/tasks.py', '        server_url=server_url,\n        task_dir=task_dir,', '        server_url=agent_url,\n        task_dir=task_dir,')
    replace_once(checkout / 'evaluation/tasks.py', '        spec.loader.exec_module(hooks)\n        prepared = hooks.prepare(server_url, task)', '''        spec.loader.exec_module(hooks)
        if hasattr(hooks, "run_task"):
            return await hooks.run_task(server_url, task, agent_runner, task_dir)
        prepared = hooks.prepare(server_url, task)''')
    replace_once(checkout / 'evaluation/tasks.py', '        verify_fn = load_verifier(web_app_dir, task["verify"])\n        passed, verifier_message = verify_fn(server_url)', '''        if hooks:
            passed, verifier_message = hooks.verify_run(server_url, task, result)
        else:
            verify_fn = load_verifier(web_app_dir, task["verify"])
            passed, verifier_message = verify_fn(server_url)''')
    for file in ('agents.py', 'vision_agents.py'):
        replace_once(checkout / 'evaluation' / file, '    async def restart_session(self) -> None:\n', '''    async def reset_for_task(self, start_url: str) -> None:
        """Billing tasks start with a fresh browser and episode entry URL."""
        self._server_url = start_url
        await self.restart_session()

    async def restart_session(self) -> None:
''')
    replace_once(checkout / 'evaluation/agents.py', '    async def reset_for_task(self, start_url: str) -> None:\n', '''    async def configure_tools(self, servers) -> None:
        from browser_use import Tools
        from browser_use.mcp.client import MCPClient
        await self._disconnect_tools()
        self._task_tools = Tools()
        for settings in servers:
            client = MCPClient(server_name=settings["server_name"], command=settings["command"],
                               args=settings["args"], env=settings["env"])
            self._mcp_clients.append(client)
            try:
                await client.register_to_tools(self._task_tools, tool_filter=settings["tool_filter"])
            except Exception:
                await self._disconnect_tools()
                raise

    async def _disconnect_tools(self) -> None:
        for client in getattr(self, "_mcp_clients", []):
            await client.disconnect()
        self._mcp_clients = []
        self._task_tools = None

    async def reset_for_task(self, start_url: str) -> None:
''')
    replace_once(checkout / 'evaluation/agents.py', '            max_steps=self.max_steps,\n        )', '            max_steps=self.max_steps,\n            tools=getattr(self, "_task_tools", None),\n        )')
    replace_once(checkout / 'evaluation/agents.py', '            history = agent.history\n        elapsed = time.time() - t0', '            history = agent.history\n        finally:\n            await self._disconnect_tools()\n        elapsed = time.time() - t0', installed_marker='        finally:\n            await self._disconnect_tools()\n        elapsed = time.time() - t0')
    replace_once(checkout / 'evaluation/agents.py', '    async def teardown(self) -> None:\n        user_data_dir = None', '    async def teardown(self) -> None:\n        await self._disconnect_tools()\n        user_data_dir = None')
    replace_once(checkout / 'evaluation/agents.py', '        timed_out = False\n        t0 = time.time()', '        timed_out = False\n        cancelled = False\n        t0 = time.time()')
    replace_once(checkout / 'evaluation/agents.py', '            history = agent.history\n        finally:', '            history = agent.history\n        except asyncio.CancelledError:\n            cancelled = True\n            history = agent.history\n        finally:', installed_marker='        except asyncio.CancelledError:\n            cancelled = True\n            history = agent.history')
    replace_once(checkout / 'evaluation/agents.py', '        if timed_out:\n            raise asyncio.TimeoutError()', '        if cancelled:\n            raise asyncio.CancelledError()\n        if timed_out:\n            raise asyncio.TimeoutError()')
    replace_once(checkout / 'evaluation/vision_agents.py', '        timed_out = False\n        steps = 0', '        timed_out = False\n        cancelled = False\n        steps = 0')
    replace_once(checkout / 'evaluation/vision_agents.py', '            self._live_errors.append(f"Timeout after {self.timeout}s")\n\n        elapsed', '            self._live_errors.append(f"Timeout after {self.timeout}s")\n        except asyncio.CancelledError:\n            cancelled = True\n            steps = len(self._live_history)\n            self._live_errors.append("Cancelled by task lifecycle")\n\n        elapsed', installed_marker='            self._live_errors.append("Cancelled by task lifecycle")')
    replace_once(checkout / 'evaluation/vision_agents.py', '        if timed_out:\n            raise asyncio.TimeoutError()', '        if cancelled:\n            raise asyncio.CancelledError()\n        if timed_out:\n            raise asyncio.TimeoutError()')
    replace_once(checkout / 'evaluation/agents.py', '    # -- lifecycle -----------------------------------------------------------', '''    action_budget_unit = "browser_tool_invocation"

    def configure_action_budget(self, consume):
        self._billworld_action_meter = consume

    def _meter_task_tools(self, tools):
        consume = getattr(self, "_billworld_action_meter", None)
        if consume is None:
            return
        original = tools.registry.execute_action
        async def execute_action(action_name, *args, **kwargs):
            consume(action_name)
            return await original(action_name, *args, **kwargs)
        tools.registry.execute_action = execute_action

    # -- lifecycle -----------------------------------------------------------''')
    replace_once(checkout / 'evaluation/agents.py', '        timed_out = False\n        cancelled = False', '        self._meter_task_tools(agent.tools)\n        budget_error = None\n        timed_out = False\n        cancelled = False')
    replace_once(checkout / 'evaluation/agents.py', '        finally:\n            await self._disconnect_tools()\n        elapsed', '''        except BaseException as error:
            if not getattr(error, "billworld_action_stop", False):
                raise
            budget_error = error
            history = agent.history
        finally:
            await self._disconnect_tools()
        elapsed''')
    replace_once(checkout / 'evaluation/agents.py', '        if cancelled:\n            raise asyncio.CancelledError()', '        if budget_error is not None:\n            raise budget_error\n        if cancelled:\n            raise asyncio.CancelledError()')
    replace_once(checkout / 'evaluation/vision_agents.py', '    async def execute_action(self, action: dict) -> None:', '''    action_budget_unit = "vision_action"

    def configure_action_budget(self, consume):
        self._billworld_action_meter = consume

    async def execute_action(self, action: dict) -> None:''')
    replace_once(checkout / 'evaluation/vision_agents.py', '        kind = action.get("type", "")\n        page = self._page', '''        kind = action.get("type", "")
        consume = getattr(self, "_billworld_action_meter", None)
        if consume is not None:
            consume(kind or "unknown")
        page = self._page''')
    replace_once(checkout / 'evaluation/vision_agents.py', '        timed_out = False\n        cancelled = False\n        steps = 0', '        budget_error = None\n        timed_out = False\n        cancelled = False\n        steps = 0')
    replace_once(checkout / 'evaluation/vision_agents.py', '            self._live_errors.append("Cancelled by task lifecycle")\n\n        elapsed', '''            self._live_errors.append("Cancelled by task lifecycle")
        except BaseException as error:
            if not getattr(error, "billworld_action_stop", False):
                raise
            budget_error = error
            steps = len(self._live_history)
            self._live_errors.append("Stopped by private action meter")

        elapsed''')
    replace_once(checkout / 'evaluation/vision_agents.py', '        if cancelled:\n            raise asyncio.CancelledError()', '        if budget_error is not None:\n            raise budget_error\n        if cancelled:\n            raise asyncio.CancelledError()')
    print(f"Installed released and construction Billworld apps into {checkout / 'apps'}; upstream revision {REVISION}")
    return app

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkout', type=Path, default=ROOT / '.upstream/webarena-infinity')
    install(parser.parse_args().checkout.resolve())
