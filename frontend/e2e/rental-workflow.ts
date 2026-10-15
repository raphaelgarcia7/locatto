import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Lifecycle tests explicitly open the relevant actions; the compact initial
// view and retained drafts have separate component/browser coverage.
export async function openRentalWorkflow(page: Page) {
  await expect(page.locator('.quotation-detail')).toBeVisible();
  for (const title of [
    '1. Pagamento e confirmação',
    '2. Contrato',
    '3. Retirada e devolução',
    'Alterações e cancelamento',
    'Consulta de estoque e histórico',
  ]) {
    const summary = page.getByText(title, { exact: true });
    if (
      !(await summary
        .locator('..')
        .evaluate((element) => element.hasAttribute('open')))
    ) {
      await summary.click();
    }
  }
  const stock = page.locator('.quotation-detail .quotation-stock-details');
  if (!(await stock.evaluate((element) => element.hasAttribute('open'))))
    await stock.locator('summary').click();
  await openFinancialDetails(page);
  const receive = page.getByRole('button', {
    name: 'Novo recebimento',
    exact: true,
  });
  await receive.click();
}

export async function openFinancialDetails(page: Page) {
  for (const title of [
    'Resumo completo dos valores',
    'Pagamentos registrados e outras operações',
    'Histórico financeiro',
  ]) {
    const summary = page.getByText(title, { exact: true });
    await expect(summary).toBeVisible();
    if (
      !(await summary
        .locator('..')
        .evaluate((element) => element.hasAttribute('open')))
    )
      await summary.click();
  }
}
