import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ChecklistSection, type Checklist } from './ChecklistSection';

const initial: Checklist = {
  version: 0,
  rental_version: 1,
  needs_recheck: false,
  updated_at: null,
  products: [
    { id: 'product', name: 'Painel romano', quantity: 2, checked: false },
  ],
  extras: [],
};
afterEach(() => vi.unstubAllGlobals());

it('adds free operational extras, checks products and persists for the team before printing', async () => {
  let current = structuredClone(initial);
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        bodies.push(body);
        current = {
          ...current,
          version: 1,
          products: current.products.map((row) => ({
            ...row,
            checked: body.checked_products.includes(row.id),
          })),
          extras: body.extras,
        };
      }
      return new Response(JSON.stringify(current));
    }),
  );
  const user = userEvent.setup();
  render(<ChecklistSection rentalId="rental" />);
  await screen.findByText('2 × Painel romano');
  await user.type(
    screen.getByLabelText('Adicionar acessório ou lembrete'),
    '10 pregadores',
  );
  await user.click(screen.getByRole('button', { name: 'Adicionar extra' }));
  await user.click(screen.getByRole('checkbox', { name: '10 pregadores' }));
  await user.click(screen.getByRole('checkbox', { name: '2 × Painel romano' }));
  expect(screen.getByText(/2 de 2 itens separados/)).toBeVisible();
  expect(
    screen.queryByRole('link', { name: 'Imprimir / baixar checklist' }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Salvar checklist' }));
  await screen.findByText('Checklist salvo para a equipe.');
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({
    expected_version: 0,
    expected_rental_version: 1,
    checked_products: ['product'],
    extras: [{ label: '10 pregadores', checked: true }],
  });
  expect(bodies[0]).not.toHaveProperty('price');
  expect(
    screen.getByRole('link', { name: 'Imprimir / baixar checklist' }),
  ).toHaveAttribute('href', '/api/rentals/rental/checklist/download');
});

it('recovers a lost acknowledgement with the same frozen command and blocks edits', async () => {
  const bodies: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init?: RequestInit) => {
      if (init?.method === 'POST') {
        bodies.push(String(init.body));
        if (bodies.length === 1) throw new TypeError('Lost ACK');
      }
      return new Response(JSON.stringify(initial));
    }),
  );
  const user = userEvent.setup();
  render(<ChecklistSection rentalId="rental" />);
  await user.click(
    await screen.findByRole('checkbox', { name: '2 × Painel romano' }),
  );
  await user.click(screen.getByRole('button', { name: 'Salvar checklist' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('checkbox')).toBeDisabled();
  await user.click(
    screen.getByRole('button', { name: 'Recuperar salvamento' }),
  );
  await screen.findByText('Checklist salvo para a equipe.');
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
});

it('shows stale-save conflicts without overwriting the other preparer and allows reloading', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response(
            JSON.stringify({
              detail: 'O checklist mudou. Recarregue antes de salvar.',
            }),
            { status: 409 },
          )
        : new Response(JSON.stringify({ ...initial, version: 2 })),
    ),
  );
  const user = userEvent.setup();
  render(<ChecklistSection rentalId="rental" />);
  await user.click(await screen.findByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Salvar checklist' }));
  await screen.findByRole('alert');
  await user.click(
    screen.getByRole('button', { name: 'Recarregar checklist' }),
  );
  await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked());
  expect(
    screen.getByRole('button', { name: 'Salvar checklist' }),
  ).toBeDisabled();
});
