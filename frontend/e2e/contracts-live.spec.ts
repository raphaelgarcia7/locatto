import { openRentalWorkflow } from './rental-workflow';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { createHash, randomInt, randomUUID } from 'node:crypto';

// Signed/customer document flows must not put identity/address payloads in traces.
test.use({ trace: 'off' });
const digest = (value: string | null) =>
  createHash('sha256')
    .update(value ?? '')
    .digest('hex');

const origin = 'http://127.0.0.1:4173';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
// Runtime-only synthetic identity/contact data, never a customer's fixture.
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
        (sum, value, index) => sum + value * (size + 1 - index),
        0,
      ) *
        10) %
        11) %
        10,
    );
  return digits.join('');
}
async function post(page: Page, path: string, body: object, status = 200) {
  const response = await page.request.post(`/api/${path}`, {
    headers: { Origin: origin },
    data: body,
  });
  expect(response.status(), path).toBe(status);
  return await response.json();
}
async function login(page: Page) {
  const response = await page.request.post(
    'http://127.0.0.1:8000/__test/setup?isolated=true',
  );
  expect(response.status()).toBe(200);
  const account = await response.json();
  expect(
    (
      await page.request.post('http://127.0.0.1:8000/auth/password/set', {
        headers: { Origin: origin },
        data: {
          token: account.token,
          password: 'synthetic contract browser phrase',
        },
      })
    ).status(),
  ).toBe(204);
  await page.goto('/parametros');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page
    .getByLabel('Senha', { exact: true })
    .fill('synthetic contract browser phrase');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Parâmetros do sistema' }),
  ).toBeVisible();
}
async function visual(page: Page, info: TestInfo, name: string) {
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
    page.locator('.customer-contact:visible'),
    page.locator('.catalog-attributes dd:visible'),
  ];
  await page.screenshot({
    path: `test-results/executor-rop015/evidence/${info.project.name}-${name}.png`,
    fullPage: true,
    mask,
    maskColor: '#dce5d7',
  });
  await page.screenshot({
    path: `test-results/executor-rop015/evidence/${info.project.name}-${name}-viewport.png`,
    mask,
    maskColor: '#dce5d7',
  });
}
async function fillAddress(page: Page, legend: string) {
  const group = page.getByRole('group', { name: legend, exact: true });
  const value = address();
  for (const [label, content] of Object.entries({
    Rua: value.street,
    Número: value.number,
    Bairro: value.neighborhood,
    Cidade: value.city,
    UF: value.state,
    CEP: value.postal_code,
  }))
    await group.getByLabel(label, { exact: true }).fill(content);
}
function section(page: Page) {
  return page.getByRole('region', { name: 'Contratos', exact: true });
}

test('progressive company parameters, optional logo and preserved fields after conflicts and unknown result', async ({
  page,
}, info) => {
  await login(page);
  await expect(
    page.getByText('Nenhum parâmetro cadastrado. A logo é opcional.'),
  ).toBeVisible();
  await visual(page, info, 'parameters-empty');
  await page.getByLabel('Nome da empresa').focus();
  await page.keyboard.type('Locadora Sintética');
  await page.keyboard.press('Tab');
  await expect(
    page.getByLabel('Identificação da locadora (CPF/CNPJ)'),
  ).toBeFocused();
  const focus = await page
    .getByLabel('Identificação da locadora (CPF/CNPJ)')
    .evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(focus).not.toBe('none');
  let body: string | null = null;
  let calls = 0;
  await page.route('**/api/parameters', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    calls++;
    if (calls === 1) {
      body = route.request().postData();
      await route.fetch();
      await route.abort('connectionfailed');
    } else {
      expect(digest(route.request().postData())).toBe(digest(body));
      await route.continue();
    }
  });
  await page.getByRole('button', { name: 'Salvar parâmetros' }).click();
  await expect(page.getByRole('alert')).toContainText('Resultado desconhecido');
  await expect(page.getByLabel('Nome da empresa')).toBeDisabled();
  await visual(page, info, 'parameters-unknown');
  await page.getByRole('button', { name: 'Repetir mesma operação' }).click();
  await expect(page.getByRole('status')).toContainText('Parâmetros salvos');
  await expect(page.getByRole('status')).toBeFocused();
  await page.unroute('**/api/parameters');
  const saved = await (await page.request.get('/api/parameters')).json();
  await post(page, 'parameters', {
    ...saved,
    logo: undefined,
    pending: undefined,
    version: undefined,
    request_id: randomUUID(),
    expected_version: saved.version,
    name: 'Locadora Sintética concorrente',
  });
  await page
    .getByLabel('Contato', { exact: true })
    .fill('Contato sintético preservado');
  await page.getByRole('button', { name: 'Salvar parâmetros' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Contato', { exact: true })).toHaveValue(
    'Contato sintético preservado',
  );
  await page
    .getByRole('button', { name: 'Reconsultar revisão sem apagar campos' })
    .click();
  await expect(page.getByRole('status')).toContainText(
    'Seus campos foram mantidos',
  );
  await expect(page.getByLabel('Contato', { exact: true })).toHaveValue(
    'Contato sintético preservado',
  );
  await page
    .getByLabel('Identificação da locadora (CPF/CNPJ)')
    .fill('IDENTIFICAÇÃO SINTÉTICA');
  await fillAddress(page, 'Endereço da locadora');
  await page.getByRole('button', { name: 'Salvar parâmetros' }).click();
  await expect(
    page.getByText('Sem logo. Isso não impede a emissão do contrato.'),
  ).toBeVisible();
  await expect(
    page.getByText('Dados da locadora completos', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('Selecionar logo').setInputFiles({
    name: 'synthetic-logo.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await page.getByRole('button', { name: 'Guardar logo' }).click();
  await expect(page.getByAltText('Logo atual da locadora')).toBeVisible();
  expect(
    await page
      .getByAltText('Logo atual da locadora')
      .evaluate((image) => (image as HTMLImageElement).naturalWidth),
  ).toBe(1);
  await visual(page, info, 'parameters-logo');
  await page
    .getByRole('button', { name: 'Remover logo dos próximos contratos' })
    .click();
  await expect(
    page.getByText('Sem logo. Isso não impede a emissão do contrato.'),
  ).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await visual(page, info, 'parameters-zoom200');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await page.route('**/api/parameters', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Synthetic read failure' }),
    }),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(
    page.getByText('Nenhum parâmetro cadastrado. A logo é opcional.'),
  ).toHaveCount(0);
  await visual(page, info, 'parameters-error');
  await page.unroute('**/api/parameters');
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/parameters', async (route) => {
    await gate;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByRole('status')).toContainText('Carregando parâmetros');
  await visual(page, info, 'parameters-loading');
  // The retry remains a read, with no business write or counter reset.
  release!();
  await expect(
    page.getByRole('button', { name: 'Salvar parâmetros' }),
  ).toBeVisible();
});

test('issued versions, missing photos, lost acknowledgement, delivery and manual signature review remain distinct', async ({
  page,
}, info) => {
  await login(page);
  const company = await (await page.request.get('/api/parameters')).json();
  await post(page, 'parameters', {
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
    {
      name: `Produto Sintético ${suffix}`,
      price: '400.00',
      initial_quantity: 5,
    },
    201,
  );
  const draft = {
    customer_id: customer.id,
    pickup_date: '2026-10-12',
    event_date: '2026-10-13',
    return_date: '2026-10-14',
    valid_until: '2026-10-11',
    lines: [{ kind: 'product', source_id: product.id, quantity: 1 }],
  };
  const preview = await post(page, 'quotations/preview', draft);
  const quote = await post(
    page,
    'quotations',
    {
      ...draft,
      catalog_versions: preview.catalog_versions,
      request_id: randomUUID(),
    },
    201,
  );
  let releaseContracts: (() => void) | undefined;
  const contractsGate = new Promise<void>((resolve) => {
    releaseContracts = resolve;
  });
  await page.route(`**/api/quotations/${quote.id}/contracts`, async (route) => {
    await contractsGate;
    await route.continue();
  });
  await page.goto(`/locacoes?orcamento=${quote.id}`);
  await openRentalWorkflow(page);
  await expect(section(page).getByRole('status')).toContainText(
    'Carregando contratos',
  );
  await visual(page, info, 'contracts-loading');
  releaseContracts!();
  await expect(
    section(page).getByText(
      'Nenhum contrato emitido. Você pode preparar o documento antes do pagamento do sinal.',
    ),
  ).toBeVisible();
  // Let the gated handler finish before removing it; unroute can otherwise
  // handle its in-flight request while route.continue is still pending.
  await page.unroute(`**/api/quotations/${quote.id}/contracts`);
  await fillAddress(page, 'Endereço do evento');
  await expect(
    section(page).getByRole('textbox', { name: /condição na saída/ }),
  ).toHaveCount(0);
  await section(page)
    .getByRole('button', { name: 'Visualizar contrato' })
    .click();
  await expect(
    section(page).getByText(/Foto do produto .* pendente/),
  ).toBeVisible();
  await expect(
    section(page).getByRole('button', { name: 'Emitir contrato final' }),
  ).toBeDisabled();
  await visual(page, info, 'contract-photo-pending');
  const upload = await page.request.post(`/api/products/${product.id}/photos`, {
    headers: { Origin: origin },
    multipart: {
      expected_version: '1',
      file: { name: 'synthetic.png', mimeType: 'image/png', buffer: png },
    },
  });
  expect(upload.status()).toBe(201);
  await section(page)
    .getByRole('button', { name: 'Atualizar dados do contrato' })
    .click();
  await section(page)
    .getByRole('button', { name: 'Visualizar contrato' })
    .click();
  await expect(
    section(page).getByText(
      'Dados completos para emissão final. Confira o PDF antes de confirmar.',
    ),
  ).toBeVisible();
  await section(page)
    .getByRole('checkbox', {
      name: 'Conferi esta prévia e confirmo a emissão final',
    })
    .check();
  let body: string | null = null;
  let calls = 0;
  await page.route(`**/api/quotations/${quote.id}/contracts`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    calls++;
    if (calls === 1) {
      body = route.request().postData();
      await route.fetch();
      await route.abort('connectionfailed');
    } else {
      expect(digest(route.request().postData())).toBe(digest(body));
      await route.continue();
    }
  });
  await section(page)
    .getByRole('button', { name: 'Emitir contrato final' })
    .click();
  await expect(section(page).getByRole('alert')).toContainText(
    'Resultado desconhecido',
  );
  await visual(page, info, 'contract-unknown');
  await section(page)
    .getByRole('button', { name: 'Repetir mesma emissão' })
    .click();
  await expect(
    section(page).getByRole('link', {
      name: 'Baixar PDF do contrato',
      exact: true,
    }),
  ).toBeVisible();
  await section(page)
    .getByText('Contratos emitidos e histórico', { exact: true })
    .click();
  await expect(
    section(page).getByRole('heading', {
      name: 'Contrato v1 · versão vigente',
    }),
  ).toBeVisible();
  await page.unroute(`**/api/quotations/${quote.id}/contracts`);
  const first = (
    await (
      await page.request.get(`/api/quotations/${quote.id}/contracts`)
    ).json()
  )[0];
  const pdfResponse = await page.request.get(
    `/api/contracts/${first.contract_id}/versions/1/download`,
  );
  expect(pdfResponse.status()).toBe(200);
  expect(pdfResponse.headers()['cache-control']).toBe('no-store');
  const originalPdf = await pdfResponse.body();
  await section(page)
    .getByRole('button', { name: 'Registrar entrega' })
    .click();
  await section(page)
    .getByLabel('Motivo / registro da entrega')
    .fill('Entrega sintética manual');
  await section(page)
    .getByRole('checkbox', { name: 'Confirmo os dados deste registro' })
    .check();
  await section(page)
    .getByRole('button', { name: 'Confirmar registro' })
    .click();
  await expect(
    section(page).getByText(/Entrega registrada · Assinatura pendente/),
  ).toBeVisible();
  await expect(
    section(page).getByText('Registro confirmado pelo servidor.'),
  ).toBeFocused();
  await section(page)
    .getByRole('button', { name: 'Anexar contrato assinado' })
    .click();
  await section(page).getByLabel('Arquivo assinado').setInputFiles({
    name: 'synthetic.png',
    mimeType: 'image/png',
    buffer: png,
  });
  expect(
    await section(page)
      .getByLabel('Arquivo assinado')
      .evaluate((element) => (element as HTMLInputElement).checkValidity()),
  ).toBe(true);
  await section(page)
    .getByRole('checkbox', { name: 'Confirmo os dados deste registro' })
    .check();
  await section(page)
    .getByRole('button', { name: 'Confirmar registro' })
    .click();
  await expect(
    section(page).getByText('Anexo recebido, aguardando conferência manual.'),
  ).toBeVisible();
  const uploads = (
    await (
      await page.request.get(`/api/quotations/${quote.id}/contracts`)
    ).json()
  )[0].events;
  const uploaded = uploads.find(
    (event: { kind: string }) => event.kind === 'signature_upload',
  );
  const uploadedDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(uploaded.created_at));
  const uploadItem = section(page)
    .getByRole('listitem')
    .filter({
      hasText: /^Anexo recebido ·/,
      has: page.getByRole('link', {
        name: 'Baixar anexo da versão 1',
        exact: true,
      }),
    });
  await expect(uploadItem).toBeVisible();
  const uploadSummary = await uploadItem.evaluate((item) => {
    let text = '';
    // The summary precedes details; the later attachment link has its own separator.
    for (const node of item.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) break;
      text += node.textContent;
    }
    return text.trim();
  });
  expect(uploadSummary).toBe(`Anexo recebido · ${uploadedDate}`);
  await visual(page, info, 'contract-awaiting-review');
  await section(page)
    .getByRole('button', { name: 'Conferir assinatura' })
    .click();
  await section(page)
    .getByLabel('Declaração de conferência')
    .fill('Conferência sintética manual da identidade, assinatura e versão');
  await section(page)
    .getByRole('checkbox', { name: 'Confirmo os dados deste registro' })
    .check();
  await section(page)
    .getByRole('button', { name: 'Confirmar registro' })
    .click();
  await expect(
    section(page).getByText('Assinatura vigente registrada pela equipe.'),
  ).toBeVisible();
  await expect(
    section(page).getByText(
      'Contrato emitido. Consulte abaixo a entrega e a assinatura desta versão.',
    ),
  ).toBeVisible();
  await expect(
    section(page).getByText(/a assinatura ainda precisam ser registradas/),
  ).toHaveCount(0);
  await visual(page, info, 'contract-signed');
  const currentCompany = await (
    await page.request.get('/api/parameters')
  ).json();
  await post(page, 'parameters', {
    request_id: randomUUID(),
    expected_version: currentCompany.version,
    name: 'Locadora Sintética atualizada',
    identification: 'IDENTIFICAÇÃO SINTÉTICA',
    contact: 'Contato sintético novo',
    address: address(),
  });
  await section(page)
    .getByRole('button', { name: 'Atualizar dados do contrato' })
    .click();
  await section(page)
    .getByText('Gerar nova versão do contrato', { exact: true })
    .click();
  await section(page)
    .getByRole('button', { name: 'Visualizar contrato' })
    .click();
  await expect(
    section(page).getByText('Mudanças em relação ao contrato anterior'),
  ).toBeVisible();
  await section(page)
    .getByRole('checkbox', {
      name: 'Conferi esta prévia e confirmo a emissão final',
    })
    .check();
  await section(page)
    .getByRole('button', { name: 'Emitir contrato final' })
    .click();
  await expect(
    section(page).getByRole('heading', {
      name: 'Contrato v2 · versão vigente',
    }),
  ).toBeVisible();
  await expect(
    section(page).getByRole('heading', {
      name: 'Contrato v1 · versão anterior',
    }),
  ).toBeVisible();
  await expect(
    section(page).getByText('Assinatura vigente pendente.'),
  ).toBeVisible();
  const historical = await page.request.get(
    `/api/contracts/${first.contract_id}/versions/1/download`,
  );
  expect(await historical.body()).toEqual(originalPdf);
  await visual(page, info, 'contract-history');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await visual(page, info, 'contract-zoom200');
});
