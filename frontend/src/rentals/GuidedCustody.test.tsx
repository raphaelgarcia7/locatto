import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { Quotation } from '../quotations/api';
import type { Payments } from '../payments/api';
import type { Custody } from './CustodySection';
import type { Checklist } from './ChecklistSection';
import { GuidedCustody } from './GuidedCustody';

const quotation = { rental: { id: 'rental', version: 1 } } as Quotation;
function operations(state: Custody['state'] = 'confirmed'): Custody {
  return {
    rental_id: 'rental',
    rental_version: 1,
    quotation_version: 1,
    financial_version: 2,
    state,
    contract: { version: 1, ready_for_pickup: true, signed: true },
    financial: { remaining: '0.00', deposit_validated: true } as Payments,
    lines: [
      {
        product_id: 'product',
        name: 'Painel',
        quantity: 2,
        received: 0,
        outstanding: 2,
        lost: 0,
        condition: 'Conferido',
      },
    ],
    handover: null,
    returns: [],
    incidents: [],
    resolutions: [],
    agreements: [],
    forecasts: [],
    late: false,
    can_close: false,
  };
}
const checklist: Checklist = {
  version: 1,
  rental_version: 1,
  needs_recheck: false,
  updated_at: '2026-10-16T12:00:00Z',
  products: [{ id: 'product', name: 'Painel', quantity: 2, checked: true }],
  extras: [{ id: 'extra', label: 'Pregadores', checked: true }],
};
afterEach(() => vi.unstubAllGlobals());
function setup(
  current = operations(),
  handler?: (path: string, body: object) => Custody | Promise<Custody>,
  items = checklist,
) {
  const commands: { path: string; body: Record<string, unknown> }[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      commands.push({ path: url, body });
      return Response.json(handler ? await handler(url, body) : current);
    }
    return Response.json(url.endsWith('/checklist') ? items : current);
  });
  vi.stubGlobal('fetch', fetcher);
  return { commands, fetcher };
}
const props = () => ({
  quotation,
  prepared: true,
  onChanged: vi.fn(),
  onContract: vi.fn(),
});

it('confirms pickup with a name and fresh server checks in one explicit action', async () => {
  const user = userEvent.setup();
  const { commands } = setup(operations(), (url) =>
    operations(url.endsWith('/handover') ? 'out' : 'confirmed'),
  );
  const handlers = props();
  render(<GuidedCustody {...handlers} />);
  await user.type(
    await screen.findByLabelText('Nome de quem retira'),
    'Cliente sintético',
  );
  await user.click(screen.getByRole('button', { name: 'Confirmar retirada' }));
  await screen.findByText(/Retirada confirmada. Próximo passo/);
  expect(commands.map((command) => command.path)).toEqual([
    '/api/rentals/rental/handover-preview',
    '/api/rentals/rental/handover',
  ]);
  expect(commands[1].body).toMatchObject({
    reason: 'Retirada confirmada por: Cliente sintético',
    expected_rental_version: 1,
    third_party: null,
    balance_exception: null,
    lines: [{ product_id: 'product', quantity: 2 }],
  });
  expect(handlers.onChanged).toHaveBeenCalledOnce();
});

it.each(['preparation', 'deposit', 'balance'])(
  'blocks pickup when %s is pending',
  async (missing) => {
    const state = operations();
    if (missing === 'deposit') state.financial.deposit_validated = false;
    if (missing === 'balance') state.financial.remaining = '100.00';
    const { commands } = setup(state);
    render(<GuidedCustody {...props()} prepared={missing !== 'preparation'} />);
    await screen.findByLabelText('Nome de quem retira');
    expect(
      screen.getByRole('button', { name: 'Confirmar retirada' }),
    ).toBeDisabled();
    expect(commands).toEqual([]);
  },
);

it('allows an ordinary pickup without a contract or signature', async () => {
  const user = userEvent.setup();
  const state = operations();
  state.contract = { version: 0, ready_for_pickup: false, signed: false };
  const { commands } = setup(state, (url) =>
    operations(url.endsWith('/handover') ? 'out' : 'confirmed'),
  );
  render(<GuidedCustody {...props()} />);
  await user.type(
    await screen.findByLabelText('Nome de quem retira'),
    'Cliente sintético',
  );
  expect(screen.getByText(/Contrato opcional/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Confirmar retirada' }));
  await screen.findByText(/Retirada confirmada/);
  expect(commands[1].body.expected_contract_version).toBe(0);
});

it('requires every returned product and accessory, then closes only after server authorization', async () => {
  const user = userEvent.setup();
  const { commands } = setup(operations('out'), (url) => ({
    ...operations(url.endsWith('/close') ? 'completed' : 'out'),
    rental_version: 2,
    can_close: true,
  }));
  render(<GuidedCustody {...props()} />);
  await user.click(await screen.findByRole('checkbox', { name: '2 × Painel' }));
  const submit = screen.getByRole('button', {
    name: 'Confirmar devolução e concluir',
  });
  expect(submit).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: 'Pregadores' }));
  await user.click(submit);
  await screen.findByText(
    'Devolução concluída. Todos os itens foram conferidos.',
  );
  expect(commands.map((command) => command.path)).toEqual([
    '/api/rentals/rental/returns',
    '/api/rentals/rental/close',
  ]);
  expect(commands[0].body).toMatchObject({
    lines: [{ product_id: 'product', quantity: 2, condition: 'fit' }],
    observation: 'Acessórios conferidos (1): Pregadores',
  });
  expect(commands[1].body.expected_rental_version).toBe(2);
});

it('does not close when the server reports unresolved incidents', async () => {
  const user = userEvent.setup();
  const { commands } = setup(operations('out'));
  render(<GuidedCustody {...props()} />);
  await user.click(await screen.findByRole('checkbox', { name: '2 × Painel' }));
  await user.click(screen.getByRole('checkbox', { name: 'Pregadores' }));
  await user.click(
    screen.getByRole('button', { name: 'Confirmar devolução e concluir' }),
  );
  await screen.findByText(/Confira as ocorrências antes de concluir/);
  expect(commands).toHaveLength(1);
});

it('recovers a lost close acknowledgement without registering returned items twice', async () => {
  const user = userEvent.setup();
  let closeCalls = 0;
  const { commands } = setup(operations('out'), async (url) => {
    if (url.endsWith('/close') && ++closeCalls === 1)
      throw new TypeError('Lost close acknowledgement');
    return {
      ...operations(url.endsWith('/close') ? 'completed' : 'out'),
      can_close: true,
      rental_version: 2,
    };
  });
  render(<GuidedCustody {...props()} />);
  await user.click(await screen.findByRole('checkbox', { name: '2 × Painel' }));
  await user.click(screen.getByRole('checkbox', { name: 'Pregadores' }));
  await user.click(
    screen.getByRole('button', { name: 'Confirmar devolução e concluir' }),
  );
  await screen.findByText(
    /Os itens foram recebidos. Falta confirmar o encerramento/,
  );
  await user.click(
    screen.getByRole('button', { name: 'Recuperar confirmação' }),
  );
  await screen.findByText(
    'Devolução concluída. Todos os itens foram conferidos.',
  );
  expect(commands).toHaveLength(3);
  expect(commands[1]).toEqual(commands[2]);
  expect(
    commands.filter((command) => command.path.endsWith('/returns')),
  ).toHaveLength(1);
});

it('does not mark an unsaved or outdated preparation as ready on pickup', async () => {
  const user = userEvent.setup();
  const { commands } = setup(operations(), undefined, {
    ...checklist,
    needs_recheck: true,
  });
  render(<GuidedCustody {...props()} />);
  await user.type(
    await screen.findByLabelText('Nome de quem retira'),
    'Cliente sintético',
  );
  await user.click(screen.getByRole('button', { name: 'Confirmar retirada' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Conclua e salve a preparação',
    ),
  );
  expect(commands).toEqual([]);
});

it('preserves return checkboxes when a background read returns the same rental revision', async () => {
  const user = userEvent.setup();
  const { fetcher } = setup(operations('out'));
  const handlers = props();
  const view = render(<GuidedCustody {...handlers} />);
  await user.click(await screen.findByRole('checkbox', { name: '2 × Painel' }));
  view.rerender(<GuidedCustody {...handlers} active={false} />);
  view.rerender(<GuidedCustody {...handlers} active />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
  expect(screen.getByRole('checkbox', { name: '2 × Painel' })).toBeChecked();
  expect(
    screen.getByRole('checkbox', { name: 'Pregadores' }),
  ).not.toBeChecked();
});
