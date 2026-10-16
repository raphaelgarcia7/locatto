import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { QuotationDetail } from './QuotationDetail';
import type { Quotation } from './api';
import type { Payments } from '../payments/api';

// Contract behavior is tested separately; these tests isolate financial refresh.
vi.mock('../contracts/ContractsSection', () => ({
  ContractsSection: () => null,
}));
// Custody has its own command/unknown-state tests; keep this financial contract
// test's existing responses scoped to the sections it exercises.
vi.mock('../rentals/GuidedCustody', () => ({ GuidedCustody: () => null }));
vi.mock('../rentals/ChecklistSection', () => ({
  ChecklistSection: () => null,
}));

const record: Quotation = {
  id: '11111111-1111-4111-8111-111111111111',
  customer_id: '22222222-2222-4222-8222-222222222222',
  version: 1,
  current_version: 1,
  lines: [],
  capacity: [],
  total: '400.00',
  subtotal: '400.00',
  discount_amount: '0.00',
  estimated_deposit: '200.00',
  estimated_balance: '200.00',
  revised_at: '2026-10-10T12:00:00Z',
  created_at: '2026-10-10T12:00:00Z',
  pickup_date: '2026-10-11',
  event_date: '2026-10-12',
  return_date: '2026-10-13',
  valid_until: '2026-10-10',
  pickup_time: null,
  event_time: null,
  return_time: null,
  discount: null,
  catalog_versions: {},
  state: 'current',
  expired: false,
  requires_revision: false,
  capacity_mode: 'allocation_aware',
  capacity_checked_at: '2026-10-10T12:00:00Z',
  stock_pending: false,
  planning_available_from: '2026-10-14',
  reason: null,
  actor_id: 'synthetic',
  session_id: 'synthetic',
};

it('shows a concise rental summary without IDs, source versions or duplicated product components', async () => {
  const productId = '33333333-3333-4333-8333-333333333333';
  const quotation: Quotation = {
    ...record,
    lines: [
      {
        id: 'line',
        kind: 'product',
        source_id: productId,
        name: 'Painel romano',
        quantity: 1,
        unit_price: '30.00',
        source_version: 2,
        items: [
          {
            product_id: productId,
            name: 'Painel romano',
            quantity: 1,
            source_version: 2,
          },
        ],
      },
    ],
    capacity: [
      {
        product_id: productId,
        name: 'Painel romano',
        demand: 1,
        apt: 1,
        shortage: 0,
      },
    ],
  };
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    expect(options?.method).not.toBe('POST');
    if (url.includes('/rentals/')) return new Response('{}', { status: 404 });
    return new Response(
      JSON.stringify(
        url.endsWith('/payments')
          ? empty
          : url.endsWith('/versions')
            ? [quotation]
            : page([]),
      ),
    );
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <MemoryRouter>
      <QuotationDetail record={quotation} onEdit={vi.fn()} onClose={vi.fn()} />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole('heading', { name: 'Detalhes da locação' }),
  ).toBeVisible();
  expect(
    screen.queryByText(record.id, { exact: true }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/fonte v/i)).not.toBeInTheDocument();
  expect(
    within(screen.getByRole('list', { name: 'Itens da locação' })).getAllByText(
      'Painel romano',
    ),
  ).toHaveLength(1);
  expect(
    document.querySelector('.quotation-workflow > summary')!.parentElement,
  ).toHaveAttribute('open');
  expect(
    document.querySelectorAll('.quotation-workflow > summary')[1].parentElement,
  ).not.toHaveAttribute('open');
  expect(
    screen.getByText('Alterações e cancelamento').parentElement,
  ).not.toHaveAttribute('open');
  const user = userEvent.setup();
  await user.click(
    screen.getAllByRole('button', {
      name: 'Registrar sinal e reservar',
    })[0],
  );
  expect(
    document.querySelector('.quotation-workflow > summary')!.parentElement,
  ).toHaveAttribute('open');
  await user.click(
    await within(
      screen.getByRole('region', { name: 'Pagamentos da locação' }),
    ).findByRole('button', { name: 'Sinal pago' }),
  );
  const amount = await screen.findByLabelText('Valor em reais');
  await user.clear(amount);
  await user.type(amount, '30,00');
  await user.click(document.querySelector('.quotation-workflow > summary')!);
  await user.click(document.querySelector('.quotation-workflow > summary')!);
  expect(screen.getByLabelText('Valor em reais')).toHaveValue('30,00');
  expect(
    fetcher.mock.calls.every(([, options]) => options?.method !== 'POST'),
  ).toBe(true);
});
const empty: Payments = {
  quotation_id: record.id,
  quotation_version: 1,
  financial_version: 0,
  reconciled_quotation_version: null,
  total: '400.00',
  estimated_deposit: '200.00',
  estimated_balance: '200.00',
  received: '0.00',
  refunded: '0.00',
  net_received: '0.00',
  applied_deposit: '0.00',
  applied_balance: '0.00',
  deposit_remaining: '200.00',
  balance_remaining: '200.00',
  remaining: '400.00',
  pending: '0.00',
  excess: '0.00',
  deposit_validated: false,
  fully_paid: false,
  requires_reconciliation: false,
  commercial_version_pending: false,
  receipts: [],
  refunds: [],
};
const paid: Payments = {
  ...empty,
  financial_version: 2,
  reconciled_quotation_version: 1,
  received: '200.00',
  net_received: '200.00',
  applied_deposit: '200.00',
  deposit_remaining: '0.00',
  remaining: '200.00',
  deposit_validated: true,
  receipts: [
    {
      id: 'receipt',
      revision: 1,
      amount: '200.00',
      method: 'pix',
      business_date: '2026-10-08',
      observation: null,
      actor_id: 'synthetic',
      session_id: 'synthetic',
      created_at: record.revised_at,
      refunded: '0.00',
      net: '200.00',
      applied_deposit: '200.00',
      applied_balance: '0.00',
      pending: '0.00',
      proofs: [],
    },
  ],
};
const rental = {
  state: 'confirmed',
  allocations: [],
  current_financial: paid,
  confirmation_deposit: '200.00',
  signature_commercial_version: 1,
  id: 'rental',
  version: 1,
  quotation_version: 1,
  financial_version: 2,
  checked_at: '2026-10-10T12:00:00Z',
  pending: [],
};
const page = (items: unknown[]) => ({
  items,
  total: items.length,
  page: 1,
  page_size: 50,
});
afterEach(() => vi.unstubAllGlobals());

it.each(
  ['500.00', '150.00'].flatMap((total) =>
    (['loaded', 'loading', 'failed'] as const).map((read) => ({ total, read })),
  ),
)(
  'never restores 50% estimates for a cancelled rental: %j',
  async ({ total, read }) => {
    const deposit = total === '500.00' ? '200.00' : '150.00';
    const balance = total === '500.00' ? '300.00' : '0.00';
    const financial = {
      ...paid,
      total,
      estimated_deposit: deposit,
      estimated_balance: balance,
      balance_remaining: balance,
      remaining: balance,
    };
    const cancelled = { ...rental, state: 'cancelled' as const };
    const quotation: Quotation = {
      ...record,
      total,
      estimated_deposit: total === '500.00' ? '250.00' : '75.00',
      estimated_balance: total === '500.00' ? '250.00' : '75.00',
      rental: {
        ...cancelled,
        inventory_pending: false,
        financial_pending: false,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/payments')) {
          if (read === 'loading') return new Promise<Response>(() => {});
          if (read === 'failed') return new Response('{}', { status: 503 });
          return new Response(
            JSON.stringify(url.endsWith('/history') ? page([]) : financial),
          );
        }
        const result = url.endsWith('/versions')
          ? [quotation]
          : url.includes('/history')
            ? page([])
            : cancelled;
        return new Response(JSON.stringify(result));
      }),
    );
    render(
      <MemoryRouter>
        <QuotationDetail
          record={quotation}
          onEdit={vi.fn()}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );
    if (!document.querySelector('.quotation-workflow')!.hasAttribute('open'))
      await userEvent.click(
        document.querySelector('.quotation-workflow > summary')!,
      );
    const summary = within(
      screen.getByRole('region', { name: 'Prévia comercial do servidor' }),
    );
    // Assert immediately too: pending/error reads must never fall back to 50%.
    expect(summary.queryByText('Sinal previsto')).not.toBeInTheDocument();
    expect(summary.queryByText('Saldo previsto')).not.toBeInTheDocument();
    const panel = within(
      screen.getByRole('region', { name: 'Pagamentos da locação' }),
    );
    if (read === 'loaded') {
      await panel.findByText('Sinal previsto');
      expect(
        panel.getByText('Sinal previsto').nextElementSibling,
      ).toHaveTextContent(deposit === '200.00' ? '200,00' : '150,00');
      expect(
        panel.getByText('Saldo previsto').nextElementSibling,
      ).toHaveTextContent(balance === '300.00' ? '300,00' : '0,00');
    } else if (read === 'failed') {
      expect(await panel.findByRole('alert')).toHaveTextContent(
        'Não foi possível consultar o financeiro',
      );
    } else {
      expect(panel.getByText('Consultando financeiro…')).toBeVisible();
    }
    expect(summary.queryByText('Sinal previsto')).not.toBeInTheDocument();
    expect(summary.queryByText('Saldo previsto')).not.toBeInTheDocument();
  },
);

it.each(['confirmed', 'review', 'out', 'completed'] as const)(
  'leaves the financial server as the only installment authority for %s',
  async (state) => {
    const financial = {
      ...paid,
      total: '150.00',
      estimated_deposit: '75.00',
      estimated_balance: '75.00',
    };
    const quotation: Quotation = {
      ...record,
      rental: {
        id: rental.id,
        version: 1,
        state,
        inventory_pending: false,
        financial_pending: false,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const result = url.endsWith('/payments')
          ? financial
          : url.endsWith('/versions')
            ? [quotation]
            : url.includes('/history')
              ? page([])
              : { ...rental, state };
        return new Response(JSON.stringify(result));
      }),
    );
    render(
      <MemoryRouter>
        <QuotationDetail
          record={quotation}
          onEdit={vi.fn()}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );
    if (!document.querySelector('.quotation-workflow')!.hasAttribute('open'))
      await userEvent.click(
        document.querySelector('.quotation-workflow > summary')!,
      );
    const summary = within(
      screen.getByRole('region', { name: 'Prévia comercial do servidor' }),
    );
    expect(summary.queryByText('Sinal previsto')).not.toBeInTheDocument();
    expect(summary.queryByText('Saldo previsto')).not.toBeInTheDocument();
    const panel = within(
      screen.getByRole('region', { name: 'Pagamentos da locação' }),
    );
    await panel.findByText('Sinal previsto');
    expect(
      panel.getByText('Sinal previsto').nextElementSibling,
    ).toHaveTextContent('75,00');
    expect(
      panel.getByText('Saldo previsto').nextElementSibling,
    ).toHaveTextContent('75,00');
  },
);

it('keeps the original estimates for a quotation without a rental', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/rentals/')) return new Response('{}', { status: 404 });
      const result = url.endsWith('/payments')
        ? empty
        : url.endsWith('/versions')
          ? [record]
          : page([]);
      return new Response(JSON.stringify(result));
    }),
  );
  render(
    <MemoryRouter>
      <QuotationDetail record={record} onEdit={vi.fn()} onClose={vi.fn()} />
    </MemoryRouter>,
  );
  if (!document.querySelector('.quotation-workflow')!.hasAttribute('open'))
    await userEvent.click(
      document.querySelector('.quotation-workflow > summary')!,
    );
  const summary = within(
    screen.getByRole('region', { name: 'Prévia comercial do servidor' }),
  );
  expect(
    summary.getByText('Sinal previsto').nextElementSibling,
  ).toHaveTextContent('200,00');
  expect(
    summary.getByText('Saldo previsto').nextElementSibling,
  ).toHaveTextContent('200,00');
  await screen.findByText(/Marque o sinal como pago após receber/);
});

it.each([
  { unknown: false, readFailure: false },
  { unknown: true, readFailure: false },
  { unknown: false, readFailure: true },
  { unknown: true, readFailure: true },
])(
  'refreshes externally paid financial facts and history through confirmation/replay: %j',
  async ({ unknown, readFailure }) => {
    let financial = empty;
    let confirmed = false;
    let unavailable = readFailure;
    const payloads: string[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (confirmed && unavailable && url.endsWith('/payments/history'))
        return new Response('{}', { status: 503 });
      let result: unknown = record;
      if (url.endsWith('/payments')) result = financial;
      else if (url.endsWith('/payments/history'))
        result = page(
          financial.financial_version
            ? [
                ...['receipt', 'reconciliation'].map((operation, index) => ({
                  id: String(index),
                  operation,
                  financial_version: index + 1,
                  quotation_version: 1,
                  created_at: record.revised_at,
                  before: empty,
                  after: paid,
                })),
              ]
            : [],
        );
      else if (url.endsWith('/confirmation-preview'))
        result = {
          quotation_version: 1,
          financial_version: 2,
          deposit_valid: true,
          pending: false,
          capacity: [],
        };
      else if (url.endsWith('/confirm')) {
        payloads.push(String(init?.body));
        confirmed = true;
        if (unknown && payloads.length === 1)
          throw new TypeError('Synthetic lost acknowledgement');
        result = rental;
      } else if (url.includes('/rentals/by-quotation/')) {
        if (!confirmed) return new Response('{}', { status: 404 });
        result = rental;
      } else if (url.endsWith('/versions')) result = [record];
      else if (url.includes('/rentals/rental/history')) result = page([]);
      return new Response(JSON.stringify(result));
    });
    vi.stubGlobal('fetch', fetcher);
    render(
      <MemoryRouter>
        <QuotationDetail record={record} onEdit={vi.fn()} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    if (!document.querySelector('.quotation-workflow')!.hasAttribute('open'))
      await userEvent.click(
        document.querySelector('.quotation-workflow > summary')!,
      );
    const panel = within(
      screen.getByRole('region', { name: 'Pagamentos da locação' }),
    );
    await panel.findByText(/Marque o sinal como pago após receber/);
    await userEvent.click(
      panel.getByText('Histórico financeiro', { exact: true }),
    );
    expect(
      panel.getByText('Nenhuma movimentação financeira no histórico.'),
    ).toBeVisible();
    financial = paid; // Another attendant receives and reconciles while the detail stays open.
    await userEvent.click(
      screen.getByText('Mais opções · histórico e alterações'),
    );
    await userEvent.click(screen.getByText('Reservar com sinal já registrado'));
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Conferir disponibilidade para reservar',
      }),
    );
    await panel.findByText(
      'Sinal recebido. Confirme a reserva para garantir os itens.',
    );
    await userEvent.click(
      panel.getByText('Histórico financeiro', { exact: true }),
    );
    expect(
      screen.getByRole('region', { name: 'Pagamentos da locação' }),
    ).toHaveAttribute('data-financial-version', '2');
    expect(panel.getByText(/Recebimento registrado/)).toBeVisible();
    expect(panel.getByText(/Conciliação substituída/)).toBeVisible();
    expect(
      panel.queryByText('Nenhuma movimentação financeira no histórico.'),
    ).not.toBeInTheDocument();
    expect(
      panel.getByText('Recebido registrado').nextElementSibling,
    ).toHaveTextContent('200,00');
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Confirmar reserva e reservar itens',
      }),
    );
    if (readFailure) {
      expect(await panel.findByRole('alert')).toHaveTextContent(
        'Não foi possível consultar o financeiro',
      );
      expect(
        panel.queryByText(/Para reservar, o sinal é de R\$\s*200,00\./),
      ).not.toBeInTheDocument();
      expect(
        panel.queryByText(
          'Sinal recebido. Confirme a reserva para garantir os itens.',
        ),
      ).not.toBeInTheDocument();
      expect(
        panel.queryByText('Nenhuma movimentação financeira no histórico.'),
      ).not.toBeInTheDocument();
      unavailable = false;
      await userEvent.click(
        panel.getByRole('button', { name: 'Reconsultar financeiro' }),
      );
    }
    if (unknown) {
      await screen.findByText(/Resultado desconhecido/);
      expect(screen.queryByText('Reserva confirmada')).not.toBeInTheDocument();
      await panel.findByText(
        'Sinal recebido. Confirme a reserva para garantir os itens.',
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'Reconciliar a mesma confirmação' }),
      );
    }
    await screen.findByText('Reserva confirmada');
    expect(
      screen.queryByText('Validade comercial vigente'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Validade vigente · não é reserva confirmada'),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        panel.getByText(
          'Sinal recebido. Confirme a reserva para garantir os itens.',
        ),
      ).toBeVisible(),
    );
    expect(
      panel.queryByText(/Para reservar, o sinal é de R\$\s*200,00\./),
    ).not.toBeInTheDocument();
    expect(payloads).toHaveLength(unknown ? 2 : 1);
    if (unknown) expect(payloads[1]).toBe(payloads[0]);
  },
);
