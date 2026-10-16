import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const sharedStyles = readFileSync(
  new URL('../src/index.css', import.meta.url),
  'utf8',
);

test('disabled action buttons keep a normal cursor without allowing clicks', async ({
  page,
}) => {
  await page.setContent(`
    <style>${sharedStyles}</style>
    <button class="auth-button">Salvar checklist</button>
    <button class="auth-retry">Salvar alterações</button>
  `);
  for (const button of await page.getByRole('button').all()) {
    await button.hover();
    await expect(button).toHaveCSS('cursor', 'pointer');
    await button.evaluate((element: HTMLButtonElement) => {
      element.disabled = true;
      element.addEventListener('click', () => {
        element.dataset.clicked = 'true';
      });
    });
    await button.hover();
    await expect(button).toHaveCSS('cursor', 'default');
    await expect(button).toBeDisabled();
    const box = await button.boundingBox();
    if (!box) throw new Error('Expected a visible action button');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(button).not.toHaveAttribute('data-clicked', 'true');
  }
});
