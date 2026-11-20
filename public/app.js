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
/** Mural: '' = todos; um id = só os cartões dessa pessoa. */
let person = '';
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
/** Rosto recortado do avatar da equipe; sem avatar, as iniciais. */
const face = (member, cls = '') => {
  const art = member && avatarFor(member.name);
  return art
    ? `<span class="face ${cls}" aria-hidden="true" data-art="${art}"></span>`
    : `<span class="avatar ${cls}" aria-hidden="true">${escape(initialsOf(member?.name || '?'))}</span>`;
};
const AGENTS = ['Codex', 'Claude'];
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

/** Fundo do quadro de cada pessoa (a foto entra pelo CSSOM: a política de segurança não aceita estilo no HTML). */
const BACKGROUNDS = [['noite', 'Noite'], ['couro', 'Couro'], ['asfalto', 'Asfalto'], ['entardecer', 'Entardecer']];
function applyBackground(prefs) {
  const html = document.documentElement;
  html.dataset.bg = prefs?.background || 'noite';
  if (prefs?.backgroundFile) html.style.setProperty('--bg-image', `url('/api/backgrounds/${prefs.backgroundFile}')`);
  else html.style.removeProperty('--bg-image');
}

function backgroundPicker() {
  const prefs = board.preferences || {};
  const current = prefs.background || 'noite';
  return `<div class="bg-picker">
    <h3 id="bg-title">Fundo do quadro</h3>
    <div class="bg-swatches" role="group" aria-labelledby="bg-title">
      ${BACKGROUNDS.map(([key, label]) => `<button type="button" class="bg-swatch" data-action="set-bg" data-bg="${key}" aria-pressed="${current === key}">
        <span class="bg-paint" aria-hidden="true"></span><span>${label}</span></button>`).join('')}
      ${prefs.backgroundFile ? `<button type="button" class="bg-swatch" data-action="set-bg" data-bg="imagem" aria-pressed="${current === 'imagem'}">
        <span class="bg-paint is-photo" aria-hidden="true"></span><span>Sua imagem</span></button>` : ''}
    </div>
    <label class="bg-upload">${icon('image-plus')}<span>${prefs.backgroundFile ? 'Trocar sua imagem' : 'Usar uma imagem sua'}</span>
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="sr-only" data-bg-upload></label>
  </div>`;
}

async function refresh({ shell = false } = {}) {
  board = await request('/board');
  applyBackground(board.preferences);
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
      <button class="account" type="button" data-action="profile" aria-label="Abrir seu perfil">${face(board.user)}<span class="user-name">${escape(board.user.name)}</span></button>
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
    <div><h1>${view === 'board' && board.projects.length > 1
      ? `<label class="title-picker"><select id="project" aria-label="Projeto">${projectOptions(projectId)}</select>${icon('chevron-down')}</label>`
      : escape({ board: board.projects[0]?.name || 'Quadro', mine: 'Minhas tarefas', archive: 'Arquivo' }[view])}</h1>
      <p id="scope-summary" class="muted"></p>
    </div>
    <div id="mural-slot" class="mural-slot"></div>
  </section>
  <div class="filters">
    ${view !== 'archive' ? button('Bloqueados', 'filter', 'circle-alert', '', `aria-pressed="${blockedOnly}"`) : ''}
    ${iconButton('Atualizar quadro', 'refresh', 'refresh-cw')}
    ${button('Novo cartão', 'new', 'plus', 'primary', board.projects.length ? '' : 'disabled')}
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
        <div id="bg-slot">${backgroundPicker()}</div>
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

/** Próximo passo do cartão: um só, discreto, que aparece por inteiro ao passar o mouse. */
function nextCardAction(card) {
  const target = `data-card="${card.id}"`;
  if (card.archived) return button('Restaurar', 'restore', 'archive-restore', 'card-action', target);
  if (card.status === 'done') return button('Arquivar', 'archive-card', 'archive', 'card-action quiet', target);
  if (card.blocked) return '';
  const start = card.status === 'todo';
  return button(start ? 'Começar' : 'Concluir', 'move', start ? 'play' : 'check',
    `card-action ${start ? 'quiet' : 'primary'}`, `${target} data-status="${start ? 'doing' : 'done'}"`);
}

const DAY = 86400000;
const fileUrl = (card, attachment) => `/api/files/${card.id}/${attachment.file}`;
const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' });
/** Prazo em palavras: "Atrasado 2 dias", "Hoje", "Amanhã", "Sex, 24/11". */
function dueLabel(card) {
  if (!card.due) return null;
  const days = Math.round((Date.parse(card.due) - Date.parse(today())) / DAY);
  const short = card.due.split('-').reverse().slice(0, 2).join('/');
  if (card.status === 'done') return { text: short, tone: '' };
  if (days < 0) return { text: days === -1 ? 'Atrasado 1 dia' : `Atrasado ${-days} dias`, tone: 'late' };
  if (days === 0) return { text: 'Hoje', tone: 'soon' };
  if (days === 1) return { text: 'Amanhã', tone: 'soon' };
  if (days < 7) return { text: `${weekday.format(new Date(card.due)).replace('.', '')}, ${short}`, tone: '' };
  return { text: short, tone: '' };
}

/** Último assistente (Codex/Claude) que mexeu no cartão, se a última mudança foi dele. */
const lastAgent = (card) => {
  const last = card.history.at(-1);
  return last && AGENTS.includes(last.source) ? last.source : '';
};

function cardTemplate(card) {
  const assignee = board.members.find((member) => member.id === card.assigneeId);
  const due = dueLabel(card);
  const urgent = card.priority === 'alta' && card.status !== 'done';
  const steps = card.checklist.length;
  const checks = card.checklist.filter((item) => item.done).length;
  const title = escape(card.title);
  const agent = lastAgent(card);
  const actions = card.archived
    ? button('Restaurar', 'restore', 'archive-restore', 'ghost', `data-card="${card.id}"`)
    : Object.entries(stages).filter(([key]) => key !== card.status)
      .map(([key, label]) => button(label, 'move', 'arrow-right', 'ghost', `data-card="${card.id}" data-status="${key}"`)).join('') +
      (card.status === 'done' ? button('Arquivar', 'archive-card', 'archive', 'ghost', `data-card="${card.id}"`) : '');
  return `<article class="card ${moved === card.id ? 'moved' : ''}" data-id="${card.id}" data-status="${card.status}"
    data-urgent="${urgent}" data-blocked="${Boolean(card.blocked)}" ${card.archived ? '' : 'draggable="true"'}>
    ${card.attachments?.length && card.status !== 'done' ? `<button type="button" class="card-cover" data-action="edit" data-card="${card.id}" tabindex="-1" aria-hidden="true">
      <img src="${fileUrl(card, card.attachments.at(-1))}" alt="" loading="lazy" draggable="false">
      ${card.attachments.length > 1 ? `<span class="cover-count">${icon('images')}${card.attachments.length}</span>` : ''}</button>` : ''}
    ${card.blocked && card.status !== 'done' ? `<button type="button" class="card-block" data-action="view-block" data-card="${card.id}">
      ${icon('octagon-pause')}<span><b>Travado:</b> ${escape(card.blocked)}</span></button>` : ''}
    <div class="card-top">
      <h3><button type="button" class="card-title" data-action="edit" data-card="${card.id}">${urgent ? `<span class="urgent">Urgente</span> ` : ''}${title}</button></h3>
      <details class="menu"><summary aria-label="Ações de ${title}" title="Ações do cartão">${icon('ellipsis')}</summary><div class="menu-items">${actions}</div></details>
    </div>
    ${card.description && card.status !== 'done' ? `<p class="card-desc">${escape(card.description.slice(0, 110))}${card.description.length > 110 ? '…' : ''}</p>` : ''}
    ${view !== 'board' ? `<p class="card-project">${escape(board.projects.find((item) => item.id === card.projectId)?.name)}</p>` : ''}
    <div class="card-bottom">
      <span class="card-who" title="${escape(assignee?.name || 'Sem responsável')}">
        ${assignee ? face(assignee, 'card-face') : `<span class="card-face nobody" aria-hidden="true">${icon('user-round')}</span>`}
        <span class="sr-only">${escape(assignee?.name || 'Sem responsável')}</span>
        ${agent ? `<span class="card-agent" title="Última mudança feita pelo ${agent}">${icon('bot')}<span>${agent}</span></span>` : ''}
      </span>
      <span class="card-signals">
        ${due ? `<span class="due" data-tone="${due.tone}"><time datetime="${card.due}">${due.text}</time></span>` : ''}
        ${card.comments.length ? `<span class="signal" aria-label="${card.comments.length} comentários">${icon('message-square')}${card.comments.length}</span>` : ''}
        ${card.attachments?.length && card.status === 'done' ? `<span class="signal" aria-label="${card.attachments.length} prints">${icon('image')}${card.attachments.length}</span>` : ''}
      </span>
      <div class="card-footer">${nextCardAction(card)}</div>
    </div>
    ${steps ? `<div class="trail" data-progress="${checks / steps}" data-full="${checks === steps}" role="img" aria-label="${checks} de ${steps} passos feitos">
      <span class="trail-line"></span><img class="trail-hawk" src="/aguia-dourada.svg" alt=""><span class="trail-count">${checks}/${steps}</span></div>` : ''}
  </article>`;
}

/**
 * Mural da equipe: cada pessoa em pé, com o que está fazendo e o que travou
 * neste projeto, e o selo do assistente (Codex/Claude) quando ele agiu pela
 * pessoa nas últimas 24 h. Tocar na pessoa mostra só os cartões dela.
 */
function muralTemplate(scoped) {
  const since = new Date(Date.now() - 86400000).toISOString();
  const people = [...board.members].sort((a, b) =>
    (a.id === board.user.id ? -1 : b.id === board.user.id ? 1 : a.name.localeCompare(b.name, 'pt-BR')));
  const figures = people.map((member) => {
    const mine = scoped.filter((card) => card.assigneeId === member.id);
    const doing = mine.filter((card) => card.status === 'doing').length;
    const todo = mine.filter((card) => card.status === 'todo').length;
    const stuck = mine.filter((card) => card.blocked && card.status !== 'done').length;
    const agentActs = scoped.flatMap((card) => card.history)
      .filter((event) => event.actor === member.name && AGENTS.includes(event.source) && event.at >= since);
    const agents = [...new Set(agentActs.map((event) => event.source))];
    const load = doing ? `${doing} fazendo` : todo ? `${todo} na fila` : 'Livre';
    const art = avatarFor(member.name);
    return `<li><button type="button" class="figure" data-action="person" data-person="${member.id}"
      aria-pressed="${person === member.id}" data-stuck="${stuck > 0}" data-free="${!doing && !todo}">
      <span class="figure-stage">
        ${art ? `<img class="figure-art" src="/api/avatar-assets/${art}.png" alt="" loading="lazy" draggable="false">`
          : `<span class="figure-initials" aria-hidden="true">${escape(initialsOf(member.name))}</span>`}
        ${agents.length ? `<span class="figure-agent" title="${agents.join(' e ')} trabalhou pela pessoa hoje">${icon('bot')}<span class="sr-only">${agents.join(' e ')} trabalhou hoje</span></span>` : ''}
      </span>
      <span class="figure-name">${escape(member.id === board.user.id ? `${member.name} (você)` : member.name)}</span>
      <span class="figure-load">${load}${stuck ? ` · <b>${stuck} travado${stuck > 1 ? 's' : ''}</b>` : ''}</span>
    </button></li>`;
  }).join('');
  const loose = scoped.filter((card) => !card.assigneeId && card.status !== 'done').length;
  return `<section class="mural" aria-label="Equipe neste projeto">
    <ul class="mural-row">${figures}</ul>
    <p class="mural-note">${person
      ? `Mostrando só os cartões de <strong>${escape(board.members.find((member) => member.id === person).name)}</strong>. <button type="button" class="link" data-action="person" data-person="">Ver todos</button>`
      : loose ? `${loose} ${loose === 1 ? 'cartão está' : 'cartões estão'} sem ninguém. Toque numa pessoa para ver só os dela.` : 'Toque numa pessoa para ver só os cartões dela.'}</p>
  </section>`;
}

function renderContents() {
  const content = document.querySelector('#content');
  if (!content) return;
  const needle = search.trim().toLocaleLowerCase('pt-BR');
  const scoped = (view === 'archive' ? board.archive : board.cards).filter((card) =>
    (view !== 'board' || card.projectId === projectId) &&
    (view !== 'mine' || card.assigneeId === board.user.id));
  if (view !== 'board' || !board.members.some((member) => member.id === person)) person = '';
  const cards = scoped.filter((card) =>
    (!person || card.assigneeId === person) &&
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
    paintTrails(content);
    return;
  }
  const slot = document.querySelector('#mural-slot');
  if (slot) slot.innerHTML = view === 'board' ? muralTemplate(scoped) : '';
  content.innerHTML = `<div class="board">${Object.entries(stages).map(([key, label]) => {
    const inStage = cards.filter((card) => card.status === key);
    return `<section class="column" data-status="${key}" aria-label="${label}">
      <div class="column-head"><span class="stage-icon">${icon(stageIcons[key])}</span><h2>${label}</h2>
      <span class="count" aria-label="${inStage.length} cartões">${inStage.length}</span>
      ${key === 'todo' && board.projects.length && view === 'board' ? iconButton('Adicionar cartão', 'new', 'plus') : ''}</div>
      <div class="cards">${inStage.map(cardTemplate).join('') || `<p class="empty">${emptyText}</p>`}</div>
    </section>`;
  }).join('')}</div>`;
  paintTrails(content);
}

/** A águia voa pela trilha do checklist até onde a equipe chegou (CSP: valor posto pelo CSSOM). */
function paintTrails(scope) {
  for (const trail of scope.querySelectorAll('.trail')) trail.style.setProperty('--p', trail.dataset.progress);
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
    title: `<input class="task-title-input" name="title" value="${escape(card.title)}" placeholder="Nome da tarefa" maxlength="160" aria-label="Título">`,
    description: `<textarea class="task-writing" name="description" maxlength="8000" placeholder="Escreva o que precisa ser feito…" aria-label="Descrição">${escape(card.description)}</textarea>`,
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

/** Hora em palavras: "hoje, 21:54", "ontem, 10:02", "18/11, 09:30". */
function when(iso) {
  const at = new Date(iso);
  const time = at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Fortaleza' });
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Fortaleza' }).format(at);
  const diff = Math.round((Date.parse(today()) - Date.parse(day)) / DAY);
  if (diff === 0) return `hoje, ${time}`;
  if (diff === 1) return `ontem, ${time}`;
  return `${day.split('-').reverse().slice(0, 2).join('/')}, ${time}`;
}

const memberNamed = (name) => board.members.find((member) => member.name === name) || { name };
const agentMark = (source) => (AGENTS.includes(source)
  ? `<span class="card-agent" title="Feito pelo ${source}">${icon('bot')}<span>${source}</span></span>` : '');

/** O que mudou, em frase: "mudou a etapa e mexeu no checklist". */
const ACTIONS = {
  'Criou o cartão': 'criou o cartão', Título: 'mudou o título', Descrição: 'mudou a descrição',
  Responsável: 'trocou o responsável', Prazo: 'mudou o prazo', Prioridade: 'mudou a prioridade',
  Etapa: 'mudou a etapa', Bloqueio: 'mexeu no bloqueio', Arquivo: 'arquivou ou restaurou',
  Checklist: 'mexeu no checklist', Comentário: 'comentou', Print: 'pôs um print', 'Tirou print': 'tirou um print'
};
function actionSentence(action) {
  const parts = action.split(', ').map((part) => ACTIONS[part] || part.toLowerCase());
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}` : parts[0];
}

function showCard(card, origin) {
  if (!card) return;
  const project = board.projects.find((item) => item.id === card.projectId);
  const assignee = board.members.find((item) => item.id === card.assigneeId);
  const done = card.checklist.filter((item) => item.done).length;
  const due = dueLabel(card);
  const details = `<p class="task-project">${escape(project?.name)}${card.archived ? ' · Arquivado' : ''}</p>`;
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
  openDialog(editArea('title', `<span>${escape(card.title)}</span>`, 'task-heading-edit'), `
    <div class="inspector-overview">
      <div class="inspector-meta">
        ${editArea('status', stages[card.status], 'inspector-stage')}
        ${editArea('assignee', `${assignee ? face(assignee, 'card-face') : `<span class="card-face nobody" aria-hidden="true">${icon('user-round')}</span>`}
          ${escape(assignee?.name || 'Sem responsável')}`)}
        ${editArea("due", `${taskIcon("date")} ${due ? due.text : "Sem prazo"}`)}
        ${editArea('priority', `${taskIcon('priority')} ${card.priority === 'alta' ? 'Urgente' : `Prioridade ${priorities[card.priority].toLowerCase()}`}`)}
      </div>
      <div class="inspector-actions">
        ${button('Editar', 'task-section', 'pencil', 'inspector-edit ghost', 'data-section="edit"')}
        ${nextCardAction(card)}
      </div>
    </div>
    <nav class="inspector-nav" aria-label="Seções da ficha">
      ${tabs.map(([key, label, glyph]) => button(taskIcon(glyph) + label, 'task-section', '', 'ghost',
        `data-section="${key}" aria-pressed="${key === 'summary'}" aria-controls="task-${key}"`)).join('')}
    </nav>
    <section class="inspector-section" id="task-summary" data-task-section="summary">
      ${card.blocked ? `<div class="inspector-block">${icon('octagon-pause')}
        <div><h3>${editArea('blocked', 'Travado')}</h3><p>${escape(card.blocked)}</p></div></div>` : ''}
      <section class="inspector-description">
        <h3 class="sr-only">Descrição</h3>
        ${card.description ? `<p>${linkify(card.description)}</p>`
          : editArea('description', `${icon('plus')} Escrever o que precisa ser feito`, 'inspector-empty')}
      </section>
      <section class="inspector-prints" aria-labelledby="prints-title">
        <div class="inspector-progress-label"><h3 id="prints-title">Prints</h3>${(card.attachments || []).length ? `<span>${card.attachments.length}</span>` : ''}</div>
        <ul class="prints">${(card.attachments || []).map((item, index) => `<li><button type="button" class="print" data-action="view-print"
          data-card="${card.id}" data-index="${index}" aria-label="Abrir print ${index + 1} de ${card.attachments.length}, de ${escape(item.by)}">
          <img src="${fileUrl(card, item)}" alt="" loading="lazy"></button></li>`).join('')}
          ${card.archived ? '' : `<li class="print-add-cell"><label class="print-add" data-drop="${card.id}">
            ${icon('image-plus')}<span><b>Colar print</b> com Ctrl+V,<br>arrastar ou escolher</span>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple class="sr-only" data-upload="${card.id}">
          </label></li>`}</ul>
      </section>
      ${`<section class="inspector-checks">
        <div class="inspector-progress-label"><h3>Passos</h3>${editArea('checklist', `${icon('pencil')} ${card.checklist.length ? 'Mudar passos' : 'Adicionar passos'}`, 'inspector-link')}</div>
        ${card.checklist.length ? `<div class="trail" data-progress="${done / card.checklist.length}" data-full="${done === card.checklist.length}" role="img" aria-label="${done} de ${card.checklist.length} passos feitos">
          <span class="trail-line"></span><img class="trail-hawk" src="/aguia-dourada.svg" alt=""><span class="trail-count">${done}/${card.checklist.length}</span></div>` : ''}
        <ul class="steps">${card.checklist.map((item, index) => `<li><button type="button" class="step" data-action="toggle-check"
          data-card="${card.id}" data-index="${index}" aria-pressed="${item.done}" ${card.archived ? 'disabled' : ''}>
          <span class="step-box" aria-hidden="true">${icon('check')}</span><span>${escape(item.title)}</span></button></li>`).join('')}</ul>
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
  paintTrails(dialog);
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
    ${face(memberNamed(item.actor), 'card-face')}
    <div class="comment-body"><p class="comment-by"><strong>${escape(item.actor)}</strong>${agentMark(item.source)}<small>${when(item.at)}</small></p>
      <p class="comment-text">${linkify(item.text)}</p></div></div>`).join('') ||
    '<p class="muted inspector-quiet">Ninguém comentou ainda. Escreva abaixo para a equipe (e os assistentes) verem.</p>';
}

/** Linha do tempo: quem fez, por qual canal, o quê e quando. */
function cardHistory(card) {
  return card.history.slice().reverse().map((entry) => `<li class="moment" data-agent="${AGENTS.includes(entry.source)}">
    ${face(memberNamed(entry.actor), 'card-face')}
    <p><strong>${escape(entry.actor)}</strong> ${escape(actionSentence(entry.action))}${agentMark(entry.source)}</p>
    <small>${when(entry.at)}</small>
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
  if (status === 'done') {
    const figure = root.querySelector(`.figure[data-person="${card.assigneeId}"]`);
    figure?.classList.add('cheer');
    setTimeout(() => figure?.classList.remove('cheer'), 800);
    const who = board.members.find((member) => member.id === card.assigneeId);
    message(who ? `Boa, ${who.name.split(' ')[0]}! Cartão concluído.` : 'Cartão concluído.');
  } else message(`Cartão movido para ${stages[status]}.`);
}

async function updateArchive(id, archived) {
  const card = cardById(id);
  await request(`/cards/${id}`, 'PATCH', { archived, version: card.version });
  await refresh();
  message(archived ? 'Cartão arquivado.' : 'Cartão restaurado.');
}

/** Prints grandes viram WebP de até 2400 px antes de subir (texto continua legível). */
async function shrinkImage(file) {
  if (file.type === 'image/gif' || (file.size < 3_000_000 && file.type !== 'image/bmp')) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob || file), 'image/webp', 0.9));
}

async function uploadPrints(cardId, files) {
  const images = [...files].filter((file) => /^image\/(png|jpeg|webp|gif)$/.test(file.type));
  if (!images.length) return message('Só imagens: PNG, JPG, WebP ou GIF.');
  const drop = dialog.querySelector('.print-add');
  drop?.setAttribute('data-busy', '');
  try {
    for (const file of images) {
      const body = await shrinkImage(file);
      const response = await fetch(`/api/cards/${cardId}/attachments`, { method: 'POST', headers: { 'content-type': body.type || file.type }, body });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Não deu para enviar o print.');
    }
    await refresh();
    if (dialog.open) {
      showCard(cardById(cardId));
      dialog.querySelector('.prints li:nth-last-child(2) .print')?.setAttribute('data-fresh', '');
    }
    message(images.length === 1 ? 'Print colado no cartão.' : `${images.length} prints colados no cartão.`);
  } catch (error) {
    message(error.message);
  } finally {
    drop?.removeAttribute('data-busy');
  }
}

/** Visualizador: o print em tela cheia, setas para o próximo, apagar e abrir o original. */
function viewPrint(cardId, index) {
  const card = cardById(cardId);
  const list = card?.attachments || [];
  const item = list[index];
  document.querySelector('.viewer')?.remove();
  if (!item) return;
  const viewer = document.createElement('div');
  viewer.className = 'viewer';
  viewer.setAttribute('role', 'dialog');
  viewer.setAttribute('aria-modal', 'true');
  viewer.setAttribute('aria-label', `Print ${index + 1} de ${list.length}`);
  viewer.innerHTML = `<img class="viewer-img" src="${fileUrl(card, item)}" alt="Print ${index + 1} do cartão ${escape(card.title)}">
    <div class="viewer-bar">
      <span>${face(memberNamed(item.by), 'card-face')}<b>${escape(item.by)}</b> · ${when(item.at)} · ${index + 1} de ${list.length}</span>
      <span class="viewer-actions">
        <a class="btn ghost" href="${fileUrl(card, item)}" target="_blank" rel="noopener">${icon('external-link')}Abrir original</a>
        ${card.archived ? '' : button('Tirar', 'remove-print', 'trash-2', 'ghost', `data-card="${card.id}" data-attachment="${item.id}"`)}
        ${iconButton('Fechar', 'close-viewer', 'x')}
      </span>
    </div>
    ${index > 0 ? `<button type="button" class="viewer-nav prev" data-action="view-print" data-card="${card.id}" data-index="${index - 1}" aria-label="Print anterior">${icon('chevron-left')}</button>` : ''}
    ${index < list.length - 1 ? `<button type="button" class="viewer-nav next" data-action="view-print" data-card="${card.id}" data-index="${index + 1}" aria-label="Próximo print">${icon('chevron-right')}</button>` : ''}`;
  viewer.dataset.card = cardId;
  viewer.dataset.index = String(index);
  document.body.append(viewer);
  viewer.querySelector('[data-action=close-viewer]').focus();
}

document.addEventListener('keydown', (event) => {
  const viewer = document.querySelector('.viewer');
  if (!viewer) return;
  const index = Number(viewer.dataset.index);
  if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); viewer.remove(); dialog.querySelector(`.print[data-index="${index}"]`)?.focus(); }
  if (event.key === 'ArrowRight') viewPrint(viewer.dataset.card, index + 1);
  if (event.key === 'ArrowLeft' && index > 0) viewPrint(viewer.dataset.card, index - 1);
}, true);

// Ctrl+V com a ficha aberta cola o print no cartão; arrastar uma imagem para a ficha também.
document.addEventListener('paste', (event) => {
  const zone = dialog.open && dialog.querySelector('[data-upload]');
  const files = [...(event.clipboardData?.files || [])];
  if (!zone || !files.some((file) => file.type.startsWith('image/'))) return;
  event.preventDefault();
  void uploadPrints(zone.dataset.upload, files);
});
dialog.addEventListener('dragover', (event) => {
  const zone = dialog.querySelector('.print-add');
  if (!zone || !event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  zone.dataset.over = '';
});
dialog.addEventListener('dragleave', (event) => {
  if (!dialog.contains(event.relatedTarget)) delete dialog.querySelector('.print-add')?.dataset.over;
});
dialog.addEventListener('drop', (event) => {
  const zone = dialog.querySelector('[data-upload]');
  if (!zone || !event.dataTransfer?.files.length) return;
  event.preventDefault();
  delete dialog.querySelector('.print-add')?.dataset.over;
  void uploadPrints(zone.dataset.upload, event.dataTransfer.files);
});
document.addEventListener('change', async (event) => {
  const bgInput = event.target.closest?.('[data-bg-upload]');
  if (bgInput?.files?.[0]) {
    try {
      const body = await shrinkImage(bgInput.files[0]);
      const response = await fetch('/api/preferences/background', { method: 'POST', headers: { 'content-type': body.type || bgInput.files[0].type }, body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não deu para usar essa imagem.');
      board.preferences = data;
      applyBackground(data);
      root.querySelector('#bg-slot').innerHTML = backgroundPicker();
      message('Fundo trocado. Só você vê.');
    } catch (error) { message(error.message); }
    return;
  }
  const input = event.target.closest?.('[data-upload]');
  if (!input?.files?.length) return;
  void uploadPrints(input.dataset.upload, input.files).finally(() => { input.value = ''; });
});

document.addEventListener('click', async (event) => {
  const control = event.target.closest('button[data-action]');
  if (!control) {
    if (event.target.classList?.contains('viewer')) event.target.remove();
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
    } else if (action === 'person') {
      const next = control.dataset.person === person ? '' : control.dataset.person;
      const swap = () => { person = next; renderContents(); };
      if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(swap);
      else swap();
      root.querySelector(`.figure[data-person="${next || control.dataset.person}"]`)?.focus({ preventScroll: true });
    } else if (action === 'profile') {
      root.querySelector('.profile-handle')?.click();
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
      const fromTask = dialog.open && dialog.contains(control);
      await placeCard(card, status);
      if (fromTask) showCard(cardById(card));
      else root.querySelector(`.card-title[data-card="${card}"]`)?.focus({ preventScroll: true });
    } else if (action === 'set-bg') {
      board.preferences = await request('/preferences', 'PUT', { background: control.dataset.bg });
      applyBackground(board.preferences);
      root.querySelector('#bg-slot').innerHTML = backgroundPicker();
      root.querySelector(`.bg-swatch[data-bg="${control.dataset.bg}"]`)?.focus();
    } else if (action === 'view-print') {
      viewPrint(card, Number(control.dataset.index));
    } else if (action === 'close-viewer') {
      document.querySelector('.viewer')?.remove();
    } else if (action === 'remove-print') {
      document.querySelector('.viewer')?.remove();
      await request(`/cards/${card}/attachments/${control.dataset.attachment}`, 'DELETE', {});
      await refresh();
      if (dialog.open) showCard(cardById(card));
      message('Print tirado do cartão.');
    } else if (action === 'toggle-check') {
      const current = cardById(card);
      const index = Number(control.dataset.index);
      const checklist = current.checklist.map((item, i) => (i === index ? { ...item, done: !item.done } : item));
      control.setAttribute('aria-pressed', String(checklist[index].done));
      await request(`/cards/${card}`, 'PATCH', { checklist, version: current.version });
      await refresh();
      const section = dialog.querySelector('[data-task-section]:not([hidden])')?.dataset.taskSection;
      showCard(cardById(card));
      if (section && section !== 'summary') setTaskSection(section);
      dialog.querySelector(`[data-action=toggle-check][data-index="${index}"]`)?.focus({ preventScroll: true });
      if (checklist.every((item) => item.done)) message('Todos os passos feitos. A águia chegou!');
    } else if (action === 'archive-card' || action === 'restore') {
      const fromTask = dialog.open && dialog.contains(control);
      await updateArchive(card, action === 'archive-card');
      if (fromTask) showCard(cardById(card));
      else root.querySelector('[aria-current=page]')?.focus();
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
      applyBackground(null);
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
  try {
    if (!(await request('/session')).signedIn) return login();
    await refresh({ shell: true });
  }
  catch (error) {
    if (error.status === 401) login();
    else {
      root.innerHTML = '<div class="loading"><p>Não foi possível carregar o quadro.</p><button type="button" class="btn">Tentar novamente</button></div>';
      root.querySelector('button').onclick = start;
    }
  } finally { root.removeAttribute('aria-busy'); }
}
void start();
