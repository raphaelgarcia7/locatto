import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QuotationEditor } from './QuotationEditor';
import { QuotationsPage } from './QuotationsPage';
import { draftOf, quotationRequest } from './api';
import type { Quotation } from './api';

const record: Quotation = {
  id: '11111111-1111-4111-8111-111111111111',
  customer_id: '22222222-2222-4222-8222-222222222222',
  version: 1,
  current_version: 1,
  pickup_date: '2026-10-10',
  event_date: '2026-10-11',
  return_date: '2026-10-13',
  valid_until: '2026-10-09',
  pickup_time: '10:00',
  event_time: null,
  return_time: null,
  lines: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      kind: 'product',
      source_id: '44444444-4444-4444-8444-444444444444',
      quantity: 1,
      name: 'Synthetic product',
      unit_price: '100.01',
      source_version: 1,
      items: [
        {
          product_id: '44444444-4444-4444-8444-444444444444',
          quantity: 1,
          name: 'Synthetic product',
          source_version: 1,
        },
      ],
    },
  ],
  discount: null,
  subtotal: '100.01',
  discount_amount: '0.00',
  total: '100.01',
  estimated_deposit: '50.01',
  estimated_balance: '50.00',
  catalog_versions: {},
  state: 'current',
  expired: false,
  requires_revision: false,
  capacity: [
    {
      product_id: '44444444-4444-4444-8444-444444444444',
      name: 'Synthetic product',
      demand: 1,
      apt: 0,
      shortage: 1,
    },
  ],
  capacity_mode: 'registered_stock',
  capacity_checked_at: '2026-10-09T12:00:00Z',
  stock_pending: true,
  planning_available_from: '2026-10-14',
  reason: null,
  actor_id: '55555555-5555-4555-8555-555555555555',
  session_id: '66666666-6666-4666-8666-666666666666',
  created_at: '2026-10-09T12:00:00Z',
  revised_at: '2026-10-09T12:00:00Z',
};
const empty = { items: [], total: 0, page: 1, page_size: 25 };
const response = (data: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
});
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(response(empty));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it('opens the new rental editor directly without a quotation search or technical fields', async () => {
  render(
    <MemoryRouter>
      <QuotationsPage />
    </MemoryRouter>,
  );
  expect(
    await screen.findByRole('heading', { name: 'Nova locação' }),
  ).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'Cliente' })).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Nova locação' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Buscar locações' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText('ID do cliente')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('ID do orçamento')).not.toBeInTheDocument();
  expect(
    fetchMock.mock.calls.filter(([url]) => url === '/api/quotations/search'),
  ).toHaveLength(0);
  expect(
    screen.getByRole('link', { name: 'Consultar orçamentos por cliente' }),
  ).toHaveAttribute('href', '/clientes');
});

it('keeps the exact saved lines by identity rather than accepting new catalog prices', () => {
  const draft = draftOf(record);
  expect(draft.lines).toEqual([
    {
      kind: 'product',
      source_id: record.lines[0].source_id,
      quantity: 1,
      retained_line_id: record.lines[0].id,
    },
  ]);
  expect(draft.expected_version).toBe(1);
  expect(draft.pickup_time).toBe('10:00');
  expect('total' in draft).toBe(false);
});

it('reconciles an uncertain revision with the identical key/body and no false success', async () => {
  const onSaved = vi.fn();
  let writes = 0;
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/preview')) return response(record);
    if (url.endsWith('/versions')) {
      writes++;
      if (writes === 1) throw new TypeError('synthetic connection failure');
      return response({ ...record, version: 2 });
    }
    return response(empty);
  });
  render(
    <QuotationEditor initial={record} onSaved={onSaved} onCancel={() => {}} />,
  );
  await userEvent.type(
    screen.getByLabelText('Motivo da nova revisão'),
    'Synthetic reviewed agreement',
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Calcular prévia' }),
  );
  await userEvent.click(
    await screen.findByRole('button', { name: 'Salvar nova revisão' }),
  );
  expect(
    await screen.findByRole('button', { name: 'Reconciliar mesma gravação' }),
  ).toBeVisible();
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Motivo da nova revisão')).toBeDisabled();
  await userEvent.click(
    screen.getByRole('button', { name: 'Reconciliar mesma gravação' }),
  );
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  const bodies = fetchMock.mock.calls
    .filter(([url]) => url.endsWith('/versions'))
    .map(([, options]) => options.body);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
  expect(JSON.parse(bodies[0]).request_id).toMatch(/^[0-9a-f-]{36}$/);
});

it('shows conflict comparison while preserving the negotiated draft and requiring a fresh preview', async () => {
  fetchMock.mockImplementation(async (url: string) =>
    url.endsWith('/preview')
      ? response({ detail: 'Os dados mudaram.', code: 'version_conflict' }, 409)
      : url === `/api/quotations/${record.id}`
        ? response({ ...record, version: 2, total: '120.00' })
        : response(empty),
  );
  render(
    <QuotationEditor initial={record} onSaved={() => {}} onCancel={() => {}} />,
  );
  await userEvent.type(
    screen.getByLabelText('Motivo da nova revisão'),
    'Synthetic local draft',
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Calcular prévia' }),
  );
  expect(await screen.findByRole('alert')).toHaveFocus();
  expect(
    await screen.findByRole('heading', { name: 'Versão atual 2' }),
  ).toBeVisible();
  expect(screen.getByLabelText('Motivo da nova revisão')).toHaveValue(
    'Synthetic local draft',
  );
  expect(
    screen.queryByRole('button', { name: 'Salvar nova revisão' }),
  ).not.toBeInTheDocument();
});

it('ends session on authenticated failure without leaking rejected fields into feedback', async () => {
  const ended = vi.fn();
  window.addEventListener('rentalops-session-ended', ended);
  fetchMock.mockResolvedValue(response({ detail: 'Sessão encerrada.' }, 401));
  await expect(quotationRequest('/search', {})).rejects.toThrow(
    'Sessão encerrada.',
  );
  expect(ended).toHaveBeenCalledOnce();
  window.removeEventListener('rentalops-session-ended', ended);
  fetchMock.mockResolvedValue(
    response(
      {
        detail: 'private synthetic contents',
        fields: ['private synthetic contents'],
      },
      422,
    ),
  );
  await expect(quotationRequest('/preview', {})).rejects.toThrow(
    'Revise os campos destacados',
  );
});

it.each([
  [
    'Data do evento',
    '2026-10-09',
    'O evento não pode ser anterior à retirada.',
  ],
  [
    'Devolução prevista',
    '2026-10-10',
    'A devolução não pode ser anterior ao evento.',
  ],
])(
  'explains invalid %s beside the field and does not send or save the draft',
  async (label, value, explanation) => {
    const saved = vi.fn();
    render(
      <QuotationEditor initial={record} onSaved={saved} onCancel={() => {}} />,
    );
    await userEvent.type(
      screen.getByLabelText('Motivo da nova revisão'),
      'Revisão sintética',
    );
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    await userEvent.click(
      screen.getByRole('button', { name: 'Calcular prévia' }),
    );
    const input = screen.getByLabelText(label);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveFocus();
    expect(
      document.getElementById(input.getAttribute('aria-describedby')!),
    ).toHaveTextContent(explanation);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Nenhuma locação foi salva ou confirmada',
    );
    expect(
      fetchMock.mock.calls.filter(
        ([url]) => url.endsWith('/preview') || url.endsWith('/versions'),
      ),
    ).toHaveLength(0);
    expect(saved).not.toHaveBeenCalled();
  },
);

it('shows a required-field error, clears it after correction and only calculates the preview', async () => {
  fetchMock.mockImplementation(async (url: string) =>
    response(url.endsWith('/preview') ? record : empty),
  );
  const saved = vi.fn();
  render(
    <QuotationEditor initial={record} onSaved={saved} onCancel={() => {}} />,
  );
  await userEvent.type(
    screen.getByLabelText('Motivo da nova revisão'),
    'Revisão sintética',
  );
  fireEvent.change(screen.getByLabelText('Retirada prevista'), {
    target: { value: '' },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Calcular prévia' }),
  );
  expect(screen.getByLabelText('Retirada prevista')).toHaveFocus();
  expect(
    screen.getByLabelText('Retirada prevista'),
  ).toHaveAccessibleDescription('Preencha este campo.');
  fireEvent.change(screen.getByLabelText('Retirada prevista'), {
    target: { value: record.pickup_date },
  });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: 'Calcular prévia' }),
  );
  expect(
    await screen.findByRole('button', { name: 'Salvar nova revisão' }),
  ).toBeVisible();
  expect(saved).not.toHaveBeenCalled();
  expect(
    fetchMock.mock.calls.filter(([url]) => url.endsWith('/versions')),
  ).toHaveLength(0);
});

it('preserves the server calculation reason and points to the affected discount field', async () => {
  const explanation = 'O desconto não pode deixar o total abaixo de R$ 0,01.';
  fetchMock.mockImplementation(async (url: string) =>
    url.endsWith('/preview')
      ? response(
          {
            code: 'invalid_offer',
            detail: explanation,
            field_errors: { 'discount.value': explanation },
          },
          422,
        )
      : response(empty),
  );
  render(
    <QuotationEditor
      initial={{
        ...record,
        discount: {
          kind: 'amount',
          value: '200.00',
          reason: 'Acordo sintético',
        },
      }}
      onSaved={() => {}}
      onCancel={() => {}}
    />,
  );
  await userEvent.type(
    screen.getByLabelText('Motivo da nova revisão'),
    'Revisão sintética',
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Calcular prévia' }),
  );
  const discount = await screen.findByLabelText('Valor do desconto');
  await waitFor(() => expect(discount).toHaveFocus());
  expect(discount).toHaveAccessibleDescription(explanation);
  expect(screen.queryByText(/Confira cliente, datas/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Salvar nova revisão' }),
  ).not.toBeInTheDocument();
});

it('waits for current catalog values before enabling an explicit source refresh', async () => {
  let resolveProduct: (value: unknown) => void = () => {};
  fetchMock.mockImplementation(async (url: string) =>
    url.startsWith('/api/products?')
      ? new Promise((resolve) => {
          resolveProduct = resolve;
        })
      : url.endsWith('/preview')
        ? response(record)
        : response(empty),
  );
  render(
    <QuotationEditor initial={record} onSaved={() => {}} onCancel={() => {}} />,
  );
  const refresh = screen.getByRole('button', {
    name: 'Usar valores atuais do catálogo',
  });
  expect(refresh).toBeDisabled();
  resolveProduct(
    response({
      ...empty,
      items: [
        {
          id: record.lines[0].source_id,
          name: 'Synthetic product',
          price: '200.00',
          is_active: true,
          version: 2,
          total_quantity: 1,
          maintenance_quantity: 0,
          apt_quantity: 1,
        },
      ],
    }),
  );
  await waitFor(() => expect(refresh).toBeEnabled());
  await userEvent.click(refresh);
  await userEvent.type(
    screen.getByLabelText('Motivo da nova revisão'),
    'Synthetic explicit refreshed source',
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Calcular prévia' }),
  );
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/preview'))).toBe(
      true,
    ),
  );
  const body = JSON.parse(
    fetchMock.mock.calls.find(([url]) => url.endsWith('/preview'))![1].body,
  );
  expect(body.lines[0].retained_line_id).toBeUndefined();
});
