import express from 'express';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AppError, pinInput, sources } from './store.js';
import { serveMcp } from './mcp.js';
import { mergeGithubActivity, recentCommits } from './github.js';

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

const FIELD_LABELS = {
  title: 'Título', description: 'Descrição', comment: 'Comentário', text: 'Mensagem', name: 'Nome', pin: 'PIN',
  currentPin: 'PIN atual', newPin: 'PIN novo', url: 'Link', links: 'Links', due: 'Prazo', blocked: 'Motivo do bloqueio',
  amountCents: 'Valor', paidOn: 'Data do pagamento', payerId: 'Quem pagou', participantIds: 'Participantes', frequency: 'Recorrência',
  checklist: 'Passos', resumo: 'O que é', objetivo: 'No que estamos agora', regras: 'Como trabalhamos', decisoes: 'Decisões',
  stack: 'Stack', producao: 'Produção', teste: 'Teste', repositorio: 'Repositório', branch: 'Branch', versaoLida: 'Versão lida'
};

/**
 * App e estilo com a versão no endereço (app.js?v=…): a versão é a impressão digital do
 * arquivo já com os imports versionados, então muda sempre que ele ou um import muda.
 * Endereço versionado fica guardado por 1 ano; index.html é conferido sempre.
 */
function versionAssets(dir) {
  const raw = new Map(readdirSync(dir).filter((name) => /\.(js|css)$/.test(name)).map((name) => [name, readFileSync(join(dir, name), 'utf8')]));
  const files = new Map();
  const build = (name) => {
    if (files.has(name)) return files.get(name);
    const body = raw.get(name).replace(/(from\s+['"]\.\/)([\w-]+\.js)(['"])/g, (all, start, dep, end) =>
      raw.has(dep) ? `${start}${dep}?v=${build(dep).v}${end}` : all);
    const asset = { body, v: createHash('sha256').update(body).digest('base64url').slice(0, 12), type: name.endsWith('.css') ? 'css' : 'js' };
    files.set(name, asset);
    return asset;
  };
  for (const name of raw.keys()) build(name);
  const index = readFileSync(join(dir, 'index.html'), 'utf8')
    .replace(/(["'])\/(app\.js|styles\.css)\1/g, (all, quote, name) => `${quote}/${name}?v=${files.get(name).v}${quote}`);
  return { files, index };
}

/** Avatares só para quem entrou: o navegador guarda, a CDN não. */
const privateCache = (res) => res.setHeader('Cache-Control', 'private, max-age=604800');

export function createApp(store, { production = false, origin = '', uploads = process.env.UPLOAD_DIR || '.data/uploads', commits = recentCommits, push = null } = {}) {
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
  // Atualizações da lista completa podem incluir até 60 passos com detalhes.
  const checklistJson = express.json({ limit: '2mb' });
  app.patch('/api/cards/:id', checklistJson);
  app.post('/mcp', checklistJson);
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Imagens só na rota de anexos; um formulário de outro site não consegue mandar esse tipo sem pedir licença ao servidor.
    const image = req.method === 'POST' && /^\/(cards\/[^/]+\/attachments|preferences\/background|team\/images)$/.test(req.path) && Boolean(req.is(Object.keys(IMAGE_TYPES)));
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

  // Avisos fora do site (Web Push).
  const needPush = () => { if (!push) throw new AppError(503, 'Avisos fora do site não estão ligados neste servidor.'); return push; };
  app.get('/api/push/key', async (_req, res) => res.json({ publicKey: (await needPush().keys()).publicKey }));
  app.post('/api/push/subscriptions', async (req, res) => { await needPush().subscribe(req.actor.id, req.body?.subscription); res.status(201).json({ ok: true }); });
  app.delete('/api/push/subscriptions', async (req, res) => { await needPush().unsubscribe(req.actor.id, req.body?.endpoint); res.json({ ok: true }); });
  app.post('/api/team/images', express.raw({ type: Object.keys(IMAGE_TYPES), limit: MAX_IMAGE }), async (req, res) => {
    const type = IMAGE_TYPES[req.get('content-type')];
    if (!type || !Buffer.isBuffer(req.body) || !type.magic(req.body)) throw new AppError(400, 'Envie uma imagem PNG, JPG, WebP ou GIF válida.');
    const id = crypto.randomUUID();
    const dir = join(uploadRoot, 'team');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, id + '.' + type.ext);
    await writeFile(path, req.body, { mode: 0o600 });
    try {
      res.status(201).json(await store.saveTeamImage({ id, type: req.get('content-type'), size: req.body.length, url: '/api/team/images/' + id }, req.actor));
    } catch (error) { await unlink(path).catch(() => {}); throw error; }
  });
  app.get('/api/team/images/:id', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const image = await store.teamImage(id);
    const ext = IMAGE_TYPES[image.type]?.ext;
    if (!ext) throw new AppError(404, 'Imagem não encontrada.');
    const bytes = await readFile(join(uploadRoot, 'team', id + '.' + ext)).catch(() => null);
    if (!bytes) throw new AppError(404, 'Imagem não encontrada.');
    res.set({ 'Content-Type': image.type, 'Cache-Control': 'private, max-age=604800' }).send(bytes);
  });
  app.get('/api/team/reactions', async (req, res) => res.json(await store.teamReactions(String(req.query.ids || '').split(','))));
  app.post('/api/team/messages/:id/reaction', async (req, res) => res.json(await store.reactTeamMessage(req.params.id, req.body, req.actor)));
  app.get('/api/team/messages', async (req, res) => res.json(await store.teamMessages(req.query)));
  app.get('/api/team/messages/stream', async (req, res) => {
    const cursor = req.get('Last-Event-ID') ?? req.query.after ?? '0';
    let after = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(cursor);
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store',
      'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('retry: 1000\n\n');
    let reactionRevision = -1;
    let closed = false, draining = false, queued = false, heartbeat = 0;
    const stop = () => { closed = true; clearInterval(timer); unsubscribe(); };
    const drain = async () => {
      if (closed) return;
      if (draining) { queued = true; return; }
      draining = true;
      try {
        do {
          queued = false;
          // A autorização continua valendo durante a conexão, não só na abertura.
          if (!(await store.identity(credential(req), 'Web'))) { res.end(); stop(); return; }
          const revision = await store.teamReactionRevision();
          if (reactionRevision !== revision) {
            reactionRevision = revision;
            res.write(`event: reactions-changed\ndata: ${revision}\n\n`);
          }
          const page = await store.teamMessages({ after, limit: 100 });
          if (closed) return;
          if (page.messages.length) {
            after = page.nextAfter;
            if (!res.write(`id: ${after}\nevent: messages\ndata: ${JSON.stringify(page.messages)}\n\n`)) {
              // Cliente lento reconecta pelo último evento, sem acumular buffers.
              res.end(); stop(); return;
            }
          }
          queued ||= page.hasMore;
        } while (queued && !closed);
      } catch { res.end(); stop(); }
      finally { draining = false; }
    };
    const unsubscribe = store.subscribeTeamMessages(() => void drain());
    // Entrega local imediata; reconcilia também gravações de outros workers.
    const timer = setInterval(() => {
      if (++heartbeat % 15 === 0) res.write(': heartbeat\n\n');
      void drain();
    }, 1000);
    res.on('close', stop);
    void drain();
  });
  app.post('/api/team/messages', async (req, res) => res.status(201).json(await store.addTeamMessage(req.body, req.actor)));

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
  app.use('/api/avatar-assets', express.static(file('../assets/avatars/'), { index: false, maxAge: '7d', setHeaders: privateCache }));
  app.get('/api/board', async (req, res) => {
    const [projects, members, preferences, versions, messages] = await Promise.all([
      store.projects(), store.members(), store.preferences(req.actor.id), store.cardVersions(), store.latestMessages()
    ]);
    const fingerprint = JSON.stringify([req.actor, projects, members, preferences, versions, messages]);
    const tag = `"${createHash('sha256').update(fingerprint).digest('base64url')}"`;
    res.set('ETag', tag);
    if (req.get('If-None-Match') === tag) return res.status(304).end();
    const { cards, archive } = await store.boardCards();
    res.json({ user: req.actor, projects, members, cards, archive, preferences, messages });
  });
  app.post('/api/cards', async (req, res) => res.status(201).json(await store.createCard(req.body, req.actor)));
  app.patch('/api/cards/:id', async (req, res) => {
    const version = z.int().positive().parse(req.body.version);
    res.json(await store.updateCard(z.uuid().parse(req.params.id), req.body, req.actor, version));
  });

  const stepVersion = z.int().positive().optional();
  app.post('/api/cards/:id/steps', async (req, res) => {
    const version = stepVersion.parse(req.body?.version);
    res.status(201).json(await store.addStep(z.uuid().parse(req.params.id), req.body, req.actor, version));
  });
  app.patch('/api/cards/:id/steps/:stepId', async (req, res) => {
    const version = stepVersion.parse(req.body?.version);
    const id = z.uuid().parse(req.params.id);
    const stepId = z.uuid().parse(req.params.stepId);
    res.json(await store.updateStep(id, stepId, req.body, req.actor, version));
  });
  app.delete('/api/cards/:id/steps/:stepId', async (req, res) => {
    const version = stepVersion.parse(req.body?.version);
    const id = z.uuid().parse(req.params.id);
    const stepId = z.uuid().parse(req.params.stepId);
    res.json(await store.removeStep(id, stepId, req.actor, version));
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

  app.get('/api/projects/:id/finance', async (req, res) =>
    res.json(await store.projectFinance(z.uuid().parse(req.params.id))));
  app.post('/api/projects/:id/finance/categories', async (req, res) =>
    res.status(201).json(await store.addFinanceCategory(z.uuid().parse(req.params.id), req.body, req.actor)));
  app.delete('/api/projects/:id/finance/expenses/:expense', async (req, res) =>
    res.json(await store.deleteExpense(z.uuid().parse(req.params.id), z.uuid().parse(req.params.expense), req.body, req.actor)));
  app.post('/api/projects/:id/finance/expenses', async (req, res) =>
    res.status(201).json(await store.addExpense(z.uuid().parse(req.params.id), req.body, req.actor)));
  app.post('/api/projects/:id/finance/settlements', async (req, res) =>
    res.status(201).json(await store.settleFinance(z.uuid().parse(req.params.id), req.body, req.actor)));

  app.get('/api/projects/:id/context', async (req, res) => res.json(await store.projectContext(z.uuid().parse(req.params.id))));
  app.put('/api/projects/:id/context', async (req, res) =>
    res.json(await store.setProjectContext(z.uuid().parse(req.params.id), req.body, req.actor)));
  app.get('/api/projects/:id/activity', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const ctx = await store.projectContext(id);
    const [github, pushed] = await Promise.all([commits(ctx.repositorio, ctx.branch), store.githubEvents(ctx.repositorio, ctx.branch)]);
    const items = mergeGithubActivity(pushed, github.commits).slice(0, 200);
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
    res.sendFile(file('../node_modules/@google/model-viewer/dist/model-viewer.min.js'), { maxAge: '7d' }));
  // Fonte, ícones e imagens não mudam entre publicações: a CDN e o navegador guardam por 7 dias.
  // app.js, styles.css e index.html são conferidos sempre, para a versão nova chegar na hora.
  app.use('/assets/manrope', express.static(file('../node_modules/@fontsource-variable/manrope/files/'), { maxAge: '7d' }));
  app.use('/assets/icons', express.static(file('../node_modules/lucide-static/icons/'), { maxAge: '7d' }));
  let assets = versionAssets(file('../public/'));
  const fresh = () => (production ? assets : (assets = versionAssets(file('../public/'))));
  app.get(['/', '/index.html'], (_req, res) => res.set('Cache-Control', 'no-cache').type('html').send(fresh().index));
  app.get(/^\/[\w-]+\.(?:js|css)$/, (req, res, next) => {
    const asset = fresh().files.get(req.path.slice(1));
    if (!asset) return next();
    res.set('Cache-Control', req.query.v === asset.v ? 'public, max-age=31536000, immutable' : 'no-cache').type(asset.type).send(asset.body);
  });
  app.use(express.static(file('../public/'), { setHeaders: (res, path) => {
    if (/\.(svg|png|jpe?g|webp|gif|woff2?|glb)$/i.test(path)) res.setHeader('Cache-Control', 'public, max-age=604800');
    else res.setHeader('Cache-Control', 'no-cache');
  } }));
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof AppError) return res.status(error.status).json({ error: error.message });
    if (error instanceof z.ZodError) {
      // Diz qual campo e o que está errado, em vez de um "confira os campos" genérico.
      const issue = error.issues[0];
      const field = FIELD_LABELS[[...(issue?.path || [])].reverse().find((key) => FIELD_LABELS[key])];
      if (!issue) return res.status(400).json({ error: 'Confira os campos informados.' });
      return res.status(400).json({ error: issue.code === 'custom' || !field ? issue.message : `${field}: ${issue.message}` });
    }
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
