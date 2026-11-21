import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../src/db.js';
import { createStore } from '../src/store.js';

async function setup(t) {
  const database = await openDatabase({ path: ':memory:' });
  t.after(() => database.close());
  const store = createStore(database);
  const ana = await store.createMember({ name: 'Ana' });
  return { store, actor: { ...ana, source: 'Web' }, ana };
}

test('nota: cria com autor, move com versão e recusa versão velha', async (t) => {
  const { store, actor } = await setup(t);
  const note = await store.addCompanyItem('note', { title: 'Ideia', text: 'app de entregas' }, actor);
  assert.equal(note.author.name, 'Ana');
  assert.equal(note.color, 'papel');
  const moved = await store.updateCompanyItem('note', note.id, { x: 40, y: 300, version: 1 }, actor);
  assert.equal(moved.version, 2);
  assert.equal(moved.title, 'Ideia');
  await assert.rejects(store.updateCompanyItem('note', note.id, { x: 1, version: 1 }, actor), { status: 409 });
  assert.deepEqual((await store.companyItems('note')).map((item) => [item.x, item.y]), [[40, 300]]);
});

test('agenda e caixa validam campos; tipo desconhecido é recusado', async (t) => {
  const { store, actor, ana } = await setup(t);
  await assert.rejects(store.addCompanyItem('event', { title: 'sem dia' }, actor));
  const event = await store.addCompanyItem('event', { day: '2026-12-01', title: 'Reunião', time: '14:30' }, actor);
  assert.equal(event.time, '14:30');
  const cash = await store.addCompanyItem('cash', { type: 'out', amountCents: 4590, day: '2026-11-21', description: 'Hospedagem', ownerId: ana.id }, actor);
  assert.equal(cash.ownerId, ana.id);
  await assert.rejects(store.addCompanyItem('cash', { type: 'out', amountCents: 1, day: '2026-11-21', description: 'x', ownerId: crypto.randomUUID() }, actor), { status: 400 });
  await assert.rejects(store.companyItems('outra'));
  await store.removeCompanyItem('cash', cash.id);
  assert.equal((await store.companyItems('cash')).length, 0);
});
