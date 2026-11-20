import { playCardFlight } from './card-flight.js';
import { avatarFor, setupProfileDock } from './profile-dock.js';

const root = document.querySelector('#root');
const dialog = document.querySelector('#dialog');
const notice = document.querySelector('#notice');
const stages = { todo: 'A fazer', doing: 'Em andamento', done: 'Concluído' };
const priorities = { alta: 'Alta', normal: 'Normal', baixa: 'Baixa' };
let board;
let view = 'board';
let projectId = '';
let search = '';
let blockedOnly = false;
let moved = '';
let dragged;
let noticeTimer;
let restoreFocus;

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const icon = (name) => `<img class="icon" src="/assets/icons/${name}.svg" alt="">`;
const button = (label, action, glyph, cls = '', extra = '') =>
  `<button class="btn ${cls}" type="button" data-action="${action}" ${extra}>${glyph ? icon(glyph) : ''}${label}</button>`;
const iconButton = (label, action, glyph, extra = '') =>
  button('', action, glyph, 'ghost tile', `aria-label="${label}" title="${label}" ${extra}`);
const brand = '<span class="brand"><span class="brand-mark"><img src="/aguia-dourada.svg" alt=""></span><span class="brand-name">GAVYO <strong>Tarefas</strong></span></span>';
const initialsOf = (name) => name.trim().split(/\s+/).slice(0, 2)
  .map((part) => Array.from(part)[0]).join('').toUpperCase();
const stageIcons = { todo: 'circle-dashed', doing: 'loader-circle', done: 'circle-check' };
const option = (id, label, current) => `<option value="${escape(id)}"${id === current ? ' selected' : ''}>${escape(label)}</option>`;
const field = (label, html) => `<label class="field">${label}${html}</label>`;
const projectOptions = (id) => board.projects.map((project) => option(project.id, project.name, id)).join('');
const memberOptions = (id) => option('', 'Sem responsável', id || '') +
  board.members.map((member) => option(member.id, member.name, id)).join('');
const priorityOptions = (value) => Object.entries(priorities).map(([id, label]) => option(id, label, value)).join('');
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Fortaleza' }).format(new Date());
const cardById = (id) => [...board.cards, ...board.archive].find((card) => card.id === id);

async function request(path, method = 'GET', data) {
  const response = await fetch('/api' + path, {
    method, ...(data ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) } : {})
  });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error), { status: response.status });
  return body;
}

function message(text) {
  const destination = dialog.open ? dialog.querySelector('.task-feedback') || notice : notice;
  const other = destination === notice ? dialog.querySelector('.task-feedback') : notice;
  if (other) other.hidden = true;
  destination.textContent = text;
  destination.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { destination.hidden = true; }, 3600);
}

function login() {
  root.className = 'login';
  root.innerHTML = `<section class="login-panel">${brand}<h1>Entre no quadro</h1>
    <form data-form="login">
      ${field('E-mail', '<input name="email" type="email" autocomplete="username" required>')}
      ${field('Senha', '<input name="password" type="password" autocomplete="current-password" required>')}
      <div class="error" role="alert"></div><button class="btn primary">Entrar</button>
    </form></section>`;
}

async function refresh({ shell = false } = {}) {
  board = await request('/board');
  projectId = board.projects.some((project) => project.id === projectId) ? projectId : board.projects[0]?.id || '';
  if (shell) renderShell();
  else renderContents();
}

function renderShell() {
  const profileWasOpen = root.querySelector('.profile-dock')?.dataset.open === 'true';
  const profileAvatar = avatarFor(board.user.name);
  root.className = 'wrap';
  root.innerHTML = `<header class="top">
    <div class="brand-island">${brand}</div>
    <label class="search search-island">${icon('search')}<input type="search" id="search" aria-label="Buscar cartões" placeholder="Buscar cartões" value="${escape(search)}"><kbd aria-hidden="true">${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl '}K</kbd></label>
    <div class="top-actions actions-island">
      <div class="account"><span class="avatar" aria-hidden="true">${escape(initialsOf(board.user.name))}</span><span class="user-name">${escape(board.user.name)}</span></div>
      ${iconButton('Conectar ao Codex ou Claude', 'connect', 'plug')}
      ${board.user.role === 'admin' ? iconButton('Administrar projetos e equipe', 'admin', 'settings') : ''}
      ${iconButton('Sair', 'logout', 'log-out')}
    </div>
    <nav class="workspace-nav" aria-label="Área de trabalho" data-view="${view}">
      <span class="nav-pill" aria-hidden="true"></span>
      ${button('Quadro', 'board', 'columns-3', 'nav-btn', view === 'board' ? 'aria-current="page"' : '')}
      ${button('Minhas tarefas', 'mine', 'list-checks', 'nav-btn', view === 'mine' ? 'aria-current="page"' : '')}
      ${button('Arquivo', 'archive', 'archive', 'nav-btn', view === 'archive' ? 'aria-current="page"' : '')}
    </nav>
  </header>
  <section class="heading">
    <div><h1>${{ board: 'Quadro de tarefas', mine: 'Minhas tarefas', archive: 'Arquivo' }[view]}</h1>
      <p id="scope-summary" class="muted"></p>
    </div>
    ${button('Novo cartão', 'new', 'plus', 'primary', board.projects.length ? '' : 'disabled')}
  </section>
  <div class="filters">
    ${view === 'board' ? `<label class="project-picker">${icon('layers-2')}<select aria-label="Projeto" id="project">${projectOptions(projectId)}</select></label>` : ''}
    ${view !== 'archive' ? button('Bloqueados', 'filter', 'circle-alert', '', `aria-pressed="${blockedOnly}"`) : ''}
    ${iconButton('Atualizar quadro', 'refresh', 'refresh-cw')}
  </div>
  <div id="content"></div>
  <div class="profile-dock" data-open="false">
    <button class="profile-handle" type="button" aria-label="Abrir perfil" aria-expanded="false"
      aria-controls="profile-panel">${icon('grip-vertical')}</button>
    <aside class="profile-panel" id="profile-panel" aria-labelledby="profile-name" inert>
      <button class="btn ghost tile profile-close" type="button" aria-label="Fechar perfil">${icon('x')}</button>
      <div class="profile-avatar-stage">
        ${profileAvatar ? '' : `<span class="profile-initials" aria-hidden="true">${escape(initialsOf(board.user.name))}</span>`}
      </div>
      <div class="profile-info">
        <h2 id="profile-name">${escape(board.user.name)}</h2>
        <p>${board.user.role === 'admin' ? 'Administrador' : 'Membro da equipe'}</p>
      </div>
    </aside>
  </div>`;
  renderContents();
  setupProfileDock(root.querySelector('.profile-dock'), {
    avatar: profileAvatar, name: board.user.name, initiallyOpen: profileWasOpen
  });
}

function navigate(nextView) {
  if (view === nextView) return;
  const previous = root.querySelector('.nav-pill')?.getBoundingClientRect();
  view = nextView;
  search = '';
  blockedOnly = false;
  renderShell();
  const pill = root.querySelector('.nav-pill');
  if (previous?.width && previous.height && pill?.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const next = pill.getBoundingClientRect();
    if (next.width && next.height) {
      pill.animate([
        { transform: `translate(${previous.left - next.left}px, ${previous.top - next.top}px) scaleX(${previous.width / next.width})` },
        { transform: 'none' }
      ], { duration: 320, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
  }
  root.querySelector('[aria-current=page]')?.focus({ preventScroll: true });
}

function nextCardAction(card) {
  const target = `data-card="${card.id}"`;
  if (card.archived) return button('Restaurar', 'restore', 'archive-restore', 'card-action', target);
  if (card.status === 'done') return button('Arquivar', 'archive-card', 'archive', 'card-action', target);
  if (card.blocked) return button('Ver bloqueio', 'view-block', 'circle-alert', 'card-action attention', target);
  const start = card.status === 'todo';
  return button(start ? 'Começar' : 'Concluir', 'move', start ? 'play' : 'check',
    'card-action primary', `${target} data-status="${start ? 'doing' : 'done'}"`);
}

function cardTemplate(card) {
  const assignee = board.members.find((member) => member.id === card.assigneeId);
  const name = assignee?.name || 'Sem responsável';
  const initials = initialsOf(name);
  const overdue = card.due && card.due < today() && card.status !== 'done';
  const due = card.due?.split('-').reverse().join('/');
  const urgent = card.priority === 'alta';
  const checks = card.checklist.filter((item) => item.done).length;
  const title = escape(card.title);
  const actions = card.archived
    ? button('Restaurar', 'restore', 'archive-restore', 'ghost', `data-card="${card.id}"`)
    : Object.entries(stages).filter(([key]) => key !== card.status)
      .map(([key, label]) => button(label, 'move', 'arrow-right', 'ghost', `data-card="${card.id}" data-status="${key}"`)).join('') +
      (card.status === 'done' ? button('Arquivar', 'archive-card', 'archive', 'ghost', `data-card="${card.id}"`) : '');
  return `<article class="card ${moved === card.id ? 'moved' : ''}" data-id="${card.id}" data-priority="${card.priority}" ${card.archived ? '' : 'draggable="true"'}>
    <div class="card-top">
      <h3><button type="button" class="card-title" data-action="edit" data-card="${card.id}">${title}</button></h3>
      <details class="menu"><summary aria-label="Ações de ${title}" title="Ações do cartão">${icon('ellipsis')}</summary><div class="menu-items">${actions}</div></details>
    </div>
    ${card.description ? `<p>${escape(card.description.slice(0, 130))}${card.description.length > 130 ? '…' : ''}</p>` : ''}
    <div class="chips">
      ${view !== 'board' ? `<span class="chip">${escape(board.projects.find((item) => item.id === card.projectId)?.name)}</span>` : ''}
      ${card.blocked ? `<span class="chip warn">${icon('circle-alert')} Bloqueado</span>` : ''}
      ${card.priority !== 'normal' ? `<span class="chip ${urgent ? 'priority-high' : ''}">${icon(urgent ? 'flag' : 'arrow-down')} Prioridade ${card.priority}</span>` : ''}
    </div>
    ${card.blocked ? `<p class="card-block-reason">${escape(card.blocked)}</p>` : ''}
    <div class="card-bottom">
      <div class="card-meta">
        <span class="row">${assignee ? `<span class="avatar" aria-hidden="true">${escape(initials)}</span>` : icon('user-round')}${escape(name)}</span>
        <span class="card-signals">
          ${due ? `<span class="signal ${overdue ? 'overdue' : ''}">${icon('calendar-days')}${overdue ? 'Atrasado · ' : ''}<time datetime="${card.due}" title="${due}">${card.due.startsWith(today().slice(0, 4)) ? due.slice(0, 5) : due}</time></span>` : ''}
          ${card.checklist.length ? `<span class="signal" aria-label="${checks} de ${card.checklist.length} passos concluídos">${icon('list-checks')} ${checks}/${card.checklist.length}</span>` : ''}
          ${card.comments.length ? `<span class="signal" aria-label="${card.comments.length} comentários">${icon('message-square')} ${card.comments.length}</span>` : ''}
        </span>
      </div>
      <div class="card-footer">${nextCardAction(card)}</div>
    </div>
  </article>`;
}

function renderContents() {
  const content = document.querySelector('#content');
  if (!content) return;
  const needle = search.trim().toLocaleLowerCase('pt-BR');
  const scoped = (view === 'archive' ? board.archive : board.cards).filter((card) =>
    (view !== 'board' || card.projectId === projectId) &&
    (view !== 'mine' || card.assigneeId === board.user.id));
  const cards = scoped.filter((card) =>
    (view === 'archive' || !blockedOnly || card.blocked) &&
    (!needle || `${card.title} ${card.description}`.toLocaleLowerCase('pt-BR').includes(needle)));
  const countLabel = (count, singular, plural) => `${count} ${count === 1 ? singular : plural}`;
  const summary = document.querySelector('#scope-summary');
  const done = scoped.filter((card) => card.status === 'done').length;
  const blocked = scoped.filter((card) => card.blocked).length;
  summary.textContent = view === 'archive'
    ? countLabel(scoped.length, 'cartão arquivado', 'cartões arquivados')
    : [countLabel(scoped.length, 'cartão', 'cartões'), countLabel(done, 'concluído', 'concluídos'),
      countLabel(blocked, 'bloqueado', 'bloqueados')].join(' · ');
  const filtering = Boolean(needle || (blockedOnly && view !== 'archive'));
  const emptyText = filtering ? 'Nenhum cartão com estes filtros.' : 'Nenhum cartão nesta etapa.';
  if (!board.projects.length && view === 'board') {
    content.innerHTML = `<p class="empty">${board.user.role === 'admin' ? 'Crie um projeto nas configurações para começar.' : 'A equipe ainda não tem projetos.'}</p>`;
    return;
  }
  if (view === 'archive') {
    content.innerHTML = `<div class="cards full-list">${cards.map(cardTemplate).join('') || '<p class="empty">Nenhum cartão arquivado.</p>'}</div>`;
    return;
  }
  content.innerHTML = `<div class="board">${Object.entries(stages).map(([key, label]) => {
    const inStage = cards.filter((card) => card.status === key);
    return `<section class="column" data-status="${key}" aria-label="${label}">
      <div class="column-head"><span class="stage-icon">${icon(stageIcons[key])}</span><h2>${label}</h2>
      <span class="count" aria-label="${inStage.length} cartões">${inStage.length}</span>
      ${key === 'todo' && board.projects.length && view === 'board' ? iconButton('Adicionar cartão', 'new', 'plus') : ''}</div>
      <div class="cards">${inStage.map(cardTemplate).join('') || `<p class="empty">${emptyText}</p>`}</div>
    </section>`;
  }).join('')}</div>`;
}

function openDialog(title, html, focusSelector, { details = '', footer = '', origin } = {}) {
  const opening = !dialog.open;
  if (opening) restoreFocus = document.activeElement;
  dialog.classList.toggle('task-dialog', Boolean(details));
  dialog.innerHTML = `<header class="dialog-head"><div class="dialog-headline">
    <h2 id="dialog-title" tabindex="-1">${title}</h2>${details}</div>${iconButton('Fechar', 'close', 'x')}</header>
    <div class="dialog-body">${html}</div>${footer}`;
  if (opening) {
    dialog.showModal();
    if (origin && dialog.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const target = dialog.getBoundingClientRect();
      const x = origin.left + origin.width / 2 - target.left - target.width / 2;
      const y = origin.top + origin.height / 2 - target.top - target.height / 2;
      const scale = Math.max(.86, Math.min(1, origin.width / target.width));
      dialog.animate([
        { transform: `translate(${x * .38}px, ${y * .38}px) scale(${scale})`, opacity: .65 },
        { transform: 'none', opacity: 1 }
      ], { duration: 320, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
  }
  if (focusSelector) dialog.querySelector(focusSelector)?.focus({ preventScroll: focusSelector === '#dialog-title' });
}

function showNew() {
  openDialog('Novo cartão', `<form data-form="new">
    ${field('Título', '<input name="title" maxlength="160" required>')}
    ${field('Projeto', `<select name="projectId" required>${projectOptions(projectId)}</select>`)}
    <div class="error" role="alert"></div><div class="row"><button class="btn primary">Criar cartão</button></div>
  </form>`, '[name=title]');
}

function checklistItem(item) {
  return `<div class="check-row">
    <input type="checkbox" aria-label="Marcar passo como concluído" ${item.done ? 'checked' : ''}>
    <input type="text" value="${escape(item.title)}" maxlength="240" placeholder="Descreva o passo" aria-label="Descrição do passo">
    ${iconButton('Remover passo', 'remove-check', 'trash-2')}
  </div>`;
}

function linkify(text) {
  return String(text).split(/(https?:\/\/[^\s<>"']+)/gi).map((part, i) =>
    i % 2 ? `<a href="${escape(part)}" target="_blank" rel="noopener noreferrer">${escape(part)}</a>` : escape(part)).join('');
}

function showCard(card, origin) {
  if (!card) return;
  const project = board.projects.find((item) => item.id === card.projectId);
  const current = Object.keys(stages).indexOf(card.status);
  const details = `<p class="task-project">${icon('layers-2')} ${escape(project?.name)}
    ${card.archived ? '<span class="chip">Arquivado</span>' : ''}
    ${card.blocked ? '<span class="chip warn">Bloqueado</span>' : ''}</p>`;
  const footer = `<footer class="task-footer"><p class="task-feedback" role="status" hidden></p>
    ${button('Voltar', 'close', '')}
    <button class="btn primary" type="submit" form="task-edit">${icon('check')} Salvar alterações</button></footer>`;
  openDialog(escape(card.title), `
    <ol class="task-path" aria-label="Etapa da tarefa">
      ${Object.entries(stages).map(([key, label], index) => `<li
        ${index === current ? 'aria-current="step"' : ''} data-reached="${index < current}">
        <span class="task-step-icon">${icon(index < current ? 'check' : stageIcons[key])}</span><span>${label}</span>
      </li>`).join('')}
    </ol>
    <div class="task-layout">
    <form id="task-edit" data-form="edit" data-card="${card.id}" data-version="${card.version}">
      <section class="task-panel" aria-labelledby="task-info-title"><h3 id="task-info-title">Detalhes da tarefa</h3>
    ${field('Título', `<input name="title" value="${escape(card.title)}" required maxlength="160">`)}
    ${field('Descrição', `<textarea name="description" maxlength="8000">${escape(card.description)}</textarea>`)}
    ${/https?:\/\//i.test(card.description) ? `<div class="task-links muted">${linkify(card.description)}</div>` : ''}
    <div class="row fields">
      ${field('Responsável', `<select name="assigneeId">${memberOptions(card.assigneeId)}</select>`)}
      ${field('Prazo', `<input type="date" name="due" value="${card.due ?? ''}">`)}
      ${field('Prioridade', `<select name="priority">${priorityOptions(card.priority)}</select>`)}
      ${field('Etapa', `<select name="status" ${card.archived ? 'disabled' : ''}>${Object.entries(stages).map(([id, label]) => option(id, label, card.status)).join('')}</select>`)}
    </div>
    ${field('Motivo do bloqueio', `<input name="blocked" value="${escape(card.blocked)}" maxlength="500" placeholder="Deixe vazio se estiver livre">`)}
    </section>
    <section class="task-panel" aria-labelledby="task-check-title">
      <div class="task-panel-heading"><h3 id="task-check-title">Checklist</h3>${button('Adicionar passo', 'add-check', 'plus')}</div>
      <div id="checklist" class="cards">${card.checklist.map(checklistItem).join('')}</div>
    </section>
    <div class="error task-edit-error" role="alert"></div>
  </form>
  <div class="task-sidebar">
  <section class="task-panel" aria-labelledby="task-comments-title">
    <h3 id="task-comments-title">Comentários</h3>
    <div id="task-comments">${cardActivity(card)}</div>
    <form data-form="comment" data-card="${card.id}" data-version="${card.version}">
      ${field('Escrever comentário', '<textarea name="comment" maxlength="2000" required></textarea>')}
      <div class="error" role="alert"></div><div><button class="btn">Comentar</button></div>
    </form>
  </section>
  <details class="task-panel task-history">
    <summary>${icon('history')} <strong>Histórico</strong> ${icon('chevron-down')}</summary>
    <ol class="history" id="task-history-list">${cardHistory(card)}</ol>
  </details></div></div>`, '#dialog-title', { details, footer, origin });
}

function cardActivity(card) {
  return card.comments.map((item) => `<div class="comment">
    <div class="comment-by"><span class="avatar" aria-hidden="true">${escape(initialsOf(item.actor))}</span>
      <div><strong>${escape(item.actor)}</strong><small>${dateFormat.format(new Date(item.at))}</small></div>
    </div><p>${linkify(item.text)}</p></div>`).join('') || '<p class="muted">Nenhum comentário.</p>';
}

function cardHistory(card) {
  return card.history.slice().reverse().map((entry) => `<li>
    <strong>${escape(entry.actor)}${entry.source === 'Web' ? '' : ' via ' + escape(entry.source)}</strong>
    <span>${escape(entry.action)}</span><small>${dateFormat.format(new Date(entry.at))}</small>
  </li>`).join('');
}

function showAdmin() {
  openDialog('Projetos e equipe', `
    <form data-form="project">
      <h3>Projetos</h3>
      <p class="muted">${board.projects.map((item) => escape(item.name)).join(' · ') || 'Nenhum projeto ainda.'}</p>
      ${field('Nome do projeto', '<input name="name" maxlength="100" required>')}
      <div class="error" role="alert"></div><div><button class="btn">Adicionar projeto</button></div>
    </form>
    <form class="detail-section" data-form="member">
      <h3>Equipe</h3>
      <p class="muted">${board.members.map((item) => escape(item.name)).join(' · ')}</p>
      ${field('Nome', '<input name="name" maxlength="100" required>')}
      ${field('E-mail', '<input name="email" type="email" autocomplete="off" maxlength="254" required>')}
      ${field('Senha inicial', '<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="200" required>')}
      <div class="error" role="alert"></div><div><button class="btn">Adicionar colega</button></div>
    </form>`);
}

async function showConnect() {
  const tokens = await request('/tokens');
  openDialog('Conectar IA ao quadro', `<p class="muted">Gere um token pessoal para cada ferramenta. O acesso vence em 30 dias.</p>
    <form class="detail-section" data-form="token">
      ${field('Ferramenta', '<select name="source"><option>Codex</option><option>Claude</option></select>')}
      <div class="error" role="alert"></div><div><button class="btn primary">Gerar token</button></div>
    </form>
    <section class="detail-section"><h3>Tokens ativos</h3>
      ${tokens.map((item) => `<div class="row"><span>${escape(item.source)} · vence em ${dateFormat.format(new Date(Number(item.expires)))}</span>
      ${button('Revogar', 'revoke-token', 'x', 'ghost', `data-token="${item.id}"`)}</div>`).join('') || '<p class="muted">Nenhum token ativo.</p>'}
    </section>`);
}

function showToken(token, source) {
  const url = new URL('/mcp', location.origin).href;
  const instructions = source === 'Codex'
    ? 'Configure o servidor no Codex com o URL acima e a variável de ambiente GAVYO_MCP_TOKEN como bearer_token_env_var.'
    : 'No Claude Code, adicione um servidor HTTP com o URL acima e um cabeçalho Authorization com Bearer seguido do token.';
  openDialog('Token de conexão', `<div class="cards">
    ${field('URL do MCP', `<input readonly value="${escape(url)}">`)}
    ${field('Token pessoal', `<input readonly value="${escape(token)}">`)}
    <p>${instructions}</p><small>Copie o token agora. Ele é exibido uma vez.</small>
  </div>`);
}

async function placeCard(id, status, dragSource) {
  const card = cardById(id);
  if (!card || status === card.status) return;
  await request(`/cards/${id}`, 'PATCH', { status, version: card.version });
  const data = await request('/board');
  const paint = () => {
    board = data;
    moved = dragSource ? '' : id;
    renderContents();
    moved = '';
  };
  const html = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!dragSource && !reduce && document.startViewTransition && !html.hasAttribute('data-card-transition')) {
    const old = document.querySelector(`[data-id="${id}"]`);
    if (old) {
      html.setAttribute('data-card-transition', '');
      old.classList.add('card-transition');
      const transition = document.startViewTransition(() => {
        paint();
        document.querySelector(`[data-id="${id}"]`)?.classList.add('card-transition');
      });
      const cleanup = () => {
        html.removeAttribute('data-card-transition');
        root.querySelector('.card-transition')?.classList.remove('card-transition');
      };
      void transition.finished.then(cleanup, cleanup);
      await transition.updateCallbackDone;
    } else paint();
  } else {
    paint();
    if (dragSource) playCardFlight(root.querySelector(`[data-id="${id}"]`), dragSource);
  }
  message(`Cartão movido para ${stages[status]}.`);
}

async function updateArchive(id, archived) {
  const card = cardById(id);
  await request(`/cards/${id}`, 'PATCH', { archived, version: card.version });
  await refresh();
  message(archived ? 'Cartão arquivado.' : 'Cartão restaurado.');
}

document.addEventListener('click', async (event) => {
  const control = event.target.closest('button[data-action]');
  if (!control) {
    for (const menu of document.querySelectorAll('.menu[open]')) if (!menu.contains(event.target)) menu.open = false;
    return;
  }
  const { action, card, status } = control.dataset;
  try {
    if (['board', 'mine', 'archive'].includes(action)) {
      navigate(action);
    } else if (action === 'filter') {
      blockedOnly = !blockedOnly; control.setAttribute('aria-pressed', blockedOnly); renderContents();
    } else if (action === 'refresh') { await refresh(); message('Quadro atualizado.'); }
    else if (action === 'new') showNew();
    else if (action === 'edit' || action === 'view-block') {
      showCard(cardById(card), control.closest('.card')?.getBoundingClientRect());
      if (action === 'view-block') dialog.querySelector('[name=blocked]')?.focus();
    } else if (action === 'close') dialog.close();
    else if (action === 'admin') showAdmin();
    else if (action === 'connect') await showConnect();
    else if (action === 'revoke-token') {
      await request('/tokens/' + control.dataset.token, 'DELETE', {});
      await showConnect();
      message('Token revogado.');
    }
    else if (action === 'move') {
      const menu = control.closest('details');
      if (menu) menu.open = false;
      control.disabled = true;
      await placeCard(card, status);
      root.querySelector(`.card-title[data-card="${card}"]`)?.focus({ preventScroll: true });
    } else if (action === 'archive-card' || action === 'restore') {
      await updateArchive(card, action === 'archive-card');
      root.querySelector('[aria-current=page]')?.focus();
    } else if (action === 'add-check') {
      const checklist = dialog.querySelector('#checklist');
      if (checklist.children.length >= 60) return message('O cartão aceita até 60 passos.');
      checklist.insertAdjacentHTML('beforeend', checklistItem({ title: '', done: false }));
      checklist.lastElementChild.querySelector('input[type=text]').focus();
    } else if (action === 'remove-check') {
      control.closest('.check-row').remove();
      dialog.querySelector('[data-action=add-check]').focus();
    } else if (action === 'logout') {
      await request('/logout', 'POST', {});
      board = null; view = 'board'; projectId = ''; search = ''; blockedOnly = false;
      login();
    }
  } catch (error) {
    message(error.message);
    if (error.status === 401) { dialog.close(); login(); }
    if (error.status === 409) await refresh().catch(() => {});
  } finally {
    if (action === 'move') control.disabled = false;
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target;
  const kind = form.dataset.form;
  if (!kind) return;
  event.preventDefault();
  const errorNode = form.querySelector('.error');
  const submit = event.submitter || (kind === 'edit'
    ? dialog.querySelector('button[form=task-edit]') : form.querySelector('button:not([type=button])'));
  errorNode.textContent = '';
  submit.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  try {
    if (kind === 'login') {
      await request('/login', 'POST', data);
      await refresh({ shell: true });
    } else if (kind === 'new') {
      const card = await request('/cards', 'POST', data);
      view = 'board'; projectId = card.projectId; search = ''; blockedOnly = false;
      dialog.close(); await refresh({ shell: true }); message('Cartão criado.');
      root.querySelector(`.card-title[data-card="${card.id}"]`)?.focus();
    } else if (kind === 'edit' || kind === 'comment') {
      if (kind === 'edit') {
        data.assigneeId ||= null;
        data.due ||= null;
        data.checklist = Array.from(form.querySelectorAll('.check-row'), (row) => ({
          title: row.querySelector('input[type=text]').value.trim(), done: row.querySelector('input[type=checkbox]').checked
        })).filter((item) => item.title);
      }
      const card = await request(`/cards/${form.dataset.card}`, 'PATCH', { ...data, version: Number(form.dataset.version) });
      await refresh();
      if (kind === 'comment' && form.isConnected) {
        dialog.querySelector('#task-comments').innerHTML = cardActivity(card);
        dialog.querySelector('#task-history-list').innerHTML = cardHistory(card);
        dialog.querySelector('#task-edit').dataset.version = card.version;
        form.dataset.version = card.version;
        form.reset();
        form.querySelector('[name=comment]').focus();
      } else if (kind === 'edit' && form.isConnected) {
        const historyOpen = dialog.querySelector('.task-history').open;
        showCard(card);
        dialog.querySelector('.task-history').open = historyOpen;
        dialog.querySelector('button[form=task-edit]')?.focus({ preventScroll: true });
      }
      message(kind === 'comment' ? 'Comentário registrado.' : 'Cartão atualizado.');
    } else if (kind === 'token') {
      const { token } = await request('/tokens', 'POST', data);
      showToken(token, data.source);
    } else {
      await request(kind === 'project' ? '/projects' : '/members', 'POST', data);
      await refresh({ shell: true });
      showAdmin();
      message(kind === 'project' ? 'Projeto criado.' : 'Colega adicionado.');
    }
  } catch (error) {
    errorNode.textContent = error.message;
    if (error.status === 409 && (kind === 'edit' || kind === 'comment')) {
      errorNode.textContent += ' Feche e reabra o cartão antes de salvar.';
      await refresh().catch(() => {});
    }
  } finally {
    submit.disabled = false;
  }
});

dialog.addEventListener('close', () => {
  if (!dialog.open) dialog.replaceChildren();
  const target = restoreFocus?.isConnected ? restoreFocus : root.querySelector('[aria-current=page]');
  target?.focus({ preventScroll: true });
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'search') { search = event.target.value; renderContents(); }
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'project') { projectId = event.target.value; renderContents(); }
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !dialog.open) {
    const input = document.querySelector('#search');
    if (input) { event.preventDefault(); input.focus(); }
  }
  if (event.key === 'Escape' && document.activeElement.closest('.menu[open]')) {
    const menu = document.activeElement.closest('.menu[open]');
    menu.open = false; menu.querySelector('summary').focus();
  }
});
document.addEventListener('dragstart', (event) => {
  const card = event.target.closest('.card[draggable]');
  if (card && event.target === card) {
    dragged = card.dataset.id;
    event.dataTransfer.setData('text/plain', dragged);
    event.dataTransfer.effectAllowed = 'move';
  }
});
document.addEventListener('dragover', (event) => {
  const column = event.target.closest('.column');
  if (!column || !dragged) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  for (const item of document.querySelectorAll('.column.drop')) if (item !== column) item.classList.remove('drop');
  column.classList.add('drop');
});
document.addEventListener('dragleave', (event) => {
  const column = event.target.closest('.column');
  if (column && !column.contains(event.relatedTarget)) column.classList.remove('drop');
});
document.addEventListener('dragend', () => {
  dragged = null;
  document.querySelectorAll('.drop').forEach((item) => item.classList.remove('drop'));
});
document.addEventListener('drop', (event) => {
  const column = event.target.closest('.column');
  if (!column || !dragged) return;
  event.preventDefault();
  column.classList.remove('drop');
  const source = root.querySelector(`[data-id="${dragged}"]`)?.getBoundingClientRect();
  if (source) void placeCard(dragged, column.dataset.status, source).catch((error) => message(error.message));
});

async function start() {
  try { await refresh({ shell: true }); }
  catch (error) {
    if (error.status === 401) login();
    else {
      root.innerHTML = '<div class="loading"><p>Não foi possível carregar o quadro.</p><button type="button" class="btn">Tentar novamente</button></div>';
      root.querySelector('button').onclick = start;
    }
  } finally { root.removeAttribute('aria-busy'); }
}
void start();
