import { openFinancialDetails, openRentalWorkflow } from './rental-workflow';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { randomInt, randomUUID } from 'node:crypto';

const origin = 'http://127.0.0.1:4173';
const evidence =
  process.env.LOCATTO_EVIDENCE_DIR ?? 'test-results/rop011-evidence';
async function post(page: Page, path: string, body: object, status = 200) {
  const response = await page.request.post(`/api/${path}`, {
    headers: { Origin: origin },
    data: body,
  });
  expect(response.status(), path).toBe(status);
  return await response.json();
}
async function setup(page: Page) {
  const result = await page.request.post('http://127.0.0.1:8000/__test/setup');
  expect(result.status()).toBe(200);
  const account = await result.json();
  expect(
    (
      await page.request.post('http://127.0.0.1:8000/auth/password/set', {
        headers: { Origin: origin },
        data: {
          token: account.token,
          password: 'synthetic reservation browser phrase',
        },
      })
    ).status(),
  ).toBe(204);
  await page.goto('/locacoes');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page
    .getByLabel('Senha', { exact: true })
    .fill('synthetic reservation browser phrase');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Nova locação', exact: true }),
  ).toBeVisible();
  const suffix = randomUUID().slice(0, 8);
  const customer = await post(
    page,
    'customers',
    {
      name: `Synthetic reservations ${suffix}`,
      phone: `+55119${randomInt(10000000, 99999999)}`,
    },
    201,
  );
  const product = await post(
    page,
    'products',
    { name: `Synthetic arch ${suffix}`, price: '400.00', initial_quantity: 1 },
    201,
  );
  const draft = {
    customer_id: customer.id,
    pickup_date: '2026-10-11',
    event_date: '2026-10-12',
    return_date: '2026-10-13',
    valid_until: '2026-10-10',
    lines: [{ kind: 'product', source_id: product.id, quantity: 1 }],
  };
  const preview = await post(page, 'quotations/preview', draft);
  const quote = await post(
    page,
    'quotations',
    {
      ...draft,
      request_id: randomUUID(),
      catalog_versions: preview.catalog_versions,
    },
    201,
  );
  await page.goto(`/locacoes?orcamento=${quote.id}`);
  await openRentalWorkflow(page);
  await expect(
    section(page).getByRole('button', {
      name: 'Conferir disponibilidade para reservar',
    }),
  ).toBeEnabled();
  return { quote, product, customer };
}
function section(page: Page) {
  return page.getByRole('region', { name: '2. Confirmar a reserva' });
}
async function financialPaid(page: Page, reserved = false) {
  await openFinancialDetails(page);
  const panel = page.getByRole('region', {
    name: 'Pagamentos da locação',
  });
  await expect(
    panel.getByText(
      reserved
        ? 'Sinal recebido. Registre o restante quando o cliente pagar.'
        : 'Sinal recebido. Confirme a reserva para garantir os itens.',
    ),
  ).toBeVisible();
  await expect(
    panel.getByText('Recebido registrado').locator('..'),
  ).toContainText('200,00');
  await expect(panel).toHaveAttribute('data-financial-version', '2');
  await expect(panel.getByText(/Recebimento registrado/)).toBeVisible();
  await expect(panel.getByText(/Conciliação substituída/)).toBeVisible();
  await expect(
    panel.getByText('Nenhuma movimentação financeira no histórico.'),
  ).toHaveCount(0);
}
async function paid(page: Page, id: string) {
  const body = {
    request_id: randomUUID(),
    expected_quotation_version: 1,
    expected_financial_version: 0,
    amount: '200.00',
    method: 'pix',
    business_date: '2026-10-08',
  };
  const received = await post(page, `quotations/${id}/payments/receipts`, body);
  await post(page, `quotations/${id}/payments/reconciliations`, {
    request_id: randomUUID(),
    expected_quotation_version: 1,
    expected_financial_version: 1,
    reason: 'Synthetic explicit reconciliation',
    applications: [
      {
        receipt_id: received.receipts[0].id,
        deposit: '200.00',
        balance: '0.00',
      },
    ],
  });
  return received.receipts[0].id as string;
}
async function visual(page: Page, info: TestInfo, name: string) {
  await section(page).scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: `${evidence}/${info.project.name}-${name}.png`,
    fullPage: true,
  });
  await page.screenshot({
    path: `${evidence}/${info.project.name}-${name}-viewport.png`,
  });
}

test('confirmation requires payment and explicit action; unknown result reuses the same key', async ({
  page,
}, info) => {
  const { quote } = await setup(page);
  let releaseLoading: () => void = () => {};
  const waitLoading = new Promise<void>((resolve) => {
    releaseLoading = resolve;
  });
  await page.route(`**/api/rentals/by-quotation/${quote.id}`, async (route) => {
    await waitLoading;
    await route.continue();
  });
  await page.reload();
  await openRentalWorkflow(page);
  await expect(section(page).getByText('Consultando locação…')).toBeVisible();
  await visual(page, info, 'loading');
  const finishedLoading = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/rentals/by-quotation/${quote.id}`) &&
      response.status() === 404,
  );
  releaseLoading();
  await finishedLoading;
  await page.unroute(`**/api/rentals/by-quotation/${quote.id}`);
  await expect(
    section(page).getByText('Nenhuma reserva confirmada para este orçamento.'),
  ).toBeVisible();
  await visual(page, info, 'empty');
  await page.route(`**/api/rentals/by-quotation/${quote.id}`, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Synthetic unavailable' }),
    });
  });
  await page.reload();
  await openRentalWorkflow(page);
  await expect(section(page).getByRole('alert')).toContainText(
    'Não foi possível consultar a locação',
  );
  await expect(
    section(page).getByText('Nenhuma reserva confirmada para este orçamento.'),
  ).toHaveCount(0);
  await visual(page, info, 'read-error');
  await page.unroute(`**/api/rentals/by-quotation/${quote.id}`);
  await section(page)
    .getByRole('button', { name: 'Conferir disponibilidade para reservar' })
    .click();
  await expect(section(page).getByRole('alert')).toHaveCount(0);
  await section(page)
    .getByRole('button', { name: 'Conferir disponibilidade para reservar' })
    .click();
  await expect(
    section(page).getByRole('button', {
      name: 'Confirmar reserva e reservar itens',
      exact: true,
    }),
  ).toBeDisabled();
  await visual(page, info, 'deposit-required');
  const finance = page.getByRole('region', {
    name: 'Pagamentos da locação',
  });
  await expect(finance.getByText(/Para reservar, o sinal é de/)).toBeVisible();
  await openFinancialDetails(page);
  await expect(
    finance.getByText('Nenhuma movimentação financeira no histórico.'),
  ).toBeVisible();
  await paid(page, quote.id);
  let finishFinance: () => void = () => {};
  const financeLoading = new Promise<void>((resolve) => {
    finishFinance = resolve;
  });
  await page.route(
    `**/api/quotations/${quote.id}/payments/history`,
    async (route) => {
      await financeLoading;
      await route.continue();
    },
  );
  await section(page)
    .getByRole('button', { name: 'Conferir disponibilidade para reservar' })
    .click();
  const confirm = section(page).getByRole('button', {
    name: 'Confirmar reserva e reservar itens',
    exact: true,
  });
  await expect(confirm).toBeFocused();
  await expect(finance.getByText('Consultando financeiro…')).toBeVisible();
  await expect(finance.getByText(/Para reservar, o sinal é de/)).toHaveCount(0);
  await visual(page, info, 'financial-loading');
  const financeLoaded = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/${quote.id}/payments/history`) &&
      response.status() === 200,
  );
  finishFinance();
  await financeLoaded;
  await page.unroute(`**/api/quotations/${quote.id}/payments/history`);
  await financialPaid(page);
  await visual(page, info, 'preview-focus');
  await page.route(
    `**/api/quotations/${quote.id}/payments/history`,
    async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: 'Synthetic financial history unavailable',
        }),
      });
    },
  );
  const payloads: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith(`/${quote.id}/confirm`))
      payloads.push(request.postData() ?? '');
  });
  await page.route(`**/api/quotations/${quote.id}/confirm`, async (route) => {
    const committed = await route.fetch();
    expect(committed.status()).toBe(201);
    await route.abort('failed');
  });
  await confirm.press('Enter');
  await expect(section(page).getByRole('alert')).toContainText(
    'Resultado desconhecido',
  );
  await expect(
    section(page).getByText('Reserva confirmada', { exact: true }),
  ).toHaveCount(0);
  await expect(
    section(page).getByText('Nenhuma reserva confirmada para este orçamento.'),
  ).toHaveCount(0);
  await expect(
    section(page).getByRole('button', {
      name: 'Conferir disponibilidade para reservar',
    }),
  ).toBeDisabled();
  await expect(finance.getByRole('alert')).toBeVisible();
  await expect(finance.getByText(/Para reservar, o sinal é de/)).toHaveCount(0);
  await expect(
    finance.getByText(
      'Sinal recebido. Confirme a reserva para garantir os itens.',
    ),
  ).toHaveCount(0);
  await visual(page, info, 'financial-read-error');
  await page.unroute(`**/api/quotations/${quote.id}/payments/history`);
  await finance.getByRole('button', { name: 'Reconsultar financeiro' }).click();
  await financialPaid(page);
  await visual(page, info, 'unknown');
  await financialPaid(page);
  await page.unroute(`**/api/quotations/${quote.id}/confirm`);
  await section(page)
    .getByRole('button', { name: 'Reconciliar a mesma confirmação' })
    .click();
  await expect(
    section(page).getByText('Reserva confirmada', { exact: true }),
  ).toBeVisible();
  expect(payloads).toHaveLength(2);
  expect(payloads[0]).toBe(payloads[1]);
  await expect(
    page.getByRole('button', { name: 'Editar proposta', exact: true }),
  ).toHaveCount(0);
  await financialPaid(page, true);
  await expect(page.getByText('Validade comercial vigente')).toHaveCount(0);
  await expect(
    page.getByText('Validade vigente · não é reserva confirmada'),
  ).toHaveCount(0);
  await visual(page, info, 'success');
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await visual(page, info, 'zoom');
  await page.evaluate(() => {
    document.documentElement.style.zoom = '';
  });
  expect(
    await page.evaluate(
      () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    ),
  ).toBe(true);
});

test('fresh capacity conflict, preserved money, inventory and financial issues and customer summary', async ({
  page,
}, info) => {
  const { quote, product, customer } = await setup(page);
  const receipt = await paid(page, quote.id);
  await section(page)
    .getByRole('button', { name: 'Conferir disponibilidade para reservar' })
    .click();
  await expect(
    section(page).getByRole('button', {
      name: 'Confirmar reserva e reservar itens',
      exact: true,
    }),
  ).toBeEnabled();
  const maintenance = await post(page, `products/${product.id}/maintenance`, {
    expected_version: 1,
    quantity: 1,
    reason: 'Synthetic sudden damage',
  });
  await section(page)
    .getByRole('button', {
      name: 'Confirmar reserva e reservar itens',
      exact: true,
    })
    .click();
  await expect(section(page).getByRole('alert')).toContainText(
    'Capacidade insuficiente',
  );
  await expect(
    section(page).getByText(/Conflito de 2026-10-11 a 2026-10-13/),
  ).toBeVisible();
  await visual(page, info, 'capacity-conflict');
  const money = await page.request.get(`/api/quotations/${quote.id}/payments`);
  expect((await money.json()).net_received).toBe('200.00');
  await post(
    page,
    `products/${product.id}/maintenance/${maintenance.maintenance[0].id}/release`,
    {
      expected_version: 2,
      quantity: 1,
      reason: 'Synthetic repaired before confirmation',
    },
  );
  await section(page)
    .getByRole('button', { name: 'Conferir disponibilidade para reservar' })
    .click();
  await section(page)
    .getByRole('button', {
      name: 'Confirmar reserva e reservar itens',
      exact: true,
    })
    .press('Enter');
  await expect(
    section(page).getByText('Reserva confirmada', { exact: true }),
  ).toBeVisible();
  const overlappingDraft = {
    customer_id: customer.id,
    pickup_date: '2026-10-13',
    event_date: '2026-10-13',
    return_date: '2026-10-13',
    valid_until: '2026-10-10',
    lines: [{ kind: 'product', source_id: product.id, quantity: 1 }],
  };
  const overlappingPreview = await post(
    page,
    'quotations/preview',
    overlappingDraft,
  );
  expect(overlappingPreview.capacity[0].committed).toBe(1);
  expect(overlappingPreview.capacity[0].available).toBe(0);
  const overlapping = await post(
    page,
    'quotations',
    {
      ...overlappingDraft,
      request_id: randomUUID(),
      catalog_versions: overlappingPreview.catalog_versions,
    },
    201,
  );
  await page.goto(`/locacoes?orcamento=${overlapping.id}`);
  await openRentalWorkflow(page);
  await expect(
    page.getByText('Disponível no período 0 · pico comprometido 1'),
  ).toBeVisible();
  await visual(page, info, 'allocation-aware-quotation');
  await page.goto(`/locacoes?orcamento=${quote.id}`);
  await openRentalWorkflow(page);
  await expect(
    section(page).getByText('Reserva confirmada', { exact: true }),
  ).toBeVisible();
  await post(page, `products/${product.id}/maintenance`, {
    expected_version: 3,
    quantity: 1,
    reason: 'Synthetic inventory incident',
  });
  await post(
    page,
    `quotations/${quote.id}/payments/receipts/${receipt}/corrections`,
    {
      request_id: randomUUID(),
      expected_quotation_version: 1,
      expected_financial_version: 2,
      amount: '100.00',
      method: 'pix',
      business_date: '2026-10-08',
      reason: 'Synthetic correction',
    },
  );
  await section(page)
    .getByRole('button', { name: 'Reconsultar locação' })
    .click();
  await expect(
    section(page).getByText(/Pendência de estoque: a equipe/),
  ).toBeVisible();
  await expect(
    section(page).getByText(/Pendência financeira após correção/),
  ).toBeVisible();
  await visual(page, info, 'separate-issues-history');
  await page.goto(`/clientes?cliente=${customer.id}`);
  await expect(
    page.getByText(/Nenhuma locação confirmada registrada/),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      /Reserva confirmada · locação v1 · pendência de estoque · pendência financeira/,
    ),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: `${evidence}/${info.project.name}-customer-summary.png`,
    fullPage: true,
  });
});
