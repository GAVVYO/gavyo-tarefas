const formatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayLabel = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeZone: 'UTC' });
const iso = (date) => date.toISOString().slice(0, 10);

export function renderTaskCalendar(panel, today, offset = 0) {
  const input = panel.querySelector('[name=due]');
  const target = panel.querySelector('.task-calendar');
  const [year, month] = (target.dataset.month || input.value || today).split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1 + offset, 1));
  const length = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  target.dataset.month = iso(start).slice(0, 7);
  const blanks = '<span aria-hidden="true"></span>'.repeat(start.getUTCDay());
  const days = Array.from({ length }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(index + 1);
    const id = iso(date);
    return `<button type="button" class="calendar-day" data-action="task-day" data-date="${id}"
      aria-label="${dayLabel.format(date)}" aria-pressed="${id === input.value}" ${id === today ? 'aria-current="date"' : ''}>${index + 1}</button>`;
  }).join('');
  target.innerHTML = `<div class="calendar-month">
    <button class="btn ghost" type="button" data-action="task-month" data-offset="-1" aria-label="Mês anterior">‹</button>
    <strong aria-live="polite">${formatter.format(start)}</strong>
    <button class="btn ghost" type="button" data-action="task-month" data-offset="1" aria-label="Próximo mês">›</button>
  </div><div class="calendar-grid">
    ${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day) => `<span class="calendar-weekday">${day}</span>`).join('')}
    ${blanks}${days}
  </div>`;
  panel.querySelector('[data-action=task-clear-day]').disabled = !input.value;
}
