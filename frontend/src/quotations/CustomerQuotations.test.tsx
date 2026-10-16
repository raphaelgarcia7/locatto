import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { CustomerQuotations } from './CustomerQuotations';

afterEach(() => vi.unstubAllGlobals());
it('finds quotations inside the customer record without showing technical identifiers', async () => {
  const identifier = '11111111-1111-4111-8111-111111111111';
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              id: identifier,
              total: '200.00',
              event_date: '2026-10-20',
              version: 3,
              rental: {
                state: 'confirmed',
                version: 4,
                financial_pending: false,
                inventory_pending: false,
              },
            },
          ],
          total: 26,
          page: 1,
          page_size: 25,
        }),
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <MemoryRouter>
      <CustomerQuotations customerId="customer" />
    </MemoryRouter>,
  );
  const link = await screen.findByRole('link', {
    name: 'Orçamento · evento 20/10/2026',
  });
  expect(link).toHaveAttribute('href', `/locacoes?orcamento=${identifier}`);
  expect(document.body).not.toHaveTextContent(identifier.slice(0, 8));
  expect(document.body).not.toHaveTextContent(
    /revisão 3|locação v4|Validade vigente/,
  );
  expect(screen.getByText('Reserva confirmada')).toBeVisible();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Mais orçamentos' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
    customer_id: 'customer',
    page: 2,
  });
});
