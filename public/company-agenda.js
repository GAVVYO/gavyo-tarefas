/**
 * Tela Empresa. Parte 2: Agenda — um calendário de parede onde cada compromisso é um post-it.
 * Arrastar o post-it faz ele balançar; ao soltar em outro dia, o gavião vem e prega ali.
 * Criar ou editar é um formulário em três etapas: o quê, quando e a cor do post-it.
 */
const COLORS = [['amarelo', 'Amarelo'], ['rosa', 'Rosa'], ['azul', 'Azul'], ['verde', 'Verde'], ['papel', 'Papel']];
const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const todayIso = () => isoOf(new Date());
const upper = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const longDay = (iso) => upper(new Date(`${iso}T12:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }));
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = () => matchMedia('(max-width: 710px)').matches;

export function setupAgenda({ request, escape, face, icon, message, onExpired }) {
  let events = [];
  let month = (() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); })();
  let panel = null;
  let drag = null;
  let pollTimer = 0;
  let lastPaint = '';
  const form = document.createElement('dialog');
  form.className = 'agenda-form';
  form.setAttribute('aria-labelledby', 'agenda-form-title');
  document.body.append(form);

  const byId = (id) => events.find((item) => item.id === id);
  const tilt = (id) => ((parseInt(id.slice(0, 4), 16) % 9) - 4) * 0.7;

  async function load() {
    try { events = await request('/company/event'); } catch (error) {
      if (error.status === 401) return onExpired();
      message(error.message);
    }
  }

  async function render(target) {
    panel = target;
    lastPaint = '';
    await load();
    paint(true);
    schedule();
  }

  function schedule() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      if (!panel?.isConnected) return;
      if (!drag && !form.open && !document.hidden) { await load(); paint(); }
      schedule();
    }, document.hidden ? 30000 : 9000);
  }

  function postit(item) {
    return `<button type="button" class="postit" data-event="${item.id}" data-color="${item.color}"
        aria-label="${escape(item.title)}${item.time ? `, às ${item.time}` : ''}, de ${escape(item.author.name)}. Abrir">
      <span class="postit-pin" aria-hidden="true"></span>
      ${item.time ? `<time class="postit-time">${item.time}</time>` : ''}<span class="postit-title">${escape(item.title)}</span>
      ${face(item.author, 'postit-face')}</button>`;
  }

  function paint(force = false) {
    if (!panel?.isConnected) return;
    const key = JSON.stringify([isoOf(month), events.map((item) => [item.id, item.version])]);
    if (!force && key === lastPaint) return;
    lastPaint = key;
    const first = new Date(month);
    const start = new Date(first); start.setDate(1 - first.getDay());
    const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    const weeks = days[35].getMonth() === month.getMonth() ? 6 : 5;
    const byDay = new Map();
    for (const item of [...events].sort((a, b) => (a.time || '99').localeCompare(b.time || '99'))) {
      if (!byDay.has(item.day)) byDay.set(item.day, []);
      byDay.get(item.day).push(item);
    }
    const today = todayIso();
    const title = upper(month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
    const inMonth = events.filter((item) => item.day.startsWith(isoOf(month).slice(0, 7))).length;
    panel.innerHTML = `<div class="wall-calendar">
      <div class="calendar-rings" aria-hidden="true">${'<i></i>'.repeat(14)}</div>
      <header class="calendar-top">
        <button type="button" class="calendar-turn" data-agenda="prev" aria-label="Mês anterior">${icon('chevron-left')}</button>
        <div><h2>${title}</h2><p>${inMonth ? `${inMonth} ${inMonth === 1 ? 'compromisso' : 'compromissos'} neste mês` : 'Nenhum compromisso neste mês'}</p></div>
        <button type="button" class="calendar-turn" data-agenda="next" aria-label="Próximo mês">${icon('chevron-right')}</button>
        <button type="button" class="calendar-today" data-agenda="today">Hoje</button>
        <button type="button" class="postit-pad" data-agenda="new" aria-label="Novo compromisso">
          <span class="postit-pad-sheet" aria-hidden="true"></span><span class="postit-pad-top"><b aria-hidden="true">+</b>Novo post-it</span></button>
      </header>
      <div class="calendar-week" aria-hidden="true">${WEEK.map((day) => `<span>${day}</span>`).join('')}</div>
      <div class="calendar-grid" role="grid" aria-label="${title}">${days.slice(0, weeks * 7).map((date) => {
        const iso = isoOf(date);
        const items = byDay.get(iso) || [];
        const shown = items.slice(0, 2);
        return `<div class="calendar-day" role="gridcell" data-day="${iso}" data-out="${date.getMonth() !== month.getMonth()}" data-today="${iso === today}"
            data-weekend="${date.getDay() === 0 || date.getDay() === 6}">
          <button type="button" class="day-number" data-agenda="add" aria-label="${longDay(iso)}${items.length ? `, ${items.length} ${items.length === 1 ? 'compromisso' : 'compromissos'}` : ''}. Novo compromisso neste dia">${date.getDate()}</button>
          <div class="day-postits">${shown.map(postit).join('')}${items.length > 2 ? `<button type="button" class="day-more" data-agenda="day" aria-label="Ver os ${items.length} compromissos">+${items.length - 2}</button>` : ''}</div>
          <span class="day-dots" aria-hidden="true">${items.slice(0, 4).map((item) => `<i data-color="${item.color}"></i>`).join('')}</span>
        </div>`;
      }).join('')}</div>
    </div>`;
    for (const element of panel.querySelectorAll('.postit')) element.style.setProperty('--tilt', `${tilt(element.dataset.event)}deg`);
  }

  /* ---------- Formulário em etapas ---------- */
  let draft = null;
  function openForm(item, day) {
    draft = item ? { ...item } : { day: day || todayIso(), title: '', text: '', time: null, color: 'amarelo' };
    draft.step = item ? 3 : 1;
    paintForm();
    form.showModal();
    form.querySelector(draft.step === 1 ? '[name=title]' : '[data-agenda=save]')?.focus();
  }

  function paintForm() {
    const { step } = draft;
    const steps = [['1', 'O quê'], ['2', 'Quando'], ['3', 'Cor']];
    form.innerHTML = `<form method="dialog" class="agenda-sheet" data-color="${draft.color}">
      <header class="agenda-form-head">
        <h2 id="agenda-form-title">${draft.id ? 'Editar compromisso' : 'Novo compromisso'}</h2>
        <button type="button" class="agenda-x" data-agenda="cancel" aria-label="Fechar">${icon('x')}</button>
      </header>
      <ol class="agenda-steps">${steps.map(([n, label]) => `<li data-state="${Number(n) < step ? 'done' : Number(n) === step ? 'now' : 'next'}">
        <button type="button" data-agenda="step" data-step="${n}" ${Number(n) > step && !draft.id ? 'disabled' : ''}><span>${n}</span>${label}</button></li>`).join('')}</ol>
      <div class="agenda-step" ${step === 1 ? '' : 'hidden'}>
        <label class="agenda-field"><span>Título</span><input name="title" maxlength="120" required value="${escape(draft.title)}" placeholder="Ex.: Reunião com a Loja X"></label>
        <label class="agenda-field"><span>Detalhes <small>(opcional)</small></span><textarea name="text" maxlength="1000" rows="3" placeholder="Endereço, pauta, quem vai…">${escape(draft.text)}</textarea></label>
      </div>
      <div class="agenda-step" ${step === 2 ? '' : 'hidden'}>
        <label class="agenda-field"><span>Dia</span><input name="day" type="date" required value="${draft.day}"></label>
        <label class="agenda-field"><span>Horário <small>(opcional)</small></span><input name="time" type="time" value="${draft.time || ''}"></label>
      </div>
      <div class="agenda-step" ${step === 3 ? '' : 'hidden'}>
        <p class="agenda-field-label">Cor do post-it</p>
        <div class="agenda-colors" role="radiogroup" aria-label="Cor do post-it">${COLORS.map(([key, label]) =>
          `<button type="button" role="radio" class="agenda-color" data-agenda="color" data-color="${key}" aria-checked="${draft.color === key}" aria-label="${label}"></button>`).join('')}</div>
        <div class="agenda-preview" aria-hidden="true">${postitPreview()}</div>
      </div>
      <p class="agenda-error" role="alert" hidden></p>
      <footer class="agenda-form-foot">
        ${draft.id ? `<button type="button" class="agenda-delete" data-agenda="delete">${icon('trash-2')}<span>Tirar do calendário</span></button>` : '<span></span>'}
        <span class="agenda-nav">
          ${step > 1 ? '<button type="button" class="btn ghost" data-agenda="back">Voltar</button>' : ''}
          ${step < 3 ? '<button type="button" class="btn primary" data-agenda="forward">Continuar</button>'
            : `<button type="button" class="btn primary" data-agenda="save">${draft.id ? 'Salvar' : 'Pregar no calendário'}</button>`}
        </span>
      </footer>
    </form>`;
  }

  function postitPreview() {
    return `<span class="postit is-preview" data-color="${draft.color}"><span class="postit-pin"></span>
      ${draft.time ? `<time class="postit-time">${draft.time}</time>` : ''}<span class="postit-title">${escape(draft.title || 'Seu compromisso')}</span></span>`;
  }

  function readForm() {
    const data = new FormData(form.querySelector('form'));
    if (draft.step === 1) { draft.title = String(data.get('title') || '').trim(); draft.text = String(data.get('text') || ''); }
    if (draft.step === 2) { draft.day = String(data.get('day') || ''); draft.time = String(data.get('time') || '') || null; }
  }

  function goTo(step) {
    readForm();
    const error = form.querySelector('.agenda-error');
    if (step > 1 && !draft.title) return showError('Dê um título ao compromisso.', '[name=title]');
    if (step > 2 && !draft.day) return showError('Escolha o dia.', '[name=day]');
    draft.step = step;
    paintForm();
    form.querySelector(step === 1 ? '[name=title]' : step === 2 ? '[name=day]' : '[aria-checked=true]')?.focus();
    void error;
  }

  function showError(text, focus) {
    const error = form.querySelector('.agenda-error');
    error.textContent = text; error.hidden = false;
    form.querySelector(focus)?.focus();
  }

  async function saveForm() {
    readForm();
    if (!draft.title) { draft.step = 1; paintForm(); return showError('Dê um título ao compromisso.', '[name=title]'); }
    const body = { title: draft.title, text: draft.text, day: draft.day, time: draft.time, color: draft.color };
    try {
      const saved = draft.id
        ? await request(`/company/event/${draft.id}`, 'PATCH', { ...body, version: draft.version })
        : await request('/company/event', 'POST', body);
      events = draft.id ? events.map((item) => (item.id === saved.id ? saved : item)) : [...events, saved];
      form.close();
      month = new Date(Number(saved.day.slice(0, 4)), Number(saved.day.slice(5, 7)) - 1, 1);
      paint(true);
      await hawkPins(saved.id);
      message(draft.id ? 'Compromisso salvo.' : 'Pregado no calendário.');
    } catch (error) {
      if (error.status === 401) return onExpired();
      showError(error.message, '[data-agenda=save]');
      if (error.status === 409) await load();
    }
  }

  async function removeEvent(control) {
    if (control.dataset.confirm !== 'true') {
      control.dataset.confirm = 'true';
      control.querySelector('span').textContent = 'Toque de novo para tirar';
      return;
    }
    try {
      await request(`/company/event/${draft.id}`, 'DELETE', {});
      events = events.filter((item) => item.id !== draft.id);
      form.close();
      paint(true);
      message('Compromisso tirado do calendário.');
    } catch (error) { showError(error.message, '[data-agenda=delete]'); }
  }

  /* ---------- O gavião ---------- */
  /** O gavião desce de fora da tela até o post-it e prega o alfinete. */
  function hawkPins(id) {
    const target = panel?.querySelector(`.postit[data-event="${id}"]`);
    if (!target) return Promise.resolve();
    target.classList.add('is-landing');
    if (calm() || !document.body.animate) { target.classList.remove('is-landing'); target.classList.add('is-pinned'); return Promise.resolve(); }
    const box = target.getBoundingClientRect();
    const hawk = document.createElement('img');
    hawk.className = 'agenda-hawk';
    hawk.src = '/aguia-dourada.svg';
    hawk.alt = '';
    document.body.append(hawk);
    const x = box.left + box.width / 2 - 66;
    const y = box.top - 52;
    const fromRight = box.left < innerWidth / 2;
    const flight = hawk.animate([
      { transform: `translate(${fromRight ? innerWidth + 40 : -140}px, ${y - 260}px) rotate(${fromRight ? -18 : 18}deg) scaleX(${fromRight ? -1 : 1})`, opacity: 0 },
      { transform: `translate(${x}px, ${y - 30}px) rotate(${fromRight ? -6 : 6}deg) scaleX(${fromRight ? -1 : 1})`, opacity: 1, offset: 0.55 },
      { transform: `translate(${x}px, ${y + 6}px) rotate(0deg) scaleX(${fromRight ? -1 : 1})`, offset: 0.68 },
      { transform: `translate(${x}px, ${y - 4}px) rotate(0deg) scaleX(${fromRight ? -1 : 1})`, offset: 0.78 },
      { transform: `translate(${fromRight ? -160 : innerWidth + 60}px, ${y - 320}px) rotate(${fromRight ? 14 : -14}deg) scaleX(${fromRight ? -1 : 1})`, opacity: 0 }
    ], { duration: 1500, easing: 'cubic-bezier(.45,.05,.35,1)' });
    setTimeout(() => {
      target.classList.remove('is-landing');
      target.classList.add('is-pinned');
      target.animate?.([{ scale: 1.12 }, { scale: 0.97 }, { scale: 1 }], { duration: 320, easing: 'ease-out' });
    }, 1020);
    return flight.finished.then(() => hawk.remove(), () => hawk.remove());
  }

  /* ---------- Arrastar o post-it para outro dia ---------- */
  document.addEventListener('pointerdown', (event) => {
    const element = event.target.closest?.('.wall-calendar .postit');
    if (!element || event.button !== 0 || phone()) return;
    drag = { element, id: element.dataset.event, x: event.clientX, y: event.clientY, moved: false, over: null };
    element.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove', (event) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
    if (!drag.moved) { drag.moved = true; drag.element.classList.add('is-dragging'); }
    drag.element.style.translate = `${event.clientX - drag.x}px ${event.clientY - drag.y}px`;
    drag.element.style.setProperty('--sway', `${Math.max(-14, Math.min(14, (event.movementX || 0) * 1.6))}deg`);
    drag.element.hidden = true;
    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest('.calendar-day');
    drag.element.hidden = false;
    if (cell !== drag.over) { drag.over?.classList.remove('is-target'); cell?.classList.add('is-target'); drag.over = cell; }
  });
  document.addEventListener('pointerup', async () => {
    if (!drag) return;
    const { element, id, moved, over } = drag;
    drag = null;
    over?.classList.remove('is-target');
    element.classList.remove('is-dragging');
    element.style.translate = '';
    if (!moved) { openForm(byId(id)); return; }
    const item = byId(id);
    if (!over || !item || over.dataset.day === item.day) return;
    try {
      const saved = await request(`/company/event/${id}`, 'PATCH', { day: over.dataset.day, version: item.version });
      events = events.map((entry) => (entry.id === id ? saved : entry));
      paint(true);
      await hawkPins(id);
      message(`Movido para ${longDay(saved.day)}.`);
    } catch (error) {
      if (error.status === 401) return onExpired();
      message(error.message); await load(); paint(true);
    }
  });
  document.addEventListener('pointercancel', () => {
    if (!drag) return;
    drag.over?.classList.remove('is-target');
    drag.element.classList.remove('is-dragging'); drag.element.style.translate = ''; drag = null;
  });

  /* ---------- Cliques ---------- */
  document.addEventListener('click', (event) => {
    const control = event.target.closest?.('[data-agenda]');
    const tappedPostit = phone() && event.target.closest?.('.wall-calendar .postit');
    if (tappedPostit) { openForm(byId(tappedPostit.dataset.event)); return; }
    const dayCell = phone() && !control && event.target.closest?.('.wall-calendar .calendar-day');
    if (dayCell) { showDay(dayCell.dataset.day); return; }
    if (!control) return;
    const action = control.dataset.agenda;
    const day = control.closest('.calendar-day')?.dataset.day;
    if (action === 'prev' || action === 'next') { month = new Date(month.getFullYear(), month.getMonth() + (action === 'next' ? 1 : -1), 1); paint(true); }
    else if (action === 'today') { const now = new Date(); month = new Date(now.getFullYear(), now.getMonth(), 1); paint(true); }
    else if (action === 'new') openForm(null);
    else if (action === 'add') { if (phone()) showDay(day); else openForm(null, day); }
    else if (action === 'day') showDay(day);
    else if (action === 'cancel') form.close();
    else if (action === 'step') goTo(Number(control.dataset.step));
    else if (action === 'forward') goTo(draft.step + 1);
    else if (action === 'back') goTo(draft.step - 1);
    else if (action === 'save') void saveForm();
    else if (action === 'delete') void removeEvent(control);
    else if (action === 'color') {
      draft.color = control.dataset.color;
      for (const swatch of control.parentElement.children) swatch.setAttribute('aria-checked', String(swatch === control));
      form.querySelector('.agenda-sheet').dataset.color = draft.color;
      form.querySelector('.agenda-preview').innerHTML = postitPreview();
    } else if (action === 'open') { form.close(); openForm(byId(control.dataset.event)); }
    else if (action === 'add-day') { form.close(); openForm(null, control.dataset.day); }
  });
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('input')) { event.preventDefault(); if (draft?.step < 3) goTo(draft.step + 1); else void saveForm(); }
  });
  form.addEventListener('click', (event) => { if (event.target === form) form.close(); });

  /** Lista do dia (usada no celular e quando o dia tem mais de dois post-its). */
  function showDay(day) {
    const items = events.filter((item) => item.day === day).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    draft = null;
    form.innerHTML = `<div class="agenda-sheet agenda-day-sheet">
      <header class="agenda-form-head"><h2 id="agenda-form-title">${longDay(day)}</h2>
        <button type="button" class="agenda-x" data-agenda="cancel" aria-label="Fechar">${icon('x')}</button></header>
      <div class="agenda-day-list">${items.length ? items.map((item) => `<button type="button" class="postit is-row" data-agenda="open" data-event="${item.id}" data-color="${item.color}">
          <span class="postit-pin" aria-hidden="true"></span>${item.time ? `<time class="postit-time">${item.time}</time>` : ''}<span class="postit-title">${escape(item.title)}</span>${face(item.author, 'postit-face')}</button>`).join('')
        : '<p class="muted">Nada marcado neste dia.</p>'}</div>
      <footer class="agenda-form-foot"><span></span><button type="button" class="btn primary" data-agenda="add-day" data-day="${day}">${icon('plus')}Novo compromisso</button></footer>
    </div>`;
    form.showModal();
  }

  function stop() { clearTimeout(pollTimer); panel = null; }
  return { render, stop };
}
