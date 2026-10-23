import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { start } from '../server.mjs';
const file = new URL('../mail-mcp.mjs', import.meta.url).pathname;
const decode = value => JSON.parse(value.content[0].text);

test('actual MCP stdio tools share mailbox state, paginate and reject another episode', async () => {
  const runtime = await start({ port: 0, adminPort: 0, dbPath: ':memory:' });
  const fixture = runtime.world.create();
  const client = new Client({ name: 'reference-test', version: '1.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [file], env: { ...process.env,
    BILLWORLD_MAIL_URL: runtime.baseUrl, BILLWORLD_EPISODE: fixture.episodeId, BILLWORLD_MAIL_TOKEN: fixture.connectorToken } });
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['gmail_get_attachment', 'gmail_get_thread', 'gmail_list_messages', 'gmail_read_message', 'gmail_update_message']);
    const bytes=Buffer.from('Synthetic statement: $84.32');
    runtime.world.transact(fixture.episodeId,s=>{s.mail.find(m=>m.id==='mail-2').attachments=[{id:'attachment-1',name:'statement.txt',mimeType:'text/plain',sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),dataBase64:bytes.toString('base64')}];});
    const attachments=decode(await client.callTool({name:'gmail_list_messages',arguments:{q:'has:attachment'}}));
    assert.equal(attachments.messages.length,1);assert.equal(attachments.messages[0].attachments[0].dataBase64,undefined);
    const downloaded=decode(await client.callTool({name:'gmail_get_attachment',arguments:{messageId:'mail-2',attachmentId:'attachment-1'}}));
    assert.equal(downloaded.attachment.dataBase64,bytes.toString('base64'));
    assert.equal((await client.callTool({name:'gmail_get_attachment',arguments:{messageId:'mail-1',attachmentId:'attachment-1'}})).isError,true);
    const first = decode(await client.callTool({ name: 'gmail_list_messages', arguments: { limit: 1 } }));
    assert.equal(first.messages[0].id, 'mail-2'); assert.equal(first.nextCursor, 'mail-2');
    const bill=first.messages[0],after=Math.floor(Date.parse(bill.receivedAt)/1000)-1;
    const graceSearch=decode(await client.callTool({name:'gmail_list_messages',arguments:{q:`{from:missing@billworld.test from:${bill.from}} after:${after}`}}));
    assert.ok(graceSearch.messages.some(message=>message.id===bill.id),'Grace arrival query survives MCP and HTTP transport');
    const next = decode(await client.callTool({ name: 'gmail_list_messages', arguments: { limit: 1, cursor: first.nextCursor } }));
    assert.equal(next.messages[0].id, 'mail-1'); assert.equal(next.nextCursor, null);
    runtime.world.resetRequest(fixture.episodeId, { email: fixture.credentials.email });
    const found = decode(await client.callTool({ name: 'gmail_list_messages', arguments: { q: 'subject:Reset is:unread' } }));
    assert.equal(found.messages.length, 1); assert.match(found.messages[0].text, /\/portal\/reset\?token=/);
    const read = decode(await client.callTool({ name: 'gmail_read_message', arguments: { id: found.messages[0].id } }));
    assert.equal(read.message.unread, false); assert.equal(runtime.world.message(fixture.episodeId, fixture.connectorToken, read.message.id).unread, false);
    const thread = decode(await client.callTool({ name: 'gmail_get_thread', arguments: { threadId: read.message.threadId } }));
    assert.equal(thread.messages[0].text, read.message.text);
    await client.callTool({ name: 'gmail_update_message', arguments: { id: read.message.id, changes: { starred: true } } });
    assert.equal(runtime.world.message(fixture.episodeId, fixture.connectorToken, read.message.id).starred, true);
    assert.equal((await client.callTool({ name: 'gmail_read_message', arguments: { id: 'mail-999' } })).isError, true);
    const forged = await client.callTool({ name: 'gmail_update_message', arguments: { id: read.message.id, changes: { text: 'forged' } } });
    assert.equal(forged.isError, true);
    const other = runtime.world.create();
    const foreign = new Client({ name: 'wrong-episode-test', version: '1.0' });
    try {
      await foreign.connect(new StdioClientTransport({ command: process.execPath, args: [file], env: { ...process.env,
        BILLWORLD_MAIL_URL: runtime.baseUrl, BILLWORLD_EPISODE: other.episodeId, BILLWORLD_MAIL_TOKEN: fixture.connectorToken } }));
      assert.equal((await foreign.callTool({ name: 'gmail_list_messages', arguments: {} })).isError, true);
      assert.equal((await foreign.callTool({name:'gmail_get_attachment',arguments:{messageId:'mail-2',attachmentId:'attachment-1'}})).isError,true);
    } finally { await foreign.close(); }
  } finally { await client.close(); await runtime.close(); }
});
