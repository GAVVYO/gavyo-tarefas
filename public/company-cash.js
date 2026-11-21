/**
 * Tela Empresa. Parte 3: Caixa — o gavião cuida do balde de dinheiro da empresa.
 * Lançar uma entrada: ele traz uma moeda e solta no balde. Lançar uma saída: ele mergulha e leva uma.
 * Cada lançamento diz quanto, para quê, de quem é, quem lançou, o dia e a categoria.
 */
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const pad = (n) => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const upper = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** "1.234,56" ou "1234.5" → centavos. */
function toCents(text) {
  const clean = String(text || '').replace(/[^\d,.-]/g, '');
  if (!clean) return 0;
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
  return Math.round(Number(normalized) * 100) || 0;
}

export function setupCash({ request, escape, face, icon, message, onExpired, getBoard }) {
  let items = [];
  let month = todayIso().slice(0, 7);
  let filter = 'all';
  let panel = null;
  let pollTimer = 0;
  let lastPaint = '';
  let draft = null;
  const form = document.createElement('dialog');
  form.className = 'cash-form';
  form.setAttribute('aria-labelledby', 'cash-form-title');
  document.body.append(form);

  const members = () => getBoard()?.members || [];
  const projects = () => getBoard()?.projects || [];
  const memberName = (id) => members().find((member) => member.id === id)?.name;
  const byId = (id) => items.find((item) => item.id === id);

  async function load() {
    try { items = await request('/company/cash'); } catch (error) {
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
      if (!form.open && !document.hidden && !panel.querySelector('.cash-scene.is-busy')) { await load(); paint(); }
      schedule();
    }, document.hidden ? 30000 : 10000);
  }

  function totals(list) {
    const entrou = list.filter((item) => item.type === 'in').reduce((sum, item) => sum + item.amountCents, 0);
    const saiu = list.filter((item) => item.type === 'out').reduce((sum, item) => sum + item.amountCents, 0);
    return { entrou, saiu, saldo: entrou - saiu };
  }

  /** Cédula de real desenhada em SVG (verde, com borda, R$ e o gavião no meio). */
  const NOTE_SVG = `<svg viewBox="0 0 96 46" aria-hidden="true"><rect x="1" y="1" width="94" height="44" rx="4" fill="#6fbf8a" stroke="#2f6b45" stroke-width="2"/>
    <rect x="6" y="6" width="84" height="34" rx="2" fill="none" stroke="#2f6b45" stroke-width="1.2" stroke-dasharray="3 2"/>
    <circle cx="48" cy="23" r="11" fill="#9fd9b0" stroke="#2f6b45" stroke-width="1.5"/><text x="48" y="27.5" text-anchor="middle" font-size="12" font-weight="800" fill="#1f4d31">$</text>
    <text x="12" y="20" font-size="9" font-weight="800" fill="#1f4d31">R$</text><text x="84" y="36" text-anchor="end" font-size="9" font-weight="800" fill="#1f4d31">50</text></svg>`;
  /** Mão de desenho (manga, punho e dedos fechados em pinça) apontando para baixo. */
  const HAND_SVG = `<svg viewBox="0 0 70 150" aria-hidden="true">
    <rect x="15" y="0" width="40" height="84" rx="8" fill="#38507a"/><rect x="13" y="72" width="44" height="14" rx="5" fill="#2b3e60"/>
    <path d="M18 84 h34 c6 0 9 6 9 12 v14 c0 10 -8 18 -18 18 h-10 c-10 0 -18 -8 -18 -18 v-14 c0 -6 3 -12 9 -12z" fill="#f0c08a" stroke="#b9875a" stroke-width="1.5"/>
    <path d="M26 124 c0 8 4 13 9 13 s9 -5 9 -13" fill="#f0c08a" stroke="#b9875a" stroke-width="1.5"/>
    <path d="M24 100 h22 M24 109 h22" stroke="#d29f6c" stroke-width="1.6" stroke-linecap="round"/></svg>`;

  function sceneHtml(saldo) {
    const notes = saldo <= 0 ? 0 : Math.min(6, 1 + Math.floor(Math.log10(saldo / 100 + 1) * 1.5));
    return `<div class="cash-scene" aria-hidden="true">
      <span class="cash-perch"><img class="cash-hawk" src="/aguia-dourada.svg" alt="">
        <span class="hawk-eyes"><i><b></b></i><i><b></b></i></span></span>
      <div class="cash-bucket">
        <span class="bucket-handle"></span>
        <span class="bucket-notes">${Array.from({ length: notes }, () => `<span class="bucket-note">${NOTE_SVG}</span>`).join('')}</span>
        <span class="cash-hand"><span class="hand-arm">${HAND_SVG}</span><span class="hand-note">${NOTE_SVG}</span></span>
        <span class="bucket-body"><b>GAVYO</b></span>
      </div>
    </div>`;
  }

  function rowHtml(item) {
    const owner = item.ownerId ? memberName(item.ownerId) || 'ex-membro' : null;
    const whose = owner ? `${item.type === 'in' ? 'para' : 'de'} ${escape(owner)}` : item.type === 'in' ? 'para a empresa' : 'da empresa';
    const project = item.projectId ? projects().find((entry) => entry.id === item.projectId)?.name : '';
    const day = new Date(`${item.day}T12:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    return `<li><button type="button" class="cash-row" data-cash="open" data-id="${item.id}" data-type="${item.type}">
      <span class="cash-arrow" aria-hidden="true">${icon(item.type === 'in' ? 'arrow-down-left' : 'arrow-up-right')}</span>
      <span class="cash-what"><b>${escape(item.description)}</b>
        <small>${item.category ? `<span class="cash-chip">${escape(item.category)}</span>` : ''}${project ? `<span class="cash-chip is-project">${escape(project)}</span>` : ''}
          <span>${whose} · lançado por ${escape(item.author.name)}</span></small></span>
      ${item.ownerId ? face({ name: owner }, 'cash-face') : `<span class="cash-face is-company" aria-hidden="true">${icon('building-2')}</span>`}
      <time datetime="${item.day}">${day}</time>
      <span class="cash-amount">${item.type === 'in' ? '+' : '−'} ${money.format(item.amountCents / 100)}</span>
    </button></li>`;
  }

  function paint(force = false) {
    if (!panel?.isConnected) return;
    const key = JSON.stringify([month, filter, items.map((item) => [item.id, item.version])]);
    if (!force && key === lastPaint) return;
    lastPaint = key;
    const all = totals(items);
    const inMonth = items.filter((item) => item.day.startsWith(month));
    const mt = totals(inMonth);
    const shown = inMonth.filter((item) => filter === 'all' || item.type === filter)
      .sort((a, b) => b.day.localeCompare(a.day) || b.at.localeCompare(a.at));
    const label = upper(new Date(`${month}-15T12:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
    panel.innerHTML = `<div class="cash">
      <section class="cash-hero">
        ${sceneHtml(all.saldo)}
        <div class="cash-balance">
          <p>No balde agora</p>
          <strong data-tone="${all.saldo < 0 ? 'neg' : 'pos'}">${money.format(all.saldo / 100)}</strong>
          <span class="cash-actions">
            <button type="button" class="cash-launch is-in" data-cash="new" data-type="in">${icon('arrow-down-left')}<span class="nav-long">Entrou dinheiro</span><span class="nav-short">Entrou</span></button>
            <button type="button" class="cash-launch is-out" data-cash="new" data-type="out">${icon('arrow-up-right')}<span class="nav-long">Saiu dinheiro</span><span class="nav-short">Saiu</span></button>
          </span>
        </div>
      </section>
      <section class="cash-month">
        <header class="cash-month-head">
          <button type="button" class="calendar-turn" data-cash="prev" aria-label="Mês anterior">${icon('chevron-left')}</button>
          <h2>${label}</h2>
          <button type="button" class="calendar-turn" data-cash="next" aria-label="Próximo mês">${icon('chevron-right')}</button>
        </header>
        <div class="cash-stats">
          <div class="cash-stat is-in"><span>Entrou</span><b>${money.format(mt.entrou / 100)}</b></div>
          <div class="cash-stat is-out"><span>Saiu</span><b>${money.format(mt.saiu / 100)}</b></div>
          <div class="cash-stat is-profit" data-tone="${mt.saldo < 0 ? 'neg' : 'pos'}"><span>${mt.saldo < 0 ? 'Prejuízo' : 'Lucro'} do mês</span><b>${money.format(Math.abs(mt.saldo) / 100)}</b></div>
        </div>
        <div class="cash-filter" role="group" aria-label="Mostrar">
          ${[['all', 'Tudo'], ['in', 'Entradas'], ['out', 'Saídas']].map(([key, text]) => `<button type="button" data-cash="filter" data-filter="${key}" aria-pressed="${filter === key}">${text}</button>`).join('')}
        </div>
        ${shown.length ? `<ul class="cash-list">${shown.map(rowHtml).join('')}</ul>`
          : `<p class="cash-empty">${inMonth.length ? 'Nada com esse filtro neste mês.' : 'Nenhum lançamento neste mês. Use os botões acima quando entrar ou sair dinheiro.'}</p>`}
      </section>
    </div>`;
    panel.querySelectorAll('.bucket-note').forEach((note, i) => {
      note.style.setProperty('--nx', `${(i % 2 ? 1 : -1) * (6 + (i * 9) % 22)}px`);
      note.style.setProperty('--nr', `${(i % 2 ? 1 : -1) * (8 + (i * 13) % 20)}deg`);
    });
  }

  /* ---------- Formulário ---------- */
  function openForm(item, type) {
    draft = item ? { ...item } : { type, amountCents: 0, description: '', ownerId: null, category: '', day: todayIso(), projectId: null };
    const categories = [...new Set(items.map((entry) => entry.category).filter(Boolean))].sort();
    form.innerHTML = `<form method="dialog" class="cash-sheet" data-type="${draft.type}">
      <header class="agenda-form-head"><h2 id="cash-form-title">${item ? 'Editar lançamento' : draft.type === 'in' ? 'Entrou dinheiro' : 'Saiu dinheiro'}</h2>
        <button type="button" class="agenda-x" data-cash="cancel" aria-label="Fechar">${icon('x')}</button></header>
      <div class="cash-type" role="radiogroup" aria-label="Tipo">
        <button type="button" role="radio" data-cash="type" data-type="in" aria-checked="${draft.type === 'in'}">${icon('arrow-down-left')}Entrada</button>
        <button type="button" role="radio" data-cash="type" data-type="out" aria-checked="${draft.type === 'out'}">${icon('arrow-up-right')}Saída</button>
      </div>
      <label class="cash-value"><span>Valor</span><span class="cash-value-box"><i>R$</i><input name="amount" inputmode="decimal" autocomplete="off" required
        value="${draft.amountCents ? (draft.amountCents / 100).toFixed(2).replace('.', ',') : ''}" placeholder="0,00" aria-label="Valor em reais"></span></label>
      <label class="agenda-field"><span>Para quê</span><input name="description" maxlength="300" required value="${escape(draft.description)}" placeholder="${draft.type === 'in' ? 'Ex.: Pagamento do site da Loja X' : 'Ex.: Hospedagem de novembro'}"></label>
      <div class="cash-grid">
        <label class="agenda-field"><span>De quem é</span><select name="ownerId">
          <option value="">Da empresa</option>${members().map((member) => `<option value="${member.id}" ${draft.ownerId === member.id ? 'selected' : ''}>${escape(member.name)}</option>`).join('')}</select></label>
        <label class="agenda-field"><span>Dia</span><input name="day" type="date" required value="${draft.day}"></label>
        <label class="agenda-field"><span>Categoria <small>(opcional)</small></span><input name="category" maxlength="60" list="cash-categories" value="${escape(draft.category)}" placeholder="Ex.: Hospedagem">
          <datalist id="cash-categories">${categories.map((name) => `<option value="${escape(name)}"></option>`).join('')}</datalist></label>
        <label class="agenda-field"><span>Projeto <small>(opcional)</small></span><select name="projectId">
          <option value="">Nenhum</option>${projects().map((entry) => `<option value="${entry.id}" ${draft.projectId === entry.id ? 'selected' : ''}>${escape(entry.name)}</option>`).join('')}</select></label>
      </div>
      <p class="agenda-error" role="alert" hidden></p>
      <footer class="agenda-form-foot">
        ${item ? `<button type="button" class="agenda-delete" data-cash="delete">${icon('trash-2')}<span>Apagar lançamento</span></button>` : '<span></span>'}
        <button type="button" class="btn primary cash-save" data-cash="save">${item ? 'Salvar' : draft.type === 'in' ? 'Colocar no balde' : 'Tirar do balde'}</button>
      </footer>
    </form>`;
    form.showModal();
    form.querySelector(item ? '[data-cash=save]' : '[name=amount]').focus();
  }

  function fail(text, focus) {
    const error = form.querySelector('.agenda-error');
    error.textContent = text; error.hidden = false;
    form.querySelector(focus)?.focus();
  }

  async function save() {
    const data = new FormData(form.querySelector('form'));
    const body = {
      type: draft.type, amountCents: toCents(data.get('amount')), description: String(data.get('description') || '').trim(),
      ownerId: String(data.get('ownerId') || '') || null, category: String(data.get('category') || '').trim(),
      day: String(data.get('day') || ''), projectId: String(data.get('projectId') || '') || null
    };
    if (body.amountCents <= 0) return fail('Informe o valor, por exemplo 49,90.', '[name=amount]');
    if (!body.description) return fail('Diga para que é esse dinheiro.', '[name=description]');
    if (!body.day) return fail('Escolha o dia.', '[name=day]');
    try {
      const saved = draft.id
        ? await request(`/company/cash/${draft.id}`, 'PATCH', { ...body, version: draft.version })
        : await request('/company/cash', 'POST', body);
      const created = !draft.id;
      items = created ? [...items, saved] : items.map((item) => (item.id === saved.id ? saved : item));
      form.close();
      month = saved.day.slice(0, 7);
      if (created) await handMoves(saved.type);
      paint(true);
      message(created ? (saved.type === 'in' ? `${money.format(saved.amountCents / 100)} no balde.` : `${money.format(saved.amountCents / 100)} saiu do balde.`) : 'Lançamento salvo.');
    } catch (error) {
      if (error.status === 401) return onExpired();
      fail(error.message, '[data-cash=save]');
      if (error.status === 409) await load();
    }
  }

  async function remove(control) {
    if (control.dataset.confirm !== 'true') {
      control.dataset.confirm = 'true';
      control.querySelector('span').textContent = 'Toque de novo para apagar';
      return;
    }
    try {
      await request(`/company/cash/${draft.id}`, 'DELETE', {});
      items = items.filter((item) => item.id !== draft.id);
      form.close();
      paint(true);
      message('Lançamento apagado.');
    } catch (error) { fail(error.message, '[data-cash=delete]'); }
  }

  /* ---------- A mão, a cédula e o gavião de olho ---------- */
  /** O gavião olha para um ponto da tela (os olhos acompanham o dinheiro ou o mouse). */
  function look(x, y) {
    const eyes = panel?.querySelector('.hawk-eyes');
    if (!eyes) return;
    const box = eyes.getBoundingClientRect();
    const dx = x - (box.left + box.width / 2);
    const dy = y - (box.top + box.height / 2);
    const size = Math.hypot(dx, dy) || 1;
    eyes.style.setProperty('--lx', `${(dx / size) * 3.2}px`);
    eyes.style.setProperty('--ly', `${(dy / size) * 3.2}px`);
  }
  document.addEventListener('pointermove', (event) => {
    if (panel?.isConnected && !panel.querySelector('.cash-scene.is-busy')) look(event.clientX, event.clientY);
  });

  /**
   * Entrada: a mão desce com a cédula, solta dentro do balde e sobe vazia.
   * Saída: a mão desce vazia, pega uma cédula e sobe com ela.
   * A mão e a cédula ficam atrás da frente do balde: entram nele, não atravessam.
   */
  function handMoves(type) {
    const scene = panel?.querySelector('.cash-scene');
    const hand = scene?.querySelector('.cash-hand');
    const note = hand?.querySelector('.hand-note');
    const bucket = scene?.querySelector('.cash-bucket');
    if (!scene || !hand?.animate || calm()) return Promise.resolve();
    scene.classList.add('is-busy');
    scene.dataset.move = type;
    const out = 'translateY(-300px)';
    const over = 'translateY(-70px)';
    const inside = 'translateY(6px)';
    const timing = { duration: 2200, easing: 'cubic-bezier(.45,.05,.35,1)' };
    // Os olhos seguem a mão quadro a quadro.
    let watching = true;
    const follow = () => {
      if (!watching) return;
      const box = (note.style.opacity === '0' ? hand : note).getBoundingClientRect();
      look(box.left + box.width / 2, box.top + box.height / 2);
      requestAnimationFrame(follow);
    };
    requestAnimationFrame(follow);
    const wobble = () => bucket.animate([{ rotate: '0deg' }, { rotate: '-4deg' }, { rotate: '3deg' }, { rotate: '-1deg' }, { rotate: '0deg' }], { duration: 560, easing: 'ease-out' });
    const handFrames = [
      { transform: out, opacity: 1 }, { transform: over, offset: 0.3 }, { transform: inside, offset: 0.5 },
      { transform: inside, offset: 0.58 }, { transform: over, offset: 0.76 }, { transform: out, opacity: 1 }
    ];
    const run = hand.animate(handFrames, { ...timing, fill: 'both' });
    note.animate(type === 'in'
      ? [{ opacity: 1 }, { opacity: 1, offset: 0.54 }, { opacity: 0, offset: 0.56 }, { opacity: 0 }]
      : [{ opacity: 0 }, { opacity: 0, offset: 0.54 }, { opacity: 1, offset: 0.56 }, { opacity: 1 }], { ...timing, fill: 'both' });
    setTimeout(wobble, 1150);
    const done = () => { watching = false; hand.getAnimations().forEach((a) => a.cancel()); note.getAnimations().forEach((a) => a.cancel()); scene.classList.remove('is-busy'); delete scene.dataset.move; };
    return run.finished.then(done, done);
  }

  /* ---------- Cliques ---------- */
  document.addEventListener('click', (event) => {
    const control = event.target.closest?.('[data-cash]');
    if (!control) return;
    const action = control.dataset.cash;
    if (action === 'new') openForm(null, control.dataset.type);
    else if (action === 'open') openForm(byId(control.dataset.id));
    else if (action === 'cancel') form.close();
    else if (action === 'save') void save();
    else if (action === 'delete') void remove(control);
    else if (action === 'filter') { filter = control.dataset.filter; paint(true); }
    else if (action === 'prev' || action === 'next') {
      const [y, m] = month.split('-').map(Number);
      const next = new Date(y, m - 1 + (action === 'next' ? 1 : -1), 1);
      month = `${next.getFullYear()}-${pad(next.getMonth() + 1)}`;
      paint(true);
    } else if (action === 'type') {
      draft.type = control.dataset.type;
      for (const option of control.parentElement.children) option.setAttribute('aria-checked', String(option === control));
      form.querySelector('.cash-sheet').dataset.type = draft.type;
      if (!draft.id) {
        form.querySelector('#cash-form-title').textContent = draft.type === 'in' ? 'Entrou dinheiro' : 'Saiu dinheiro';
        form.querySelector('.cash-save').textContent = draft.type === 'in' ? 'Colocar no balde' : 'Tirar do balde';
      }
    }
  });
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('input')) { event.preventDefault(); void save(); }
  });
  form.addEventListener('click', (event) => { if (event.target === form) form.close(); });

  function stop() { clearTimeout(pollTimer); panel = null; }
  return { render, stop };
}
