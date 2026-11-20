import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setupWorkspace } from '../src/bootstrap.js';
import { openDatabase } from '../src/db.js';
import { createStore } from '../src/store.js';

test('o setup de produção inicializa uma única vez e preserva o PIN alterado', async (t) => {
  const db = await openDatabase({ path: ':memory:' });
  t.after(() => db.close());
  const store = createStore(db);
  const env = { ADMIN_NAME: 'Felipe', INITIAL_PROJECTS: 'GAVYO Auto' };
  const options = { onlyWhenEmpty: true };
  await Promise.all([setupWorkspace(store, env, options), setupWorkspace(store, env, options)]);
  const members = await store.members();
  assert.equal(members.length, 1);
  assert.equal(members[0].role, 'admin');
  const { token } = await store.login(members[0].id, '1234');
  await store.changePin(members[0].id, '1234', '7602', token);
  await setupWorkspace(store, { ...env, INITIAL_PROJECTS: 'Outro' }, options);
  await assert.rejects(() => store.login(members[0].id, '1234'), { status: 401 });
  assert.deepEqual((await store.projects()).map(({ name }) => name), ['GAVYO Auto']);
});
