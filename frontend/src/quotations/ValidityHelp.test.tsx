import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ValidityHelp } from './ValidityHelp';

it('explains validity on demand using keyboard without submitting the rental form', async () => {
  const submit = vi.fn((event) => event.preventDefault());
  render(
    <form onSubmit={submit}>
      <ValidityHelp />
    </form>,
  );
  const button = screen.getByRole('button', {
    name: 'Entender a validade comercial',
  });
  expect(button).toHaveAttribute('aria-expanded', 'false');
  button.focus();
  const user = userEvent.setup();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('note')).toHaveTextContent(
    'data limite para confirmar os preços',
  );
  expect(screen.getByRole('note')).toHaveTextContent(
    'Não é a data de devolução e não reserva estoque',
  );
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(submit).not.toHaveBeenCalled();
  await user.click(button);
  expect(screen.queryByRole('note')).not.toBeInTheDocument();
});
