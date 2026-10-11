import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { createHash, randomInt, randomUUID } from 'node:crypto';

test.use({ trace: 'off' });
const origin = 'http://127.0.0.1:4173';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const hash = (body: string | null) =>
  createHash('sha256')
    .update(body ?? '')
    .digest('hex');
function address() {
  const marker = randomUUID().slice(0, 8);
  return {
    street: `Via Sintética ${marker}`,
    number: 'TESTE',
    neighborhood: `Setor ${marker}`,
    city: `Cidade Sintética ${marker}`,
    state: 'SP',
    postal_code: '00000000',
  };
}
function cpf() {
  const digits = Array.from({ length: 9 }, () => randomInt(0, 10));
  for (const size of [9, 10])
    digits.push(
      ((digits.reduce(
        (sum, digit, index) => sum + digit * (size + 1 - index),
        0,
      ) *
        10) %
        11) %
        10,
    );
  return digits.join('');
}
async function post(page: Page, path: string, data: object, status = 200) {
  const response = await page.request.post(`/api/${path}`, {
    headers: { Origin: origin },
    data,
  });
  expect(response.status(), path).toBe(status);
  return response.json();
}
async function seed(page: Page) {
  const setup = await page.request.post('http://127.0.0.1:8000/__test/setup');
  expect(setup.status()).toBe(200);
  const account = await setup.json();
  const access = await page.request.post(
    'http://127.0.0.1:8000/auth/password/set',
    {
      headers: { Origin: origin },
      data: {
        token: account.token,
        password: 'synthetic custody browser phrase',
      },
    },
  );
  expect(access.status()).toBe(204);
  await page.goto('/locacoes');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page
    .getByLabel('Senha', { exact: true })
    .fill('synthetic custody browser phrase');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Novo orçamento' }),
  ).toBeVisible();
  const company = await (await page.request.get('/api/parameters')).json();
  const parameters = await post(page, 'parameters', {
    request_id: randomUUID(),
    expected_version: company.version,
    name: 'Locadora Sintética',
    identification: 'IDENTIFICAÇÃO SINTÉTICA',
    contact: 'Contato sintético',
    address: address(),
  });
  const suffix = randomUUID().slice(0, 8);
  const customer = await post(
    page,
    'customers',
    {
      name: `Cliente Sintético ${suffix}`,
      phone: `+55119${randomInt(10000000, 99999999)}`,
      cpf: cpf(),
      address: address(),
    },
    201,
  );
  const product = await post(
    page,
    'products',
    { name: `Vaso Sintético ${suffix}`, price: '40.00', initial_quantity: 10 },
    201,
  );
  const photo = await page.request.post(`/api/products/${product.id}/photos`, {
    headers: { Origin: origin },
    multipart: {
      expected_version: '1',
      file: { name: 'synthetic.png', mimeType: 'image/png', buffer: png },
    },
  });
  expect(photo.status()).toBe(201);
  const draft = {
    customer_id: customer.id,
    pickup_date: '2026-10-12',
    event_date: '2026-10-13',
    return_date: '2026-10-14',
    valid_until: '2026-10-11',
    lines: [{ kind: 'product', source_id: product.id, quantity: 10 }],
  };
  const preview = await post(page, 'quotations/preview', draft);
  const quotation = await post(
    page,
    'quotations',
    {
      ...draft,
      catalog_versions: preview.catalog_versions,
      request_id: randomUUID(),
    },
    201,
  );
  const receipt = await post(
    page,
    `quotations/${quotation.id}/payments/receipts`,
    {
      request_id: randomUUID(),
      expected_quotation_version: 1,
      expected_financial_version: 0,
      amount: '200.00',
      method: 'pix',
      business_date: '2026-10-08',
    },
  );
  await post(page, `quotations/${quotation.id}/payments/reconciliations`, {
    request_id: randomUUID(),
    expected_quotation_version: 1,
    expected_financial_version: 1,
    reason: 'Conferência sintética explícita',
    applications: [
      {
        receipt_id: receipt.receipts[0].id,
        deposit: '200.00',
        balance: '0.00',
      },
    ],
  });
  const rental = await post(
    page,
    `quotations/${quotation.id}/confirm`,
    {
      request_id: randomUUID(),
      expected_quotation_version: 1,
      expected_financial_version: 2,
    },
    201,
  );
  const contract = await post(page, `quotations/${quotation.id}/contracts`, {
    request_id: randomUUID(),
    expected_quotation_version: 1,
    expected_financial_version: 2,
    expected_rental_version: rental.version,
    expected_contract_version: 0,
    expected_company_version: parameters.version,
    event_address: address(),
    items: [
      { product_id: product.id, condition: 'Conferência sintética na emissão' },
    ],
  });
  return { quotation, rental, product, customer, contract };
}
function section(page: Page) {
  return page.getByRole('region', {
    name: 'Retirada, devolução e ocorrências',
    exact: true,
  });
}
async function visual(page: Page, info: TestInfo, name: string) {
  const region = section(page);
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
  expect(
    await page.evaluate(
      () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    ),
  ).toBe(true);
  const mask = [
    page.locator('input:not([type="checkbox"]):visible'),
    page.locator('textarea:visible'),
    page.locator('.customer-contact:visible'),
  ];
  const directory =
    process.env.RENTALOPS_EVIDENCE_DIR ??
    'test-results/executor-rop014/evidence';
  await region.screenshot({
    path: `${directory}/${info.project.name}-${name}.png`,
    mask,
  });
}
async function approve(page: Page) {
  const region = section(page);
  await expect(
    region.getByRole('button', { name: 'Confirmar conferência', exact: true }),
  ).toBeDisabled();
  await region
    .getByRole('checkbox', {
      name: 'Conferi os dados e autorizo esta operação',
    })
    .check();
  await region
    .getByRole('button', { name: 'Confirmar conferência', exact: true })
    .click();
  await expect(
    region.getByText(
      'Conferência registrada pelo servidor. Estoque e dívida atualizados conforme a decisão.',
    ),
  ).toBeVisible();
}

test('RET01–07 real custody, partial return replay, maintenance close with debt and later explicit release', async ({
  page,
}, info) => {
  const fixture = await seed(page);
  const { rental, quotation, product, contract, customer } = fixture;
  await page.goto(`/locacoes?orcamento=${quotation.id}`);
  const region = section(page);
  await expect(region.getByText(/Assinatura vigente pendente/)).toBeVisible();
  await expect(
    region.getByRole('button', { name: 'Preparar prévia da saída' }),
  ).toBeDisabled();
  await visual(page, info, 'unsigned-empty');
  const signed = await page.request.post(
    `/api/contracts/${contract.contract_id}/versions/1/signatures`,
    {
      headers: { Origin: origin },
      multipart: {
        request_id: randomUUID(),
        expected_contract_version: '1',
        reviewed: 'true',
        signed_date: new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Sao_Paulo',
        }).format(new Date()),
        declaration: 'Conferência sintética explícita',
        file: { name: 'synthetic.png', mimeType: 'image/png', buffer: png },
      },
    },
  );
  expect(signed.status()).toBe(200);
  await region
    .getByRole('button', { name: 'Reconsultar conferência sem apagar campos' })
    .click();
  await expect(
    region.getByText('Contrato vigente assinado e conferido.'),
  ).toBeVisible();
  await region.getByLabel(/condição conferida/).focus();
  await page.keyboard.type('Bom estado conferido');
  await page.keyboard.press('Tab');
  await expect(
    region.getByRole('checkbox', { name: 'Retirada por terceiro autorizado' }),
  ).toBeFocused();
  expect(
    await region
      .getByRole('checkbox', { name: 'Retirada por terceiro autorizado' })
      .evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe('none');
  await region
    .getByRole('checkbox', { name: 'Retirada por terceiro autorizado' })
    .check();
  await region.getByLabel('Nome de quem retira').fill('Pessoa Sintética');
  await region
    .getByLabel('Autorização do cliente')
    .fill('Autorização sintética documentada');
  await region
    .getByRole('checkbox', { name: 'Autorizar exceção de saldo pendente' })
    .check();
  await region
    .getByLabel('Justificativa da exceção financeira')
    .fill('Equipe autoriza saldo preservado');
  await region
    .getByLabel('Motivo / acordo documentado', { exact: true })
    .fill('Saída sintética integral');
  await region
    .getByRole('button', { name: 'Preparar prévia da saída' })
    .click();
  await expect(
    region.getByRole('heading', { name: 'Registrar saída integral' }),
  ).toBeFocused();
  await approve(page);
  await expect(
    region.getByText(/Materiais em uso · conferência/),
  ).toBeVisible();
  await visual(page, info, 'handover-success');
  const received = region.getByRole('group', {
    name: 'Recebimento por produto',
    exact: true,
  });
  await received
    .getByLabel(`Aptos · ${product.name}`, { exact: true })
    .fill('8');
  await received
    .getByLabel('Motivo / acordo documentado', { exact: true })
    .fill('Recebimento sintético parcial de oito aptos');
  await received.getByRole('button', { name: 'Preparar recebimento' }).click();
  let first: string | null = null;
  let attempts = 0;
  await page.route(`**/api/rentals/${rental.id}/returns`, async (route) => {
    attempts++;
    if (attempts === 1) {
      first = route.request().postData();
      await route.fetch();
      await route.abort('connectionfailed');
    } else {
      expect(hash(route.request().postData())).toBe(hash(first));
      await route.continue();
    }
  });
  await region
    .getByRole('checkbox', {
      name: 'Conferi os dados e autorizo esta operação',
    })
    .check();
  await region
    .getByRole('button', { name: 'Confirmar conferência', exact: true })
    .click();
  await expect(region.getByRole('alert')).toContainText(
    'Resultado desconhecido',
  );
  await expect(
    received.getByLabel(`Aptos · ${product.name}`, { exact: true }),
  ).toBeDisabled();
  await expect(
    region.getByRole('button', {
      name: 'Reconsultar conferência sem apagar campos',
    }),
  ).toBeDisabled();
  await visual(page, info, 'return-unknown');
  await region
    .getByRole('button', { name: 'Repetir mesma conferência' })
    .click();
  await expect(
    region.getByText(
      /Enviados 10 · recebidos 8 · perda formalizada 0 · faltantes 2/,
    ),
  ).toBeVisible();
  await page.unroute(`**/api/rentals/${rental.id}/returns`);
  await expect(
    region.getByRole('button', { name: 'Preparar encerramento' }),
  ).toBeDisabled();
  const current = await (
    await page.request.get(`/api/rentals/${rental.id}/operations`)
  ).json();
  expect(current.returns).toHaveLength(1);
  expect(current.financial.extra_agreed).toBe('0.00');
  await received
    .getByLabel(`Higienização · ${product.name}`, { exact: true })
    .fill('2');
  await received
    .getByLabel('Motivo / acordo documentado', { exact: true })
    .fill('Duas unidades recebidas para higienização');
  await received.getByRole('button', { name: 'Preparar recebimento' }).click();
  await approve(page);
  await expect(
    region.getByRole('button', { name: 'Preparar encerramento' }),
  ).toBeDisabled();
  const incident = region.locator('.custody-incident').filter({
    has: page.getByRole('heading', {
      name: `${product.name} · Higienização`,
      exact: true,
    }),
  });
  const decision = incident.getByRole('group', {
    name: 'Decidir ocorrência',
    exact: true,
  });
  await decision
    .getByRole('combobox', { name: 'Decisão', exact: true })
    .selectOption('maintenance');
  await decision.getByLabel('Quantidade da decisão', { exact: true }).fill('2');
  await decision
    .getByLabel('Motivo / acordo documentado', { exact: true })
    .fill('Encaminhamento explícito à manutenção');
  await decision
    .getByRole('button', { name: 'Preparar decisão da ocorrência' })
    .click();
  await approve(page);
  const closing = region.getByRole('group', {
    name: 'Encerramento operacional',
    exact: true,
  });
  await closing
    .getByLabel('Motivo / acordo documentado', { exact: true })
    .fill('Tudo conferido, manutenção encaminhada e dívida preservada');
  await closing.getByRole('button', { name: 'Preparar encerramento' }).click();
  await approve(page);
  await expect(
    region.getByText(/Locação concluída · conferência/),
  ).toBeVisible();
  await expect(region.getByText(/dívida total R\$\s*200,00/)).toBeVisible();
  await visual(page, info, 'completed-maintenance-debt');
  let state = await (
    await page.request.get(`/api/rentals/${rental.id}/operations`)
  ).json();
  expect(state.financial.received).toBe('200.00');
  expect(state.financial.refunded).toBe('0.00');
  expect(state.financial.fully_paid).toBe(false);
  const stock = await (
    await page.request.get(`/api/products/${product.id}`)
  ).json();
  expect(stock.maintenance_quantity).toBe(2);
  await decision
    .getByRole('combobox', { name: 'Decisão', exact: true })
    .selectOption('released');
  await decision.getByLabel('Quantidade da decisão', { exact: true }).fill('2');
  await decision
    .getByLabel('Motivo / acordo documentado', { exact: true })
    .fill('Liberação humana após higienização');
  await decision
    .getByRole('button', { name: 'Preparar decisão da ocorrência' })
    .click();
  await approve(page);
  state = await (
    await page.request.get(`/api/rentals/${rental.id}/operations`)
  ).json();
  expect(state.state).toBe('completed');
  expect(state.resolutions).toHaveLength(2);
  expect(
    state.resolutions.map((row: { disposition: string }) => row.disposition),
  ).toEqual(['maintenance', 'released']);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await visual(page, info, 'zoom200-release');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  const customerHistory = await post(page, 'quotations/search', {
    customer_id: customer.id,
  });
  expect(customerHistory.items[0].rental.operational_debt).toBe('200.00');
  await page.goto(`/clientes?cliente=${customer.id}`);
  await expect(page.getByText(/Dívida preservada: R\$\s*200,00/)).toBeVisible();
  await page.route(`**/api/rentals/${rental.id}/operations`, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Synthetic dependency unavailable' }),
    }),
  );
  await page.goto(`/locacoes?orcamento=${quotation.id}`);
  await expect(section(page).getByRole('alert')).toBeVisible();
  await visual(page, info, 'read-error');
  await page.unroute(`**/api/rentals/${rental.id}/operations`);
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/rentals/${rental.id}/operations`, async (route) => {
    await gate;
    await route.continue();
  });
  await section(page)
    .getByRole('button', { name: 'Reconsultar conferência sem apagar campos' })
    .click();
  await expect(
    section(page).getByText('Carregando conferência…'),
  ).toBeVisible();
  await visual(page, info, 'loading');
  release!();
  await expect(
    section(page).getByText(/Locação concluída · conferência/),
  ).toBeVisible();
});
