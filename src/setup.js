import { openDatabase } from './db.js';
import { createStore } from './store.js';

const db = await openDatabase();
try {
  const store = createStore(db);
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!(await store.members()).length) {
    await store.createMember({ name: ADMIN_NAME, email: ADMIN_EMAIL, password: ADMIN_PASSWORD, role: 'admin' });
    console.log('Administrador inicial criado.');
  }
  for (const name of (process.env.INITIAL_PROJECTS || 'GAVYO Auto').split(',').map((value) => value.trim()).filter(Boolean)) {
    if (!(await store.projects()).some((project) => project.name === name)) {
      await store.createProject({ name });
      console.log(`Projeto criado: ${name}`);
    }
  }
} finally {
  await db.close();
}
