#!/usr/bin/env node
// Stdio MCP server exposing one Fleet episode's mailbox (and the persona's text messages) as tools.
// Environment (from the private admin API: POST /episodes -> connector):
//   BILLWORLD_FLEET_URL     public fleet origin, e.g. http://127.0.0.1:3200 (BILLWORLD_MAIL_URL also accepted)
//   BILLWORLD_EPISODE       episode id
//   BILLWORLD_MAIL_TOKEN    episode connector token (not the admin token, not the browser mail password)
// Stdout is reserved for MCP protocol messages. There are no grading, billing-state or "get OTP" tools.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const target = new URL(process.env.BILLWORLD_FLEET_URL || process.env.BILLWORLD_MAIL_URL || 'http://127.0.0.1:3200');
if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || target.username || target.password)
  throw new Error('The Fleet mail connector only talks to a local HTTP Fleet server');
const episode = process.env.BILLWORLD_EPISODE, token = process.env.BILLWORLD_MAIL_TOKEN;
if (!episode || !token) throw new Error('BILLWORLD_EPISODE and BILLWORLD_MAIL_TOKEN are required');

async function request(path, input) {
  const response = await fetch(`${target.origin}/connector/${path}`, {
    method: input ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}`, 'X-Billworld-Episode': episode, ...(input ? { 'Content-Type': 'application/json' } : {}) },
    ...(input ? { body: JSON.stringify(input) } : {})
  });
  let result; try { result = await response.json(); } catch { throw new Error(`Mailbox request failed (${response.status})`); }
  if (!response.ok) throw new Error(result.error || `Mailbox request failed (${response.status})`);
  return result;
}
const qs = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString();
const ok = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 1) }] });
const safe = fn => async input => { try { return ok(await fn(input)); } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; } };

const messageId = z.string().regex(/^mail-[\w-]{1,40}$/).describe('Message id from gmail_list_messages, e.g. mail-AbC123');
const server = new McpServer({ name: 'billworld-fleet-mail', version: '1.0.0' });

server.registerTool('gmail_get_profile', {
  description: 'Return the email address and phone number of the mailbox owner, with message counts.',
  inputSchema: {}, annotations: { readOnlyHint: true, openWorldHint: false }
}, safe(() => request('profile')));
server.registerTool('gmail_list_messages', {
  description: 'List or search messages, newest first. Query syntax (Gmail subset): free text, "quoted phrase", from:, to:, subject:, is:unread|read|starred, in:inbox|trash|anywhere, has:link, newer_than:2d, older_than:1h, after:2026/10/01, before:, -negation, A OR B. Returns summaries (snippet, not full body); use gmail_read_message for the body and links.',
  inputSchema: { q: z.string().max(1000).optional(), limit: z.number().int().min(1).max(100).default(25), cursor: messageId.optional().describe('nextCursor from the previous page') },
  annotations: { readOnlyHint: true, openWorldHint: false }
}, safe(({ q, limit, cursor }) => request(`messages?${qs({ q, limit, cursor })}`)));
server.registerTool('gmail_read_message', {
  description: 'Read one message: full text with absolute links, metadata and labels. Marks it read unless markRead is false.',
  inputSchema: { id: messageId, markRead: z.boolean().default(true) }, annotations: { openWorldHint: false }
}, safe(async ({ id, markRead }) => markRead ? request('mark-read', { id }) : request(`message?${qs({ id })}`)));
server.registerTool('gmail_get_thread', {
  description: 'Read every message in a thread (same sender and subject), oldest first.',
  inputSchema: { threadId: z.string().regex(/^thr-[\w-]{1,40}$/) }, annotations: { readOnlyHint: true, openWorldHint: false }
}, safe(({ threadId }) => request(`thread?${qs({ id: threadId })}`)));
server.registerTool('gmail_update_message', {
  description: 'Change flags on a message: unread, starred, important, archived, trashed. Message contents cannot be changed and nothing can be sent.',
  inputSchema: { id: messageId, changes: z.object({ unread: z.boolean().optional(), starred: z.boolean().optional(), important: z.boolean().optional(), archived: z.boolean().optional(), trashed: z.boolean().optional() }).strict() },
  annotations: { openWorldHint: false, idempotentHint: true, destructiveHint: false }
}, safe(({ id, changes }) => { if (!Object.keys(changes).length) throw new Error('changes must set at least one flag'); return request('messages/update', { id, changes }); }));
server.registerTool('sms_list_messages', {
  description: "List text messages received on the mailbox owner's phone, newest first. Optional q filters by text or sender; 'is:unread' for unread only.",
  inputSchema: { q: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).default(25), cursor: z.string().regex(/^sms-\d{1,9}$/).optional() },
  annotations: { readOnlyHint: true, openWorldHint: false }
}, safe(({ q, limit, cursor }) => request(`sms?${qs({ q, limit, cursor })}`)));
server.registerTool('sms_read_message', {
  description: 'Read one text message and mark it read unless markRead is false.',
  inputSchema: { id: z.string().regex(/^sms-\d{1,9}$/), markRead: z.boolean().default(true) }, annotations: { openWorldHint: false }
}, safe(async ({ id, markRead }) => markRead ? request('sms/update', { id, changes: { unread: false } }) : request(`sms/message?${qs({ id })}`)));

await server.connect(new StdioServerTransport());
