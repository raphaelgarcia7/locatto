import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { CustodySection } from './CustodySection';
import type { Custody } from './CustodySection';
import type { Quotation } from '../quotations/api';
import type { Payments } from '../payments/api';

const quotation = { rental: { id: 'synthetic-rental' } } as Quotation;
function state(): Custody {
  return {
    rental_id: 'synthetic-rental',
    rental_version: 2,
    quotation_version: 1,
    financial_version: 2,
    state: 'out',
    contract: { version: 1, ready_for_pickup: false, signed: true },
    financial: {
      remaining: '200.00',
      extra_agreed: '0.00',
      operational_debt: '200.00',
    } as Payments,
    handover: {
      id: 'handover',
      reason: 'Conferência',
      actor_id: 'synthetic-actor',
      created_at: '2026-10-11T12:00:00Z',
    },
    lines: [
      {
        product_id: 'vase',
        name: 'Vaso sintético',
        quantity: 10,
        received: 8,
        outstanding: 2,
        lost: 0,
        condition: 'Bom estado',
      },
    ],
    incidents: [],
    returns: [],
    resolutions: [],
    agreements: [],
    forecasts: [],
    late: true,
    can_close: false,
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
});

it('preserves the exact return command on lost acknowledgement and waits for server success', async () => {
  const user = userEvent.setup();
  const onChanged = vi.fn();
  let calls = 0;
  const bodies: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options: RequestInit) => {
      if (options.method !== 'POST')
        return new Response(JSON.stringify(state()));
      bodies.push(String(options.body));
      calls++;
      if (calls === 1) throw new TypeError('synthetic lost acknowledgement');
      return new Response(JSON.stringify({ ...state(), rental_version: 3 }));
    }),
  );
  render(<CustodySection quotation={quotation} onChanged={onChanged} />);
  await screen.findByText(
    'Enviados 10 · recebidos 8 · perda formalizada 0 · faltantes 2',
  );
  const form = screen.getByRole('group', { name: 'Recebimento por produto' });
  await user.clear(within(form).getByLabelText('Aptos · Vaso sintético'));
  await user.type(within(form).getByLabelText('Aptos · Vaso sintético'), '2');
  await user.type(
    within(form).getByLabelText('Motivo / acordo documentado'),
    'Recebimento sintético conferido',
  );
  await user.click(
    within(form).getByRole('button', { name: 'Preparar recebimento' }),
  );
  await user.click(
    screen.getByLabelText('Conferi os dados e autorizo esta operação'),
  );
  await user.click(
    screen.getByRole('button', { name: 'Confirmar conferência' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Resultado desconhecido',
  );
  expect(onChanged).not.toHaveBeenCalled();
  expect(within(form).getByLabelText('Aptos · Vaso sintético')).toBeDisabled();
  await user.click(
    screen.getByRole('button', { name: 'Repetir mesma conferência' }),
  );
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
  expect(JSON.parse(bodies[0]).lines).toEqual([
    { product_id: 'vase', quantity: 2, condition: 'fit' },
  ]);
  expect(
    screen.getByText(/^Conferência registrada pelo servidor/),
  ).toBeVisible();
  expect(
    screen.getByText(/^Conferência registrada pelo servidor/).parentElement,
  ).toHaveFocus();
});

it('keeps all sent products and disables close while any item is unaccounted', async () => {
  const value = state();
  value.lines = Array.from({ length: 125 }, (_, i) => ({
    ...value.lines[0],
    product_id: `product-${i}`,
    name: `Produto completo ${i}`,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(value))),
  );
  render(<CustodySection quotation={quotation} onChanged={() => {}} />);
  await screen.findByText('Produto completo 124');
  expect(
    screen.getByRole('button', { name: 'Preparar encerramento' }),
  ).toBeDisabled();
  expect(screen.getAllByText(/Enviados 10 · recebidos 8/)).toHaveLength(125);
});

it('shows read failures without inventing an empty or successful operational state', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ detail: 'Unavailable' }), {
          status: 503,
        }),
    ),
  );
  render(<CustodySection quotation={quotation} onChanged={() => {}} />);
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(
    screen.queryByText('Nenhuma saída registrada.'),
  ).not.toBeInTheDocument();
});

it('reviews the exact third-party authorization and financial exception before integral handover', async () => {
  const user = userEvent.setup();
  const value = state();
  value.state = 'confirmed';
  value.handover = null;
  value.contract.ready_for_pickup = true;
  value.financial.deposit_validated = true;
  const commands: object[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit) => {
      if (options.method === 'POST' && !url.endsWith('handover-preview'))
        commands.push(JSON.parse(String(options.body)));
      return new Response(JSON.stringify(value));
    }),
  );
  render(<CustodySection quotation={quotation} onChanged={() => {}} />);
  const form = await screen.findByRole('group', {
    name: 'Checklist de saída integral',
  });
  await user.type(
    within(form).getByLabelText(/condição conferida/),
    'Condição sintética',
  );
  await user.click(
    within(form).getByLabelText('Retirada por terceiro autorizado'),
  );
  await user.type(
    within(form).getByLabelText('Nome de quem retira'),
    'Pessoa Sintética',
  );
  await user.type(
    within(form).getByLabelText('Autorização do cliente'),
    'Autorização sintética exata',
  );
  await user.click(
    within(form).getByLabelText('Autorizar exceção de saldo pendente'),
  );
  await user.type(
    within(form).getByLabelText('Justificativa da exceção financeira'),
    'Exceção sintética com dívida preservada',
  );
  await user.type(
    within(form).getByLabelText('Motivo / acordo documentado'),
    'Saída integral conferida',
  );
  await user.click(
    within(form).getByRole('button', { name: 'Preparar prévia da saída' }),
  );
  const review = await screen.findByRole('region', {
    name: 'Registrar saída integral',
  });
  expect(review).toHaveTextContent('Nome de quem retira: Pessoa Sintética');
  expect(review).toHaveTextContent(
    'Autorização do cliente: Autorização sintética exata',
  );
  expect(review).toHaveTextContent(
    'Justificativa da exceção financeira: Exceção sintética com dívida preservada',
  );
  expect(commands).toHaveLength(0);
  expect(within(form).getByLabelText('Nome de quem retira')).toBeDisabled();
  await user.click(
    within(review).getByLabelText('Conferi os dados e autorizo esta operação'),
  );
  await user.click(
    within(review).getByRole('button', { name: 'Confirmar conferência' }),
  );
  await waitFor(() => expect(commands).toHaveLength(1));
  expect(commands[0]).toMatchObject({
    third_party: {
      name: 'Pessoa Sintética',
      authorization: 'Autorização sintética exata',
    },
    balance_exception: 'Exceção sintética com dívida preservada',
  });
});

it.each([
  ['repair', 'Reparo comprovado'],
  ['replacement', 'Reposição acordada'],
  ['delay', 'Atraso acordado'],
])(
  'reviews exact %s agreement type and amount before creating an obligation',
  async (kind, label) => {
    const user = userEvent.setup();
    const value = state();
    value.incidents = [
      {
        id: 'incident',
        product_id: 'vase',
        kind: 'damaged',
        quantity: 2,
        remaining: 2,
        maintenance_decided: 0,
        reason: 'Conferência sintética',
        actor_id: 'synthetic-actor',
      },
    ];
    const commands: object[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, options: RequestInit) => {
        if (options.method === 'POST')
          commands.push(JSON.parse(String(options.body)));
        return new Response(JSON.stringify(value));
      }),
    );
    render(<CustodySection quotation={quotation} onChanged={() => {}} />);
    const form = await screen.findByRole('group', {
      name: 'Acordo financeiro explícito',
    });
    await user.selectOptions(
      within(form).getByRole('combobox', { name: 'Tipo do acordo' }),
      kind,
    );
    await user.type(within(form).getByLabelText('Quantidade do acordo'), '1');
    await user.type(
      within(form).getByLabelText('Valor extra acordado'),
      '19.75',
    );
    await user.type(
      within(form).getByLabelText('Motivo / acordo documentado'),
      'Acordo sintético documentado',
    );
    await user.click(
      within(form).getByRole('button', { name: 'Preparar acordo financeiro' }),
    );
    const review = await screen.findByRole('region', {
      name: 'Registrar obrigação financeira manual',
    });
    expect(review).toHaveTextContent(`Tipo do acordo: ${label}`);
    expect(review).toHaveTextContent(/Valor acordado: R\$\s*19,75/);
    expect(review).toHaveTextContent('Quantidade: 1');
    expect(commands).toHaveLength(0);
    await user.click(
      within(review).getByLabelText(
        'Conferi os dados e autorizo esta operação',
      ),
    );
    await user.click(
      within(review).getByRole('button', { name: 'Confirmar conferência' }),
    );
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({ kind, amount: '19.75', quantity: 1 });
  },
);

it('does not offer maintenance routing twice but keeps explicit release and repair available', async () => {
  const value = state();
  value.incidents = [
    {
      id: 'incident',
      product_id: 'vase',
      kind: 'damaged',
      quantity: 2,
      remaining: 2,
      maintenance_decided: 2,
      reason: 'Conferência sintética',
      actor_id: 'synthetic-actor',
    },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(value))),
  );
  render(<CustodySection quotation={quotation} onChanged={() => {}} />);
  const decision = await screen.findByRole('combobox', {
    name: 'Decisão',
  });
  expect(
    within(decision).queryByRole('option', { name: 'Encaminhar à manutenção' }),
  ).not.toBeInTheDocument();
  expect(
    within(decision).getByRole('option', { name: 'Liberar manutenção' }),
  ).toBeInTheDocument();
  expect(
    within(decision).getByRole('option', { name: 'Reparo concluído' }),
  ).toBeInTheDocument();
});

it('limits a partial maintenance routing to its remaining eligible quantity', async () => {
  const user = userEvent.setup();
  const value = state();
  value.incidents = [
    {
      id: 'incident',
      product_id: 'vase',
      kind: 'damaged',
      quantity: 2,
      remaining: 2,
      maintenance_decided: 1,
      reason: 'Conferência sintética',
      actor_id: 'synthetic-actor',
    },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(value))),
  );
  render(<CustodySection quotation={quotation} onChanged={() => {}} />);
  const decision = await screen.findByRole('combobox', { name: 'Decisão' });
  expect(decision).toHaveValue('maintenance');
  expect(screen.getByLabelText('Quantidade da decisão')).toHaveAttribute(
    'max',
    '1',
  );
  await user.selectOptions(decision, 'released');
  expect(screen.getByLabelText('Quantidade da decisão')).toHaveAttribute(
    'max',
    '2',
  );
});
