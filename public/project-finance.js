const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dates = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', dateStyle: 'short' });
const timestamps = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', dateStyle: 'short', timeStyle: 'short' });
const money = (cents) => currency.format(cents / 100);
const day = (date) => dates.format(new Date(date + 'T00:00:00Z'));
const frequencies = { none: 'Sem recorrência', monthly: 'Mensal', yearly: 'Anual' };

function parseAmount(value) {
  const parts = /^(\d{1,9})(?:[,.](\d{1,2}))?$/.exec(value.trim());
  if (!parts) throw new Error('Informe o valor em reais, por exemplo 120,50.');
  const amount = Number(parts[1]) * 100 + Number((parts[2] || '').padEnd(2, '0'));
  if (!amount) throw new Error('O valor do gasto precisa ser maior que zero.');
  return amount;
}

export function setupProjectFinance({ request, escape, openDialog, dialog, icon, message, onExpired }) {
  const loaders = new WeakMap();
  function financePath(id) { return `/projects/${id}/finance`; }

  function render(panel, projectId, board) {
    if (panel.querySelector('.fin-view')?.dataset.project === projectId) return;
    panel.innerHTML = `<div class="fin-view" data-project="${projectId}">
      <header class="fin-heading">
        <h2 tabindex="-1">Financeiro</h2>
        <div class="fin-actions">
          <button class="btn fin-btn" type="button" data-fin="reload">${icon('refresh-cw')}Atualizar</button>
          <button class="btn fin-btn" type="button" data-fin="category">Nova categoria</button>
          <button class="btn primary fin-btn" type="button" data-fin="new" disabled>${icon('plus')}Registrar gasto</button>
        </div>
      </header>
      <p class="fin-status" role="status"></p><div class="fin-body"></div>
    </div>`;

    const frame = panel.firstElementChild;
    const feedback = frame.querySelector('.fin-status');
    const body = frame.querySelector('.fin-body');
    const register = frame.querySelector('[data-fin=new]');
    let snapshot;
    let selectedCategory;
    let pendingLoad;
    const name = (id) => escape(board.members.find((member) => member.id === id)?.name ?? 'Membro da equipe');
    const author = (entry) => `${escape(entry.actor)} · ${escape(entry.source)}<small><time datetime="${escape(entry.at)}">${timestamps.format(new Date(entry.at))}</time></small>`;
    const balanceLabel = (entry) => `<strong>${name(entry.fromId)}</strong> deve <strong>${money(entry.amountCents)}</strong> a <strong>${name(entry.toId)}</strong>`;
    const noRows = (text) => `<p class="fin-empty">${text}</p>`;
    const section = (id, label, content) => `<section class="fin-section" aria-labelledby="fin-${id}">
      <h3 id="fin-${id}">${label}</h3>${content}
    </section>`;

    function paint() {
      const { expenses, balances, settlements, renewals } = snapshot;
      const byId = new Map(expenses.map((expense) => [expense.id, expense]));
      const debts = balances.map((entry, index) => `<li class="fin-row">
        <span>${balanceLabel(entry)}</span>
        <button class="btn fin-btn" type="button" data-fin="settle" data-index="${index}">Marcar como acertado</button>
      </li>`).join('');
      const dueText = ({ days }) => days < 0 ? 'Atrasado' : days === 0 ? 'Vence hoje'
        : days === 1 ? 'Vence amanhã' : days <= 7 ? `Vence em ${days} dias` : '';
      const due = renewals.map((entry) => {
        const expense = byId.get(entry.id);
        return `<li class="fin-row">
          <div><strong>${escape(expense.description)}</strong><small>${frequencies[expense.frequency]} · ${day(entry.dueOn)}</small></div>
          <div class="fin-actions">
            ${dueText(entry) ? `<span class="fin-due ${entry.days < 0 ? 'is-late' : ''}">${dueText(entry)}</span>` : ''}
            <button class="btn fin-btn" type="button" data-fin="renew" data-id="${entry.id}"
              aria-label="Registrar pagamento de ${escape(expense.description)}">Registrar pagamento</button>
          </div>
        </li>`;
      }).join('');
      const categoryCards = [{ id: '', name: 'Sem categoria' }, ...(snapshot.categories || [])].map(category => {
        const items = expenses.filter(e => (e.categoryId || '') === category.id);
        const total = items.reduce((sum, e) => sum + e.amountCents, 0);
        return `<button class="fin-category btn" type="button" data-fin="filter-category" data-id="${escape(category.id)}" aria-pressed="${selectedCategory === category.id}"><strong>${escape(category.name)}</strong><span>${money(total)}</span><small>${items.length} gasto(s)</small></button>`;
      }).join('');
      const shownExpenses = selectedCategory === undefined ? expenses : expenses.filter(e => (e.categoryId || '') === selectedCategory);
      const expenseRows = shownExpenses.map((entry) => `<tr role="row">
        <td role="cell"><details>
          <summary>${escape(entry.description)}</summary>
          <ul class="fin-shares">${entry.shares.map((share) => `<li>${name(share.memberId)} · ${money(share.amountCents)}</li>`).join('')}</ul>
        </details>${entry.occurrence ? `<small>Vencimento de ${day(entry.occurrence.dueOn)}</small>` : ''}</td>
        <td role="cell"><span class="fin-mobile-label" aria-hidden="true">Pago por</span>${name(entry.payerId)}</td>
        <td role="cell"><span class="fin-mobile-label" aria-hidden="true">Data</span>${day(entry.paidOn)}</td>
        <td role="cell" class="fin-amount"><span class="fin-mobile-label" aria-hidden="true">Valor</span>${money(entry.amountCents)}</td>
        <td role="cell"><span class="fin-mobile-label" aria-hidden="true">Registro</span>${author(entry)}<button class="btn fin-btn" type="button" data-fin="delete" data-id="${entry.id}" aria-label="Excluir gasto ${escape(entry.description)}">Excluir</button></td>
      </tr>`).join('');
      const history = settlements.map((entry) => `<li class="fin-row">
        <span>${name(entry.fromId)} acertou <strong>${money(entry.amountCents)}</strong> com ${name(entry.toId)}</span>
        <span>${author(entry)}</span>
      </li>`).join('');
      const removed = (snapshot.deletions || []).map(entry => `<li class="fin-row"><span>${escape(entry.description)} · ${money(entry.amountCents)}</span><span>${author(entry)}</span></li>`).join('');
      body.innerHTML =
        section('categories', 'Categorias', `<div class="fin-category-grid">${categoryCards}</div><button type="button" class="btn fin-btn" data-fin="all-categories">Todos os gastos</button>`) +
        section('debts', 'Acertos pendentes', debts ? `<ul class="fin-list">${debts}</ul>` : noRows('Nenhum acerto pendente.')) +
        section('due', 'Próximos vencimentos', due ? `<ul class="fin-list">${due}</ul>` : noRows('Nenhum gasto recorrente.')) +
        section('expenses', 'Gastos registrados', expenseRows ? `<table class="fin-table" role="table" aria-labelledby="fin-expenses">
          <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Gasto</th><th scope="col" role="columnheader">Pago por</th>
          <th scope="col" role="columnheader">Data</th><th scope="col" role="columnheader" class="fin-amount">Valor</th><th scope="col" role="columnheader">Registro</th></tr></thead>
          <tbody role="rowgroup">${expenseRows}</tbody></table>` : noRows('Nenhum gasto registrado neste projeto.')) +
        (removed ? section('deleted', 'Gastos excluídos', `<ul class="fin-list">${removed}</ul>`) : '') +
        (history ? section('settled', 'Acertos registrados', `<ul class="fin-list">${history}</ul>`) : '');
    }

    async function fetchSnapshot() {
      frame.setAttribute('aria-busy', 'true');
      feedback.textContent = 'Carregando financeiro…';
      try {
        const next = await request(financePath(projectId));
        if (!frame.isConnected) return;
        if (snapshot?.version !== next.version || snapshot.today !== next.today) {
          snapshot = next;
          paint();
        }
        register.disabled = false;
        feedback.textContent = '';
      } catch (error) {
        if (error.status === 401) onExpired();
        else feedback.textContent = 'Não foi possível carregar o financeiro. Clique em Atualizar para tentar de novo.';
      } finally {
        frame.removeAttribute('aria-busy');
      }
    }

    function load(afterWrite = false) {
      if (!frame.isConnected) return;
      if (pendingLoad) return afterWrite ? pendingLoad.then(() => load()) : pendingLoad;
      pendingLoad = fetchSnapshot().finally(() => { pendingLoad = null; });
      return pendingLoad;
    }

    function refreshAfterWrite() {
      const current = panel.querySelector('.fin-view');
      if (current?.dataset.project === projectId) void loaders.get(panel)?.(true);
    }

    function focusAfterClose() {
      dialog.addEventListener('close', () => {
        if (frame.isConnected && !dialog.open) frame.querySelector('h2').focus();
      }, { once: true });
    }

    function submitForm(form, handler) {
      const feedback = form.querySelector('[role=alert]');
      const submit = form.querySelector('[type=submit]');
      const label = submit.textContent;
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (submit.disabled) return;
        submit.disabled = true;
        submit.textContent = 'Salvando…';
        feedback.textContent = '';
        try {
          await handler(new FormData(form));
          message(({ settle: 'Acerto registrado.', category: 'Categoria criada.', delete: 'Gasto excluído. Saldos atualizados.' })[form.dataset.finForm] || 'Gasto registrado.');
          if (form.isConnected && dialog.open) {
            focusAfterClose();
            dialog.close();
          }
          // Revalida também se a aba foi aberta novamente durante a gravação.
          refreshAfterWrite();
        } catch (error) {
          if (error.status === 401) onExpired();
          else if (error.status === 409 && form.dataset.finForm === 'settle') {
            if (form.isConnected && dialog.open) {
              focusAfterClose();
              dialog.close();
            }
            refreshAfterWrite();
            message(error.message);
          } else feedback.textContent = error.message;
        } finally {
          submit.disabled = false;
          submit.textContent = label;
        }
      });
    }

    function expenseDialog(renewal) {
      const previous = renewal && snapshot.expenses.find(({ id }) => id === renewal.id);
      const payer = previous?.payerId ?? board.user.id;
      const members = board.members.map((member) => ({
        id: escape(member.id), label: escape(member.name), selected: previous?.participantIds.includes(member.id)
      }));
      const amount = previous ? (previous.amountCents / 100).toFixed(2).replace('.', ',') : '';
      openDialog(renewal ? 'Registrar pagamento' : 'Registrar gasto', `<form class="fin-form">
        ${renewal ? `<p>Vencimento de <strong>${day(renewal.dueOn)}</strong></p>` : ''}
        <label class="field">O que foi pago<input name="description" required maxlength="300" value="${escape(previous?.description)}"></label>
        <label class="field">Categoria<select name="categoryId"><option value="">Sem categoria</option>${(snapshot.categories || []).map(c => `<option value="${escape(c.id)}" ${(previous?.categoryId ?? selectedCategory) === c.id ? 'selected' : ''}>${escape(c.name)}</option>`).join('')}</select></label>
        <div class="fin-fields">
          <label class="field">Valor (R$)<input name="amount" inputmode="decimal" required maxlength="12" value="${amount}" placeholder="120,50"></label>
          <label class="field">Data do pagamento<input name="paidOn" type="date" required max="9998-12-31" value="${snapshot.today}"></label>
          <div class="field"><label for="fin-payer">Quem pagou</label><select id="fin-payer" name="payerId" required>
            ${members.map((member) => `<option value="${member.id}" ${member.id === payer ? 'selected' : ''}>${member.label}</option>`).join('')}
          </select></div>
          ${renewal ? '' : `<div class="field"><label for="fin-frequency">Recorrência</label><select id="fin-frequency" name="frequency">
            ${Object.entries(frequencies).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}
          </select></div>`}
        </div>
        <fieldset class="fin-participants"><legend>Quem divide este gasto</legend>
          <p id="fin-split-help">O valor é dividido igualmente entre as pessoas selecionadas.</p>
          ${members.map((member) => `<label><input type="checkbox" name="participantIds" value="${member.id}"
            aria-describedby="fin-split-help" ${member.selected ? 'checked' : ''}>${member.label}</label>`).join('')}
        </fieldset>
        <p class="error" role="alert"></p>
        <div class="fin-actions fin-dialog-actions">
          <button class="btn fin-btn" type="button" data-action="close">Cancelar</button>
          <button class="btn primary fin-btn" type="submit">Salvar gasto</button>
        </div>
      </form>`, '[name=description]');
      let operationId, lastInput;
      submitForm(dialog.querySelector('.fin-form'), async (data) => {
        const participantIds = data.getAll('participantIds');
        if (!participantIds.length) throw new Error('Selecione pelo menos uma pessoa para o rateio.');
        const input = {
          description: data.get('description'), amountCents: parseAmount(data.get('amount')), paidOn: data.get('paidOn'),
          categoryId: data.get('categoryId') || null, payerId: data.get('payerId'), participantIds, frequency: data.get('frequency') || 'none',
          ...(renewal && { occurrence: { expenseId: renewal.id, dueOn: renewal.dueOn } })
        };
        const key = JSON.stringify(input);
        if (key !== lastInput) { lastInput = key; operationId = crypto.randomUUID(); }
        await request(financePath(projectId) + '/expenses', 'POST', { ...input, operationId });
      });
    }

    function settlementDialog(index) {
      const entry = snapshot.balances[index];
      if (!entry) return;
      const version = snapshot.version;
      openDialog('Confirmar acerto', `<form class="fin-form" data-fin-form="settle">
        <p>${balanceLabel(entry)}. Confirme se o pagamento já foi feito.</p>
        <p class="error" role="alert"></p>
        <div class="fin-actions fin-dialog-actions">
          <button class="btn fin-btn" type="button" data-action="close">Cancelar</button>
          <button class="btn primary fin-btn" type="submit">Confirmar acerto</button>
        </div>
      </form>`, '.fin-form [data-action=close]');
      submitForm(dialog.querySelector('.fin-form'), () => request(financePath(projectId) + '/settlements', 'POST', { ...entry, version }));
    }

    frame.addEventListener('click', ({ target }) => {
      const control = target.closest('[data-fin]');
      if (!control) return;
      if (control.dataset.fin === 'filter-category' && snapshot) { selectedCategory = control.dataset.id; paint(); }
      if (control.dataset.fin === 'all-categories' && snapshot) { selectedCategory = undefined; paint(); }
      if (control.dataset.fin === 'category' && snapshot) {
        openDialog('Nova categoria', `<form class="fin-form" data-fin-form="category"><label class="field">Nome da categoria<input name="name" required maxlength="60" placeholder="IA, Hospedagem…"></label><p class="error" role="alert"></p><button class="btn primary" type="submit">Criar categoria</button></form>`, '[name=name]');
        submitForm(dialog.querySelector('.fin-form'), data => request(financePath(projectId) + '/categories', 'POST', { name: data.get('name') }));
      }
      if (control.dataset.fin === 'delete' && snapshot) {
        const entry = snapshot.expenses.find(e => e.id === control.dataset.id);
        if (!entry) return;
        const version = snapshot.version;
        openDialog('Excluir gasto', `<form class="fin-form" data-fin-form="delete"><p>Excluir <strong>${escape(entry.description)}</strong> de ${money(entry.amountCents)}?</p><p>Os saldos serão recalculados. Se houver renovações vinculadas a este gasto, elas também sairão dos totais. Acertos já registrados continuam no histórico e podem gerar um saldo de devolução. A exclusão ficará registrada com seu nome.</p><p class="error" role="alert"></p><button class="btn" type="button" data-action="close">Cancelar</button><button class="btn primary" type="submit">Excluir gasto</button></form>`, '[data-action=close]');
        submitForm(dialog.querySelector('.fin-form'), () => request(financePath(projectId) + '/expenses/' + entry.id, 'DELETE', { version }));
      }
      if (control.dataset.fin === 'reload') void load();
      if (control.dataset.fin === 'new' && snapshot) expenseDialog();
      if (control.dataset.fin === 'settle' && snapshot) settlementDialog(Number(control.dataset.index));
      if (control.dataset.fin === 'renew' && snapshot) {
        const renewal = snapshot.renewals.find(({ id }) => id === control.dataset.id);
        if (renewal) expenseDialog(renewal);
      }
    });
    loaders.set(panel, load);
    void load();
  }

  return { render };
}
