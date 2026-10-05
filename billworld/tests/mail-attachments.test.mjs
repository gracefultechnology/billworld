import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {World} from '../engine.mjs';
import {start} from '../server.mjs';
export const attachmentFixture = (text='Synthetic statement\nAmount due: $84.32\n') => {
  const bytes=Buffer.from(text);
  return {id:'attachment-1',name:'statement.txt',mimeType:'text/plain',sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),dataBase64:bytes.toString('base64')};
};
const attach=(world,f,item=attachmentFixture())=>world.transact(f.episodeId,s=>{s.mail.find(m=>m.id==='mail-2').attachments=[item];});

test('attachment projections omit bytes and retrieval respects episode, recipient and message ownership',()=>{
 const w=new World();try{
  const f=w.create();attach(w,f);const item=attachmentFixture();
  const listed=w.messages(f.episodeId,f.connectorToken,'has:attachment');assert.equal(listed.length,1);
  assert.equal(listed[0].attachments[0].dataBase64,undefined);
  assert.deepEqual(w.attachment(f.episodeId,f.connectorToken,'mail-2','attachment-1'),item);
  assert.equal(w.thread(f.episodeId,f.connectorToken,'thread-2')[0].attachments[0].dataBase64,undefined);
  assert.equal(w.markRead(f.episodeId,f.connectorToken,'mail-2').attachments[0].dataBase64,undefined);
  assert.throws(()=>w.updateMessage(f.episodeId,f.connectorToken,'mail-2',{attachments:[]}),/Unsupported/);
  assert.throws(()=>w.attachment(f.episodeId,f.connectorToken,'mail-1','attachment-1'),/Attachment not found/);
  const other=w.create();attach(w,other,attachmentFixture('Other episode statement'));
  assert.throws(()=>w.attachment(other.episodeId,f.connectorToken,'mail-2','attachment-1'),/denied/);
  w.transact(f.episodeId,s=>{s.mail.find(m=>m.id==='mail-2').to='jordan@billworld.test';});
  assert.throws(()=>w.attachment(f.episodeId,f.connectorToken,'mail-2','attachment-1'),/Message not found/);
 }finally{w.close();}
});

test('corrupt, oversized, duplicate and unsafe private attachment fixtures fail validation',()=>{
 const w=new World();try{
  const f=w.create();for(const patch of [{sha256:'0'.repeat(64)},{sizeBytes:0},{dataBase64:'%%%%'},{name:'../secret.txt'},{name:'bad\r\nheader'},{mimeType:'text/html'},{dataBase64:'a'.repeat(1398105)}]){
   attach(w,f,{...attachmentFixture(),...patch});
   assert.throws(()=>w.attachment(f.episodeId,f.connectorToken,'mail-2','attachment-1'));
   assert.throws(()=>w.messages(f.episodeId,f.connectorToken));
  }
  w.transact(f.episodeId,s=>{s.mail.find(m=>m.id==='mail-2').attachments=[attachmentFixture(),attachmentFixture()];});
  assert.throws(()=>w.messages(f.episodeId,f.connectorToken),/Duplicate/);
 }finally{w.close();}
});

test('browser attachment HTTP uses mailbox cookie and returns exact bytes with safe download headers',async()=>{
 const r=await start({port:0,adminPort:0,dbPath:':memory:'});try{
  const f=r.world.create();attach(r.world,f);const url=r.baseUrl+'/api/mail/attachment?messageId=mail-2&attachmentId=attachment-1';
  const cookie=`bw_episode=${f.episodeId}; bw_access=${f.entryToken}`;
  assert.equal((await fetch(url,{headers:{Cookie:cookie}})).status,403);
  const response=await fetch(url,{headers:{Cookie:cookie+`; bw_mail=${f.connectorToken}`}});
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'text/plain');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('cache-control'),'no-store');
  assert.match(response.headers.get('content-disposition'),/^attachment;/);
  assert.equal(Buffer.from(await response.arrayBuffer()).toString('base64'),attachmentFixture().dataBase64);
 }finally{await r.close();}
});
