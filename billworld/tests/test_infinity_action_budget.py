import ast
import asyncio
import importlib.util
import json
from pathlib import Path
import tempfile
import textwrap
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

ROOT=Path(__file__).resolve().parents[2]


def native_method(file, class_name, method):
    source=(ROOT/'.upstream/webarena-infinity/evaluation'/file).read_text()
    cls=next(n for n in ast.parse(source).body if isinstance(n,ast.ClassDef) and n.name==class_name)
    node=next(n for n in cls.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name==method)
    namespace={'asyncio':asyncio}
    exec(compile(textwrap.dedent(ast.get_source_segment(source,node)),file,'exec'),namespace)
    return namespace[method]


class ActionBudgetTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        path=ROOT/'.upstream/webarena-infinity/apps/billworld/harness.py'
        if not path.exists():self.skipTest('Bootstrap the pinned Infinity overlay first')
        spec=importlib.util.spec_from_file_location('budget_test_harness',path);self.h=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.h)
        self.prepared={'episode_id':'fixture','trial_metadata':{'kind':'agent'}}

    def runner(self,unit):
        r=SimpleNamespace(action_budget_unit=unit)
        r.configure_action_budget=lambda consume:setattr(r,'_billworld_action_meter',consume)
        return r

    def admin(self,limit=2):
        self.calls=[];self.used=0
        def call(url,route,data):
            self.calls.append((route,data))
            if route=='actions/start':return {'used':0,'limit':limit}
            self.used+=1;return {'allowed':self.used<=limit}
        return call

    async def test_browser_registry_counts_each_dispatched_action_and_stops_before_side_effect(self):
        r=self.runner('browser_tool_invocation');original=AsyncMock(return_value='done');tools=SimpleNamespace(registry=SimpleNamespace(execute_action=original))
        with patch.object(self.h,'admin',side_effect=self.admin()):
            self.h.install_action_budget('http://local',self.prepared,r)
            native_method('agents.py','BrowserUseAgent','_meter_task_tools')(r,tools)
            await tools.registry.execute_action('click',params={});await tools.registry.execute_action('gmail_read_message',params={})
            with self.assertRaises(self.h.ActionBudgetExceeded):await tools.registry.execute_action('click',params={})
        self.assertEqual(original.await_count,2);self.assertEqual([d['name'] for route,d in self.calls if route=='actions/consume'],['click','gmail_read_message','click'])

    async def test_vision_dispatch_stops_before_mouse_call_and_missing_meter_fails_closed(self):
        r=self.runner('vision_action');r._page=SimpleNamespace(mouse=SimpleNamespace(click=AsyncMock()))
        execute=native_method('vision_agents.py','VisionAgentBase','execute_action')
        with patch.object(self.h,'admin',side_effect=self.admin(limit=1)),patch('asyncio.sleep',new=AsyncMock()):
            self.h.install_action_budget('http://local',self.prepared,r);await execute(r,{'type':'click','x':1,'y':2})
            with self.assertRaises(self.h.ActionBudgetExceeded):await execute(r,{'type':'click','x':3,'y':4})
        self.assertEqual(r._page.mouse.click.await_count,1)
        with patch.object(self.h,'admin',side_effect=OSError('unavailable')):
            with self.assertRaises(self.h.ActionMeterUnavailable):r._billworld_action_meter('click')
        for response in [None,{}, {'allowed':'true'}]:
            with patch.object(self.h,'admin',return_value=response):
                with self.assertRaises(self.h.ActionMeterUnavailable):r._billworld_action_meter('click')

    async def test_unmetered_agent_is_rejected_and_reference_remains_explicitly_unmetered(self):
        with patch.object(self.h,'admin') as admin:
            with self.assertRaisesRegex(RuntimeError,'cannot enforce'):self.h.install_action_budget('http://local',self.prepared,object())
            self.h.install_action_budget('http://local',{'trial_metadata':{'kind':'reference_script'}},object());admin.assert_not_called()

    async def test_native_browser_use_cannot_swallow_the_budget_stop_as_an_ordinary_tool_error(self):
        try:
            from browser_use import Tools
        except ImportError:self.skipTest('Run this test in the native BrowserUse review environment')
        tools=Tools();effects=[]
        @tools.action('Synthetic action-budget probe')
        async def budget_probe(value:int):
            effects.append(value);return 'ok'
        action=tools.registry.create_action_model()(budget_probe={'value':1})
        r=self.runner('browser_tool_invocation')
        with patch.object(self.h,'admin',side_effect=self.admin(limit=1)):
            self.h.install_action_budget('http://local',self.prepared,r);native_method('agents.py','BrowserUseAgent','_meter_task_tools')(r,tools)
            await tools.act(action,browser_session=None)
            with self.assertRaises(self.h.ActionBudgetExceeded):await tools.act(action,browser_session=None)
        self.assertEqual(effects,[1])


if __name__=='__main__':unittest.main()
