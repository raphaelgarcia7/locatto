import { useId, useState } from 'react';

export function SearchPicker({
  label,
  query,
  onQueryChange,
  options,
  onSelect,
  disabled = false,
  invalid = false,
}: {
  label: string;
  query: string;
  onQueryChange: (value: string) => void;
  options: { id: string; label: string }[];
  onSelect: (id: string, label: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const normalized = (text: string) =>
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR');
  const matches = options
    .filter((option) => normalized(option.label).includes(normalized(query)))
    .slice(0, 100);
  function choose(index: number) {
    const option = matches[index];
    if (!option) return;
    onSelect(option.id, option.label);
    setOpen(false);
    setActive(-1);
  }
  return (
    <div
      className="search-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        role="combobox"
        autoComplete="off"
        disabled={disabled}
        maxLength={200}
        aria-expanded={open}
        aria-controls={`${id}-options`}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        aria-activedescendant={
          open && matches[active] ? `${id}-${active}` : undefined
        }
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          onQueryChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
            return;
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            setActive((previous) =>
              Math.max(
                0,
                Math.min(
                  matches.length - 1,
                  previous + (event.key === 'ArrowDown' ? 1 : -1),
                ),
              ),
            );
          }
          if (event.key === 'Enter' && open) {
            event.preventDefault();
            if (active >= 0) choose(active);
          }
        }}
      />
      {open && (
        <ul id={`${id}-options`} role="listbox" aria-label={label}>
          {matches.map((option, index) => (
            <li
              id={`${id}-${index}`}
              key={option.id}
              data-record-id={option.id}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              {option.label}
            </li>
          ))}
          {!matches.length && (
            <li role="presentation">
              Nenhuma opção nesta busca. Continue digitando para pesquisar.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
