import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { dateLabel } from './api';
import type { Calendar } from './api';

export function OperationsCalendar({
  data,
  selected,
  onSelect,
  onMonth,
}: {
  data: Calendar;
  selected: string;
  onSelect: (day: string) => void;
  onMonth: (month: string) => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  function changeMonth(offset: number) {
    const date = new Date(`${data.month}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    onMonth(date.toISOString().slice(0, 7));
  }
  function navigate(event: KeyboardEvent, index: number) {
    const key = event.key;
    const next =
      key === 'ArrowRight'
        ? index + 1
        : key === 'ArrowLeft'
          ? index - 1
          : key === 'ArrowDown'
            ? index + 7
            : key === 'ArrowUp'
              ? index - 7
              : key === 'Home'
                ? 0
                : key === 'End'
                  ? data.days.length - 1
                  : null;
    if (next === null) return;
    event.preventDefault();
    buttons.current[Math.max(0, Math.min(data.days.length - 1, next))]?.focus();
  }
  const monthLabel = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${data.month}-01T12:00:00Z`));
  const offset = (new Date(`${data.month}-01T12:00:00Z`).getUTCDay() + 6) % 7;
  return (
    <section className="operations-calendar" aria-labelledby="calendar-title">
      <div className="operations-list-heading">
        <h2 id="calendar-title" tabIndex={-1}>
          Calendário · {monthLabel}
        </h2>
        <div className="catalog-actions">
          <button className="auth-retry" onClick={() => changeMonth(-1)}>
            Mês anterior
          </button>
          <button className="auth-retry" onClick={() => changeMonth(1)}>
            Próximo mês
          </button>
        </div>
      </div>
      <p id="calendar-help">
        Use as setas, Início e Fim para navegar; Enter abre o dia. Cada contagem
        tem todos os registros na lista paginada. A lista abaixo é uma
        alternativa ao calendário. Em espaços estreitos, a grade permite rolagem
        horizontal sem reduzir o texto.
      </p>
      <div
        className="operations-calendar-scroll"
        role="region"
        aria-label="Grade do calendário com rolagem horizontal"
        tabIndex={0}
      >
        <div className="operations-week" aria-hidden="true">
          {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="operations-days" aria-describedby="calendar-help">
          {data.days.map((day, index) => (
            <button
              key={day.date}
              ref={(node) => {
                buttons.current[index] = node;
              }}
              style={index === 0 ? { gridColumnStart: offset + 1 } : undefined}
              type="button"
              className={day.date === selected ? 'is-selected' : ''}
              aria-pressed={day.date === selected}
              aria-label={`${dateLabel(day.date)}: ${day.pickup} retirada(s), ${day.returns} devolução(ões)`}
              onKeyDown={(event) => navigate(event, index)}
              onClick={() => onSelect(day.date)}
            >
              <strong>{index + 1}</strong>
              <span>R: {day.pickup}</span>
              <span>D: {day.returns}</span>
            </button>
          ))}
        </div>
      </div>
      <p>
        R: retiradas previstas · D: devoluções previstas. Datas reais são
        identificadas na locação.
      </p>
    </section>
  );
}
