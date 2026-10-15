import { useState } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { SearchPicker } from './SearchPicker';
import { useDebouncedValue } from './useDebouncedValue';

afterEach(() => vi.useRealTimers());

it('shows suggestions as typing and selects with arrows/Enter without exposing IDs', async () => {
  const user = userEvent.setup();
  const selected = vi.fn();
  function Example() {
    const [query, setQuery] = useState('');
    return (
      <SearchPicker
        label="Produto"
        query={query}
        onQueryChange={setQuery}
        options={[
          { id: 'internal-one', label: 'Painel romano' },
          { id: 'internal-two', label: 'Cilindro azul' },
        ]}
        onSelect={(id, label) => {
          selected(id);
          setQuery(label);
        }}
      />
    );
  }
  render(<Example />);
  const input = screen.getByRole('combobox', { name: 'Produto' });
  await user.type(input, 'r');
  expect(screen.getByRole('option', { name: 'Painel romano' })).toBeVisible();
  await user.type(input, 'om');
  expect(
    screen.queryByRole('option', { name: 'Cilindro azul' }),
  ).not.toBeInTheDocument();
  await user.keyboard('{ArrowDown}{Enter}');
  expect(selected).toHaveBeenCalledWith('internal-one');
  expect(input).toHaveValue('Painel romano');
  expect(input).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('internal-one')).not.toBeInTheDocument();
});

it('never treats unselected text as a chosen record and closes suggestions with Escape', async () => {
  const selected = vi.fn();
  render(
    <SearchPicker
      label="Cliente"
      query="Nome inexistente"
      onQueryChange={vi.fn()}
      options={[]}
      onSelect={selected}
    />,
  );
  await userEvent.click(screen.getByRole('combobox', { name: 'Cliente' }));
  expect(screen.getByText(/Nenhuma opção/)).toBeVisible();
  await userEvent.keyboard('{Enter}{Escape}');
  expect(selected).not.toHaveBeenCalled();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

it('debounces a burst of typing without requiring a search button', () => {
  vi.useFakeTimers();
  const view = renderHook(({ value }) => useDebouncedValue(value), {
    initialProps: { value: '' },
  });
  view.rerender({ value: 'p' });
  act(() => vi.advanceTimersByTime(100));
  view.rerender({ value: 'pa' });
  act(() => vi.advanceTimersByTime(100));
  expect(view.result.current).toBe('');
  act(() => vi.advanceTimersByTime(150));
  expect(view.result.current).toBe('pa');
});
