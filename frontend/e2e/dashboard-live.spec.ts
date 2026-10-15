import { openRentalWorkflow } from './rental-workflow';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

test.use({ trace: 'off' });
const origin = 'http://127.0.0.1:4173';

async function selectCalendarDay(page: Page, date: string) {
  const [year, month, day] = date.split('-');
  const firstDay = page.locator('.operations-days button').first();
  await expect(firstDay).toBeVisible();
  const label = await firstDay.getAttribute('aria-label');
  const current = label?.match(/^\d{2}\/(\d{2})\/(\d{4}):/);
  if (!current) throw new Error('Calendar month is unavailable');
  const offset =
    (Number(year) - Number(current[2])) * 12 +
    Number(month) -
    Number(current[1]);
  for (let index = 0; index < Math.abs(offset); index += 1) {
    await page
      .getByRole('button', {
        name: offset > 0 ? 'Próximo mês' : 'Mês anterior',
      })
      .click();
  }
  await page
    .getByRole('button', { name: new RegExp(`^${day}/${month}/${year}:`) })
    .click();
}

test.afterEach(async ({ page }) => {
  const response = await page.request.post(
    'http://127.0.0.1:8000/__test/release-fixture',
    { headers: { Origin: origin } },
  );
  expect(response.status()).toBe(204);
});

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
          password: 'synthetic dashboard browser phrase',
        },
      })
    ).status(),
  ).toBe(204);
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page
    .getByLabel('Senha', { exact: true })
    .fill('synthetic dashboard browser phrase');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Visão geral' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Atualizar painel' }),
  ).toBeEnabled();
}
async function seed(page: Page, scenario: string) {
  const response = await page.request.post(
    `http://127.0.0.1:8000/__test/dashboard/${scenario}`,
    { headers: { Origin: origin } },
  );
  expect(response.status()).toBe(200);
  return response.json() as Promise<{
    rental_id: string;
    quotation_id: string;
    customer_id: string;
  }>;
}
async function visual(
  page: Page,
  info: TestInfo,
  name: string,
  selector?: string,
) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(result.violations).toEqual([]);
  expect(
    await page.locator('.operations-queues button').evaluateAll((buttons) =>
      buttons.every((button) => {
        const label = button.querySelector('span')!.getBoundingClientRect();
        const count = button.querySelector('strong')!.getBoundingClientRect();
        return (
          button.scrollWidth <= button.clientWidth &&
          (label.right <= count.left || label.bottom <= count.top)
        );
      }),
    ),
  ).toBe(true);
  if (
    !(await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ))
  ) {
    await info.attach('overflow-layout.json', {
      contentType: 'application/json',
      body: JSON.stringify(
        await page.evaluate(() => {
          const width = document.documentElement.clientWidth;
          return [...document.querySelectorAll('body *')]
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                tag: element.tagName,
                class: element.className,
                width: rect.width,
                right: rect.right,
                left: rect.left,
                scrollWidth: element.scrollWidth,
                clientWidth: element.clientWidth,
                parentClass: element.parentElement?.className,
              };
            })
            .filter(
              (rect) =>
                rect.right > width || rect.scrollWidth > rect.clientWidth + 1,
            )
            .slice(0, 30);
        }),
      ),
    });
  }
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator('.operations-days button')
      .evaluateAll((buttons) =>
        buttons.every((button) => button.scrollWidth <= button.clientWidth),
      ),
  ).toBe(true);
  const path = `test-results/evidence/${info.project.name}-dashboard-${name}.png`;
  if (selector) await page.locator(selector).first().screenshot({ path });
  else await page.screenshot({ path, fullPage: false });
}

test('dashboard queue labels and three digit counts stay inside cards at normal and 200 percent text', async ({
  page,
}, info) => {
  await login(page);
  await seed(page, 'calendar');
  await selectCalendarDay(page, '2026-10-10');
  await expect(
    page.getByRole('button', { name: 'Retiradas do dia 125', exact: true }),
  ).toBeVisible();
  await visual(page, info, 'queue-containment-normal', '.operations-queues');
  await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
  await visual(
    page,
    info,
    'queue-containment-text-200-percent',
    '.operations-queues',
  );
});

test('dashboard real 125-rental day, stable pagination, private filters and direct links', async ({
  page,
}, info) => {
  await login(page);
  const ids = await seed(page, 'calendar');
  await selectCalendarDay(page, '2026-10-10');
  await expect(
    page.getByRole('button', { name: 'Retiradas do dia 125', exact: true }),
  ).toBeVisible();
  const list = page.getByRole('region', {
    name: 'Retiradas do dia',
    exact: true,
  });
  await expect(list.locator('li')).toHaveCount(50);
  await visual(page, info, 'day-counts', '.operations-queues');
  await visual(page, info, 'day-row', '.operations-rows > li');
  const links = () =>
    list
      .getByRole('link', { name: 'Abrir locação' })
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')));
  const seen = [...(await links())];
  await list.getByRole('button', { name: 'Próxima página' }).click();
  await expect(list.getByText('125 registro(s) · Página 2 de 3')).toBeVisible();
  await expect(list.getByRole('heading', { level: 2 })).toBeFocused();
  seen.push(...(await links()));
  await list.getByRole('button', { name: 'Próxima página' }).click();
  await expect(list.locator('li')).toHaveCount(25);
  seen.push(...(await links()));
  expect(seen.length).toBe(125);
  expect(new Set(seen).size).toBe(125);
  await expect(
    list.getByRole('button', { name: 'Próxima página' }),
  ).toBeDisabled();
  await list.getByRole('button', { name: 'Página anterior' }).click();
  await expect(list.locator('li')).toHaveCount(50);
  await page.getByText('Filtrar operação', { exact: true }).click();
  await page.getByLabel('Nome do cliente').fill('Synthetic quotation');
  const search = page.waitForRequest((request) =>
    request.url().endsWith('/api/customers/search'),
  );
  await page.getByRole('button', { name: 'Pesquisar cliente' }).click();
  const searched = await search;
  expect(searched.method()).toBe('POST');
  expect(searched.url()).not.toContain('Synthetic');
  await page.getByLabel('Nome do cliente').focus();
  await page
    .locator(`[role=option][data-record-id="${ids.customer_id}"]`)
    .click();
  await page.getByLabel('Situação financeira').selectOption('true');
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await expect(
    page.getByRole('button', { name: 'Retiradas do dia 125' }),
  ).toBeVisible();
  // The actual predecessor-created rental provides the same direct link as a row.
  await page.goto(`/locacoes?orcamento=${ids.quotation_id}`);
  await openRentalWorkflow(page);
  await expect(
    page.getByText('Reserva confirmada', { exact: true }).first(),
  ).toBeVisible();
});

test('dashboard month and week share all 125 records with keyboard navigation', async ({
  page,
}, info) => {
  await login(page);
  await seed(page, 'calendar');
  await selectCalendarDay(page, '2026-10-10');
  const calendar = page.getByRole('region', {
    name: 'Calendário · outubro de 2026',
  });
  const tenth = calendar.getByRole('button', {
    name: '10/10/2026: 125 retirada(s), 0 devolução(ões)',
  });
  await expect(tenth).toBeVisible();
  await calendar.getByRole('button', { name: 'Próximo mês' }).click();
  await expect(
    page.getByRole('heading', { name: 'Calendário · novembro de 2026' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Mês anterior' }).click();
  await expect(calendar.getByRole('heading', { level: 2 })).toBeVisible();
  await visual(page, info, 'calendar', '.operations-calendar');
  await tenth.focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    calendar.getByRole('button', {
      name: '11/10/2026: 0 retirada(s), 0 devolução(ões)',
    }),
  ).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { level: 2, name: 'Retiradas do dia' }),
  ).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Retiradas do dia 125' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Semana', exact: true }).click();
  await expect(page.locator('.operations-days button')).toHaveCount(7);
  await expect(
    page.getByRole('button', {
      name: '10/10/2026: 125 retirada(s), 0 devolução(ões)',
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Retiradas do dia', exact: true })
      .getByText('125 registro(s) · Página 1 de 3'),
  ).toBeVisible();
  await visual(page, info, 'weekly-selected-day', '.operations-rows > li');
});

test('dashboard monthly calendar remains usable with 200 percent text', async ({
  page,
}, info) => {
  await login(page);
  await seed(page, 'calendar');
  await selectCalendarDay(page, '2026-10-10');
  await expect(
    page.getByRole('button', {
      name: '10/10/2026: 125 retirada(s), 0 devolução(ões)',
    }),
  ).toBeVisible();
  await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
  const tenth = page.getByRole('button', {
    name: '10/10/2026: 125 retirada(s), 0 devolução(ões)',
  });
  await tenth.focus();
  await page.keyboard.press('End');
  await expect(
    page.getByRole('button', {
      name: '31/10/2026: 0 retirada(s), 0 devolução(ões)',
    }),
  ).toBeFocused();
  await visual(page, info, 'calendar-text-200-percent', '.operations-calendar');
});

// Keep the original combined user journey within the unchanged 30s limit.
// Full-page axe checks for every visual state remain in the focused tests above;
// they are not removed, sampled, scoped to a smaller DOM or given more time.
test('dashboard complete day to agenda journey preserves pagination, filters and direct navigation', async ({
  page,
}) => {
  await login(page);
  const ids = await seed(page, 'calendar');
  await selectCalendarDay(page, '2026-10-10');
  await expect(
    page.getByRole('button', { name: 'Retiradas do dia 125' }),
  ).toBeVisible();
  const list = page.getByRole('region', {
    name: 'Retiradas do dia',
    exact: true,
  });
  const seen: (string | null)[] = [];
  for (let number = 1; number <= 3; number++) {
    await expect(list.locator('li')).toHaveCount(number === 3 ? 25 : 50);
    seen.push(
      ...(await list
        .getByRole('link', { name: 'Abrir locação' })
        .evaluateAll((links) =>
          links.map((link) => link.getAttribute('href')),
        )),
    );
    if (number < 3)
      await list.getByRole('button', { name: 'Próxima página' }).click();
  }
  expect(seen.length).toBe(125);
  expect(new Set(seen).size).toBe(125);
  await expect(
    list.getByRole('button', { name: 'Próxima página' }),
  ).toBeDisabled();
  await list.getByRole('button', { name: 'Página anterior' }).click();
  await expect(list.locator('li')).toHaveCount(50);
  const calendar = page.getByRole('region', {
    name: 'Calendário · outubro de 2026',
  });
  const tenth = calendar.getByRole('button', {
    name: '10/10/2026: 125 retirada(s), 0 devolução(ões)',
  });
  await tenth.focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    calendar.getByRole('button', {
      name: '11/10/2026: 0 retirada(s), 0 devolução(ões)',
    }),
  ).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { level: 2, name: 'Retiradas do dia' }),
  ).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Retiradas do dia 125' }),
  ).toBeVisible();
  await page.getByText('Filtrar operação', { exact: true }).click();
  await page.getByLabel('Nome do cliente').fill('Synthetic quotation');
  const searched = page.waitForRequest((request) =>
    request.url().endsWith('/api/customers/search'),
  );
  await page.getByRole('button', { name: 'Pesquisar cliente' }).click();
  const request = await searched;
  expect(request.method()).toBe('POST');
  expect(request.url()).not.toContain('Synthetic');
  await page.getByLabel('Nome do cliente').focus();
  await page
    .locator(`[role=option][data-record-id="${ids.customer_id}"]`)
    .click();
  await page.getByLabel('Situação financeira').selectOption('true');
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await expect(
    page.getByRole('button', { name: 'Retiradas do dia 125' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Semana', exact: true }).click();
  await expect(page.locator('.operations-days button')).toHaveCount(7);
  await expect(
    page
      .getByRole('region', { name: 'Retiradas do dia', exact: true })
      .getByText('125 registro(s) · Página 1 de 3'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Mês', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retiradas do dia 125' }),
  ).toBeVisible();
  await page.goto(`/locacoes?orcamento=${ids.quotation_id}`);
  await openRentalWorkflow(page);
  await expect(
    page.getByText('Reserva confirmada', { exact: true }).first(),
  ).toBeVisible();
});

test('dashboard completed debt stays distinct and private rental/customer links work', async ({
  page,
}, info) => {
  await login(page);
  const ids = await seed(page, 'completed');
  await page.getByRole('button', { name: 'Atualizar painel' }).click();
  await expect(
    page.getByRole('button', { name: 'Pendências financeiras 1' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Pendências financeiras 1' }).click();
  const list = page.getByRole('region', {
    name: 'Pendências financeiras',
    exact: true,
  });
  await expect(
    list.getByText('Locação concluída', { exact: true }),
  ).toBeVisible();
  await expect(list.getByText('R$ 220,00 · Pendente')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Ocorrências abertas 0' }),
  ).toBeVisible();
  await expect(list.getByText('Retirada real')).toBeVisible();
  await visual(page, info, 'completed-debt', '.operations-rows > li');
  await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
  await visual(page, info, 'text-200-percent', '.operations-rows > li');
  await page.evaluate(() => (document.documentElement.style.fontSize = ''));
  await list.getByRole('link', { name: 'Histórico do cliente' }).click();
  await expect(page).toHaveURL(`/clientes?cliente=${ids.customer_id}`);
  await expect(
    page.getByText(
      'Dívida preservada: R$ 220,00. Encerramento operacional não significa quitação.',
      { exact: true },
    ),
  ).toBeVisible();
});

test('dashboard late outstanding remains visible after a new forecast with actual receipt labelled', async ({
  page,
}, info) => {
  await login(page);
  // Settle an empty snapshot on the fixture date before seeding, so selecting
  // that same day below exercises the regression regardless of today's date.
  await selectCalendarDay(page, '2026-10-14');
  const emptySnapshot = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === '/api/operations/day' &&
      url.searchParams.get('date') === '2026-10-14'
    );
  });
  await page.getByRole('button', { name: 'Atualizar painel' }).click();
  expect((await emptySnapshot).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Atrasados 0' })).toBeVisible();
  await seed(page, 'overdue');
  await selectCalendarDay(page, '2026-10-14');
  await page.getByRole('button', { name: 'Atualizar painel' }).click();
  await expect(page.getByRole('button', { name: 'Atrasados 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Atrasados 1' }).click();
  const list = page.getByRole('region', { name: 'Atrasados', exact: true });
  await expect(list.getByText('Nova previsão de retorno')).toBeVisible();
  await expect(list.getByText('16/10/2026 · Não libera estoque')).toBeVisible();
  await expect(list.getByText('Último recebimento real')).toBeVisible();
  await expect(list.getByText('4', { exact: true })).toBeVisible();
  await visual(page, info, 'overdue', '.operations-rows > li');
  await expect(
    page.getByRole('button', {
      name: '16/10/2026: 0 retirada(s), 1 devolução(ões)',
    }),
  ).toBeVisible();
  await visual(page, info, 'forecast-calendar', '.operations-calendar');
});

test('dashboard loading, empty, independent calendar error, retry, keyboard and reduced motion', async ({
  page,
}, info) => {
  await login(page);
  await expect(page.getByText(/Nenhum registro nesta fila/)).toBeVisible();
  await visual(page, info, 'empty', '.operations-list');
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/operations/day?**', async (route) => {
    await pending;
    await route.fulfill({
      status: 503,
      json: { detail: 'Serviço indisponível.' },
    });
  });
  await page.getByRole('button', { name: 'Atualizar painel' }).click();
  await expect(page.getByText('Consultando operação…')).toBeVisible();
  await visual(page, info, 'loading', '.operations-empty');
  release?.();
  await expect(page.getByRole('alert')).toContainText(
    'Não foi possível consultar',
  );
  await expect(page.getByText(/Nenhum registro nesta fila/)).toHaveCount(0);
  await visual(page, info, 'error', '.operations-empty');
  await page.unroute('**/api/operations/day?**');
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByText(/Nenhum registro nesta fila/)).toBeVisible();
  await page.route('**/api/operations/calendar?**', async (route) => {
    await route.fulfill({
      status: 503,
      json: { detail: 'Serviço indisponível.' },
    });
  });
  await page.getByRole('button', { name: 'Atualizar painel' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Não foi possível consultar',
  );
  await expect(page.getByText(/Nenhum registro nesta fila/)).toBeVisible();
  await page.unroute('**/api/operations/calendar?**');
  await page
    .getByRole('button', { name: 'Tentar carregar calendário' })
    .click();
  await expect(page.locator('.operations-days button').first()).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const refresh = page.getByRole('button', { name: 'Atualizar painel' });
  await expect(refresh).toHaveCSS('transition-duration', '0s');
  await refresh.focus();
  await expect(refresh).toBeFocused();
  await expect(refresh).toHaveCSS('outline-width', '2px');
});
