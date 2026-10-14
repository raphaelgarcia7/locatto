import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QuotationsPage } from './QuotationsPage';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const quotation = {
  id: first,
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
  return (
    <>
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

it('does not search a hidden list for direct UUID, edit or saved revision; closing reads fresh', async () => {
  renderPage(`/locacoes?orcamento=${first}`);
  expect(
    await screen.findByRole('heading', { name: `Detail ${first}` }),
  ).toBeVisible();
  expect(searches()).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: 'Edit selected' }));
  expect(await screen.findByRole('heading', { name: 'Editor' })).toBeVisible();
  expect(searches()).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: 'Save selected' }));
  expect(await screen.findByText('Version 2')).toBeVisible();
  expect(searches()).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: 'Close selected' }));
  expect(await screen.findByText('51 orçamento(s) · página 1')).toBeVisible();
  expect(searches()).toHaveLength(1);
});

it('preserves list filters and pagination through selection and refreshes the list on return', async () => {
  renderPage();
  await screen.findByText('51 orçamento(s) · página 1');
  await userEvent.type(screen.getByLabelText('ID do cliente'), second);
  await userEvent.click(
    screen.getByRole('button', { name: 'Buscar orçamentos' }),
  );
  await waitFor(() => expect(searches()).toHaveLength(2));
  await userEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
  await screen.findByText('51 orçamento(s) · página 2');
  expect(searches()).toHaveLength(3);
  await userEvent.click(screen.getByRole('link', { name: 'Abrir orçamento' }));
  await screen.findByRole('heading', { name: `Detail ${first}` });
  expect(searches()).toHaveLength(3);
  await userEvent.click(screen.getByRole('button', { name: 'Close selected' }));
  await waitFor(() => expect(searches()).toHaveLength(4));
  await screen.findByText('51 orçamento(s) · página 2');
  expect(screen.getByLabelText('ID do cliente')).toHaveValue(second);
  expect(JSON.parse(searches().at(-1)![1].body)).toEqual({
    customer_id: second,
    page: 2,
  });
});

it('aborts pending list reads when hidden and ignores their stale response after a new save', async () => {
  let finish!: (value: ReturnType<typeof response>) => void;
  const pending = new Promise<ReturnType<typeof response>>((resolve) => {
    finish = resolve;
  });
  fetchMock.mockImplementationOnce(() => pending);
  renderPage();
  await waitFor(() => expect(searches()).toHaveLength(1));
  const signal = searches()[0][1].signal as AbortSignal;
  await userEvent.click(screen.getByRole('button', { name: 'Novo orçamento' }));
  expect(signal.aborted).toBe(true);
  await act(async () => {
    finish(response({ items: [], total: 0, page: 99, page_size: 25 }));
  });
  expect(screen.getByRole('heading', { name: 'Editor' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Save selected' }));
  await screen.findByRole('heading', { name: `Detail ${first}` });
  expect(searches()).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Close selected' }));
  expect(await screen.findByText('51 orçamento(s) · página 1')).toBeVisible();
  expect(searches()).toHaveLength(2);
});

it('aborts stale identifier reads and keeps the existing detail until the next identifier resolves', async () => {
  let finishFirst!: (value: ReturnType<typeof response>) => void;
  const normal = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url, ...args) =>
    url === `/api/quotations/${first}`
      ? new Promise((resolve) => {
          finishFirst = resolve;
        })
      : normal(url, ...args),
  );
  renderPage(`/locacoes?orcamento=${first}`);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const signal = fetchMock.mock.calls.find(
    ([url]) => url === `/api/quotations/${first}`,
  )![1].signal as AbortSignal;
  await userEvent.click(screen.getByRole('button', { name: 'Second route' }));
  await screen.findByRole('heading', { name: `Detail ${second}` });
  expect(signal.aborted).toBe(true);
  await act(async () => {
    finishFirst(response(quotation));
  });
  expect(
    screen.getByRole('heading', { name: `Detail ${second}` }),
  ).toBeVisible();
  let finishNext!: (value: ReturnType<typeof response>) => void;
  fetchMock.mockImplementation((url, ...args) =>
    url === `/api/quotations/${first}`
      ? new Promise((resolve) => {
          finishNext = resolve;
        })
      : normal(url, ...args),
  );
  await userEvent.click(screen.getByRole('button', { name: 'First route' }));
  expect(
    screen.getByRole('heading', { name: `Detail ${second}` }),
  ).toBeVisible();
  await act(async () => {
    finishNext(response(quotation));
  });
  await screen.findByRole('heading', { name: `Detail ${first}` });
  expect(searches()).toHaveLength(0);
});

it('returns from selected detail through browser history to a fresh filtered list without losing its page', async () => {
  renderPage();
  await screen.findByText('51 orçamento(s) · página 1');
  await userEvent.type(screen.getByLabelText('ID do cliente'), second);
  await userEvent.click(
    screen.getByRole('button', { name: 'Buscar orçamentos' }),
  );
  await waitFor(() => expect(searches()).toHaveLength(2));
  await userEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
  await screen.findByText('51 orçamento(s) · página 2');
  await userEvent.click(screen.getByRole('link', { name: 'Abrir orçamento' }));
  await screen.findByRole('heading', { name: `Detail ${first}` });
  await userEvent.click(screen.getByRole('button', { name: 'Back route' }));
  await screen.findByRole('heading', { name: /^Orçamentos$/ });
  await waitFor(() => expect(searches()).toHaveLength(4));
  await screen.findByText('51 orçamento(s) · página 2');
  expect(screen.getByLabelText('ID do cliente')).toHaveValue(second);
  expect(JSON.parse(searches().at(-1)![1].body)).toEqual({
    customer_id: second,
    page: 2,
  });
  await userEvent.click(screen.getByRole('button', { name: 'Forward route' }));
  await screen.findByRole('heading', { name: `Detail ${first}` });
  expect(
    fetchMock.mock.calls.filter(([url]) => url === `/api/quotations/${first}`),
  ).toHaveLength(2);
  expect(searches()).toHaveLength(4);
});
