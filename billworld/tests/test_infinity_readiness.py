import io
import unittest
from unittest.mock import Mock, patch
from billworld.infinity.readiness import wait_ready


class ReadinessTests(unittest.IsolatedAsyncioTestCase):
    async def test_slow_environment_setup_can_pass_without_changing_episode_deadlines(self):
        elapsed=[0.0]
        process=Mock();process.poll.return_value=None
        async def pause(seconds):elapsed[0]+=seconds
        def request(url,timeout):
            self.assertEqual(url,'http://127.0.0.1:3100/api/state')
            self.assertLessEqual(timeout,1)
            if elapsed[0]<14:raise ConnectionRefusedError()
            return io.StringIO('{"ready":true}')
        with patch('billworld.infinity.readiness.time.monotonic',side_effect=lambda:elapsed[0]),patch('billworld.infinity.readiness.asyncio.sleep',side_effect=pause),patch('billworld.infinity.readiness.urlopen',side_effect=request):
            result=await wait_ready('http://127.0.0.1:3100',process)
        self.assertGreaterEqual(result,14);self.assertLess(result,15)

    async def test_connection_time_is_part_of_elapsed_setup_limit(self):
        elapsed=[0.0];process=Mock();process.poll.return_value=None
        async def pause(seconds):elapsed[0]+=seconds
        def request(url,timeout):elapsed[0]+=timeout;raise TimeoutError()
        with patch('billworld.infinity.readiness.time.monotonic',side_effect=lambda:elapsed[0]),patch('billworld.infinity.readiness.asyncio.sleep',side_effect=pause),patch('billworld.infinity.readiness.urlopen',side_effect=request):
            with self.assertRaisesRegex(RuntimeError,'recovery timed out after 3 seconds'):await wait_ready('http://local',process,'recovery',3)
        self.assertAlmostEqual(elapsed[0],3)

    async def test_dead_worker_or_wrong_readiness_response_is_not_ready(self):
        process=Mock();process.poll.return_value=1;process.stderr=io.BytesIO(b'Worker failed')
        with patch('billworld.infinity.readiness.urlopen') as request:
            with self.assertRaisesRegex(RuntimeError,'Worker failed'):await wait_ready('http://local',process)
            request.assert_not_called()
        process.poll.return_value=None
        with patch('billworld.infinity.readiness.urlopen',return_value=io.StringIO('{"private_state":{}}')):
            with self.assertRaisesRegex(RuntimeError,'Unexpected'):await wait_ready('http://local',process)
