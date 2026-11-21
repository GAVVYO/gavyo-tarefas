import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { createStore } from '../src/store.js';

async function fixture(t) {
  const database = await openDatabase({ path: ':memory:' });
  t.after(() => database.close());
  const store = createStore(database);
  const bola = await store.createMember({ name: 'Bola' });
  const felipe = await store.createMember({ name: 'Felipe' });
  const project = await store.createProject({ name: 'Oficina' });
  const other = await store.createProject({ name: 'Outro projeto' });
  const actor = { ...bola, source: 'Web' };
  const expense = {
    description: 'Hospedagem', amountCents: 12000, paidOn: '2024-01-31',
    payerId: felipe.id, participantIds: [bola.id, felipe.id]
  };
  return { database, store, bola, felipe, project, other, actor, expense };
}

test('rateia centavos em ordem estável, compensa gastos opostos e separa os projetos', async (t) => {
  const { store, bola, felipe, project, other, actor, expense } = await fixture(t);
  await store.addExpense(project.id, expense, actor);
  await store.addExpense(project.id, { ...expense, amountCents: 4000, payerId: bola.id }, actor);
  const result = await store.projectFinance(project.id);
  assert.deepEqual(result.balances, [{ fromId: bola.id, toId: felipe.id, amountCents: 4000 }]);
  assert.deepEqual((await store.projectFinance(other.id)).balances, []);
  const three = await store.createMember({ name: 'Outra pessoa' });
  const ids = [bola.id, felipe.id, three.id];
  const split = { ...expense, amountCents: 5, payerId: bola.id, participantIds: ids.toReversed() };
  const first = await store.addExpense(other.id, split, actor);
  const second = await store.addExpense(other.id, { ...split, participantIds: ids }, actor);
  assert.deepEqual(first.shares, second.shares);
  assert.deepEqual(first.shares.map((share) => share.amountCents), [2, 2, 1]);
  assert.equal(first.shares.reduce((sum, share) => sum + share.amountCents, 0), 5);
  await assert.rejects(store.addExpense(other.id, { ...expense, payerId: randomUUID() }, actor), { status: 400 });
  await assert.rejects(store.addExpense(other.id, { ...expense, participantIds: [bola.id, bola.id] }, actor), /repetido/);
});

test('acerto concorre pelo saldo versionado, preserva autoria e deixa despesas novas em aberto', async (t) => {
  const { database, store, project, actor, expense } = await fixture(t);
  const secondStore = createStore(database);
  await store.addExpense(project.id, expense, actor);
  const preview = await store.projectFinance(project.id);
  await store.addExpense(project.id, expense, actor);
  await assert.rejects(store.settleFinance(project.id, { ...preview.balances[0], version: preview.version }, actor), { status: 409 });
  const current = await store.projectFinance(project.id);
  const input = { ...current.balances[0], version: current.version };
  const results = await Promise.allSettled([
    store.settleFinance(project.id, input, actor),
    secondStore.settleFinance(project.id, input, actor)
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.status, 409);
  const settled = await store.projectFinance(project.id);
  assert.deepEqual(settled.balances, []);
  assert.equal(settled.settlements.length, 1);
  assert.equal(settled.settlements[0].amountCents, 12000);
  assert.equal(settled.settlements[0].source, 'Web');
  assert.equal(settled.settlements[0].actorId, actor.id);
  await store.addExpense(project.id, expense, actor);
  assert.equal((await store.projectFinance(project.id)).balances[0].amountCents, 6000);
});

test('recorrências respeitam o dia original e entram no saldo só quando pagas', async (t) => {
  const { store, project, actor, expense } = await fixture(t);
  const initial = await store.addExpense(project.id, { ...expense, frequency: 'monthly' }, actor);
  const annual = await store.addExpense(project.id, { ...expense, paidOn: '2024-02-29', frequency: 'yearly' }, actor);
  let finance = await store.projectFinance(project.id);
  assert.equal(finance.renewals.find(({ id }) => id === initial.id).dueOn, '2024-02-29');
  assert.equal(finance.renewals.find(({ id }) => id === annual.id).dueOn, '2025-02-28');
  assert.equal(finance.renewals.find(({ id }) => id === initial.id).notice, 'overdue');
  assert.equal(finance.balances[0].amountCents, 12000);
  const payment = {
    ...expense, paidOn: '2024-02-29', operationId: randomUUID(),
    occurrence: { expenseId: initial.id, dueOn: '2024-02-29' }
  };
  const first = await store.addExpense(project.id, payment, actor);
  assert.deepEqual(await store.addExpense(project.id, payment, actor), first);
  await assert.rejects(store.addExpense(project.id, { ...payment, operationId: randomUUID() }, actor), { status: 409 });
  finance = await store.projectFinance(project.id);
  assert.equal(finance.renewals.find(({ id }) => id === initial.id).dueOn, '2024-03-31');
  assert.equal(finance.balances[0].amountCents, 18000);
});

test('Web e MCP exigem sessão, compartilham dados e atribuem o canal no servidor', async (t) => {
  const { store, project, bola, expense } = await fixture(t);
  const server = createApp(store).listen(0, '127.0.0.1');
  const client = new Client({ name: 'teste-financeiro', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  });
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = `${origin}/api/projects/${project.id}/finance`;
  assert.equal((await fetch(url)).status, 401);
  const session = await store.login(bola.id, '1234');
  const { token } = await store.issue(bola.id, 'Claude', 30);
  const cookie = `gavyo_session=${session.token}`;
  const res = await fetch(url + '/expenses', {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(expense)
  });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).source, 'Web');
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', origin), {
    requestInit: { headers: { authorization: `Bearer ${token}` } }
  }));
  const call = async (name, args) => {
    const reply = await client.callTool({ name, arguments: { projectId: project.id, ...args } });
    assert.ok(!reply.isError, JSON.stringify(reply));
    return JSON.parse(reply.content[0].text);
  };
  const mcp = await call('registrar_gasto', expense);
  assert.equal(mcp.actor, 'Bola');
  assert.equal(mcp.source, 'Claude');
  assert.ok(Number.isFinite(Date.parse(mcp.at)));
  const web = await (await fetch(url, { headers: { cookie } })).json();
  assert.deepEqual((await call('ver_resumo_financeiro')).balances, web.balances);
  assert.equal(web.balances[0].amountCents, 12000);
});

test('categorias agrupam gastos e exclusão preserva auditoria com saldo recalculado', async t => {
  const {store,project,other,actor,expense}=await fixture(t);
  const category=await store.addFinanceCategory(project.id,{name:'IA'},actor);
  assert.equal((await store.addFinanceCategory(project.id,{name:' ia '},actor)).id,category.id);
  await assert.rejects(()=>store.addExpense(other.id,{...expense,categoryId:category.id},actor),{status:400});
  const paid=await store.addExpense(project.id,{...expense,categoryId:category.id},actor);
  let snapshot=await store.projectFinance(project.id);
  assert.equal(snapshot.categories.length,1);
  assert.equal(snapshot.expenses[0].categoryId,category.id);
  assert.equal(snapshot.balances[0].amountCents,6000);
  await assert.rejects(()=>store.deleteExpense(project.id,paid.id,{version:snapshot.version-1},actor),{status:409});
  const removed=await store.deleteExpense(project.id,paid.id,{version:snapshot.version},actor);
  assert.equal(removed.actor,actor.name);
  snapshot=await store.projectFinance(project.id);
  assert.deepEqual(snapshot.expenses,[]);
  assert.deepEqual(snapshot.balances,[]);
  assert.equal(snapshot.categories[0].name,'IA');
  assert.equal(snapshot.deletions[0].expenseId,paid.id);
  assert.equal((await store.deleteExpense(project.id,paid.id,{version:0},actor)).id,removed.id);
  const rows=await store.projectFinance(other.id); assert.deepEqual(rows.categories,[]);
  const retry=await store.addExpense(project.id,{...expense,operationId:paid.id,categoryId:category.id},actor);
  assert.equal(retry.id,paid.id); assert.equal((await store.projectFinance(project.id)).expenses.length,0);
});

test('excluir uma renovação reabre seu vencimento; excluir a origem retira as parcelas dos saldos', async t => {
  const {store,project,actor,expense}=await fixture(t);
  const root=await store.addExpense(project.id,{...expense,frequency:'monthly'},actor);
  let snapshot=await store.projectFinance(project.id);
  const due=snapshot.renewals[0].dueOn;
  const renewal=await store.addExpense(project.id,{...expense,paidOn:due,occurrence:{expenseId:root.id,dueOn:due}},actor);
  snapshot=await store.projectFinance(project.id);
  await store.deleteExpense(project.id,renewal.id,{version:snapshot.version},actor);
  snapshot=await store.projectFinance(project.id);
  assert.equal(snapshot.renewals[0].dueOn,due);
  await store.addExpense(project.id,{...expense,paidOn:due,occurrence:{expenseId:root.id,dueOn:due}},actor);
  snapshot=await store.projectFinance(project.id);
  await store.deleteExpense(project.id,root.id,{version:snapshot.version},actor);
  snapshot=await store.projectFinance(project.id);
  assert.deepEqual(snapshot.expenses,[]); assert.deepEqual(snapshot.balances,[]); assert.deepEqual(snapshot.renewals,[]);
});
