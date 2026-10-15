import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RecordEditor } from './RecordEditor';
import type { Kind, ProductDetail } from './api';

const product: ProductDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Painel azul',
  price: '10.00',
  version: 1,
  is_active: true,
  created_by: 'synthetic',
  updated_by: 'synthetic',
  created_at: '2026-10-14T12:00:00Z',
  updated_at: '2026-10-14T12:00:00Z',
  total_quantity: 0,
  maintenance_quantity: 0,
  apt_quantity: 0,
  description: null,
  category: null,
  color: null,
  dimensions: null,
  replacement_value: null,
  observation: null,
  history: [],
  movements: [],
  maintenance: [],
  photos: [],
};
const response = (data: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
});
const fetcher = vi.fn();
beforeEach(() => {
  let next = 0;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => `blob:synthetic-${next++}`),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.removeAttribute('open');
    },
  });
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());

function editor(saved = vi.fn(), kind: Kind = 'products') {
  render(
    <MemoryRouter>
      <RecordEditor kind={kind} onSaved={saved} onCancel={() => {}} />
    </MemoryRouter>,
  );
  return saved;
}
async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Nome'), 'Painel azul');
  await user.type(screen.getByLabelText('Preço por locação (R$)'), '10,00');
}

it('selects registered categories in a modal and creates one without submitting the product', async () => {
  const category = { id: 'category', name: 'Painéis' };
  fetcher.mockImplementation(async (_path: string, options?: RequestInit) =>
    response(
      options?.method === 'POST'
        ? category
        : { items: [category], total: 1, page: 1, page_size: 25 },
      options?.method === 'POST' ? 201 : 200,
    ),
  );
  const saved = editor();
  const user = userEvent.setup();
  expect(screen.queryByText('CADASTRO PROGRESSIVO')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('textbox', { name: 'Categoria' }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole('button', { name: 'Selecionar categoria' }),
  );
  const dialog = screen.getByRole('dialog', { name: 'Categorias de produtos' });
  await user.click(
    await within(dialog).findByRole('button', {
      name: 'Usar categoria Painéis',
    }),
  );
  expect(
    screen.getByRole('button', { name: 'Selecionar categoria: Painéis' }),
  ).toHaveFocus();
  await user.click(
    screen.getByRole('button', { name: 'Selecionar categoria: Painéis' }),
  );
  await user.type(screen.getByLabelText('Nome da categoria'), 'Mesas');
  await user.click(
    screen.getByRole('button', { name: 'Cadastrar e selecionar' }),
  );
  expect(saved).not.toHaveBeenCalled();
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === 'POST'),
  ).toHaveLength(1);
  expect(
    fetcher.mock.calls.find(([, options]) => options?.method === 'POST')?.[0],
  ).toBe('/api/product-categories');
});

it('uploads initial photos in order using the returned product version', async () => {
  let uploaded = 0;
  fetcher.mockImplementation(async (path: string) => {
    if (path.endsWith('/photos')) {
      uploaded++;
      return response({
        ...product,
        version: 1 + uploaded,
        photos: Array.from({ length: uploaded }, (_, index) => ({
          id: `photo-${index}`,
          format: 'PNG',
          size: 10,
          sha256: 'synthetic',
          order: index,
          is_principal: index === 0,
        })),
      });
    }
    return response(product, 201);
  });
  const saved = editor();
  const user = userEvent.setup();
  await fillRequired(user);
  await user.upload(screen.getByLabelText('Adicionar fotos'), [
    new File(['one'], 'one.png', { type: 'image/png' }),
    new File(['two'], 'two.png', { type: 'image/png' }),
  ]);
  expect(screen.getByAltText('Prévia da foto 1')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
  await waitFor(() =>
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 3,
        photos: expect.arrayContaining([
          expect.objectContaining({ is_principal: true }),
        ]),
      }),
    ),
  );
  const calls = fetcher.mock.calls.filter(([path]) => path.endsWith('/photos'));
  expect(
    calls.map(([, options]) =>
      (options.body as FormData).get('expected_version'),
    ),
  ).toEqual(['1', '2']);
  expect(
    fetcher.mock.calls.filter(([path]) => path === '/api/products'),
  ).toHaveLength(1);
});

it('preserves a created product after photo failure and opens it without creating a duplicate', async () => {
  fetcher.mockImplementation(async (path: string) =>
    path.endsWith('/photos')
      ? response({ detail: 'Foto inválida.' }, 422)
      : response(product),
  );
  const saved = editor();
  const user = userEvent.setup();
  await fillRequired(user);
  await user.upload(
    screen.getByLabelText('Adicionar fotos'),
    new File(['bad'], 'photo.png', { type: 'image/png' }),
  );
  await user.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'O produto foi cadastrado, mas o envio das fotos não terminou',
  );
  expect(saved).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: 'Produto cadastrado' }),
  ).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Abrir produto salvo' }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith(product));
  expect(
    fetcher.mock.calls.filter(
      ([path, options]) =>
        path === '/api/products' && options?.method === 'POST',
    ),
  ).toHaveLength(1);
});

it('removes a selected photo and releases its preview before saving', async () => {
  const saved = editor();
  fetcher.mockResolvedValue(response(product));
  const user = userEvent.setup();
  await fillRequired(user);
  await user.upload(
    screen.getByLabelText('Adicionar fotos'),
    new File(['one'], 'one.png', { type: 'image/png' }),
  );
  await user.click(screen.getByRole('button', { name: 'Remover foto 1' }));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-0');
  await user.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith(product));
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('creates a kit with its composition and uploads the selected photo to its own gallery', async () => {
  const kit = {
    ...product,
    name: 'Kit azul',
    items: [
      {
        product_id: product.id,
        name: product.name,
        quantity: 1,
        is_active: true,
      },
    ],
    needs_review: false,
  };
  fetcher.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path.startsWith('/api/products?'))
      return response({ items: [product], total: 1, page: 1, page_size: 25 });
    if (path.endsWith('/photos'))
      return response({
        ...kit,
        version: 2,
        photos: [{ id: 'kit-photo', is_principal: true }],
      });
    expect(path).toBe('/api/kits');
    expect(JSON.parse(String(options?.body)).items).toEqual([
      { product_id: product.id, quantity: 1 },
    ]);
    return response(kit, 201);
  });
  const saved = editor(vi.fn(), 'kits');
  const user = userEvent.setup();
  await fillRequired(user);
  expect(screen.getByText('CADASTRO', { exact: true })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Fotos do kit' })).toBeVisible();
  await user.click(
    await screen.findByRole('button', { name: 'Adicionar Painel azul' }),
  );
  await user.upload(
    screen.getByLabelText('Adicionar fotos'),
    new File(['kit'], 'kit.png', { type: 'image/png' }),
  );
  await user.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
  await waitFor(() =>
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 2,
        photos: [{ id: 'kit-photo', is_principal: true }],
      }),
    ),
  );
  expect(
    fetcher.mock.calls.some(
      ([path, options]) =>
        path === `/api/kits/${kit.id}/photos` &&
        (options.body as FormData).get('expected_version') === '1',
    ),
  ).toBe(true);
});
