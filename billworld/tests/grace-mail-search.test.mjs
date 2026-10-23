import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../engine.mjs';

test('Grace sender groups and epoch windows find only matching episode mail', () => {
  const world=new World();
  try {
    const fixture=world.create(), other=world.create();
    const at=Date.parse('2026-10-03T16:00:00Z'), sender='billing@utility.billworld.test';
    world.transact(fixture.episodeId,s=>{
      const base=s.mail[0];
      s.mail=[
        {...base,id:'mail-1',from:sender,receivedAt:new Date(at-2000).toISOString(),text:'old receipt REF-1048'},
        {...base,id:'mail-2',from:sender,receivedAt:new Date(at).toISOString(),text:'new receipt REF-1048'},
        {...base,id:'mail-3',from:'other@utility.billworld.test',receivedAt:new Date(at).toISOString(),text:'new receipt REF-1048'},
        {...base,id:'mail-4',from:sender,to:'someone-else@billworld.test',receivedAt:new Date(at).toISOString(),text:'new receipt REF-1048'},
      ];
    });
    const read=q=>world.messages(fixture.episodeId,fixture.connectorToken,q).map(m=>m.id);
    // Exact query forms emitted by Grace's arrival and receipt discovery.
    const group=`{from:missing@utility.billworld.test from:${sender}}`;
    assert.deepEqual(read(`${group} after:${at/1000-1}`),['mail-2']);
    assert.deepEqual(read(`${group} "REF-1048" after:${at/1000-1}`),['mail-2']);
    assert.deepEqual(read(`${group} before:${at/1000}`),['mail-1']);
    assert.deepEqual(read(`${group} after:${at/1000+1}`),[]);
    assert.deepEqual(read(`${group} "missing receipt"`),[]);
    assert.deepEqual(read(`{from:${sender} from:other@utility.billworld.test} after:${at/1000-1}`),['mail-3','mail-2']);
    assert.deepEqual(read(`from:${sender} "new receipt"`),['mail-2']);
    assert.deepEqual(read(`${group} after:invalid`),[]);
    assert.throws(()=>world.messages(other.episodeId,fixture.connectorToken,group),/denied/);
  } finally {world.close();}
});
