// Regression (audit handbuilt-4: task_onswc7, task_tus8): blind harness copies that did not surface browser downloads
// made "download the bill and report its filename" tasks unanswerable. One site sends Content-Disposition, the other
// relies on an <a download> attribute, so header sniffing is not enough: the harness must use CDP download events.
// Static check; never starts a daemon or a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../agentlab/session.mjs', import.meta.url), 'utf8');

test('agentlab session reports downloads via CDP Browser.downloadWillBegin', () => {
  assert.match(src, /Browser\.setDownloadBehavior[^\n]*eventsEnabled:\s*true/);
  assert.match(src, /Browser\.downloadWillBegin[^\n]*suggestedFilename/);
  assert.match(src, /notes\.push\(`Download started:/);
});

test('download reporting is set up for every new browser context, not only the first', () => {
  const fn = src.slice(src.indexOf('async function newContext'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /createBrowserContext/);
  assert.match(body, /Browser\.setDownloadBehavior/);
  assert.match(body, /browserContextId:\s*ctx\.id/);
});
