import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { FinancialSection } from './FinancialSection';
import { GuidedPayment } from './GuidedPayment';
import type { Payments } from './api';
import {
  existingPaymentApplication,
  newPaymentApplication,
} from './paymentSuggestions';

export const state: Payments = {
  quotation_id: '11111111-1111-4111-8111-111111111111',
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

afterEach(() => {
  vi.unstubAllGlobals();
});

it('shows paid milestones without treating an excess receipt as financial debt', () => {
  render(
    <GuidedPayment
      data={{
        ...state,
        received: '450.00',
        net_received: '450.00',
        remaining: '0.00',
        excess: '50.00',
        pending: '50.00',
        deposit_validated: true,
        fully_paid: true,
      }}
      disabled={false}
      onReceive={vi.fn()}
      onReview={vi.fn()}
    />,
  );
  expect(screen.getByText('✓ Sinal pago')).toBeVisible();
  expect(screen.getByText('✓ Restante pago')).toBeVisible();
  expect(screen.queryByText(/Pendência financeira:/)).not.toBeInTheDocument();
  expect(screen.getByText(/Excedente de/)).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Sinal pago' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Restante pago' }),
  ).not.toBeInTheDocument();
});

it('registers a deposit once and requests reservation only after the receipt commits', async () => {
  const commands: string[] = [];
  const onReserve = vi.fn(async () => {
    expect(commands).toHaveLength(1);
    return 'Pagamento registrado, mas não há estoque. Não registre o sinal novamente.';
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') commands.push(String(init.body));
      return new Response(
        JSON.stringify(
          url.endsWith('/history')
            ? { items: [], total: 0, page: 1, page_size: 50 }
            : state,
        ),
      );
    }),
  );
  const user = userEvent.setup();
  render(
    <FinancialSection
      quotationId={state.quotation_id}
      compact
      onReserve={onReserve}
    />,
  );
  await user.click(await screen.findByRole('button', { name: 'Sinal pago' }));
  expect(screen.getByText(/nova conferência de estoque/)).toBeVisible();
  await user.click(
    screen.getByRole('button', { name: 'Registrar sinal e reservar' }),
  );
  await screen.findByText(/Pagamento registrado, mas não há estoque/);
  expect(onReserve).toHaveBeenCalledOnce();
  expect(commands).toHaveLength(1);
  expect(screen.queryByText(/Resultado desconhecido/)).not.toBeInTheDocument();
});

const pendingReceipt = (id = 'received', amount = '200.00') => ({
  id,
  revision: 1,
  amount,
  method: 'pix' as const,
  business_date: '2026-10-14',
  observation: null,
  actor_id: 'synthetic',
  session_id: 'synthetic',
  created_at: '2026-10-14T12:00:00Z',
  refunded: '0.00',
  net: amount,
  applied_deposit: '0.00',
  applied_balance: '0.00',
  pending: amount,
  proofs: [],
});

it('prepares exact reviewed allocation for deposit, full payment and excess without touching other receipts', () => {
  expect(newPaymentApplication(state, '200.00')).toEqual({
    deposit: '200.00',
    balance: '0.00',
    pending: '0.00',
  });
  expect(newPaymentApplication(state, '400.00')).toEqual({
    deposit: '200.00',
    balance: '200.00',
    pending: '0.00',
  });
  expect(newPaymentApplication(state, '450.00')).toEqual({
    deposit: '200.00',
    balance: '200.00',
    pending: '50.00',
  });
  const paid = {
    ...state,
    deposit_validated: true,
    receipts: [{ ...pendingReceipt(), applied_deposit: '200.00' }],
  };
  expect(newPaymentApplication(paid, '50.01')).toEqual({
    deposit: '0.00',
    balance: '50.01',
    pending: '0.00',
  });
  expect(paid.receipts[0].applied_deposit).toBe('200.00');
});

it('does not combine insufficient deposits or inherit changed commercial terms', () => {
  expect(newPaymentApplication(state, '100.00')).toEqual({
    deposit: '0.00',
    balance: '0.00',
    pending: '100.00',
  });
  expect(
    newPaymentApplication(
      { ...state, receipts: [pendingReceipt('earlier', '100.00')] },
      '100.00',
    ),
  ).toEqual({ deposit: '0.00', balance: '0.00', pending: '100.00' });
  expect(() =>
    newPaymentApplication(
      { ...state, commercial_version_pending: true },
      '200.00',
    ),
  ).toThrow('Confira o pagamento existente');
  for (const value of ['0.00', '-1.00', '1.001', 'abc'])
    expect(() => newPaymentApplication(state, value)).toThrow(
      'valor maior que zero',
    );
});

it('reviews a single old pending receipt without creating another or reallocating other money', () => {
  expect(
    existingPaymentApplication({
      ...state,
      pending: '250.00',
      receipts: [pendingReceipt('old', '250.00')],
    }),
  ).toEqual([{ receipt_id: 'old', deposit: '200.00', balance: '50.00' }]);
  expect(
    existingPaymentApplication({
      ...state,
      receipts: [
        pendingReceipt('one', '100.00'),
        pendingReceipt('two', '100.00'),
      ],
    }),
  ).toBeNull();
  expect(
    existingPaymentApplication({
      ...state,
      commercial_version_pending: true,
      receipts: [pendingReceipt()],
    }),
  ).toBeNull();
});

it('offers review instead of another receipt when the full amount was already received', async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.method).not.toBe('POST');
    return new Response(
      JSON.stringify(
        url.endsWith('/history')
          ? { items: [], total: 0, page: 1, page_size: 50 }
          : {
              ...state,
              received: '400.00',
              net_received: '400.00',
              pending: '400.00',
              receipts: [pendingReceipt('old-full', '400.00')],
            },
      ),
    );
  });
  vi.stubGlobal('fetch', fetcher);
  render(<FinancialSection quotationId={state.quotation_id} compact />);
  const review = await screen.findByRole('button', {
    name: 'Conferir pagamento existente',
  });
  expect(
    screen.queryByRole('button', { name: 'Sinal pago' }),
  ).not.toBeInTheDocument();
  await userEvent.click(review);
  expect(screen.getByText(/sem criar outro pagamento/)).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Confirmar conferência do pagamento' }),
  ).toBeVisible();
});

it('records and applies one reviewed payment, then opens reservation without another validation', async () => {
  const user = userEvent.setup();
  let current = state;
  const commands: { path: string; body: Record<string, unknown> }[] = [];
  const onNext = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        commands.push({ path: url, body: JSON.parse(String(init.body)) });
        current = {
          ...state,
          financial_version: 1,
          received: '200.00',
          net_received: '200.00',
          reconciled_quotation_version: 1,
          deposit_validated: true,
          applied_deposit: '200.00',
          deposit_remaining: '0.00',
          remaining: '200.00',
          receipts: [
            { ...pendingReceipt(), applied_deposit: '200.00', pending: '0.00' },
          ],
        };
      }
      return new Response(
        JSON.stringify(
          url.endsWith('/history')
            ? { items: [], total: 0, page: 1, page_size: 50 }
            : current,
        ),
      );
    }),
  );
  render(
    <FinancialSection
      quotationId={state.quotation_id}
      compact
      onNext={onNext}
    />,
  );
  await user.click(
    await screen.findByRole('button', {
      name: 'Sinal pago',
    }),
  );
  expect(screen.getByLabelText('Valor em reais')).toHaveValue('200.00');
  expect(screen.getByText(/Desse valor.*cobre o sinal/)).toBeVisible();
  expect(commands).toHaveLength(0);
  await user.click(
    screen.getByRole('button', { name: 'Confirmar pagamento recebido' }),
  );
  await user.click(
    await screen.findByRole('button', {
      name: 'Confirmar reserva',
    }),
  );
  expect(onNext).toHaveBeenCalledOnce();
  expect(commands).toHaveLength(1);
  expect(commands[0].path).toMatch(/\/received-payments$/);
  expect(commands[0].body).toMatchObject({
    expected_financial_version: 0,
    expected_quotation_version: 1,
    amount: '200.00',
    deposit: '200.00',
    balance: '0.00',
  });
  expect(
    screen.queryByRole('button', { name: 'Validar pagamento já recebido' }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Restante pago' }));
  expect(screen.getByLabelText('Valor em reais')).toHaveValue('200.00');
  expect(screen.getByText(/abate o restante/)).toBeVisible();
  expect(commands).toHaveLength(1);
});

it('keeps a lost unified payment frozen and replays exactly the same command', async () => {
  const user = userEvent.setup();
  const bodies: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        bodies.push(String(init.body));
        if (bodies.length === 1)
          throw new TypeError('Synthetic lost acknowledgement');
      }
      return new Response(
        JSON.stringify(
          url.endsWith('/history')
            ? { items: [], total: 0, page: 1, page_size: 50 }
            : state,
        ),
      );
    }),
  );
  render(<FinancialSection quotationId={state.quotation_id} compact />);
  await user.click(
    await screen.findByRole('button', {
      name: 'Sinal pago',
    }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Confirmar pagamento recebido' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Resultado desconhecido',
  );
  expect(screen.getByLabelText('Valor em reais')).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: 'Sinal pago' }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole('button', { name: 'Repetir a mesma operação' }),
  );
  await screen.findByText(/Pagamento registrado e conferido/);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
});

function setup(onPost: (body: string) => Promise<Response>, current = state) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const response = await onPost(String(init.body));
      if (response.ok) current = (await response.clone().json()) as Payments;
      return response;
    }
    return new Response(
      JSON.stringify(
        url.endsWith('/history')
          ? { items: [], total: 0, page: 1, page_size: 50 }
          : current,
      ),
      { status: 200 },
    );
  });
  vi.stubGlobal('fetch', fetcher);
  render(<FinancialSection quotationId={state.quotation_id} />);
  return fetcher;
}

it('renders complete incident agreement financial history without inventing receipts', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith('/history')
              ? {
                  items: [
                    {
                      id: 'synthetic-agreement',
                      operation: 'incident_agreement',
                      financial_version: 1,
                      quotation_version: 1,
                      actor_id: 'synthetic-actor',
                      session_id: 'synthetic-session',
                      reason: 'Acordo sintético explícito',
                      created_at: '2026-10-08T12:00:00Z',
                      before: state,
                      after: {
                        ...state,
                        financial_version: 1,
                        extra_agreed: '19.75',
                        operational_debt: '419.75',
                      },
                    },
                  ],
                  total: 1,
                  page: 1,
                  page_size: 50,
                }
              : state,
          ),
        ),
    ),
  );
  render(<FinancialSection quotationId={state.quotation_id} />);
  expect(
    await screen.findByText('Acordo financeiro de ocorrência'),
  ).toBeVisible();
  expect(screen.getByText('Motivo: Acordo sintético explícito')).toBeVisible();
  expect(
    screen.getByText('Nenhum recebimento registrado. Comprovante é opcional.'),
  ).toBeVisible();
});

it('requires preview and explicit confirmation, with server versions and exact money strings', async () => {
  const sent: string[] = [];
  setup(async (body) => {
    sent.push(body);
    return new Response(
      JSON.stringify({
        ...state,
        financial_version: 1,
        received: '250.00',
        pending: '250.00',
      }),
    );
  });
  const user = userEvent.setup();
  await screen.findByText(
    'Nenhum recebimento registrado. Comprovante é opcional.',
  );
  await user.type(screen.getByLabelText('Valor em reais'), '250,00');
  await user.click(
    screen.getByRole('button', { name: 'Revisar operação financeira' }),
  );
  expect(sent).toHaveLength(0);
  const confirm = screen.getByRole('button', {
    name: 'Confirmar registro financeiro',
  });
  expect(confirm).toHaveFocus();
  await user.click(confirm);
  await screen.findByText(/Registro financeiro salvo/);
  expect(JSON.parse(sent[0])).toMatchObject({
    amount: '250.00',
    expected_financial_version: 0,
    expected_quotation_version: 1,
    method: 'pix',
  });
  expect(screen.getByText(/Sinal não validado/)).toBeInTheDocument();
});

it.each(['connection', 'server'])(
  'preserves the exact request and prevents editing after unknown %s outcome',
  async (failure) => {
    const sent: string[] = [];
    setup(async (body) => {
      sent.push(body);
      if (sent.length === 1) {
        if (failure === 'connection')
          throw new TypeError('Synthetic lost response');
        return new Response(
          JSON.stringify({ detail: 'Synthetic unavailable' }),
          {
            status: 503,
          },
        );
      }
      return new Response(JSON.stringify({ ...state, financial_version: 1 }));
    });
    const user = userEvent.setup();
    await screen.findByLabelText('Valor em reais');
    await user.type(screen.getByLabelText('Valor em reais'), '200.00');
    await user.click(
      screen.getByRole('button', { name: 'Revisar operação financeira' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Confirmar registro financeiro' }),
    );
    await screen.findByText(/Resultado desconhecido/);
    expect(screen.getByLabelText('Valor em reais')).toBeDisabled();
    await user.click(
      screen.getByRole('button', { name: 'Repetir a mesma operação' }),
    );
    await screen.findByText(/Registro financeiro salvo/);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[0]);
  },
);

it('preserves form on version conflict and prepares a new explicit operation', async () => {
  let attempts = 0;
  const sent: string[] = [];
  const fetcher = setup(async (body) => {
    sent.push(body);
    attempts++;
    return attempts === 1
      ? new Response(
          JSON.stringify({
            detail: 'Os dados mudaram. Consulte a versão atual.',
          }),
          { status: 409 },
        )
      : new Response(JSON.stringify(state));
  });
  const user = userEvent.setup();
  await screen.findByLabelText('Valor em reais');
  await user.type(screen.getByLabelText('Valor em reais'), '200.00');
  await user.click(
    screen.getByRole('button', { name: 'Revisar operação financeira' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Confirmar registro financeiro' }),
  );
  await screen.findByText('Os dados mudaram. Consulte a versão atual.');
  expect(screen.getByLabelText('Valor em reais')).toHaveValue('200.00');
  await waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThan(3));
  await user.click(
    screen.getByRole('button', { name: 'Revisar operação financeira' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Confirmar registro financeiro' }),
  );
  await screen.findByText(/Registro financeiro salvo/);
  expect(JSON.parse(sent[0]).request_id).not.toBe(
    JSON.parse(sent[1]).request_id,
  );
});

it('reconciles refreshed summary and history together, hides stale facts on loading/error and retains the form', async () => {
  let reads = 0;
  let finish: (response: Response) => void = () => {};
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/history')) {
      if (++reads === 2)
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      return new Response(
        JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }),
      );
    }
    return new Response(
      JSON.stringify({
        ...state,
        financial_version: reads ? 2 : 0,
        received: '200.00',
      }),
    );
  });
  vi.stubGlobal('fetch', fetcher);
  const view = render(<FinancialSection quotationId={state.quotation_id} />);
  await screen.findByLabelText('Valor em reais');
  await userEvent.type(screen.getByLabelText('Valor em reais'), '75.00');
  view.rerender(
    <FinancialSection quotationId={state.quotation_id} refreshVersion={1} />,
  );
  expect(screen.getByText('Consultando financeiro…')).toBeVisible();
  expect(screen.queryByText('Sinal não validado')).not.toBeInTheDocument();
  await waitFor(() => expect(reads).toBe(2));
  await act(async () => finish(new Response('{}', { status: 503 })));
  expect(await screen.findByRole('alert')).toHaveTextContent('financeiro');
  expect(screen.queryByText('Sinal não validado')).not.toBeInTheDocument();
  expect(
    screen.queryByText('Nenhuma movimentação financeira no histórico.'),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: 'Reconsultar financeiro' }),
  );
  expect(await screen.findByLabelText('Valor em reais')).toHaveValue('75.00');
  expect(screen.getByText(/Versão comercial 1 · Financeiro 2/)).toBeVisible();
});

it('ignores an older external read completing after the fresh post-save snapshot', async () => {
  let reads = 0;
  let finishPost: (response: Response) => void = () => {};
  let finishStaleRead: (response: Response) => void = () => {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST')
        return new Promise<Response>((resolve) => {
          finishPost = resolve;
        });
      if (url.endsWith('/history'))
        return new Response(
          JSON.stringify({ items: [], total: 0, page: 1, page_size: 50 }),
        );
      if (++reads === 2)
        return new Promise<Response>((resolve) => {
          finishStaleRead = resolve;
        });
      return new Response(
        JSON.stringify({ ...state, financial_version: reads > 2 ? 2 : 0 }),
      );
    }),
  );
  const view = render(<FinancialSection quotationId={state.quotation_id} />);
  await userEvent.type(
    await screen.findByLabelText('Valor em reais'),
    '200.00',
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Revisar operação financeira' }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirmar registro financeiro' }),
  );
  view.rerender(
    <FinancialSection quotationId={state.quotation_id} refreshVersion={1} />,
  );
  await waitFor(() => expect(reads).toBe(2));
  await act(async () =>
    finishPost(
      new Response(JSON.stringify({ ...state, financial_version: 1 })),
    ),
  );
  await screen.findByText(/Versão comercial 1 · Financeiro 2 · Conferida/);
  await act(async () => finishStaleRead(new Response(JSON.stringify(state))));
  expect(
    screen.getByText(/Versão comercial 1 · Financeiro 2 · Conferida/),
  ).toBeVisible();
  expect(
    screen.queryByText(/Versão comercial 1 · Financeiro 0 · Conferida/),
  ).not.toBeInTheDocument();
});

it('preserves an unknown financial command and its original versions through external refresh', async () => {
  const payloads: string[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      payloads.push(String(init.body));
      if (payloads.length === 1)
        throw new TypeError('Synthetic lost acknowledgement');
      return new Response(JSON.stringify({ ...state, financial_version: 1 }));
    }
    return new Response(
      JSON.stringify(
        url.endsWith('/history')
          ? { items: [], total: 0, page: 1, page_size: 50 }
          : { ...state, financial_version: payloads.length ? 2 : 0 },
      ),
    );
  });
  vi.stubGlobal('fetch', fetcher);
  const view = render(<FinancialSection quotationId={state.quotation_id} />);
  await userEvent.type(
    await screen.findByLabelText('Valor em reais'),
    '200.00',
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Revisar operação financeira' }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirmar registro financeiro' }),
  );
  await screen.findByText(/Resultado desconhecido/);
  view.rerender(
    <FinancialSection quotationId={state.quotation_id} refreshVersion={1} />,
  );
  await screen.findByText(/Versão comercial 1 · Financeiro 2 · Conferida/);
  await userEvent.click(
    screen.getByRole('button', { name: 'Reconsultar financeiro' }),
  );
  expect(await screen.findByText(/Resultado desconhecido/)).toBeVisible();
  await screen.findByRole('button', { name: 'Repetir a mesma operação' });
  expect(
    screen.getByText(/Versão comercial 1 · Financeiro 0\. Não realiza/),
  ).toBeVisible();
  await userEvent.click(
    screen.getByRole('button', { name: 'Repetir a mesma operação' }),
  );
  await screen.findByText(/Registro financeiro salvo/);
  expect(payloads).toHaveLength(2);
  expect(payloads[0]).toBe(payloads[1]);
  expect(JSON.parse(payloads[1]).expected_financial_version).toBe(0);
  expect(
    await screen.findByText(/Versão comercial 1 · Financeiro 2 · Conferida/),
  ).toBeVisible();
});
