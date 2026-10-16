import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QuotationsPage } from './QuotationsPage';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const quotation = {
  id: first,
  customer_id: '33333333-3333-4333-8333-333333333333',
  version: 1,
  total: '100.01',
  event_date: '2026-10-11',
  valid_until: '2026-10-09',
  expired: false,
  stock_pending: false,
};

// Isolate the page's request/route lifecycle. The real detail/editor and writes
// retain their own unit tests and the unchanged production-browser journeys.
vi.mock('./QuotationDetail', () => ({
  QuotationDetail: ({
    record,
    onEdit,
    onClose,
  }: {
    record: typeof quotation;
    onEdit: () => void;
    onClose: () => void;
  }) => (
    <section>
      <h2>Detail {record.id}</h2>
      <p>Version {record.version}</p>
      <button onClick={onEdit}>Edit selected</button>
      <button onClick={onClose}>Close selected</button>
    </section>
  ),
}));
vi.mock('./QuotationEditor', () => ({
  QuotationEditor: ({
    initial,
    onSaved,
    onCancel,
  }: {
    initial?: typeof quotation;
    onSaved: (value: typeof quotation) => void;
    onCancel: () => void;
  }) => (
    <section>
      <h2>Editor</h2>
      <button
        onClick={() =>
          onSaved({ ...quotation, version: initial ? initial.version + 1 : 1 })
        }
      >
        Save selected
      </button>
      <button onClick={onCancel}>Cancel editor</button>
    </section>
  ),
}));

const response = (value: unknown) => ({
  ok: true,
  status: 200,
  json: async () => value,
});
const fetchMock = vi.fn();
const searches = () =>
  fetchMock.mock.calls.filter(([url]) => url === '/api/quotations/search');
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === '/api/quotations/search') {
      const page = JSON.parse(String(options?.body)).page;
      return response({ items: [quotation], total: 51, page, page_size: 25 });
    }
    return response({
      ...quotation,
      id: url.endsWith(second) ? second : first,
    });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function Navigation() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <p data-testid="location">
        {location.pathname}
        {location.search}
      </p>
      <button onClick={() => void navigate('/locacoes')}>New route</button>
      <button onClick={() => void navigate(`/locacoes?orcamento=${second}`)}>
        Second route
      </button>
      <button onClick={() => void navigate(`/locacoes?orcamento=${first}`)}>
        First route
      </button>
      <button onClick={() => void navigate(-1)}>Back route</button>
      <button onClick={() => void navigate(1)}>Forward route</button>
    </>
  );
}
function renderPage(route = '/locacoes') {
  render(
    <MemoryRouter initialEntries={[route]}>
      <Navigation />
      <QuotationsPage />
    </MemoryRouter>,
  );
}

it('creates directly, saves without a hidden list read, edits and returns to the customer', async () => {
  renderPage();
  await screen.findByRole('heading', { name: 'Editor' });
  expect(searches()).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: 'Save selected' }));
  await screen.findByRole('heading', { name: `Detail ${first}` });
  expect(fetchMock).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Edit selected' }));
  await screen.findByRole('heading', { name: 'Editor' });
  await userEvent.click(screen.getByRole('button', { name: 'Save selected' }));
  await screen.findByText('Version 2');
  await userEvent.click(screen.getByRole('button', { name: 'Close selected' }));
  expect(screen.getByTestId('location')).toHaveTextContent(
    '/clientes?cliente=33333333-3333-4333-8333-333333333333',
  );
  expect(searches()).toHaveLength(0);
});

it('returns from editing to the same detail and cancels a new rental to the overview', async () => {
  renderPage(`/locacoes?orcamento=${first}`);
  await screen.findByRole('heading', { name: `Detail ${first}` });
  await userEvent.click(screen.getByRole('button', { name: 'Edit selected' }));
  await screen.findByRole('heading', { name: 'Editor' });
  await userEvent.click(screen.getByRole('button', { name: 'Cancel editor' }));
  await screen.findByRole('heading', { name: `Detail ${first}` });
  expect(screen.getByTestId('location')).toHaveTextContent(first);
  await userEvent.click(screen.getByRole('button', { name: 'New route' }));
  await screen.findByRole('heading', { name: 'Editor' });
  await userEvent.click(screen.getByRole('button', { name: 'Cancel editor' }));
  expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
  expect(searches()).toHaveLength(0);
});

it('aborts stale identifier reads and hides the old record until the next identifier resolves', async () => {
  let finish!: (value: ReturnType<typeof response>) => void;
  const normal = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url, ...args) =>
    url === `/api/quotations/${first}`
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : normal(url, ...args),
  );
  renderPage(`/locacoes?orcamento=${first}`);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await userEvent.click(screen.getByRole('button', { name: 'Second route' }));
  await screen.findByRole('heading', { name: `Detail ${second}` });
  expect(signal.aborted).toBe(true);
  await act(async () => finish(response(quotation)));
  expect(
    screen.getByRole('heading', { name: `Detail ${second}` }),
  ).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'First route' }));
  expect(
    screen.queryByRole('heading', { name: `Detail ${second}` }),
  ).not.toBeInTheDocument();
  await screen.findByText('Carregando locação…');
  await act(async () => finish(response(quotation)));
  await screen.findByRole('heading', { name: `Detail ${first}` });
  expect(searches()).toHaveLength(0);
});

it('browser Back opens a new rental and Forward reloads the selected record without searching', async () => {
  renderPage();
  await screen.findByRole('heading', { name: 'Editor' });
  await userEvent.click(screen.getByRole('button', { name: 'First route' }));
  await screen.findByRole('heading', { name: `Detail ${first}` });
  await userEvent.click(screen.getByRole('button', { name: 'Back route' }));
  await screen.findByRole('heading', { name: 'Editor' });
  await userEvent.click(screen.getByRole('button', { name: 'Forward route' }));
  await screen.findByRole('heading', { name: `Detail ${first}` });
  expect(
    fetchMock.mock.calls.filter(([url]) => url === `/api/quotations/${first}`),
  ).toHaveLength(2);
  expect(searches()).toHaveLength(0);
});

it('keeps a late edit read from replacing a newly opened rental form', async () => {
  renderPage(`/locacoes?orcamento=${first}`);
  await screen.findByRole('heading', { name: `Detail ${first}` });
  let finish!: (value: ReturnType<typeof response>) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Edit selected' }));
  await userEvent.click(screen.getByRole('button', { name: 'New route' }));
  await screen.findByRole('heading', { name: 'Editor' });
  await act(async () => finish(response(quotation)));
  expect(screen.getByRole('heading', { name: 'Editor' })).toBeVisible();
  expect(screen.queryByText('Version 1')).not.toBeInTheDocument();
});

it('shows a direct-read error and retries without opening a new form or global search', async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 503,
    json: async () => ({ detail: 'Serviço indisponível.' }),
  });
  renderPage(`/locacoes?orcamento=${first}`);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Serviço indisponível.',
  );
  expect(
    screen.queryByRole('heading', { name: 'Editor' }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: 'Tentar novamente' }),
  );
  await screen.findByRole('heading', { name: `Detail ${first}` });
  expect(searches()).toHaveLength(0);
});
