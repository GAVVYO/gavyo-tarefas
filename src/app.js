import express from 'express';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AppError, pinInput, sources } from './store.js';
import { serveMcp } from './mcp.js';

const file = (path) => fileURLToPath(new URL(path, import.meta.url));
const credential = (req) => /(?:^|;\s*)gavyo_session=([\w-]{43})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];

export function createApp(store, { production = false, origin = '' } = {}) {
  const app = express();
  const attempts = new Map();

  async function rateLimited(req, memberId, validate) {
    const forwarded = production ? req.get('x-forwarded-for')?.split(',').at(-1)?.trim() : null;
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const keys = [`address:${forwarded || req.ip}`, `profile:${memberId}`];
    const limits = [24, 8];
    const entries = keys.map((key) => attempts.get(key) ?? { count: 0, until: now + 300000 });
    if (attempts.size > 4096 || entries.some((entry, index) => entry.count >= limits[index])) {
      throw new AppError(429, 'Muitas tentativas. Aguarde alguns minutos.');
    }
    keys.forEach((key, index) => {
      entries[index].count++;
      attempts.set(key, entries[index]);
    });
    const result = await validate();
    // Successful use of one profile cannot reset the network-wide counter.
    attempts.delete(keys[1]);
    return result;
  }

  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': [
        "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "img-src 'self' blob: data:",
        "connect-src 'self' blob:",
        // Stylesheet inserted in the shadow root by the bundled model viewer.
        "style-src 'self' 'sha256-PXtZZkJMMyc18o/DN1ZEFOJ2qEGq95IQbVaJFMOXOb0='",
        "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'"
      ].join('; '),
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'
    });
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET' && (!req.is('application/json') ||
      (req.get('origin') && req.get('origin') !== (origin || `${req.protocol}://${req.get('host')}`)))) {
      throw new AppError(403, 'Origem da solicitação inválida.');
    }
    next();
  });

  app.get('/api/profiles', async (_req, res) => {
    res.json((await store.members()).map(({ id, name }) => ({ id, name })));
  });

  app.post('/api/login', async (req, res) => {
    const { memberId, pin } = z.object({ memberId: z.uuid(), pin: pinInput }).parse(req.body);
    const { token, expires } = await rateLimited(req, memberId, () => store.login(memberId, pin));
    res.cookie('gavyo_session', token, {
      httpOnly: true, secure: production, sameSite: 'strict', expires: new Date(expires), path: '/'
    }).json({ ok: true });
  });

  // Lets the page decide between login and board without a 401 in the console.
  app.get('/api/session', async (req, res) => {
    res.json({ signedIn: Boolean(await store.identity(credential(req), 'Web')) });
  });

  app.use('/api', async (req, _res, next) => {
    req.actor = await store.identity(credential(req), 'Web');
    if (!req.actor) throw new AppError(401, 'Entre para acessar o quadro.');
    next();
  });

  app.post('/api/pin', async (req, res) => {
    const { currentPin, newPin } = z.object({ currentPin: pinInput, newPin: pinInput }).parse(req.body);
    if (currentPin === newPin) throw new AppError(400, 'Escolha um PIN diferente do atual.');
    await rateLimited(req, req.actor.id, () => store.changePin(req.actor.id, currentPin, newPin, credential(req)));
    res.json({ ok: true });
  });

  app.post('/api/logout', async (req, res) => {
    await store.revoke(credential(req));
    res.clearCookie('gavyo_session', { path: '/', sameSite: 'strict', secure: production }).json({ ok: true });
  });
  app.use('/api/avatar-assets', express.static(file('../assets/avatars/'), { index: false }));
  app.get('/api/board', async (req, res) => {
    const [projects, members, cards, archive] = await Promise.all([
      store.projects(), store.members(), store.listCards(), store.listCards({ archived: true })
    ]);
    res.json({ user: req.actor, projects, members, cards, archive });
  });
  app.post('/api/cards', async (req, res) => res.status(201).json(await store.createCard(req.body, req.actor)));
  app.patch('/api/cards/:id', async (req, res) => {
    const version = z.int().positive().parse(req.body.version);
    res.json(await store.updateCard(z.uuid().parse(req.params.id), req.body, req.actor, version));
  });

  function admin(req, _res, next) {
    if (req.actor.role !== 'admin') throw new AppError(403, 'Apenas administradores podem fazer isso.');
    next();
  }
  app.post('/api/projects', admin, async (req, res) => res.status(201).json(await store.createProject(req.body)));
  app.post('/api/members', admin, async (req, res) => res.status(201).json(await store.createMember(req.body)));
  app.get('/api/tokens', async (req, res) => res.json(await store.tokens(req.actor.id)));
  app.delete('/api/tokens/:id', async (req, res) => {
    await store.revokeMcp(req.actor.id, z.string().regex(/^[a-f0-9]{64}$/).parse(req.params.id));
    res.json({ ok: true });
  });
  app.post('/api/tokens', async (req, res) => {
    const source = sources.parse(req.body.source);
    res.status(201).json(await store.issue(req.actor.id, source, 30));
  });

  app.all('/mcp', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.get('origin') && req.get('origin') !== (origin || `${req.protocol}://${req.get('host')}`)) {
      return res.status(403).end();
    }
    const token = /^Bearer ([\w-]{43})$/i.exec(req.get('authorization') ?? '')?.[1];
    const actor = await store.identity(token, 'MCP');
    if (!actor) return res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'Token MCP inválido ou expirado.' });
    await serveMcp(req, res, store, actor);
  });

  app.get('/assets/model-viewer.min.js', (_req, res) =>
    res.sendFile(file('../node_modules/@google/model-viewer/dist/model-viewer.min.js')));
  app.use('/assets/manrope', express.static(file('../node_modules/@fontsource-variable/manrope/files/')));
  app.use('/assets/icons', express.static(file('../node_modules/lucide-static/icons/')));
  app.use(express.static(file('../public/')));
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof AppError) return res.status(error.status).json({ error: error.message });
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Confira os campos informados.' });
    if (error.code === 'ER_DUP_ENTRY' || /UNIQUE constraint failed/.test(error.message)) {
      return res.status(409).json({ error: 'Já existe um registro com esses dados.' });
    }
    if (error.status === 400 || error.status === 413) {
      return res.status(error.status).json({ error: 'Solicitação inválida ou grande demais.' });
    }
    console.error(error);
    res.status(500).json({ error: 'Falha no servidor. Tente novamente.' });
  });
  return app;
}
