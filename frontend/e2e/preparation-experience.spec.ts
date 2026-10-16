import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { randomInt, randomUUID } from 'node:crypto';

test('deposit reserves once, then prepares free checklist extras on screen and PDF', async ({
  page,
}, info) => {
  const origin = 'http://127.0.0.1:4173';
  const setup = await page.request.post('http://127.0.0.1:8000/__test/setup');
  expect(setup.status()).toBe(200);
  const account = await setup.json();
  const setPassword = await page.request.post(
    'http://127.0.0.1:8000/auth/password/set',
    {
      headers: { Origin: origin },
      data: {
        token: account.token,
        password: 'synthetic preparation browser phrase',
      },
    },
  );
  expect(setPassword.status()).toBe(204);
  await page.goto('/locacoes');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page
    .getByLabel('Senha', { exact: true })
    .fill('synthetic preparation browser phrase');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Nova locação' }),
  ).toBeVisible();
  async function post(path: string, data: object, status = 200) {
    const result = await page.request.post(`/api/${path}`, {
      headers: { Origin: origin },
      data,
    });
    expect(result.status(), path).toBe(status);
    return result.json();
  }
  const customer = await post(
    'customers',
    {
      name: `Synthetic preparation ${randomUUID().slice(0, 8)}`,
      phone: `+55119${randomInt(10000000, 99999999)}`,
    },
    201,
  );
  const product = await post(
    'products',
    {
      name: 'Painel sintético de preparação',
      price: '400.00',
      initial_quantity: 2,
    },
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
  const preview = await post('quotations/preview', draft);
  const quote = await post(
    'quotations',
    {
      ...draft,
      catalog_versions: preview.catalog_versions,
      request_id: randomUUID(),
    },
    201,
  );
  let receipts = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().endsWith('/received-payments')
    )
      receipts++;
  });
  await page.goto(`/locacoes?orcamento=${quote.id}`);
  await page
    .locator('.catalog-panel-heading')
    .getByRole('button', { name: 'Registrar sinal e reservar' })
    .click();
  const payment = page.getByRole('region', { name: 'Pagamentos da locação' });
  await payment
    .getByRole('button', { name: 'Registrar sinal e reservar' })
    .click();
  await expect(payment.getByLabel('Valor em reais')).toHaveValue('200.00');
  await payment
    .getByRole('button', { name: 'Registrar sinal e reservar' })
    .click();
  await expect(page.locator('.quotation-state')).toHaveText(
    'Reserva confirmada',
  );
  expect(receipts).toBe(1);
  const checklist = page.getByRole('region', {
    name: 'Checklist de separação',
  });
  await expect(checklist).toBeVisible();
  await checklist
    .getByLabel('Adicionar acessório ou lembrete')
    .fill('10 pregadores e elásticos');
  await checklist
    .getByRole('button', { name: 'Adicionar extra', exact: true })
    .click();
  await checklist
    .getByRole('checkbox', { name: '10 pregadores e elásticos' })
    .check();
  await checklist
    .getByRole('checkbox', { name: '1 × Painel sintético de preparação' })
    .check();
  await checklist.getByRole('button', { name: 'Salvar checklist' }).click();
  await expect(
    checklist.getByText('Checklist salvo para a equipe.'),
  ).toBeVisible();
  const link = checklist.getByRole('link', {
    name: 'Imprimir / baixar checklist',
  });
  const pdf = await page.request.get((await link.getAttribute('href'))!);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await page.reload();
  await page
    .getByRole('button', { name: 'Preparar locação', exact: true })
    .click();
  await expect(
    checklist.getByRole('checkbox', { name: '10 pregadores e elásticos' }),
  ).toBeChecked();
  const checkboxBounds = await checklist
    .getByRole('checkbox', { name: '10 pregadores e elásticos' })
    .boundingBox();
  expect(checkboxBounds!.width).toBeLessThanOrEqual(24);
  expect(checkboxBounds!.height).toBeLessThanOrEqual(24);
  expect(
    await checklist
      .getByRole('checkbox', { name: '10 pregadores e elásticos' })
      .evaluate(
        (input) => getComputedStyle(input.parentElement!).flexDirection,
      ),
  ).toBe('row');
  await expect(
    checklist.getByRole('checkbox', {
      name: '1 × Painel sintético de preparação',
    }),
  ).toBeChecked();
  await expect(page.locator('.quotation-detail')).not.toContainText(
    /sessão [0-9a-f-]{36}|autor [0-9a-f-]{36}/i,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const access = await new AxeBuilder({ page }).analyze();
  expect(access.violations).toEqual([]);
  await checklist
    .getByRole('checkbox', { name: '10 pregadores e elásticos' })
    .focus();
  await page.keyboard.press('Space');
  await expect(
    checklist.getByRole('checkbox', { name: '10 pregadores e elásticos' }),
  ).not.toBeChecked();
  await checklist.screenshot({ path: info.outputPath('checklist-extras.png') });
  await page.screenshot({
    path: info.outputPath('rental-preparation.png'),
    fullPage: true,
  });
});
