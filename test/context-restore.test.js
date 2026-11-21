import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../src/db.js';
import { createStore } from '../src/store.js';

test('restaurar uma versão sem responsável remove o responsável atual', async (t) => {
  const database = await openDatabase({ path: ':memory:' });
  t.after(() => database.close());
  const store = createStore(database);
  const member = await store.createMember({ name: 'João' });
  const actor = { ...member, source: 'Codex' };
  const project = await store.createProject({ name: 'Projeto' });
  await store.setProjectContext(project.id, { resumo: 'Resumo', versaoLida: 0 }, actor);
  await store.setProjectContext(project.id, { responsavelId: member.id, versaoLida: 1 }, actor);
  const restored = await store.restoreContext(project.id, 1, { versaoLida: 2 }, actor);
  assert.deepEqual([restored.responsavelId, restored.version], [null, 3]);
});
