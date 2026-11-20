import { setupTaskWindow } from './task-window.js';
import { renderTaskCalendar } from './task-calendar.js';
import { playCardFlight } from './card-flight.js';
import { avatarFor, setupProfileDock } from './profile-dock.js';

const root = document.querySelector('#root');
const dialog = document.querySelector('#dialog');
const notice = document.querySelector('#notice');
setupTaskWindow(dialog);
const stages = { todo: 'A fazer', doing: 'Em andamento', done: 'Concluído' };
const priorities = { alta: 'Alta', normal: 'Normal', baixa: 'Baixa' };
let board;
let loginProfiles = [];
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
const taskIcon = (name) => {
  const paths = {
    task: 'M4 4h11l5 5v11H4zM15 4v5h5M8 13h8M8 16h5',
    person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c0-4 3-6 8-6s8 2 8 6',
    date: 'M4 6h16v14H4zM8 4v4m8-4v4M4 11h16m-12 4h2m4 0h2',
    stage: 'M5 17l7-10 7 10H5zM12 7V3m0 14v4',
    text: 'M4 5h16M4 10h16M4 15h11M4 20h6',
    priority: 'M5 21V4h13l-3 4 3 4H5',
    block: 'M12 3l9 9-9 9-9-9zM12 7v6m0 3v1',
    checks: 'M4 6l2 2 4-4m3 3h7M4 13l2 2 4-4m3 3h7M13 20h7',
    chat: 'M4 5h16v11H11l-5 4v-4H4zM8 10h8',
    history: 'M5 11a7 7 0 1 1 2 6M5 5v6h6m1-3v4l3 2',
    left: 'M4 5h16v14H4zM9 5v14M17 9l-3 3 3 3',
    right: 'M4 5h16v14H4zM15 5v14M7 9l3 3-3 3',
    resize: 'M8 20l12-12M13 20l7-7M18 20l2-2',
    grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01'
  };
  return `<svg class="icon task-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
};
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

const pinField = (name, autocomplete) => `<input class="pin-input" name="${name}"
  type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4"
  autocomplete="${autocomplete}" required>`;

function renderLogin(body) {
  root.className = 'login';
  root.innerHTML = `<section class="login-panel">${brand}${body}</section>`;
}

function pickProfile() {
  renderLogin(`<h1 tabindex="-1">Quem está entrando?</h1>${
    loginProfiles.length ? `<div class="login-profiles">${loginProfiles.map((profile) => `
      <button class="login-choice btn" type="button" data-action="choose-profile" data-profile="${profile.id}">
        <span class="avatar" aria-hidden="true">${escape(initialsOf(profile.name))}</span>
        <span>${escape(profile.name)}</span>${icon('chevron-right')}
      </button>`).join('')}</div>` : '<p class="muted">Ainda não há perfis cadastrados.</p>'}`);
}

async function login() {
  renderLogin('<p class="muted">Carregando perfis…</p>');
  try {
    loginProfiles = await request('/profiles');
    pickProfile();
  } catch {
    renderLogin(`<p role="alert">Não foi possível carregar os perfis.</p>
      ${button('Tentar novamente', 'retry-login', 'refresh-cw')}`);
  }
}

function showPinEntry(profile) {
  renderLogin(`<div class="login-person"><span class="avatar" aria-hidden="true">${escape(initialsOf(profile.name))}</span>
    <h1>${escape(profile.name)}</h1></div>
    <form data-form="login" data-member="${profile.id}">
      ${field('PIN de 4 dígitos', pinField('pin', 'current-password'))}
      <div class="error" role="alert"></div><button class="btn primary">Entrar</button>
      ${button('Trocar de perfil', 'pick-profile', 'arrow-left', 'ghost')}
    </form>`);
  root.querySelector('[name=pin]').focus();
}

function showChangePin() {
  openDialog('Alterar PIN', `<form data-form="change-pin">
    ${field('PIN atual', pinField('currentPin', 'current-password'))}
    ${field('Novo PIN', pinField('newPin', 'new-password'))}
    ${field('Confirme o novo PIN', pinField('confirmPin', 'off'))}
    <div class="error" role="alert"></div><div><button class="btn primary">Salvar PIN</button></div>
  </form>`, '[name=currentPin]');
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
        ${button('Alterar PIN', 'change-pin', 'key-round', 'profile-pin')}
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
  const task = Boolean(details);
  delete dialog.dataset.editing;
  delete dialog.dataset.editorStep;
  if (dialog.open && dialog.classList.contains('task-dialog') !== task) dialog.close();
  const opening = !dialog.open;
  if (opening) restoreFocus = document.activeElement;
  dialog.classList.toggle('task-dialog', task);
  const tools = task ? `<div class="task-window-tools">
    <button class="btn tile ghost task-dock-control" type="button" data-task-dock="left" aria-label="Encaixar à esquerda" title="Encaixar à esquerda">${taskIcon('left')}</button>
    <button class="btn tile ghost task-dock-control" type="button" data-task-dock="right" aria-label="Encaixar à direita" title="Encaixar à direita">${taskIcon('right')}</button>
    ${iconButton('Fechar', 'close', 'x')}
  </div>` : iconButton('Fechar', 'close', 'x');
  dialog.innerHTML = `<header class="dialog-head ${task ? 'task-drag' : ''}">
    ${task ? `<span class="task-grip" title="Arraste a ficha">${taskIcon('grip')}</span>` : ''}
    <div class="dialog-headline">
    <h2 id="dialog-title" tabindex="-1">${title}</h2>${details}</div>${tools}</header>
    <div class="dialog-body">${html}</div>${footer}${task ? `
      <span class="task-snap-hawk" aria-hidden="true"></span>
      <button class="task-resize" type="button" aria-label="Redimensionar ficha com as setas" title="Puxe para redimensionar">${taskIcon('resize')}</button>` : ''}`;
  if (opening) {
    if (task) dialog.show(); else dialog.showModal();
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

const editorSteps = [
  ['title', 'Título', 'task'], ['description', 'Descrição', 'text'],
  ['assignee', 'Responsável', 'person'], ['due', 'Prazo', 'date'],
  ['priority', 'Prioridade', 'priority'], ['status', 'Etapa', 'stage'],
  ['blocked', 'Bloqueio', 'block'], ['checklist', 'Checklist', 'checks']
];

function editArea(step, content, className = '') {
  return `<button class="task-edit-area ${className}" type="button" data-action="task-section"
    data-section="edit" data-step="${step}">${content}</button>`;
}

function taskOptions(name, options, selected) {
  return `<div class="task-options">${options.map(([id, label, emblem]) => `<label class="task-option">
    <input type="radio" name="${name}" value="${escape(id)}" ${id === selected ? 'checked' : ''}>
    <span>${emblem}${escape(label)}</span>
  </label>`).join('')}</div>`;
}

function editorPanels(card) {
  const people = [['', 'Sem responsável', taskIcon('person')], ...board.members.map((member) => {
    const avatar = avatarFor(member.name);
    const emblem = avatar ? `<img class="editor-avatar" loading="lazy" src="/api/avatar-assets/${avatar}.png" alt="">`
      : `<span class="avatar" aria-hidden="true">${escape(initialsOf(member.name))}</span>`;
    return [member.id, member.name, emblem];
  })];
  const panels = {
    title: field('Título', `<input class="task-title-input" name="title" value="${escape(card.title)}" placeholder="Nome da tarefa" maxlength="160">`),
    description: field('Descrição', `<textarea class="task-writing" name="description" maxlength="8000" placeholder="Escreva o que precisa ser feito…">${escape(card.description)}</textarea>`),
    assignee: taskOptions('assigneeId', people, card.assigneeId || ''),
    due: `<input type="hidden" name="due" value="${card.due || ''}"><div class="task-calendar"></div>
          ${button('Tirar prazo', 'task-clear-day', '', 'ghost')}`,
    priority: taskOptions('priority', Object.entries(priorities).map(([id, label]) => [id, label, taskIcon('priority')]), card.priority),
    status: card.archived ? '<p class="muted">Restaure o cartão para mudar a etapa.</p>'
      : taskOptions('status', Object.entries(stages).map(([id, label]) => [id, label, taskIcon('stage')]), card.status),
    blocked: field('Motivo do bloqueio', `<textarea class="task-writing" name="blocked" maxlength="500" placeholder="Qual é o impedimento?">${escape(card.blocked)}</textarea>`),
    checklist: `<div id="checklist" class="cards">${card.checklist.map(checklistItem).join('')}</div>
      ${button('Adicionar passo', 'add-check', 'plus')}`
  };
  return editorSteps.map(([key, label, glyph]) => `<section class="editor-step" data-editor-step="${key}" aria-label="${label}" hidden>
    <h3 class="editor-step-title">${taskIcon(glyph)} ${label}</h3>${panels[key]}
  </section>`).join('');
}

function showCard(card, origin) {
  if (!card) return;
  const project = board.projects.find((item) => item.id === card.projectId);
  const assignee = board.members.find((item) => item.id === card.assigneeId);
  const done = card.checklist.filter((item) => item.done).length;
  const details = `<p class="task-project">${icon('layers-2')} ${escape(project?.name)}
    ${card.archived ? '<span class="chip">Arquivado</span>' : ''}
    ${card.blocked ? '<span class="chip warn">Bloqueado</span>' : ''}</p>`;
  const footer = `<footer class="task-footer">
    <p class="task-feedback" role="status" hidden></p>
    <div class="inspector-edit-actions" hidden>
      ${button('Cancelar', 'task-cancel', '', 'ghost', `data-card="${card.id}"`)}
      ${button('Anterior', 'task-step-shift', 'arrow-left', 'ghost', 'data-offset="-1"')}
      ${button('Próxima', 'task-step-shift', 'arrow-right', '', 'data-offset="1"')}
      <button class="btn primary" type="submit" form="task-edit">${icon('check')} Salvar alterações</button>
    </div>
  </footer>`;
  const tabs = [
    ['summary', 'Resumo', 'task'],
    ['conversation', 'Conversa', 'chat'],
    ['history', 'Histórico', 'history']
  ];
  openDialog(editArea('title', `${taskIcon('task')} <span>${escape(card.title)}</span>`, 'task-heading-edit'), `
    <div class="inspector-overview">
      <div class="inspector-meta">
        ${editArea('status', `${taskIcon('stage')} ${stages[card.status]}`, 'inspector-stage')}
        ${editArea('assignee', `${assignee ? `<span class="avatar" aria-hidden="true">${escape(initialsOf(assignee.name))}</span>` : taskIcon('person')}
          ${escape(assignee?.name || 'Sem responsável')}`)}
        ${editArea('due', `${taskIcon('date')} ${card.due ? card.due.split('-').reverse().join('/') : 'Sem prazo'}`)}
        ${editArea('priority', `${taskIcon('priority')} ${priorities[card.priority]}`)}
      </div>
      ${button('Editar', 'task-section', 'pencil', 'inspector-edit', 'data-section="edit"')}
    </div>
    <nav class="inspector-nav" aria-label="Seções da ficha">
      ${tabs.map(([key, label, glyph]) => button(taskIcon(glyph) + label, 'task-section', '', 'ghost',
        `data-section="${key}" aria-pressed="${key === 'summary'}" aria-controls="task-${key}"`)).join('')}
    </nav>
    <section class="inspector-section" id="task-summary" data-task-section="summary">
      ${card.blocked ? `<div class="inspector-block">${taskIcon('block')}
        <div><h3>${editArea('blocked', 'Bloqueio')}</h3><p>${escape(card.blocked)}</p></div></div>` : ''}
      <section class="inspector-description">
        <h3>${editArea('description', taskIcon('text') + 'Descrição')}</h3><p class="${card.description ? '' : 'muted'}">${card.description ? linkify(card.description) : 'Sem descrição.'}</p>
      </section>
      ${`<section class="inspector-checks">
        <div class="inspector-progress-label"><h3>${editArea('checklist', taskIcon('checks') + 'Checklist')}</h3><span>${card.checklist.length ? `${done}/${card.checklist.length}` : 'Sem passos'}</span></div>
        ${card.checklist.length ? `<progress value="${done}" max="${card.checklist.length}" aria-label="Passos concluídos"></progress>` : ''}
        <ul>${card.checklist.map((item) => `<li data-done="${item.done}">${icon(item.done ? 'circle-check' : 'circle')}
          <span>${escape(item.title)}</span><span class="sr-only">${item.done ? 'Concluído' : 'A fazer'}</span></li>`).join('')}</ul>
      </section>`}
    </section>
    <section class="inspector-section" id="task-conversation" data-task-section="conversation" hidden>
      <div id="task-comments">${cardActivity(card)}</div>
      <form class="inspector-compose" data-form="comment" data-card="${card.id}" data-version="${card.version}">
        ${field('Escrever comentário', '<textarea name="comment" maxlength="2000" required></textarea>')}
        <div class="error" role="alert"></div><div><button class="btn">${icon('send')} Comentar</button></div>
      </form>
    </section>
    <section class="inspector-section" id="task-history" data-task-section="history" hidden>
      <ol class="history" id="task-history-list">${cardHistory(card)}</ol>
    </section>
    <section class="inspector-section" data-task-section="edit" hidden>
      <form id="task-edit" data-form="edit" data-card="${card.id}" data-version="${card.version}">
        <nav class="editor-steps" aria-label="Etapas da edição">${editorSteps.map(([key, label, glyph]) =>
          button(taskIcon(glyph) + `<span>${label}</span>`, 'task-step', '', 'ghost', `data-step="${key}"`)).join('')}</nav>
        ${editorPanels(card)}
        <div class="error task-edit-error" role="alert"></div>
      </form>
    </section>`, '#dialog-title', { details, footer, origin });
}

function setTaskSection(section, step = 'title') {
  dialog.dataset.editing = String(section === 'edit');
  for (const panel of dialog.querySelectorAll('[data-task-section]')) panel.hidden = panel.dataset.taskSection !== section;
  for (const control of dialog.querySelectorAll('.inspector-nav [data-section]')) {
    control.setAttribute('aria-pressed', String(control.dataset.section === section));
  }
  const editing = section === 'edit';
  dialog.querySelector('.inspector-edit-actions').hidden = !editing;
  dialog.querySelector('.inspector-edit').hidden = editing;
  if (editing) setEditorStep(step);
}

function setEditorStep(step, focus = true) {
  const panel = dialog.querySelector(`[data-editor-step="${step}"]`);
  if (!panel) return;
  for (const item of dialog.querySelectorAll('[data-editor-step]')) item.hidden = item !== panel;
  for (const control of dialog.querySelectorAll('.editor-steps button')) {
    control.setAttribute('aria-pressed', String(control.dataset.step === step));
  }
  const previous = dialog.dataset.editorStep;
  dialog.dataset.editorStep = step;
  if (previous !== step && panel.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    panel.animate([{ opacity: .55, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
      { duration: 170, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
  const position = editorSteps.findIndex(([key]) => key === step);
  dialog.querySelector('[data-action=task-step-shift][data-offset="-1"]').disabled = position === 0;
  dialog.querySelector('[data-action=task-step-shift][data-offset="1"]').disabled = position === editorSteps.length - 1;
  if (step === 'due' && !panel.querySelector('.calendar-day')) renderTaskCalendar(panel, today());
  if (focus) (panel.querySelector('input:not([type=hidden]), textarea, .calendar-day[aria-pressed=true]') ||
    dialog.querySelector(`.editor-steps [data-step="${step}"]`))?.focus({ preventScroll: true });
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
      <p class="muted">O novo perfil começa com o PIN 1234.</p>
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
    if (action === 'choose-profile') {
      const profile = loginProfiles.find((item) => item.id === control.dataset.profile);
      if (profile) showPinEntry(profile);
    } else if (action === 'pick-profile') {
      pickProfile();
      root.querySelector('h1')?.focus();
    } else if (action === 'retry-login') {
      await login();
    } else if (action === 'change-pin') {
      showChangePin();
    } else if (['board', 'mine', 'archive'].includes(action)) {
      navigate(action);
    } else if (action === 'filter') {
      blockedOnly = !blockedOnly; control.setAttribute('aria-pressed', blockedOnly); renderContents();
    } else if (action === 'refresh') { await refresh(); message('Quadro atualizado.'); }
    else if (action === 'new') showNew();
    else if (action === 'edit' || action === 'view-block') {
      showCard(cardById(card), control.closest('.card')?.getBoundingClientRect());
      if (action === 'view-block') {
        const block = dialog.querySelector('.inspector-block');
        block?.setAttribute('tabindex', '-1');
        block?.focus({ preventScroll: true });
      }
    } else if (action === 'task-section') setTaskSection(control.dataset.section, control.dataset.step);
    else if (action === 'task-step') setEditorStep(control.dataset.step);
    else if (action === 'task-step-shift') {
      const index = editorSteps.findIndex(([key]) => key === dialog.dataset.editorStep);
      setEditorStep(editorSteps[index + Number(control.dataset.offset)]?.[0]);
    }
    else if (['task-month', 'task-day', 'task-clear-day'].includes(action)) {
      const panel = control.closest('.editor-step');
      const due = panel.querySelector('[name=due]');
      if (action !== 'task-month') due.value = control.dataset.date || '';
      renderTaskCalendar(panel, today(), Number(control.dataset.offset || 0));
      const target = action === 'task-month' ? `[data-offset="${control.dataset.offset}"]` : '[aria-pressed=true], [aria-current=date], .calendar-day';
      panel.querySelector(target)?.focus({ preventScroll: true });
    }
    else if (action === 'task-cancel') {
      showCard(cardById(card));
      dialog.querySelector('.inspector-edit')?.focus();
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
      await request('/login', 'POST', { memberId: form.dataset.member, pin: data.pin });
      await refresh({ shell: true });
    } else if (kind === 'change-pin') {
      if (data.newPin !== data.confirmPin) throw new Error('Os PINs novos precisam ser iguais.');
      await request('/pin', 'POST', { currentPin: data.currentPin, newPin: data.newPin });
      dialog.close();
      message('PIN alterado.');
    } else if (kind === 'new') {
      const card = await request('/cards', 'POST', data);
      view = 'board'; projectId = card.projectId; search = ''; blockedOnly = false;
      dialog.close(); await refresh({ shell: true }); message('Cartão criado.');
      root.querySelector(`.card-title[data-card="${card.id}"]`)?.focus();
    } else if (kind === 'edit' || kind === 'comment') {
      if (kind === 'edit') {
        if (!data.title.trim()) {
          setEditorStep('title');
          throw new Error('Informe o título da tarefa.');
        }
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
        showCard(card);
        dialog.querySelector('.inspector-edit')?.focus({ preventScroll: true });
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
    if (kind === 'login' && error.status === 401) {
      const pin = form.querySelector('[name=pin]');
      pin.value = '';
      pin.focus();
    }
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
  if (event.target.classList.contains('pin-input')) {
    event.target.value = event.target.value.replace(/[^0-9]/g, '');
    const error = event.target.form?.querySelector('.error');
    if (error) error.textContent = '';
  }
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
  if (event.key === 'Escape' && dialog.open && dialog.classList.contains('task-dialog')) {
    dialog.close();
    return;
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
