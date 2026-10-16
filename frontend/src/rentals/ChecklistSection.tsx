import { useEffect, useRef, useState } from 'react';
import { quotationFeedback, QuotationError } from '../quotations/api';
import { rentalRequest } from './api';
import './checklist.css';
import { checklistComplete } from './checklistState';

export type Checklist = {
  version: number;
  rental_version: number;
  needs_recheck: boolean;
  products: { id: string; name: string; quantity: number; checked: boolean }[];
  extras: { id: string; label: string; checked: boolean }[];
  updated_at: string | null;
};

export function ChecklistSection({
  rentalId,
  onStateChange,
  onCompleted,
}: {
  rentalId: string;
  onStateChange?: (complete: boolean) => void;
  onCompleted?: () => void;
}) {
  const [data, setData] = useState<Checklist | null>(null);
  const [label, setLabel] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<object | null>(null);
  const inFlight = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    onStateChange?.(
      Boolean(data && !dirty && !pending && checklistComplete(data)),
    );
  }, [data, dirty, pending, onStateChange]);

  useEffect(() => {
    const controller = new AbortController();
    void rentalRequest<Checklist>(`/${rentalId}/checklist`, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((problem: unknown) => {
        if (!controller.signal.aborted) setError(quotationFeedback(problem));
      });
    return () => controller.abort();
  }, [rentalId]);

  async function reload() {
    setBusy(true);
    try {
      setData(await rentalRequest<Checklist>(`/${rentalId}/checklist`));
      setDirty(false);
      setError('');
      setNotice('Checklist atualizado.');
    } catch (problem) {
      setError(quotationFeedback(problem));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!data || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const command = pending ?? {
      request_id: crypto.randomUUID(),
      expected_version: data.version,
      expected_rental_version: data.rental_version,
      checked_products: data.products
        .filter((item) => item.checked)
        .map((item) => item.id),
      extras: data.extras,
    };
    try {
      await rentalRequest<Checklist>(
        `/${rentalId}/checklist`,
        undefined,
        command,
      );
      setPending(null);
      setDirty(false);
      // A replay can be older than another user's subsequent changes.
      const latest = await rentalRequest<Checklist>(`/${rentalId}/checklist`);
      setData(latest);
      setNotice(
        checklistComplete(latest)
          ? 'Preparação concluída. Todos os itens foram separados.'
          : 'Progresso salvo. Continue a separação dos itens restantes.',
      );
      if (checklistComplete(latest)) onCompleted?.();
    } catch (problem) {
      if (problem instanceof QuotationError && problem.status < 500) {
        setPending(null);
        setError(quotationFeedback(problem));
      } else {
        setPending(command);
        setError(
          'Não foi possível confirmar o resultado. Tente novamente para recuperar o mesmo salvamento, sem duplicar itens.',
        );
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const done = data
    ? [...data.products, ...data.extras].filter((item) => item.checked).length
    : 0;
  const total = data ? data.products.length + data.extras.length : 0;
  function edited() {
    setDirty(true);
    setNotice('');
  }
  return (
    <section
      className="preparation-checklist"
      aria-labelledby="checklist-title"
    >
      <header>
        <span className="section-kicker">PREPARAÇÃO</span>
        <h3 id="checklist-title">Checklist de separação</h3>
        <p>
          Separe os produtos e os acessórios que precisam acompanhar a entrega.
        </p>
      </header>
      {error && (
        <div role="alert" className="auth-feedback">
          {error}
          <button
            className="auth-retry"
            disabled={busy || Boolean(pending)}
            onClick={() => void reload()}
          >
            Recarregar checklist
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="checklist-success">
          {notice}
        </p>
      )}
      {!data && !error && <p role="status">Carregando checklist…</p>}
      {data && (
        <>
          {data.needs_recheck && (
            <p role="status" className="auth-feedback operational-warning">
              A locação mudou. Confira novamente os produtos e os extras antes
              de salvar.
            </p>
          )}
          <p className="checklist-progress" aria-live="polite">
            {done} de {total} itens separados
            {dirty ? ' · alterações não salvas' : ''}
          </p>
          <progress
            aria-label="Progresso da separação"
            value={done}
            max={Math.max(total, 1)}
          />
          <fieldset disabled={busy || Boolean(pending)}>
            <legend>Produtos da locação</legend>
            <ul className="checklist-rows">
              {data.products.map((item) => (
                <li key={item.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={(event) => {
                        setData({
                          ...data,
                          products: data.products.map((row) =>
                            row.id === item.id
                              ? { ...row, checked: event.target.checked }
                              : row,
                          ),
                        });
                        edited();
                      }}
                    />
                    <span>
                      <strong>
                        {item.quantity} × {item.name}
                      </strong>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <fieldset disabled={busy || Boolean(pending)}>
            <legend>Extras de preparação</legend>
            <p>
              Elásticos, pregadores e outros lembretes. Sem cobrança e sem
              alterar estoque ou contrato.
            </p>
            {data.extras.length === 0 && (
              <p className="checklist-empty">Nenhum extra adicionado.</p>
            )}
            <ul className="checklist-rows">
              {data.extras.map((item) => (
                <li key={item.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={(event) => {
                        setData({
                          ...data,
                          extras: data.extras.map((row) =>
                            row.id === item.id
                              ? { ...row, checked: event.target.checked }
                              : row,
                          ),
                        });
                        edited();
                      }}
                    />
                    <span>{item.label}</span>
                  </label>
                  <button
                    type="button"
                    className="auth-retry"
                    aria-label={`Remover ${item.label}`}
                    onClick={() => {
                      setData({
                        ...data,
                        extras: data.extras.filter((row) => row.id !== item.id),
                      });
                      edited();
                    }}
                  >
                    Remover
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="checklist-add"
              onSubmit={(event) => {
                event.preventDefault();
                if (!label.trim() || data.extras.length >= 100) return;
                setData({
                  ...data,
                  extras: [
                    ...data.extras,
                    {
                      id: crypto.randomUUID(),
                      label: label.trim(),
                      checked: false,
                    },
                  ],
                });
                setLabel('');
                edited();
                input.current?.focus();
              }}
            >
              <label>
                Adicionar acessório ou lembrete
                <input
                  ref={input}
                  maxLength={160}
                  required
                  value={label}
                  placeholder="Ex.: 10 pregadores e elásticos"
                  onChange={(event) => setLabel(event.target.value)}
                />
              </label>
              <button
                className="auth-retry"
                disabled={!label.trim() || data.extras.length >= 100}
              >
                Adicionar extra
              </button>
            </form>
          </fieldset>
          <div className="catalog-actions">
            <button
              className="auth-button"
              disabled={busy || (!dirty && !pending)}
              onClick={() => void save()}
            >
              {busy
                ? 'Salvando…'
                : pending
                  ? 'Recuperar salvamento'
                  : done === total && total > 0
                    ? 'Salvar preparação'
                    : 'Salvar progresso'}
            </button>
            {!dirty && !pending && (
              <a
                className="auth-retry"
                href={`/api/rentals/${rentalId}/checklist/download`}
              >
                Imprimir / baixar checklist
              </a>
            )}
          </div>
          {dirty && (
            <p>Salve as alterações para imprimir a versão atualizada.</p>
          )}
        </>
      )}
    </section>
  );
}
