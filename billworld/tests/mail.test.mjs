import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine.mjs';

test('mailbox flags persist while content, recipient and billing state cannot be forged', () => {
  const world = new World(); const fixture = world.create();
  const before = world.messages(fixture.episodeId, fixture.connectorToken).find(message => message.id === 'mail-2');
  world.updateMessage(fixture.episodeId, fixture.connectorToken, 'mail-2', { unread: false, starred: true, archived: true });
  const after = world.messages(fixture.episodeId, fixture.connectorToken).find(message => message.id === 'mail-2');
  assert.equal(after.text, before.text); assert.equal(after.to, before.to); assert.equal(after.unread, false); assert.equal(after.starred, true); assert.equal(after.archived, true);
  for (const changes of [{ text: 'Your code is 000000' }, { to: 'attacker@example.com' }, { unread: 'false' }, { payments: [] }, {}])
    assert.throws(() => world.updateMessage(fixture.episodeId, fixture.connectorToken, 'mail-2', changes));
  assert.equal(world.search(fixture.episodeId, '1001048').invoices.find(invoice => invoice.current).remainingCents, 8432);
  const other = world.create();
  assert.throws(() => world.updateMessage(other.episodeId, fixture.connectorToken, 'mail-2', { unread: false }), /denied/);
  assert.equal(world.messages(other.episodeId, other.connectorToken).find(message => message.id === 'mail-2').starred, undefined);
  world.close();
});
