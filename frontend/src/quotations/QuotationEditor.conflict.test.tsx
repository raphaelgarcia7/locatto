import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { QuotationEditor } from './QuotationEditor';
import type { Quotation } from './api';
import type { Payments } from '../payments/api';
import type { RentalRevision } from '../rentals/api';

const quotation = {
  id: '11111111-1111-4111-8111-111111111111',
  customer_id: '22222222-2222-4222-8222-222222222222',
  version: 1,
  current_version: 1,
  pickup_date: '2026-10-10',
  event_date: '2026-10-11',
  return_date: '2026-10-13',
  valid_until: '2026-10-09',
  pickup_time: null,
  event_time: null,
  return_time: null,
  lines: [
    {
      id: 'line',
      kind: 'product',
      source_id: 'product',
      quantity: 1,
      name: 'Synthetic product',
      unit_price: '100.00',
      negotiation_reason: 'Synthetic retained price reason',
      source_version: 1,
      items: [
        {
          product_id: 'product',
          name: 'Synthetic product',
          quantity: 1,
          source_version: 1,
        },
      ],
    },
  ],
  discount: null,
  subtotal: '100.00',
  discount_amount: '0.00',
  total: '100.00',
  estimated_deposit: '50.00',
  estimated_balance: '50.00',
  catalog_versions: {},
  state: 'current',
  expired: false,
  requires_revision: false,
  capacity: [],
  capacity_mode: 'registered_stock',
  capacity_checked_at: '2026-10-09T12:00:00Z',
  stock_pending: false,
  planning_available_from: '2026-10-14',
  reason: null,
  actor_id: 'synthetic',
  session_id: 'synthetic',
  created_at: '2026-10-09T12:00:00Z',
  revised_at: '2026-10-09T12:00:00Z',
} as Quotation;
const financial: Payments = {
  quotation_id: quotation.id,
  quotation_version: 1,
  financial_version: 2,
  reconciled_quotation_version: 1,
  total: '100.00',
  estimated_deposit: '50.00',
  estimated_balance: '50.00',
  received: '50.00',
  refunded: '0.00',
  applied_deposit: '50.00',
  applied_balance: '0.00',
  deposit_remaining: '0.00',
  balance_remaining: '50.00',
  remaining: '50.00',
  pending: '0.00',
  excess: '0.00',
  deposit_validated: true,
  fully_paid: false,
  requires_reconciliation: false,
  commercial_version_pending: false,
  receipts: [],
  refunds: [],
  net_received: '50.00',
};
const revision: RentalRevision = {
  id: 'rental',
  mode: 'change',
  expected_rental_version: 3,
  expected_quotation_version: 1,
  expected_financial_version: 2,
  financial,
};
const quotePath = `/api/quotations/${quotation.id}`;
const paymentPath = `${quotePath}/payments`;
const rentalPath = '/api/rentals/rental';
const paths = [quotePath, paymentPath, rentalPath];
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const conflict = () =>
  response(
    { detail: 'Synthetic version conflict', code: 'version_conflict' },
    409,
  );
const empty = { items: [], total: 0, page: 1, page_size: 100 };
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function values(version = 9) {
  return [
    { ...quotation, version, current_version: version, total: '150.00' },
    {
      ...financial,
      quotation_version: version,
      financial_version: version + 8,
      net_received: '75.00',
    },
    { id: 'rental', version: version + 14 },
  ];
}
function install(
  read: (index: number) => Promise<Response>,
  extra?: (url: string, init?: RequestInit) => Promise<Response>,
) {
  const reads: string[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const index = paths.indexOf(url);
    if (index >= 0 && (!init?.method || init.method === 'GET')) {
      reads.push(url);
      return read(index);
    }
    if (url.endsWith('preview') || url.endsWith('/changes'))
      return extra ? extra(url, init) : conflict();
    return response(empty);
  });
  vi.stubGlobal('fetch', fetcher);
  return { reads, fetcher };
}
async function open(rentalRevision: RentalRevision | undefined = revision) {
  const saved = vi.fn();
  render(
    <QuotationEditor
      initial={quotation}
      rentalRevision={rentalRevision}
      onSaved={saved}
      onCancel={() => {}}
    />,
  );
  await userEvent.type(
    screen.getByLabelText('Motivo da nova revisão'),
    'Synthetic retained reason',
  );
  await userEvent.clear(screen.getByLabelText('Quantidade', { exact: true }));
  await userEvent.type(
    screen.getByLabelText('Quantidade', { exact: true }),
    '2',
  );
  if (rentalRevision?.mode === 'resume') {
    await userEvent.click(
      screen.getByRole('checkbox', { name: /Conferi os preços/ }),
    );
  }
  await userEvent.click(
    screen.getByRole('button', { name: 'Calcular prévia' }),
  );
  return saved;
}
afterEach(() => vi.unstubAllGlobals());

it('starts all independent conflict reads before resolving any and publishes only the complete divergent versions', async () => {
  const pending = paths.map(() => deferred());
  const { reads, fetcher } = install((index) => pending[index].promise);
  const latest = values();
  const saved = await open();
  try {
    await waitFor(() => expect(reads).toEqual(paths));
    await act(async () => {
      pending[2].resolve(response(latest[2]));
      pending[1].resolve(response(latest[1]));
    });
    expect(
      screen.queryByRole('region', { name: 'Comparação de conflito' }),
    ).not.toBeInTheDocument();
    await act(async () => {
      pending[0].resolve(response(latest[0]));
    });
    const comparison = await screen.findByRole('region', {
      name: 'Comparação de conflito',
    });
    expect(comparison).toHaveTextContent('Versão atual 9');
    expect(comparison).toHaveTextContent(
      'Locação v23 · financeiro v17 · líquido R$ 75,00',
    );
    expect(screen.getByLabelText('Quantidade', { exact: true })).toHaveValue(2);
    expect(screen.getByLabelText('Motivo da nova revisão')).toHaveValue(
      'Synthetic retained reason',
    );
    expect(saved).not.toHaveBeenCalled();
    expect(
      fetcher.mock.calls.filter(([url]) => paths.includes(url)),
    ).toHaveLength(3);
  } finally {
    await act(async () => {
      pending.forEach((entry, index) => entry.resolve(response(latest[index])));
    });
  }
});

it.each([0, 1, 2])(
  'does not publish partial conflict data if independent read %s fails',
  async (failure) => {
    const latest = values();
    install(async (index) =>
      response(
        index === failure ? { detail: 'Synthetic unavailable' } : latest[index],
        index === failure ? 503 : 200,
      ),
    );
    const saved = await open();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Calcular prévia' }),
      ).toBeEnabled(),
    );
    expect(
      screen.queryByRole('region', { name: 'Comparação de conflito' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Synthetic version conflict',
    );
    expect(screen.getByLabelText('Quantidade', { exact: true })).toHaveValue(2);
    expect(screen.getByLabelText('Motivo da nova revisão')).toHaveValue(
      'Synthetic retained reason',
    );
    expect(saved).not.toHaveBeenCalled();
  },
);

it('reads quotation and money but no rental when resuming without a rental ID', async () => {
  const latest = values();
  const { reads } = install(async (index) => response(latest[index]));
  await open({
    ...revision,
    id: undefined,
    mode: 'resume',
    expected_rental_version: 0,
  });
  expect(
    await screen.findByRole('region', { name: 'Comparação de conflito' }),
  ).toHaveTextContent('Locação v0 · financeiro v17');
  expect(reads).toEqual(paths.slice(0, 2));
});

it('does not request rental or money for an ordinary commercial revision conflict', async () => {
  const latest = values();
  const { reads } = install(async (index) => response(latest[index]));
  const saved = vi.fn();
  render(
    <QuotationEditor initial={quotation} onSaved={saved} onCancel={() => {}} />,
  );
  await userEvent.type(
    screen.getByLabelText('Motivo da nova revisão'),
    'Synthetic ordinary revision',
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Calcular prévia' }),
  );
  expect(
    await screen.findByRole('heading', { name: 'Versão atual 9' }),
  ).toBeVisible();
  expect(reads).toEqual([quotePath]);
  expect(saved).not.toHaveBeenCalled();
});

it('fetches fresh versions on the next409 and sends the compared versions for server revalidation without discarding the draft', async () => {
  let round = 9;
  const previews: Record<string, unknown>[] = [];
  install(
    async (index) => response(values(round)[index]),
    async (_url, init) => {
      previews.push(JSON.parse(String(init?.body)));
      return conflict();
    },
  );
  const saved = await open();
  await screen.findByRole('heading', { name: 'Versão atual 9' });
  await userEvent.click(
    screen.getByRole('button', { name: 'Manter rascunho após comparar' }),
  );
  round = 10;
  await userEvent.click(
    screen.getByRole('button', { name: 'Calcular prévia' }),
  );
  expect(
    await screen.findByRole('region', { name: 'Comparação de conflito' }),
  ).toHaveTextContent('Locação v24 · financeiro v18');
  expect(previews[1]).toMatchObject({
    expected_quotation_version: 9,
    expected_financial_version: 17,
    expected_rental_version: 23,
  });
  expect(previews[1]).toHaveProperty('draft.lines.0.quantity', 2);
  expect(screen.getByLabelText('Motivo da nova revisão')).toHaveValue(
    'Synthetic retained reason',
  );
  expect(saved).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('button', { name: 'Confirmar alteração da locação' }),
  ).not.toBeInTheDocument();
});

it('preserves an unknown write key/body and rejects a stale retry with409 rather than reporting success', async () => {
  let previewConflict = true;
  const writes: string[] = [];
  const latest = values();
  install(
    async (index) => response(latest[index]),
    async (url, init) => {
      if (url.endsWith('preview')) {
        if (previewConflict) return conflict();
        return response({
          before: quotation,
          after: quotation,
          financial: {
            net_received: '75.00',
            remaining: '25.00',
            excess: '0.00',
            historical_deposit: '50.00',
            deposit_due: '50.00',
            balance_due: '50.00',
            requires_payment_review: false,
          },
          requires_new_signature: true,
        });
      }
      writes.push(String(init?.body));
      if (writes.length === 1)
        throw new TypeError('Synthetic lost acknowledgement');
      return conflict();
    },
  );
  const saved = await open();
  await screen.findByRole('heading', { name: 'Versão atual 9' });
  await userEvent.click(
    screen.getByRole('button', { name: 'Manter rascunho após comparar' }),
  );
  previewConflict = false;
  await userEvent.click(
    screen.getByRole('button', { name: 'Calcular prévia' }),
  );
  await userEvent.click(
    await screen.findByRole('button', {
      name: 'Confirmar alteração da locação',
    }),
  );
  await screen.findByText(/Resultado da gravação desconhecido/);
  expect(screen.getByLabelText('Motivo da nova revisão')).toBeDisabled();
  expect(screen.getByLabelText('Quantidade', { exact: true })).toBeDisabled();
  expect(saved).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole('button', { name: 'Reconciliar mesma gravação' }),
  );
  await screen.findByRole('region', { name: 'Comparação de conflito' });
  expect(writes).toHaveLength(2);
  expect(writes[0]).toBe(writes[1]);
  expect(JSON.parse(writes[0])).toMatchObject({
    expected_quotation_version: 9,
    expected_financial_version: 17,
    expected_rental_version: 23,
    reason: 'Synthetic retained reason',
  });
  expect(JSON.parse(writes[0]).request_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(JSON.parse(writes[0]).draft.lines[0].quantity).toBe(2);
  expect(saved).not.toHaveBeenCalled();
});
