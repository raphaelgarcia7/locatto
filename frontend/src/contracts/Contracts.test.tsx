import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { ParametersPage } from './ParametersPage';
import { ContractsSection } from './ContractsSection';
import { ContractActions } from './ContractActions';
import { contractEventDate, emptyAddress } from './api';
import type { Contract } from './api';
import type { Quotation } from '../quotations/api';
import { AuthContext } from '../authContext';

const company = {
  version: 0,
  name: null,
  identification: null,
  contact: null,
  address: emptyAddress,
  logo: null,
  pending: ['name'],
};

it('shows automatic event dates in São Paulo and preserves declared business dates and UTC audit timestamps', () => {
  const event = {
    id: 'synthetic-event',
    kind: 'signature_upload',
    data: {},
    actor_id: 'synthetic-actor',
    created_at: '2026-10-11T00:30:00+00:00',
  } as Contract['events'][number];
  expect(contractEventDate(event)).toBe('2026-10-10');
  expect(
    contractEventDate({ ...event, created_at: '2026-10-11T03:00:00Z' }),
  ).toBe('2026-10-11');
  expect(
    contractEventDate({ ...event, data: { business_date: '2026-10-09' } }),
  ).toBe('2026-10-09');
  expect(
    contractEventDate({ ...event, data: { signed_date: '2026-10-08' } }),
  ).toBe('2026-10-08');
  expect(event.created_at).toBe('2026-10-11T00:30:00+00:00');
});
const reply = (data: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('preserves progressive parameters and replays the exact request after an unknown result', async () => {
  const user = userEvent.setup();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(reply(company))
    .mockRejectedValueOnce(new TypeError('lost response'))
    .mockResolvedValueOnce(
      reply({ ...company, version: 1, name: 'Locadora sintética' }),
    );
  vi.stubGlobal('fetch', fetch);
  render(<ParametersPage />);
  await screen.findByText('Nenhum parâmetro cadastrado. A logo é opcional.');
  await user.type(
    screen.getByLabelText('Nome da empresa'),
    'Locadora sintética',
  );
  await user.click(screen.getByRole('button', { name: 'Salvar parâmetros' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Resultado desconhecido',
  );
  expect(screen.getByLabelText('Nome da empresa')).toBeDisabled();
  await user.click(
    screen.getByRole('button', { name: 'Repetir mesma operação' }),
  );
  await screen.findByText(/Parâmetros salvos/);
  expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[2][1].body);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
    expected_version: 0,
    name: 'Locadora sintética',
    address: emptyAddress,
  });
});

it('shows read failure separately from an empty parameters record', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(reply({ detail: 'Unavailable' }, 503)),
  );
  render(<ParametersPage />);
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(
    screen.queryByText(/Nenhum parâmetro cadastrado/),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Tentar novamente' }),
  ).toBeVisible();
});

it('does not read private parameters before authentication completes', async () => {
  const fetch = vi.fn().mockResolvedValue(reply(company));
  vi.stubGlobal('fetch', fetch);
  const context = { logout: vi.fn(), busy: false, authenticated: false };
  const view = render(
    <AuthContext.Provider value={context}>
      <ParametersPage />
    </AuthContext.Provider>,
  );
  expect(fetch).not.toHaveBeenCalled();
  view.rerender(
    <AuthContext.Provider value={{ ...context, authenticated: true }}>
      <ParametersPage />
    </AuthContext.Provider>,
  );
  await screen.findByText('Nenhum parâmetro cadastrado. A logo é opcional.');
  expect(fetch).toHaveBeenCalledOnce();
});

const quotation = {
  id: 'quotation',
  customer_id: 'customer',
  current_version: 1,
  version: 1,
  lines: [
    {
      id: 'line',
      kind: 'kit',
      source_id: 'kit',
      quantity: 2,
      unit_price: '100.00',
      name: 'Kit sintético',
      source_version: 1,
      items: [
        {
          product_id: 'product',
          name: 'Produto sintético',
          quantity: 3,
          source_version: 1,
        },
      ],
    },
  ],
} as Quotation;

it('keeps final issuance disabled while preview has product/company pending fields', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/parameters')) return reply(company);
      if (url.endsWith('/payments')) return reply({ financial_version: 0 });
      if (url.endsWith('/current-signature-state'))
        return reply({
          rental_version: 0,
          contract: null,
          ready_for_pickup: false,
        });
      if (url.endsWith('/preview'))
        return reply({
          document: btoa('%PDF-'),
          number: 1,
          pending: [
            {
              field: 'items.product.photo',
              message: 'Foto do produto pendente no catálogo.',
            },
          ],
          differences: [],
        });
      return reply([]);
    }),
  );
  render(
    <MemoryRouter>
      <ContractsSection quotation={quotation} />
    </MemoryRouter>,
  );
  await screen.findByText(
    'Nenhum contrato emitido. Você pode preparar o documento antes do pagamento do sinal.',
  );
  expect(
    screen.getByLabelText('6 × Produto sintético — condição na saída'),
  ).toBeVisible();
  await userEvent.click(
    screen.getByRole('button', { name: 'Preparar prévia do contrato' }),
  );
  await screen.findByText('Foto do produto pendente no catálogo.');
  expect(
    screen.getByRole('button', { name: 'Emitir contrato final' }),
  ).toBeDisabled();
  expect(
    screen.getByRole('link', { name: 'Baixar prévia em rascunho' }),
  ).toHaveAttribute('download', 'rascunho-v1.pdf');
});

it('an attachment upload remains explicitly awaiting later manual review', async () => {
  const user = userEvent.setup();
  const onChanged = vi.fn().mockResolvedValue(undefined);
  const fetch = vi
    .fn()
    .mockResolvedValue(reply({ signature_state: 'awaiting_review' }));
  vi.stubGlobal('fetch', fetch);
  const record = {
    contract_id: 'contract',
    number: 1,
    events: [],
  } as unknown as Contract;
  render(
    <ContractActions
      record={record}
      currentVersion={2}
      onChanged={onChanged}
    />,
  );
  await user.click(
    screen.getByRole('button', { name: 'Anexar assinatura v1' }),
  );
  expect(screen.getByText(/Anexar não marca como assinado/)).toBeVisible();
  await user.upload(
    screen.getByLabelText('Arquivo assinado'),
    new File(['synthetic'], 'synthetic.png', { type: 'image/png' }),
  );
  await user.click(screen.getByRole('checkbox'));
  expect(
    screen.getByRole('button', { name: 'Confirmar registro' }),
  ).toBeEnabled();
  expect(
    (screen.getByLabelText('Arquivo assinado') as HTMLInputElement).files,
  ).toHaveLength(1);
  // JSDOM's required file validity does not observe user-event's FileList.
  // Submit the handler here; native file validation is checked in Chromium.
  fireEvent.submit(screen.getByLabelText('Arquivo assinado').closest('form')!);
  await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  const body = fetch.mock.calls[0][1].body as FormData;
  expect(body.get('expected_contract_version')).toBe('2');
  expect(body.get('reviewed')).toBe('false');
  expect(body.get('signed_date')).toBe('');
  expect(body.get('declaration')).toBe('');
});
