/**
 * Tela Empresa. Parte 1: Notas — um mural de folhas de caderno que a equipe arrasta à vontade.
 * Clicar numa nota (ou soltá-la na borda direita) abre a nota flutuando na lateral: dá para editar
 * e continuar usando o site. As notas abertas ficam só neste navegador.
 */
import { setupAgenda } from './company-agenda.js';

const COLORS = [['papel', 'Papel'], ['amarelo', 'Amarelo'], ['azul', 'Azul'], ['verde', 'Verde'], ['rosa', 'Rosa']];
const NOTE_WIDTH = 260;
const EDGE = 72;
const OPEN_KEY = 'gavyo-notas-abertas';

export function setupCompany({ request, escape, face, icon, message, onExpired }) {
  let notes = [];
  let tab = 'notas';
  let host = null;
  let pollTimer = 0;
  let drag = null;
  let lastPaint = '';
  const opened = new Set(readOpened());
  const agenda = setupAgenda({ request, escape, face, icon, message, onExpired });
  const dock = document.createElement('aside');
  dock.className = 'note-dock';
  dock.setAttribute('aria-label', 'Notas abertas');
  document.body.append(dock);

  function readOpened() { try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '[]'); } catch { return []; } }
  function saveOpened() { try { localStorage.setItem(OPEN_KEY, JSON.stringify([...opened])); } catch { /* só nesta aba */ } }
  const byId = (id) => notes.find((note) => note.id === id);
  const when = (iso) => {
    const date = new Date(iso);
    const today = new Date().toDateString() === date.toDateString();
    return today ? `hoje, ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  };
  // Cada folha tem sua inclinação, sempre a mesma para a mesma nota.
  const tilt = (id) => ((parseInt(id.slice(0, 6), 16) % 7) - 3) * 0.55;

  async function load() {
    try {
      notes = await request('/company/note');
    } catch (error) {
      if (error.status === 401) return onExpired();
      message(error.message);
    }
  }

  /* ---------- Tela ---------- */
  async function render(content) {
    host = content;
    content.innerHTML = `<section class="company">
      <header class="company-head">
        <h1>Empresa</h1>
        <p class="muted">${{
          notas: '<span class="nav-long">Arraste as folhas pelo mural. Solte na borda direita da tela para levar a nota com você.</span><span class="nav-short">Toque numa folha para abrir e editar.</span>',
          agenda: '<span class="nav-long">Arraste um post-it para outro dia: o gavião prega lá. Clique num dia para marcar algo.</span><span class="nav-short">Toque num dia para ver e marcar compromissos.</span>'
        }[tab] || 'Ideias, datas e o caixa da GAVYO, num lugar só.'}</p>
      </header>
      <div class="binder" data-tab="${tab}">
        <div class="binder-top">
          <nav class="binder-tabs" aria-label="Partes da empresa">
            ${[['notas', 'Notas', 'sticky-note'], ['agenda', 'Agenda', 'calendar-days'], ['caixa', 'Caixa', 'wallet']].map(([key, label, glyph]) =>
              `<button type="button" class="binder-tab" data-company-tab="${key}" aria-current="${tab === key ? 'page' : 'false'}"><span class="binder-label">${icon(glyph)}${label}</span></button>`).join('')}
          </nav>
          ${tab === 'notas' ? `<button type="button" class="note-pad" data-company="new-note" aria-label="Nova nota: arrancar uma folha do bloco">
            <span class="note-pad-sheet" aria-hidden="true"></span><span class="note-pad-sheet" aria-hidden="true"></span>
            <span class="note-pad-top"><span class="note-pad-plus" aria-hidden="true">+</span>Nova folha</span></button>` : ''}
        </div>
        <div class="company-panel" id="company-panel"></div>
      </div>
    </section>`;
    agenda.stop();
    if (tab === 'agenda') { await agenda.render(content.querySelector('#company-panel')); return; }
    if (tab !== 'notas') { paintSoon(); return; }
    if (!notes.length) await load();
    paintWall(true);
    schedule();
  }

  function paintSoon() {
    host.querySelector('#company-panel').innerHTML = `<div class="company-soon">${icon('wallet')}
      <h2>O caixa com o gavião e o balde chega na próxima parte.</h2><p class="muted">As notas e a agenda já estão funcionando.</p></div>`;
  }

  function noteHtml(note) {
    return `<article class="note" data-id="${note.id}" data-color="${note.color}" tabindex="0" role="button"
        aria-label="Nota ${escape(note.title || 'sem título')}, de ${escape(note.author.name)}. Enter abre; setas movem.">
      <header class="note-head">${face(note.author, 'note-face')}<span><b>${escape(note.author.name)}</b><time datetime="${note.at}">${when(note.at)}</time></span></header>
      ${note.title ? `<h3 class="note-title">${escape(note.title)}</h3>` : ''}
      <p class="note-text">${escape(note.text) || '<span class="note-empty">Nota em branco</span>'}</p>
    </article>`;
  }

  /** Desenha o mural. Sem mudança, não mexe no DOM (não atrapalha quem está olhando). */
  function paintWall(force = false) {
    const panel = host?.querySelector('#company-panel');
    if (!panel || tab !== 'notas') return;
    const paint = JSON.stringify(notes.map((note) => [note.id, note.version]));
    if (!force && paint === lastPaint) return;
    lastPaint = paint;
    const tallest = Math.max(560, ...notes.map((note) => note.y + 340));
    panel.innerHTML = `<div class="notes-wall" id="notes-wall">${notes.map(noteHtml).join('')}
        ${notes.length ? '' : `<div class="notes-empty">${icon('sticky-note')}<p>O mural está vazio.<br>Comece com uma ideia, um lembrete ou uma reclamação de cliente.</p></div>`}
      </div>`;
    const wall = panel.querySelector('#notes-wall');
    wall.style.setProperty('--wall-height', `${tallest}px`);
    for (const element of wall.querySelectorAll('.note')) place(element, byId(element.dataset.id), wall);
    paintDock();
  }

  function place(element, note, wall) {
    const max = Math.max(0, 100 - (NOTE_WIDTH / Math.max(wall.clientWidth, 1)) * 100);
    element.style.setProperty('--x', `${Math.min(note.x, max)}%`);
    element.style.setProperty('--y', `${note.y}px`);
    element.style.setProperty('--tilt', `${tilt(note.id)}deg`);
  }

  function schedule() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      if (!host?.isConnected || tab !== 'notas') return;
      if (!drag && !document.hidden) { await load(); paintWall(); refreshDock(); }
      schedule();
    }, document.hidden ? 30000 : 8000);
  }

  /* ---------- Notas abertas na lateral ---------- */
  function dockHtml(note) {
    return `<article class="note note-open" data-id="${note.id}" data-color="${note.color}" aria-label="Nota aberta">
      <header class="note-head">${face(note.author, 'note-face')}<span><b>${escape(note.author.name)}</b><time datetime="${note.at}">${when(note.at)}</time></span>
        <button type="button" class="note-close" data-company="close-note" aria-label="Fechar nota">${icon('x')}</button></header>
      <input class="note-title-input" data-note-field="title" value="${escape(note.title)}" maxlength="120" placeholder="Título" aria-label="Título da nota">
      <textarea class="note-text-input" data-note-field="text" maxlength="4000" rows="7" placeholder="Escreva aqui…" aria-label="Texto da nota">${escape(note.text)}</textarea>
      <footer class="note-foot">
        <span class="note-colors" role="group" aria-label="Cor da folha">${COLORS.map(([key, label]) =>
          `<button type="button" class="note-swatch" data-company="color" data-color="${key}" aria-label="${label}" aria-pressed="${note.color === key}"></button>`).join('')}</span>
        <button type="button" class="note-delete" data-company="delete-note">${icon('trash-2')}<span>Apagar</span></button>
      </footer>
    </article>`;
  }

  function paintDock() {
    for (const id of [...opened]) if (!byId(id)) opened.delete(id);
    saveOpened();
    const shown = new Set([...dock.querySelectorAll('.note-open')].map((element) => element.dataset.id));
    for (const element of dock.querySelectorAll('.note-open')) if (!opened.has(element.dataset.id)) element.remove();
    for (const id of opened) if (!shown.has(id)) dock.insertAdjacentHTML('beforeend', dockHtml(byId(id)));
    dock.dataset.count = String(opened.size);
    document.documentElement.toggleAttribute('data-note-open', opened.size > 0);
  }

  /** Atualiza notas abertas que mudaram em outro lugar, sem atropelar quem está digitando nelas. */
  function refreshDock() {
    for (const element of dock.querySelectorAll('.note-open')) {
      const note = byId(element.dataset.id);
      if (!note || element.contains(document.activeElement)) continue;
      if (Number(element.dataset.version) === note.version) continue;
      element.outerHTML = dockHtml(note);
      dock.querySelector(`.note-open[data-id="${note.id}"]`).dataset.version = String(note.version);
    }
    paintDock();
  }

  /** Abre a nota na lateral, voando do mural até lá (como a nave do outro site). */
  function openNote(id, from) {
    const fresh = !opened.has(id);
    opened.add(id);
    paintDock();
    const target = dock.querySelector(`.note-open[data-id="${id}"]`);
    if (!target) return;
    target.dataset.version = String(byId(id).version);
    if (fresh && from && target.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const a = from.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      target.animate([
        { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}) rotate(${tilt(id)}deg)`, opacity: 0.9 },
        { transform: 'translate(0, 0) scale(1) rotate(-1deg)', offset: 0.8 },
        { transform: 'none', opacity: 1 }
      ], { duration: 520, easing: 'cubic-bezier(.2,.9,.25,1.05)' });
    }
    target.querySelector(byId(id).title ? '.note-text-input' : '.note-title-input')?.focus({ preventScroll: true });
  }

  function closeNote(id) {
    opened.delete(id);
    dock.querySelector(`.note-open[data-id="${id}"]`)?.remove();
    paintDock();
    host?.querySelector(`.note[data-id="${id}"]`)?.focus({ preventScroll: true });
  }

  /* ---------- Gravar ---------- */
  async function save(id, patch, done) {
    const note = byId(id);
    if (!note) return;
    try {
      const updated = await request(`/company/note/${id}`, 'PATCH', { ...patch, version: note.version });
      notes = notes.map((item) => (item.id === id ? updated : item));
      const open = dock.querySelector(`.note-open[data-id="${id}"]`);
      if (open) { open.dataset.version = String(updated.version); open.dataset.color = updated.color; }
      paintWall();
      if (done) message(done);
    } catch (error) {
      if (error.status === 401) return onExpired();
      message(error.message);
      await load(); paintWall(true); refreshDock();
    }
  }

  async function createNote() {
    const wall = host?.querySelector('#notes-wall');
    const top = wall ? Math.max(24, -wall.getBoundingClientRect().top + 90) : 24;
    try {
      const note = await request('/company/note', 'POST', { x: 3 + (notes.length % 5) * 3, y: Math.round(top + (notes.length % 4) * 18) });
      notes.push(note);
      paintWall(true);
      openNote(note.id, host.querySelector(`.note[data-id="${note.id}"]`));
    } catch (error) { message(error.message); }
  }

  async function removeNote(id, control) {
    if (control.dataset.confirm !== 'true') {
      control.dataset.confirm = 'true';
      control.querySelector('span').textContent = 'Toque de novo para apagar';
      setTimeout(() => { if (control.isConnected) { control.dataset.confirm = 'false'; control.querySelector('span').textContent = 'Apagar'; } }, 3500);
      return;
    }
    try {
      await request(`/company/note/${id}`, 'DELETE', {});
      notes = notes.filter((note) => note.id !== id);
      closeNote(id);
      paintWall(true);
      message('Nota apagada.');
    } catch (error) { message(error.message); }
  }

  /* ---------- Arrastar ---------- */
  document.addEventListener('pointerdown', (event) => {
    const element = event.target.closest?.('.notes-wall .note');
    if (!element || event.button !== 0 || matchMedia('(max-width: 710px)').matches) return;
    const wall = element.parentElement;
    const box = element.getBoundingClientRect();
    drag = { element, wall, id: element.dataset.id, startX: event.clientX, startY: event.clientY, dx: event.clientX - box.left, dy: event.clientY - box.top, moved: false };
    element.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.moved && distance < 5) return;
    if (!drag.moved) { drag.moved = true; drag.element.classList.add('is-dragging'); }
    drag.element.style.translate = `${event.clientX - drag.startX}px ${event.clientY - drag.startY}px`;
    document.documentElement.classList.toggle('note-to-edge', event.clientX > innerWidth - EDGE);
  });
  document.addEventListener('pointerup', (event) => {
    if (!drag) return;
    const { element, wall, id, dx, dy, moved } = drag;
    drag = null;
    document.documentElement.classList.remove('note-to-edge');
    element.classList.remove('is-dragging');
    element.style.translate = '';
    if (!moved) { openNote(id, element); return; }
    if (event.clientX > innerWidth - EDGE) { openNote(id, element); return; }
    const area = wall.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((event.clientX - dx - area.left) / area.width) * 100));
    const y = Math.max(0, Math.round(event.clientY - dy - area.top));
    const note = byId(id);
    note.x = x; note.y = y;
    place(element, note, wall);
    void save(id, { x: Math.round(x * 100) / 100, y });
  });
  document.addEventListener('pointercancel', () => {
    if (!drag) return;
    drag.element.classList.remove('is-dragging');
    drag.element.style.translate = '';
    drag = null;
    document.documentElement.classList.remove('note-to-edge');
  });

  // Teclado: Enter abre; setas movem a folha (alternativa ao arrastar).
  let keyTimer = 0;
  document.addEventListener('keydown', (event) => {
    const element = event.target.closest?.('.notes-wall .note');
    if (!element) return;
    const note = byId(element.dataset.id);
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openNote(note.id, element); return; }
    const step = event.shiftKey ? 5 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step * 20], ArrowDown: [0, step * 20] };
    if (!moves[event.key]) return;
    event.preventDefault();
    note.x = Math.max(0, Math.min(100, note.x + moves[event.key][0]));
    note.y = Math.max(0, note.y + moves[event.key][1]);
    place(element, note, element.parentElement);
    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => void save(note.id, { x: note.x, y: note.y }), 600);
  });

  /* ---------- Cliques e edição ---------- */
  document.addEventListener('click', (event) => {
    const tabButton = event.target.closest?.('[data-company-tab]');
    if (tabButton && host?.contains(tabButton)) { tab = tabButton.dataset.companyTab; void render(host); return; }
    const tapped = event.target.closest?.('.notes-wall .note');
    if (tapped && matchMedia('(max-width: 710px)').matches) { openNote(tapped.dataset.id, tapped); return; }
    const control = event.target.closest?.('[data-company]');
    if (!control) return;
    const id = control.closest('.note')?.dataset.id;
    const action = control.dataset.company;
    if (action === 'new-note') void createNote();
    else if (action === 'close-note') closeNote(id);
    else if (action === 'delete-note') void removeNote(id, control);
    else if (action === 'color') {
      for (const swatch of control.parentElement.children) swatch.setAttribute('aria-pressed', String(swatch === control));
      void save(id, { color: control.dataset.color });
    }
  });
  document.addEventListener('focusout', (event) => {
    const field = event.target.closest?.('.note-open [data-note-field]');
    if (!field) return;
    const id = field.closest('.note-open').dataset.id;
    const key = field.dataset.noteField;
    const value = key === 'title' ? field.value.trim() : field.value;
    if (byId(id) && value !== byId(id)[key]) void save(id, { [key]: value });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && event.target.closest?.('.note-open')) { event.preventDefault(); closeNote(event.target.closest('.note-open').dataset.id); }
  });

  // As notas abertas continuam ali mesmo fora da tela Empresa.
  async function start() { if (opened.size) { await load(); paintDock(); } }

  function stop() { clearTimeout(pollTimer); agenda.stop(); host = null; }
  function signOut() { stop(); notes = []; opened.clear(); saveOpened(); dock.replaceChildren(); }

  return { render, start, stop, signOut };
}
