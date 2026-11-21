import { openDatabase } from './db.js';
import { createStore } from './store.js';
import { createApp } from './app.js';
import { setupWorkspace } from './bootstrap.js';
import { createPush } from './push.js';

// Hostinger's launcher loads this module with require(), which needs a synchronous module graph.
async function start() {
  const production = process.env.NODE_ENV === 'production';
  const origin = process.env.PUBLIC_ORIGIN || '';
  if (production && (!origin.startsWith('https://') || new URL(origin).origin !== origin)) {
    throw new Error('Defina PUBLIC_ORIGIN como a origem HTTPS do quadro sem barra final.');
  }

  const database = await openDatabase();
  const store = createStore(database);
  // Os gastos do financeiro antigo passam a aparecer no Caixa da tela Empresa (cópia, sem apagar nada).
  await store.migrateFinanceToCash().then((copied) => copied && console.log(`Caixa: ${copied} gasto(s) copiado(s) do financeiro.`))
    .catch((error) => console.error('Caixa: migração do financeiro falhou:', error.message));
  if (production && process.env.ADMIN_NAME) await setupWorkspace(store, process.env, { onlyWhenEmpty: true });
  const push = createPush({ query: database.query, store });
  store.onEvent((event) => (event.type === 'team' ? push.teamMessage(event.message) : push.cardComment(event.card, event.comment, event.actor)));
  const app = createApp(store, { production, origin, push });
  const port = Number(process.env.PORT || 3000);
  app.listen(port, production ? '0.0.0.0' : '127.0.0.1', () => console.log(`GAVYO Tarefas na porta ${port}`));
}

void start().catch((error) => {
  console.error(error);
  process.exit(1);
});
