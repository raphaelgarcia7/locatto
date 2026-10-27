import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useDebouncedValue } from '../components/useDebouncedValue';
import { SearchPicker } from '../components/SearchPicker';
import { Icon, type IconName } from '../components/Icon';
import { AuthContext } from '../authContext';
import { customerRequest } from '../customers/api';
import type { CustomerPageData } from '../customers/api';
import { OperationList } from './OperationList';
import { OperationsCalendar } from './OperationsCalendar';
import { dateLabel, localToday, operationRequest, queueLabels } from './api';
import type { Calendar, Day, Filters, Queue } from './api';
import { calendarMonths } from './calendar';
import type { CalendarView } from './calendar';
import '../catalog/catalog.css';
import './dashboard.css';

const emptyFilters: Filters = {
  operational_state: '',
  financial_pending: '',
  customer_id: '',
};
const metricHints: Record<Queue, string> = {
  pickup: 'Kits para preparar',
  return: 'Materiais para conferir',
  overdue: 'Devoluções em atraso',
  debt: 'Saldos para acompanhar',
  occurrence: 'Atenção da equipe',
};
const metricIcons: Record<Queue, IconName> = {
  pickup: 'truck',
  return: 'box',
  overdue: 'clock',
  debt: 'wallet',
  occurrence: 'alert',
};

export function DashboardPage() {
  const { authenticated } = useContext(AuthContext);
  const today = localToday();
  const [date, setDate] = useState(today);
  const [anchor, setAnchor] = useState(today);
  const [calendarView, setCalendarView] = useState<CalendarView>('month');
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState(filters);
  const [queue, setQueue] = useState<Queue>('pickup');
  const [page, setPage] = useState(1);
  const [day, setDay] = useState<Day | null>(null);
  const [calendar, setCalendar] = useState<Calendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [error, setError] = useState('');
  const [calendarError, setCalendarError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [settled, setSettled] = useState(0);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const customerSequence = useRef(0);
  const [customers, setCustomers] = useState<CustomerPageData | null>(null);
  const [searching, setSearching] = useState(false);
  const [customerError, setCustomerError] = useState('');
  const focus = useRef<HTMLHeadingElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setLoading(true);
        setError('');
      }
    });
    void operationRequest<Day>(
      'day',
      { ...applied, date, queue, page },
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) setDay(value);
      })
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
  }, [authenticated, date, applied, queue, page, refresh]);

  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setCalendarLoading(true);
        setCalendarError('');
      }
    });
    void Promise.all(
      calendarMonths(anchor, calendarView).map((month) =>
        operationRequest<Calendar>(
          'calendar',
          { ...applied, month },
          controller.signal,
        ),
      ),
    )
      .then((value) => {
        if (!controller.signal.aborted) setCalendar(value);
      })
      .catch((problem: unknown) => {
        if (!controller.signal.aborted)
          setCalendarError(
            problem instanceof Error
              ? problem.message
              : 'Não foi possível carregar o calendário.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setCalendarLoading(false);
      });
    return () => controller.abort();
  }, [authenticated, anchor, calendarView, applied, refresh]);

  useEffect(() => {
    const update = () => setRefresh((value) => value + 1);
    window.addEventListener('focus', update);
    return () => window.removeEventListener('focus', update);
  }, []);

  useEffect(() => {
    if (!loading && restoreFocus.current) {
      (error
        ? focus.current
        : document.getElementById('operations-list-title')
      )?.focus();
      restoreFocus.current = false;
    }
  }, [loading, error, settled]);

  function selectQueue(nextQueue: Queue, nextDate = date) {
    if (!loading && nextDate === date && nextQueue === queue && page === 1) {
      (error
        ? focus.current
        : document.getElementById('operations-list-title')
      )?.focus();
      restoreFocus.current = false;
    } else restoreFocus.current = true;
    setDate(nextDate);
    setQueue(nextQueue);
    setPage(1);
  }

  function selectDay(next: string) {
    const count = calendar
      .flatMap((month) => month.days)
      .find((day) => day.date === next);
    selectQueue(count?.pickup || !count?.returns ? 'pickup' : 'return', next);
  }

  const searchCustomers = useCallback(
    async (query: string, signal?: AbortSignal) => {
      const sequence = ++customerSequence.current;
      setSearching(true);
      setCustomerError('');
      try {
        const result = await customerRequest<CustomerPageData>(
          '/search',
          'POST',
          {
            name: query,
            page: 1,
            page_size: 50,
          },
          signal,
        );
        if (!signal?.aborted && sequence === customerSequence.current)
          setCustomers(result);
      } catch {
        if (!signal?.aborted && sequence === customerSequence.current)
          setCustomerError(
            'Não foi possível pesquisar clientes. Tente novamente.',
          );
      } finally {
        if (!signal?.aborted && sequence === customerSequence.current)
          setSearching(false);
      }
    },
    [],
  );
  useEffect(() => {
    if (!authenticated || !debouncedSearch.trim()) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted)
        void searchCustomers(debouncedSearch, controller.signal);
    });
    return () => controller.abort();
  }, [authenticated, debouncedSearch, searchCustomers]);

  const filtered = Object.values(applied).some(Boolean);
  return (
    <div className="catalog-workspace operations-workspace">
      <header className="operations-page-heading">
        <div>
          <h1 ref={focus} tabIndex={-1}>
            Visão geral
          </h1>
          <p>Sua operação, do preparo à devolução.</p>
        </div>
        <button
          className="auth-retry"
          disabled={loading || calendarLoading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          <Icon name="refresh" size={18} />
          Atualizar painel
        </button>
      </header>

      <div className="operations-summary-heading">
        <h2>
          {date === today
            ? 'Hoje na operação'
            : `Operação de ${dateLabel(date)}`}
        </h2>
        <span>
          {dateLabel(date)}
          {filtered ? ' · Com filtros' : ''}
        </span>
      </div>
      <div className="operations-queues" aria-label="Filas operacionais">
        {(Object.keys(queueLabels) as Queue[]).map((kind) => (
          <button
            type="button"
            className={`operations-metric operations-metric--${kind}${queue === kind ? ' is-selected' : ''}`}
            key={kind}
            aria-pressed={queue === kind}
            aria-label={`${queueLabels[kind]} ${loading || error ? '—' : (day?.queues[kind].total ?? '—')}`}
            onClick={() => selectQueue(kind)}
          >
            <span className="operations-metric-topline">
              <span className="operations-metric-icon">
                <Icon name={metricIcons[kind]} size={19} />
              </span>
              <span className="operations-metric-label">
                {queueLabels[kind]}
              </span>
            </span>
            <strong>
              {loading || error ? '—' : (day?.queues[kind].total ?? '—')}
            </strong>
            <span className="operations-metric-hint">{metricHints[kind]}</span>
          </button>
        ))}
      </div>

      <details className="operations-filter-disclosure">
        <summary>
          <Icon name="filter" size={18} />
          <span>Filtrar operação{filtered ? ' · filtros ativos' : ''}</span>
        </summary>
        <form
          className="operations-filters"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied({ ...filters });
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
            <SearchPicker
              label="Nome do cliente"
              query={search}
              options={(customers?.items ?? []).map((customer) => ({
                id: customer.id,
                label: customer.name,
              }))}
              onQueryChange={(value) => {
                setSearch(value);
                setFilters({ ...filters, customer_id: '' });
              }}
              onSelect={(id, label) => {
                setSearch(label);
                setFilters({ ...filters, customer_id: id });
              }}
            />
          </div>
          <div className="catalog-actions">
            <button
              type="button"
              className="auth-retry"
              disabled={!search.trim() || searching}
              onClick={() => void searchCustomers(search)}
            >
              {searching ? 'Buscando clientes…' : 'Pesquisar cliente'}
            </button>
            <button type="submit" className="auth-button">
              Aplicar filtros
            </button>
            <button
              type="button"
              className="auth-retry operations-clear"
              onClick={() => {
                setFilters(emptyFilters);
                setApplied(emptyFilters);
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
              <span>
                {customers.total > customers.items.length
                  ? 'Refine o nome para encontrar outros clientes.'
                  : `${customers.total} cliente(s) encontrado(s).`}
              </span>
            </label>
          )}
        </form>
      </details>

      <OperationsCalendar
        data={calendar}
        anchor={anchor}
        selected={date}
        view={calendarView}
        loading={calendarLoading}
        error={calendarError}
        onSelect={selectDay}
        onNavigate={setAnchor}
        onViewChange={(next) => {
          if (next === 'week' && date.slice(0, 7) === anchor.slice(0, 7))
            setAnchor(date);
          setCalendarView(next);
        }}
        onRetry={() => setRefresh((value) => value + 1)}
      />

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
      ) : day ? (
        <OperationList
          data={day.queues[queue]}
          label={queueLabels[queue]}
          onPage={(next) => {
            restoreFocus.current = true;
            setPage(next);
          }}
        />
      ) : null}
    </div>
  );
}
