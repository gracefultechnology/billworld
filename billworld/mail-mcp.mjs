import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const target = new URL(process.env.BILLWORLD_MAIL_URL || 'http://127.0.0.1:3100');
if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || target.username || target.password)
  throw new Error('Mailbox connector requires a local HTTP service');
const episode = process.env.BILLWORLD_EPISODE, token = process.env.BILLWORLD_MAIL_TOKEN;
if (!episode || !token) throw new Error('Episode-scoped mailbox credentials are required');
const server = new McpServer({ name: 'billworld-mock-gmail', version: '0.2.0' });
const messageId = z.string().regex(/^mail-[1-9]\d*$/);
async function request(path, input) {
  const response = await fetch(target.origin + '/connector/' + path, {
    method: input ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'X-Billworld-Episode': episode, 'Content-Type': 'application/json' },
    ...(input ? { body: JSON.stringify(input) } : {}), redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Mailbox request failed (${response.status})`);
  return result;
}
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const safe = fn => async input => { try { return result(await fn(input)); } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; } };
server.registerTool('gmail_list_messages', {
  description: 'List/search ordinary messages in this episode. Query supports text, quoted phrases, from:, to:, subject:, is:unread and has:attachment. Newest messages first. No access to billing or grader state.',
  inputSchema: { q: z.string().max(1000).optional(), limit: z.number().int().min(1).max(100).default(25), cursor: messageId.optional() },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, safe(async ({ q = '', limit, cursor }) => {
  let { messages } = await request('messages?q=' + encodeURIComponent(q));
  if (cursor) messages = messages.filter(message => Number(message.id.slice(5)) < Number(cursor.slice(5)));
  const page = messages.slice(0, limit);
  return { messages: page, nextCursor: messages.length > limit ? page.at(-1).id : null };
}));
server.registerTool('gmail_read_message', {
  description: 'Read a message body and metadata. Optionally mark it read in the shared mailbox.',
  inputSchema: { id: messageId, markRead: z.boolean().default(true) }, annotations: { openWorldHint: false },
}, safe(async ({ id, markRead }) => {
  const { message } = await request('message?id=' + encodeURIComponent(id));
  if (markRead) return { message: await request('messages/update', { id, changes: { unread: false } }) };
  return { message };
}));
server.registerTool('gmail_get_thread', {
  description: 'Read the ordinary messages of one mailbox thread, oldest first.',
  inputSchema: { threadId: z.string().regex(/^thread-[1-9]\d*$/) }, annotations: { readOnlyHint: true, openWorldHint: false },
}, safe(({ threadId }) => request('thread?id=' + encodeURIComponent(threadId))));
server.registerTool('gmail_get_attachment', {
  description: 'Retrieve an attachment from an authorized message. Returns ordinary metadata, SHA-256 and base64 bytes; maximum one MiB. Listing messages returns metadata only.',
  inputSchema: { messageId, attachmentId: z.string().regex(/^attachment-[1-9]\d*$/) },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, safe(({ messageId, attachmentId }) => request('attachment?messageId='+encodeURIComponent(messageId)+'&attachmentId='+encodeURIComponent(attachmentId))));
server.registerTool('gmail_update_message', {
  description: 'Change read, star, archive, trash, importance or spam flags. Message contents and recipients cannot be changed.',
  inputSchema: { id: messageId, changes: z.object({ unread: z.boolean().optional(), starred: z.boolean().optional(), archived: z.boolean().optional(), trashed: z.boolean().optional(), important: z.boolean().optional(), spam: z.boolean().optional() }).strict().refine(value => Object.keys(value).length > 0) },
  annotations: { openWorldHint: false, idempotentHint: true, destructiveHint: false },
}, safe(({ id, changes }) => request('messages/update', { id, changes })));
await server.connect(new StdioServerTransport());
