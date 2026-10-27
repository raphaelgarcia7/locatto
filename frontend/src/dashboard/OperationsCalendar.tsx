import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { addDays, dateLabel, localToday } from './api';
import type { Calendar } from './api';
import { calendarDates, moveCalendar } from './calendar';
import type { CalendarView } from './calendar';

export function OperationsCalendar({
  data,
  anchor,
  selected,
  view,
  loading,
  error,
  onSelect,
  onNavigate,
  onViewChange,
  onRetry,
}: {
  data: Calendar[];
  anchor: string;
  selected: string;
  view: CalendarView;
  loading: boolean;
  error: string;
  onSelect: (day: string) => void;
  onNavigate: (date: string) => void;
  onViewChange: (view: CalendarView) => void;
  onRetry: () => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const dates = calendarDates(anchor, view);
  const counts = new Map(
    data.flatMap((month) => month.days).map((day) => [day.date, day]),
  );
  const today = localToday();
  const periodLabel =
    view === 'month'
      ? new Intl.DateTimeFormat('pt-BR', {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(`${anchor}T12:00:00Z`))
      : `${dateLabel(dates[0])} – ${dateLabel(dates[6])}`;
  const offset =
    view === 'month' ? new Date(`${dates[0]}T12:00:00Z`).getUTCDay() : 0;
  const weekdays =
    view === 'month'
      ? ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
      : ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

  function navigate(event: KeyboardEvent, index: number) {
    const next =
      event.key === 'ArrowRight'
        ? index + 1
        : event.key === 'ArrowLeft'
          ? index - 1
          : event.key === 'ArrowDown'
            ? index + 7
            : event.key === 'ArrowUp'
              ? index - 7
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? dates.length - 1
                  : null;
    if (next === null) return;
    event.preventDefault();
    buttons.current[Math.max(0, Math.min(dates.length - 1, next))]?.focus();
  }

  return (
    <section className="operations-calendar" aria-labelledby="calendar-title">
      <div className="operations-calendar-heading">
        <div>
          <span className="operations-eyebrow">PREPARAÇÃO E AGENDA</span>
          <h2 id="calendar-title" tabIndex={-1}>
            Calendário · {periodLabel}
          </h2>
        </div>
        <div
          className="operations-view"
          aria-label="Visualização do calendário"
        >
          <button
            type="button"
            aria-pressed={view === 'month'}
            onClick={() => onViewChange('month')}
          >
            Mês
          </button>
          <button
            type="button"
            aria-pressed={view === 'week'}
            onClick={() => onViewChange('week')}
          >
            Semana
          </button>
        </div>
      </div>
      <div className="operations-calendar-toolbar">
        <div className="operations-calendar-navigation">
          <button
            type="button"
            className="auth-retry"
            aria-label={view === 'month' ? 'Mês anterior' : 'Semana anterior'}
            onClick={() => onNavigate(moveCalendar(anchor, view, -1))}
          >
            ‹
          </button>
          <button
            type="button"
            className="auth-retry"
            onClick={() => {
              onNavigate(today);
              onSelect(today);
            }}
          >
            Hoje
          </button>
          <button
            type="button"
            className="auth-retry"
            aria-label={view === 'month' ? 'Próximo mês' : 'Próxima semana'}
            onClick={() => onNavigate(moveCalendar(anchor, view, 1))}
          >
            ›
          </button>
        </div>
        <div className="operations-calendar-legend">
          <span className="operations-legend-pickup">R · Retiradas</span>
          <span className="operations-legend-return">D · Devoluções</span>
        </div>
      </div>
      <p className="operations-calendar-hint" id="calendar-help">
        Selecione um dia para ver as locações e organizar os kits.
      </p>
      {loading ? (
        <p className="operations-calendar-message" role="status">
          Carregando calendário…
        </p>
      ) : error ? (
        <div className="operations-calendar-message">
          <p role="alert">{error}</p>
          <button type="button" className="auth-retry" onClick={onRetry}>
            Tentar carregar calendário
          </button>
        </div>
      ) : (
        <div
          className="operations-calendar-scroll"
          role="region"
          aria-label="Grade do calendário com rolagem horizontal"
          tabIndex={0}
        >
          <div
            className={`operations-calendar-grid operations-calendar-grid--${view}`}
          >
            <div className="operations-week" aria-hidden="true">
              {weekdays.map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <div className="operations-days" aria-describedby="calendar-help">
              {Array.from({ length: offset }, (_, index) => (
                <span
                  key={`previous-${index}`}
                  className="operations-day-ghost"
                  aria-hidden="true"
                >
                  {Number(addDays(dates[0], index - offset).slice(-2))}
                </span>
              ))}
              {dates.map((date, index) => {
                const day = counts.get(date);
                const pickup = day?.pickup ?? 0;
                const returns = day?.returns ?? 0;
                return (
                  <button
                    key={date}
                    ref={(node) => {
                      buttons.current[index] = node;
                    }}
                    style={
                      index === 0 ? { gridColumnStart: offset + 1 } : undefined
                    }
                    type="button"
                    className={date === selected ? 'is-selected' : ''}
                    aria-pressed={date === selected}
                    aria-current={date === today ? 'date' : undefined}
                    aria-label={`${dateLabel(date)}: ${pickup} retirada(s), ${returns} devolução(ões)`}
                    onKeyDown={(event) => navigate(event, index)}
                    onClick={() => onSelect(date)}
                  >
                    <span className="operations-day-number">
                      {Number(date.slice(-2))}
                      {view === 'week' && <small>/{date.slice(5, 7)}</small>}
                    </span>
                    <span className="operations-day-events">
                      {pickup > 0 && (
                        <span className="operations-event operations-event--pickup">
                          {pickup}{' '}
                          <span className="operations-event-label">
                            {pickup === 1 ? 'retirada' : 'retiradas'}
                          </span>
                          <span
                            className="operations-event-short"
                            aria-hidden="true"
                          >
                            R
                          </span>
                        </span>
                      )}
                      {returns > 0 && (
                        <span className="operations-event operations-event--return">
                          {returns}{' '}
                          <span className="operations-event-label">
                            {returns === 1 ? 'devolução' : 'devoluções'}
                          </span>
                          <span
                            className="operations-event-short"
                            aria-hidden="true"
                          >
                            D
                          </span>
                        </span>
                      )}
                      {pickup === 0 && returns === 0 && (
                        <span
                          className="operations-day-empty"
                          aria-hidden="true"
                        >
                          —
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <p className="operations-calendar-footnote">
        Agenda de locações confirmadas · horários e detalhes na locação.
      </p>
    </section>
  );
}
