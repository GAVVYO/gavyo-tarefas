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

test('migração copia gastos ativos do financeiro para o Caixa, uma vez só', async (t) => {
  const { store, actor, ana } = await setup(t);
  const project = await store.createProject({ name: 'Loja' });
  const category = await store.addFinanceCategory(project.id, { name: 'Hospedagem' }, actor);
  const kept = await store.addExpense(project.id, { description: 'Servidor', amountCents: 5990, paidOn: '2026-11-10', payerId: ana.id, participantIds: [ana.id], categoryId: category.id }, actor);
  const gone = await store.addExpense(project.id, { description: 'Errado', amountCents: 100, paidOn: '2026-11-11', payerId: ana.id, participantIds: [ana.id] }, actor);
  const { version } = await store.projectFinance(project.id);
  await store.deleteExpense(project.id, gone.id, { version }, actor);
  assert.equal(await store.migrateFinanceToCash(), 1);
  assert.equal(await store.migrateFinanceToCash(), 0);
  const [cash] = await store.companyItems('cash');
  assert.equal(cash.id, kept.id);
  assert.deepEqual([cash.type, cash.amountCents, cash.day, cash.category, cash.ownerId, cash.projectId, cash.author.name], ['out', 5990, '2026-11-10', 'Hospedagem', ana.id, project.id, 'Ana']);
  assert.equal((await store.projectFinance(project.id)).expenses.length, 1);
});
