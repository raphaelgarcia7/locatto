import { useContext, useEffect, useRef, useState } from 'react';
import { AuthContext } from '../authContext';
import { customerRequest } from '../customers/api';
import type { CustomerPageData } from '../customers/api';
import { OperationList } from './OperationList';
import { OperationsCalendar } from './OperationsCalendar';
import {
  addDays,
  dateLabel,
  localToday,
  operationRequest,
  queueLabels,
} from './api';
import type { Calendar, Day, Filters, Queue, Upcoming } from './api';
import '../catalog/catalog.css';
import './dashboard.css';

export function DashboardPage() {
  const { authenticated } = useContext(AuthContext);
  const initial = localToday();
  const [date, setDate] = useState(initial);
  const [month, setMonth] = useState(initial.slice(0, 7));
  const [period, setPeriod] = useState({
    from: initial,
    to: addDays(initial, 29),
  });
  const [range, setRange] = useState(period);
  const [filters, setFilters] = useState<Filters>({
    operational_state: '',
    financial_pending: '',
    customer_id: '',
  });
  const [applied, setApplied] = useState(filters);
  const [view, setView] = useState<'day' | 'agenda'>('day');
  const [queue, setQueue] = useState<Queue>('pickup');
  const [page, setPage] = useState(1);
  const [day, setDay] = useState<Day | null>(null);
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [upcoming, setUpcoming] = useState<Upcoming | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [settled, setSettled] = useState(0);
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<CustomerPageData | null>(null);
  const [searching, setSearching] = useState(false);
  const [customerError, setCustomerError] = useState('');
  const focus = useRef<HTMLHeadingElement>(null);
  const restoreFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setLoading(true);
        setError('');
      }
    });
    const load =
      view === 'day'
        ? operationRequest<Day>(
            'day',
            { ...applied, date, queue, page },
            controller.signal,
          ).then((value) => {
            if (!controller.signal.aborted) setDay(value);
          })
        : Promise.all([
            operationRequest<Calendar>(
              'calendar',
              { ...applied, month },
              controller.signal,
            ),
            operationRequest<Upcoming>(
              'upcoming',
              { ...applied, ...range, page },
              controller.signal,
            ),
          ]).then(([nextCalendar, nextUpcoming]) => {
            if (!controller.signal.aborted) {
              setCalendar(nextCalendar);
              setUpcoming(nextUpcoming);
            }
          });
    void load
      .catch((problem: unknown) => {
        if (!controller.signal.aborted)
          setError(
            problem instanceof Error
              ? problem.message
              : 'Falha de conexão. Tente atualizar novamente.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setSettled((value) => value + 1);
        }
      });
    return () => controller.abort();
  }, [authenticated, date, month, range, view, applied, queue, page, refresh]);
  useEffect(() => {
    const update = () => setRefresh((value) => value + 1);
    window.addEventListener('focus', update);
    return () => window.removeEventListener('focus', update);
  }, []);
  useEffect(() => {
    if (!loading && restoreFocus.current) {
      const target = error
        ? focus.current
        : document.getElementById(restoreFocus.current);
      target?.focus();
      restoreFocus.current = null;
    }
  }, [loading, error, settled]);
  function selectPage(next: number) {
    restoreFocus.current = 'operations-list-title';
    setPage(next);
  }
  function selectDay(next: string) {
    setDate(next);
    setQueue(
      calendar?.days.find((day) => day.date === next)?.pickup
        ? 'pickup'
        : 'return',
    );
    setView('day');
    setPage(1);
    queueMicrotask(() => focus.current?.focus());
  }
  async function searchCustomers() {
    setSearching(true);
    setCustomerError('');
    try {
      setCustomers(
        await customerRequest<CustomerPageData>('/search', 'POST', {
          name: search,
          page: 1,
          page_size: 50,
        }),
      );
    } catch {
      setCustomerError('Não foi possível pesquisar clientes. Tente novamente.');
    } finally {
      setSearching(false);
    }
  }
  const checked =
    loading || error
      ? null
      : view === 'day'
        ? day?.checked_at
        : upcoming?.checked_at;
  return (
    <div className="catalog-workspace operations-workspace">
      <header className="page-heading">
        <span className="section-kicker">SUA LOCADORA · PEGUE E MONTE</span>
        <h1 ref={focus} tabIndex={-1}>
          Painel operacional
        </h1>
        <p>
          Prepare as retiradas, acompanhe os retornos e resolva as pendências da
          equipe.
        </p>
      </header>
      <div className="operations-topline">
        <p>Fuso: America/Sao_Paulo · Hoje {dateLabel(initial)}</p>
        <button
          className="auth-retry"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Atualizar painel
        </button>
      </div>
      <p className="catalog-help">
        {checked
          ? `Consulta de ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(checked))}. `
          : ''}
        Consulta informativa. Não reserva estoque nem confirma disponibilidade.
        Orçamentos não entram na agenda confirmada.
      </p>
      <form
        className="catalog-panel operations-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(filters);
          setPage(1);
        }}
      >
        <div className="catalog-form-grid">
          <label>
            Estado operacional
            <select
              value={filters.operational_state}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  operational_state: event.target.value,
                })
              }
            >
              <option value="">Todos</option>
              <option value="confirmed">Reserva confirmada</option>
              <option value="out">Materiais em uso</option>
              <option value="completed">Locação concluída</option>
              <option value="review">Locação em revisão</option>
              <option value="cancelled">Locação cancelada</option>
            </select>
          </label>
          <label>
            Situação financeira
            <select
              value={filters.financial_pending}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  financial_pending: event.target.value,
                })
              }
            >
              <option value="">Todas</option>
              <option value="true">Com pendência</option>
              <option value="false">Sem pendência</option>
            </select>
          </label>
          <label>
            Nome do cliente
            <input
              autoComplete="off"
              value={search}
              maxLength={200}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        <div className="catalog-actions">
          <button
            type="button"
            className="auth-retry"
            disabled={!search.trim() || searching}
            onClick={() => void searchCustomers()}
          >
            {searching ? 'Buscando clientes…' : 'Pesquisar cliente'}
          </button>
          <button type="submit" className="auth-button">
            Aplicar filtros
          </button>
          <button
            type="button"
            className="catalog-back"
            onClick={() => {
              const cleared = {
                operational_state: '',
                financial_pending: '',
                customer_id: '',
              };
              setFilters(cleared);
              setApplied(cleared);
              setSearch('');
              setCustomers(null);
              setPage(1);
            }}
          >
            Limpar filtros
          </button>
        </div>
        {customerError && <p role="alert">{customerError}</p>}
        {customers && (
          <label>
            Cliente pesquisado
            <select
              value={filters.customer_id}
              onChange={(event) =>
                setFilters({ ...filters, customer_id: event.target.value })
              }
            >
              <option value="">Todos os clientes</option>
              {customers.items.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} · {customer.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <span>
              {customers.total > customers.items.length
                ? 'Refine o nome para encontrar outros clientes.'
                : `${customers.total} cliente(s) encontrado(s).`}
            </span>
          </label>
        )}
      </form>
      <div className="operations-view" aria-label="Visões operacionais">
        <button
          className="auth-retry"
          aria-pressed={view === 'day'}
          onClick={() => {
            setView('day');
            setPage(1);
          }}
        >
          Filas do dia
        </button>
        <button
          className="auth-retry"
          aria-pressed={view === 'agenda'}
          onClick={() => {
            setView('agenda');
            setPage(1);
          }}
        >
          Calendário e próximas
        </button>
      </div>
      {view === 'day' ? (
        <>
          <label className="operations-date">
            Dia consultado
            <input
              type="date"
              value={date}
              onChange={(event) => {
                if (event.target.value) {
                  setDate(event.target.value);
                  setPage(1);
                }
              }}
            />
          </label>
          <div className="operations-queues" aria-label="Filas operacionais">
            {(Object.keys(queueLabels) as Queue[]).map((kind) => (
              <button
                className={queue === kind ? 'is-selected' : ''}
                key={kind}
                aria-pressed={queue === kind}
                aria-label={`${queueLabels[kind]} ${loading || error ? '—' : (day?.queues[kind].total ?? '—')}`}
                onClick={() => {
                  setQueue(kind);
                  setPage(1);
                }}
              >
                <span>{queueLabels[kind]}</span>
                <strong>
                  {loading || error ? '—' : (day?.queues[kind].total ?? '—')}
                </strong>
              </button>
            ))}
          </div>
          <p className="catalog-help">
            Retiradas e devoluções usam o dia escolhido. Atrasados até essa
            data, dívidas e ocorrências abertas continuam nas pendências,
            inclusive dívida de locação concluída.
          </p>
        </>
      ) : (
        <form
          className="catalog-panel operations-period"
          onSubmit={(event) => {
            event.preventDefault();
            setRange(period);
            setPage(1);
          }}
        >
          <h2>Lista das próximas retiradas e devoluções</h2>
          <p>
            Inicialmente 30 dias. Escolha um período explícito de até 90 dias.
          </p>
          <div className="catalog-form-grid">
            <label>
              De
              <input
                type="date"
                required
                value={period.from}
                onChange={(event) =>
                  setPeriod({ ...period, from: event.target.value })
                }
              />
            </label>
            <label>
              Até
              <input
                type="date"
                required
                value={period.to}
                onChange={(event) =>
                  setPeriod({ ...period, to: event.target.value })
                }
              />
            </label>
            <label>
              Mês do calendário
              <input
                type="month"
                required
                value={month}
                onChange={(event) => {
                  if (event.target.value) setMonth(event.target.value);
                }}
              />
            </label>
          </div>
          <button className="auth-retry">Aplicar período</button>
        </form>
      )}
      {loading ? (
        <p className="operations-empty" role="status">
          Consultando operação…
        </p>
      ) : error ? (
        <div className="operations-empty">
          <p className="auth-feedback auth-feedback--error" role="alert">
            {error} Os registros não foram confirmados por esta consulta.
          </p>
          <button
            className="auth-retry"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Tentar novamente
          </button>
        </div>
      ) : view === 'day' && day ? (
        <OperationList
          data={day.queues[queue]}
          label={queueLabels[queue]}
          onPage={selectPage}
        />
      ) : calendar && upcoming ? (
        <>
          <OperationsCalendar
            data={calendar}
            selected={date}
            onSelect={selectDay}
            onMonth={(next) => {
              restoreFocus.current = 'calendar-title';
              setMonth(next);
            }}
          />
          <OperationList
            data={upcoming}
            label="Próximas retiradas e devoluções"
            onPage={selectPage}
          />
        </>
      ) : null}
    </div>
  );
}
