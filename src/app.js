import express from 'express';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AppError, pinInput, sources } from './store.js';
import { serveMcp } from './mcp.js';
import { recentCommits } from './github.js';

const file = (path) => fileURLToPath(new URL(path, import.meta.url));
const credential = (req) => /(?:^|;\s*)gavyo_session=([\w-]{43})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];

/** Prints e imagens: tipo conferido pelos primeiros bytes, não pelo nome. */
const IMAGE_TYPES = {
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  'image/gif': { ext: 'gif', magic: (b) => b.subarray(0, 4).toString() === 'GIF8' }
};
const MAX_IMAGE = 8 * 1024 * 1024;

export function createApp(store, { production = false, origin = '', uploads = process.env.UPLOAD_DIR || '.data/uploads', commits = recentCommits } = {}) {
  const uploadRoot = resolve(uploads);
  const presence = new Map();
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
  /**
   * Webhook do GitHub: pushes e pull requests chegam na hora. Confere a assinatura
   * com GITHUB_WEBHOOK_SECRET antes de ler qualquer coisa.
   */
  app.post('/api/github/webhook', express.raw({ type: 'application/json', limit: '5mb' }), async (req, res) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ error: 'Webhook sem senha configurada (GITHUB_WEBHOOK_SECRET).' });
    const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(req.body || '').digest('hex')}`);
    const given = Buffer.from(String(req.get('x-hub-signature-256') || ''));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return res.status(401).json({ error: 'Assinatura inválida.' });
    const kind = req.get('x-github-event');
    if (kind === 'ping') return res.json({ ok: true });
    const payload = JSON.parse(req.body.toString('utf8'));
    await store.saveGithubEvent(kind, payload);
    res.json({ ok: true });
  });
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Imagens só na rota de anexos; um formulário de outro site não consegue mandar esse tipo sem pedir licença ao servidor.
    const image = req.method === 'POST' && /^\/(cards\/[^/]+\/attachments|preferences\/background)$/.test(req.path) && Boolean(req.is(Object.keys(IMAGE_TYPES)));
    if (req.method !== 'GET' && ((!req.is('application/json') && !image) ||
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
    const [projects, members, preferences, versions] = await Promise.all([
      store.projects(), store.members(), store.preferences(req.actor.id), store.cardVersions()
    ]);
    const fingerprint = JSON.stringify([req.actor, projects, members, preferences, versions]);
    const tag = `"${createHash('sha256').update(fingerprint).digest('base64url')}"`;
    res.set('ETag', tag);
    if (req.get('If-None-Match') === tag) return res.status(304).end();
    const { cards, archive } = await store.boardCards();
    res.json({ user: req.actor, projects, members, cards, archive, preferences });
  });
  app.post('/api/cards', async (req, res) => res.status(201).json(await store.createCard(req.body, req.actor)));
  app.patch('/api/cards/:id', async (req, res) => {
    const version = z.int().positive().parse(req.body.version);
    res.json(await store.updateCard(z.uuid().parse(req.params.id), req.body, req.actor, version));
  });

  app.post('/api/cards/:id/attachments', express.raw({ type: Object.keys(IMAGE_TYPES), limit: MAX_IMAGE }), async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const type = IMAGE_TYPES[req.get('content-type')];
    if (!type || !Buffer.isBuffer(req.body) || !req.body.length) throw new AppError(400, 'Envie uma imagem PNG, JPG, WebP ou GIF.');
    if (!type.magic(req.body)) throw new AppError(400, 'Esse arquivo não é uma imagem de verdade.');
    const name = `${crypto.randomUUID()}.${type.ext}`;
    const dir = join(uploadRoot, id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, name), req.body, { mode: 0o600 });
    try {
      res.status(201).json(await store.addAttachment(id, { name, type: req.get('content-type'), size: req.body.length }, req.actor));
    } catch (error) {
      await unlink(join(dir, name)).catch(() => {});
      throw error;
    }
  });
  app.delete('/api/cards/:id/attachments/:attachment', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const { card, result } = await store.removeAttachment(id, z.uuid().parse(req.params.attachment), req.actor);
    await unlink(join(uploadRoot, id, result.file)).catch(() => {});
    res.json(card);
  });
  app.get('/api/files/:card/:name', async (req, res) => {
    const id = z.uuid().parse(req.params.card);
    const name = z.string().regex(/^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/).parse(req.params.name);
    const attachment = await store.cardFile(id, name);
    if (!attachment) throw new AppError(404, 'Imagem não encontrada.');
    const bytes = await readFile(join(uploadRoot, id, name)).catch(() => null);
    if (!bytes) throw new AppError(404, 'Imagem não encontrada.');
    res.set({ 'Content-Type': attachment.type, 'Cache-Control': 'private, max-age=31536000, immutable' }).send(bytes);
  });

  /**
   * Quem está com o quadro aberto agora (memória do servidor, sem banco): cada aba manda um sinal
   * a cada 15 s com a tela e o cartão que está vendo. Some depois de 45 s sem sinal.
   */
  app.post('/api/presence', async (req, res) => {
    const { view, cardId, away } = z.object({
      view: z.enum(['board', 'mine', 'archive', 'context']).optional(),
      cardId: z.uuid().nullable().optional(), away: z.boolean().optional()
    }).parse(req.body);
    const now = Date.now();
    presence.set(req.actor.id, { at: now, view: view || 'board', cardId: cardId || null, away: Boolean(away) });
    for (const [id, item] of presence) if (now - item.at > 45000) presence.delete(id);
    res.json([...presence].map(([id, item]) => ({ id, ...item })));
  });

  app.get('/api/projects/:id/context', async (req, res) => res.json(await store.projectContext(z.uuid().parse(req.params.id))));
  app.put('/api/projects/:id/context', async (req, res) =>
    res.json(await store.setProjectContext(z.uuid().parse(req.params.id), req.body, req.actor)));
  app.get('/api/projects/:id/activity', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const ctx = await store.projectContext(id);
    const [github, pushed] = await Promise.all([commits(ctx.repositorio, ctx.branch), store.githubEvents(ctx.repositorio, ctx.branch)]);
    const seen = new Set(pushed.map((item) => item.id));
    const merged = [...pushed, ...github.commits.map((item) => ({ kind: 'commit', id: `commit:${item.sha}`, ...item })).filter((item) => !seen.has(item.id))];
    // A aba Atividade é só do GitHub: commits e PRs, do mais novo para o mais velho.
    const items = merged.filter((item) => item.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200);
    res.json({ items, note: pushed.length ? '' : github.note, version: ctx.version, repository: ctx.repositorio || '' });
  });
  app.get('/api/projects/:id/messages', async (req, res) => res.json(await store.projectMessages(z.uuid().parse(req.params.id))));
  app.post('/api/projects/:id/messages', async (req, res) => res.json(await store.addProjectMessage(z.uuid().parse(req.params.id), req.body, req.actor)));
  app.get('/api/projects/:id/context/history', async (req, res) => res.json(await store.contextHistory(z.uuid().parse(req.params.id))));
  app.post('/api/projects/:id/context/restore/:version', async (req, res) =>
    res.json(await store.restoreContext(z.uuid().parse(req.params.id), z.coerce.number().int().min(1).parse(req.params.version), req.body, req.actor)));

  app.put('/api/preferences', async (req, res) => {
    const input = z.object({ background: z.enum(['noite', 'couro', 'asfalto', 'entardecer', 'imagem']) }).parse(req.body);
    res.json((await store.setPreferences(req.actor.id, input)).saved);
  });
  /** Foto de fundo da própria pessoa: substitui a anterior e apaga o arquivo velho. */
  app.post('/api/preferences/background', express.raw({ type: Object.keys(IMAGE_TYPES), limit: MAX_IMAGE }), async (req, res) => {
    const type = IMAGE_TYPES[req.get('content-type')];
    if (!type || !Buffer.isBuffer(req.body) || !req.body.length || !type.magic(req.body)) throw new AppError(400, 'Envie uma imagem PNG, JPG, WebP ou GIF.');
    const name = `${crypto.randomUUID()}.${type.ext}`;
    const dir = join(uploadRoot, 'fundos', req.actor.id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, name), req.body, { mode: 0o600 });
    const { previous, saved } = await store.setPreferences(req.actor.id, { background: 'imagem', backgroundFile: name });
    if (previous.backgroundFile && previous.backgroundFile !== name) await unlink(join(dir, previous.backgroundFile)).catch(() => {});
    res.status(201).json(saved);
  });
  app.get('/api/backgrounds/:name', async (req, res) => {
    const name = z.string().regex(/^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/).parse(req.params.name);
    if ((await store.preferences(req.actor.id)).backgroundFile !== name) throw new AppError(404, 'Imagem não encontrada.');
    const bytes = await readFile(join(uploadRoot, 'fundos', req.actor.id, name)).catch(() => null);
    if (!bytes) throw new AppError(404, 'Imagem não encontrada.');
    const ext = name.split('.').pop();
    const mime = Object.entries(IMAGE_TYPES).find(([, value]) => value.ext === ext)[0];
    res.set({ 'Content-Type': mime, 'Cache-Control': 'private, max-age=31536000, immutable' }).send(bytes);
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
