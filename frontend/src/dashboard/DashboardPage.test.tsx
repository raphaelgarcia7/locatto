import { act, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPage';
import { OperationsCalendar } from './OperationsCalendar';
import type { Calendar } from './api';
import { calendarDates, calendarMonths, moveCalendar } from './calendar';

const row = {
  rental_id: '00000000-0000-4000-8000-000000000001',
  quotation_id: '00000000-0000-4000-8000-000000000002',
  customer_id: '00000000-0000-4000-8000-000000000003',
  customer_display_name: 'Cliente Sintético',
  kind: 'pickup',
  date: '2026-10-10',
  optional_time: null,
  operational_state: 'completed',
  financial_summary: {
    remaining: '200.00',
    extra_agreed: '20.00',
    operational_debt: '220.00',
    unallocated_received: '0.00',
    requires_reconciliation: false,
    pending: true,
  },
  occurrence_count: 1,
  outstanding_qty: 2,
  pickup_date: '2026-10-10',
  return_date: '2026-10-13',
  current_return_forecast: '2026-10-15',
  actual_pickup_date: '2026-10-10',
  last_actual_return_date: '2026-10-12',
};
const empty = { items: [], total: 0, page: 1, page_size: 50 };
function monthData(month = '2026-10'): Calendar {
  return {
    month,
    timezone: 'America/Sao_Paulo',
    checked_at: '',
    days: calendarDates(`${month}-01`, 'month').map((date, index) => ({
      date,
      pickup: index === 0 ? 125 : 0,
      returns: 0,
    })),
  };
}
function day() {
  return {
    date: '2026-10-10',
    timezone: 'America/Sao_Paulo',
    checked_at: '2026-10-10T12:00:00Z',
    queues: {
      pickup: { ...empty, items: [row], total: 125 },
      return: empty,
      debt: { ...empty, items: [{ ...row, kind: 'debt' }], total: 1 },
      occurrence: empty,
      overdue: empty,
    },
  };
}
function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}
afterEach(() => vi.unstubAllGlobals());

it('presents month weeks from Sunday without changing actionable dates or keyboard navigation', async () => {
  const select = vi.fn();
  const { container } = render(
    <OperationsCalendar
      data={[]}
      anchor="2026-10-26"
      selected="2026-10-26"
      view="month"
      loading={false}
      error=""
      onSelect={select}
      onNavigate={vi.fn()}
      onViewChange={vi.fn()}
      onRetry={vi.fn()}
    />,
  );
  expect(
    container.querySelector('.operations-week')?.firstChild,
  ).toHaveTextContent('Dom');
  expect(container.querySelectorAll('.operations-day-ghost')).toHaveLength(4);
  expect(container.querySelectorAll('.operations-days button')).toHaveLength(
    31,
  );
  const first = screen.getByRole('button', { name: /^01\/10\/2026:/ });
  expect(first).toHaveStyle({ gridColumnStart: 5 });
  const user = userEvent.setup();
  await user.click(first);
  expect(select).toHaveBeenCalledWith('2026-10-01');
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('button', { name: /^02\/10\/2026:/ })).toHaveFocus();
});

it('ignores obsolete responses and hides prior counts while a new query is pending or fails', async () => {
  const pending: ((value: {
    ok: boolean;
    status?: number;
    json: () => Promise<ReturnType<typeof day>>;
  }) => void)[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string) =>
      path.includes('/calendar?')
        ? Promise.resolve({
            ok: true,
            json: async () =>
              monthData(
                new URL(path, 'http://localhost').searchParams.get('month') ??
                  undefined,
              ),
          })
        : new Promise((resolve) => pending.push(resolve)),
    ),
  );
  const user = userEvent.setup();
  renderPage();
  await waitFor(() => expect(pending).toHaveLength(1));
  await user.click(screen.getByText('Filtrar operação', { exact: true }));
  await user.selectOptions(
    screen.getByLabelText('Situação financeira'),
    'true',
  );
  await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
  await waitFor(() => expect(pending).toHaveLength(2));
  const current = day();
  current.queues.pickup.total = 7;
  current.queues.pickup.items = [
    { ...row, customer_display_name: 'Resposta atual' },
  ];
  await act(async () => pending[1]({ ok: true, json: async () => current }));
  expect(await screen.findByText('Resposta atual')).toBeVisible();
  await act(async () => pending[0]({ ok: true, json: async () => day() }));
  expect(screen.queryByText('Cliente Sintético')).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Retiradas do dia 7' }),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Atualizar painel' }));
  await waitFor(() => expect(pending).toHaveLength(3));
  expect(
    screen.getByRole('button', { name: 'Retiradas do dia —' }),
  ).toBeVisible();
  expect(screen.queryByText('Resposta atual')).not.toBeInTheDocument();
  await act(async () =>
    pending[2]({ ok: false, status: 503, json: async () => day() }),
  );
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Retiradas do dia —' }),
  ).toBeVisible();
  expect(
    screen.queryByText(/Nenhum registro nesta fila/),
  ).not.toBeInTheDocument();
});

it('shows persisted debt separately, real dates, direct private links and stable pagination filters', async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      calls.push(path);
      if (path.includes('/calendar?'))
        return { ok: true, json: async () => monthData() };
      const response = day();
      const page = new URL(path, 'http://localhost').searchParams.get('page');
      response.queues.pickup.page = Number(page ?? 1);
      return { ok: true, json: async () => response };
    }),
  );
  const user = userEvent.setup();
  renderPage();
  expect(await screen.findByText('Cliente Sintético')).toBeVisible();
  expect(
    screen.getByText('Horário não informado', { exact: false }),
  ).toBeVisible();
  expect(
    within(screen.getByRole('region', { name: 'Retiradas do dia' })).getByText(
      'Locação concluída',
    ),
  ).toBeVisible();
  expect(screen.getByText('R$ 220,00 · Pendente')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Abrir locação' })).toHaveAttribute(
    'href',
    `/locacoes?orcamento=${row.quotation_id}`,
  );
  expect(
    screen.getByRole('link', { name: 'Histórico do cliente' }),
  ).toHaveAttribute('href', `/clientes?cliente=${row.customer_id}`);
  await user.click(
    screen.getByRole('button', { name: 'Retiradas do dia 125' }),
  );
  expect(
    screen.getByRole('heading', { level: 2, name: 'Retiradas do dia' }),
  ).toHaveFocus();
  await user.click(screen.getByText('Filtrar operação', { exact: true }));
  await user.selectOptions(
    screen.getByLabelText('Situação financeira'),
    'true',
  );
  await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
  await user.click(
    await screen.findByRole('button', { name: 'Próxima página' }),
  );
  await waitFor(() =>
    expect(calls.filter((path) => path.includes('/day?')).at(-1)).toContain(
      'page=2',
    ),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { level: 2, name: 'Retiradas do dia' }),
    ).toHaveFocus(),
  );
  expect(calls.filter((path) => path.includes('/day?')).at(-1)).toContain(
    'financial_pending=true',
  );
  expect(calls.some((path) => path.includes('/auth/activity'))).toBe(false);
});

it('keeps loading, empty and failed queries distinct; retry and private customer search are explicit', async () => {
  const fetcher = vi.fn().mockImplementation(async (path: string) =>
    path.includes('/calendar?')
      ? { ok: true, json: async () => monthData() }
      : {
          ok: false,
          status: 503,
          json: async () => ({}),
        },
  );
  vi.stubGlobal('fetch', fetcher);
  const user = userEvent.setup();
  renderPage();
  expect(screen.getByText('Consultando operação…')).toBeVisible();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Não foi possível consultar',
  );
  expect(
    screen.queryByText(/Nenhum registro nesta fila/),
  ).not.toBeInTheDocument();
  fetcher.mockImplementation(async (path: string) => ({
    ok: true,
    json: async () =>
      path.includes('/calendar?')
        ? monthData()
        : path.includes('/customers/')
          ? {
              ...empty,
              items: [
                { id: row.customer_id, name: 'Cliente Sintético privado' },
              ],
              total: 1,
            }
          : {
              ...day(),
              queues: Object.fromEntries(
                Object.keys(day().queues).map((key) => [key, empty]),
              ),
            },
  }));
  await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(await screen.findByText(/Nenhum registro nesta fila/)).toBeVisible();
  await user.click(screen.getByText('Filtrar operação', { exact: true }));
  await user.type(
    screen.getByLabelText('Nome do cliente'),
    'Sintético privado',
  );
  await user.click(
    await screen.findByRole('option', { name: /Sintético privado/ }),
  );
  await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls
        .filter((call) => call[0].includes('/day?'))
        .at(-1)?.[0],
    ).toContain(`customer_id=${row.customer_id}`),
  );
  const searchCall = fetcher.mock.calls.find((call) =>
    call[0].includes('/customers/'),
  );
  expect(searchCall?.[0]).toBe('/api/customers/search');
  expect(searchCall?.[1].method).toBe('POST');
  expect(searchCall?.[1].body).toContain('Sintético privado');
  expect(
    fetcher.mock.calls.every((call) => !call[0].includes('Sintético')),
  ).toBe(true);
});

it('calendar exposes every count, keyboard day navigation and focused selection', async () => {
  const onSelect = vi.fn();
  const onNavigate = vi.fn();
  const user = userEvent.setup();
  const calendar: Calendar = {
    month: '2026-10',
    timezone: 'America/Sao_Paulo',
    checked_at: '',
    days: Array.from({ length: 31 }, (_, index) => ({
      date: `2026-10-${String(index + 1).padStart(2, '0')}`,
      pickup: index === 0 ? 125 : 0,
      returns: 0,
    })),
  };
  render(
    <OperationsCalendar
      data={[calendar]}
      anchor="2026-10-01"
      view="month"
      loading={false}
      error=""
      selected="2026-10-01"
      onSelect={onSelect}
      onNavigate={onNavigate}
      onViewChange={vi.fn()}
      onRetry={vi.fn()}
    />,
  );
  const region = screen.getByRole('region', {
    name: 'Calendário · outubro de 2026',
  });
  const first = within(region).getByRole('button', {
    name: '01/10/2026: 125 retirada(s), 0 devolução(ões)',
  });
  first.focus();
  await user.keyboard('{ArrowRight}{Enter}');
  expect(onSelect).toHaveBeenCalledWith('2026-10-02');
  await user.keyboard('{End}');
  expect(
    within(region).getByRole('button', {
      name: '31/10/2026: 0 retirada(s), 0 devolução(ões)',
    }),
  ).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Próximo mês' }));
  expect(onNavigate).toHaveBeenCalledWith('2026-11-01');
});

it('loads both months for a week crossing a month boundary and opens the selected day', async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      calls.push(path);
      const query = new URL(path, 'http://localhost').searchParams;
      return {
        ok: true,
        json: async () =>
          path.includes('/calendar?')
            ? monthData(query.get('month') ?? undefined)
            : day(),
      };
    }),
  );
  const user = userEvent.setup();
  renderPage();
  await screen.findByText('Cliente Sintético');
  expect(screen.queryByLabelText('Dia consultado')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Próximo mês' }));
  await user.click(
    await screen.findByRole('button', {
      name: '01/11/2026: 125 retirada(s), 0 devolução(ões)',
    }),
  );
  await user.click(screen.getByRole('button', { name: 'Semana' }));
  expect(
    await screen.findByRole('button', {
      name: '26/10/2026: 0 retirada(s), 0 devolução(ões)',
    }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', {
      name: '01/11/2026: 125 retirada(s), 0 devolução(ões)',
    }),
  ).toBeVisible();
  expect(
    calls.some(
      (path) => path.includes('/calendar?') && path.includes('month=2026-10'),
    ),
  ).toBe(true);
  expect(
    calls.some(
      (path) => path.includes('/calendar?') && path.includes('month=2026-11'),
    ),
  ).toBe(true);
  await user.click(
    screen.getByRole('button', {
      name: '26/10/2026: 0 retirada(s), 0 devolução(ões)',
    }),
  );
  await waitFor(() =>
    expect(calls.filter((path) => path.includes('/day?')).at(-1)).toContain(
      'date=2026-10-26',
    ),
  );
  expect(screen.getByRole('button', { name: 'Semana' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

it('calculates complete weeks, leap months and year navigation without local timezone drift', () => {
  expect(calendarDates('2026-11-01', 'week')).toEqual([
    '2026-10-26',
    '2026-10-27',
    '2026-10-28',
    '2026-10-29',
    '2026-10-30',
    '2026-10-31',
    '2026-11-01',
  ]);
  expect(calendarMonths('2026-11-01', 'week')).toEqual(['2026-10', '2026-11']);
  expect(calendarDates('2028-02-29', 'month')).toHaveLength(29);
  expect(moveCalendar('2026-12-31', 'month', 1)).toBe('2027-01-01');
  expect(moveCalendar('2026-12-31', 'week', 1)).toBe('2027-01-07');
});
