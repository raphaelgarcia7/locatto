import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Quotation } from '../quotations/api';
import { QuotationError, quotationFeedback } from '../quotations/api';
import { rentalRequest } from './api';
import type { Checklist } from './ChecklistSection';
import { checklistComplete } from './checklistState';
import { CustodySection, type Custody } from './CustodySection';

type Command = {
  path: 'handover' | 'returns' | 'close';
  body: object;
  finish?: boolean;
};
function versions(data: Custody) {
  return {
    expected_rental_version: data.rental_version,
    expected_quotation_version: data.quotation_version,
    expected_financial_version: data.financial_version,
    expected_contract_version: data.contract.version,
  };
}
function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());
}

export function GuidedCustody({
  quotation,
  prepared,
  onChanged,
  onContract,
  active = true,
}: {
  quotation: Quotation;
  prepared: boolean;
  onChanged: () => void;
  onContract: () => void;
  active?: boolean;
}) {
  const id = quotation.rental?.id;
  const [data, setData] = useState<Custody | null>(null);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [returnChecks, setReturnChecks] = useState<{
    version: number;
    ids: string[];
  }>({ version: -1, ids: [] });
  const checked =
    returnChecks.version === data?.rental_version ? returnChecks.ids : [];
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState(false);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Command | null>(null);
  const [exceptions, setExceptions] = useState(false);
  const [exceptionsLoaded, setExceptionsLoaded] = useState(false);
  const [exceptionPending, setExceptionPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const flight = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!id || pending || !active) return;
    const controller = new AbortController();
    void Promise.all([
      rentalRequest<Custody>(`/${id}/operations`, controller.signal),
      rentalRequest<Checklist>(`/${id}/checklist`, controller.signal),
    ])
      .then(([operations, items]) => {
        if (controller.signal.aborted) return;
        setData(operations);
        setChecklist(items);
        setReadError(false);
      })
      .catch((problem: unknown) => {
        if (!controller.signal.aborted) {
          setReadError(true);
          setError(quotationFeedback(problem));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, quotation.rental?.version, prepared, revision, pending, active]);
  useEffect(() => {
    if (error || notice) feedback.current?.focus();
  }, [error, notice]);

  async function write(initial: Command) {
    let command = initial;
    try {
      let value = await rentalRequest<Custody>(
        `/${id}/${command.path}`,
        undefined,
        command.body,
      );
      setData(value);
      if (command.path === 'returns') {
        // Closing uses the server's returned versions, never a guessed completed state.
        if (command.finish && value.can_close) {
          command = {
            path: 'close',
            body: {
              ...versions(value),
              request_id: crypto.randomUUID(),
              reason: 'Todos os itens devolvidos e conferidos pela equipe',
            },
          };
          setPending(command);
          value = await rentalRequest<Custody>(
            `/${id}/close`,
            undefined,
            command.body,
          );
          setData(value);
        }
      }
      setPending(null);
      setNotice(
        value.state === 'completed'
          ? 'Devolução concluída. Todos os itens foram conferidos.'
          : command.path === 'handover'
            ? 'Retirada confirmada. Próximo passo: conferir a devolução.'
            : 'Devolução registrada. Confira as ocorrências antes de concluir.',
      );
      onChanged();
    } catch (problem) {
      if (problem instanceof QuotationError && problem.status < 500) {
        setPending(null);
        setError(
          `${quotationFeedback(problem)} Atualize os dados antes de tentar novamente.`,
        );
      } else {
        setPending(command);
        setError(
          command.path === 'close'
            ? 'Os itens foram recebidos. Falta confirmar o encerramento. Recupere esta confirmação, sem registrar a devolução novamente.'
            : 'Não foi possível confirmar o resultado. Recupere a mesma confirmação, sem registrar novamente.',
        );
      }
    }
  }
  async function recover() {
    if (!pending || flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    await write(pending);
    setBusy(false);
    flight.current = false;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id || !data || flight.current || pending) return;
    const form = new FormData(event.currentTarget);
    flight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const fresh = await rentalRequest<Custody>(`/${id}/operations`);
      setData(fresh);
      if (
        fresh.rental_version !== data.rental_version ||
        fresh.state !== data.state
      ) {
        throw new Error('A locação mudou. Confira os itens novamente.');
      }
      let command: Command;
      if (fresh.state === 'confirmed') {
        if (!String(form.get('name') ?? '').trim())
          throw new Error('Informe o nome de quem retirou os itens.');
        const saved = await rentalRequest<Checklist>(`/${id}/checklist`);
        if (!prepared || !checklistComplete(saved))
          throw new Error('Conclua e salve a preparação antes da retirada.');
        if (
          !fresh.financial.deposit_validated ||
          fresh.financial.remaining !== '0.00'
        ) {
          throw new Error(
            'Confira o pagamento. Para retirar com saldo pendente, use a opção de exceção.',
          );
        }
        await rentalRequest<Custody>(
          `/${id}/handover-preview`,
          undefined,
          versions(fresh),
        );
        command = {
          path: 'handover',
          body: {
            ...versions(fresh),
            request_id: crypto.randomUUID(),
            reason: `Retirada confirmada por: ${String(form.get('name')).trim()}`,
            lines: fresh.lines.map((line) => ({
              product_id: line.product_id,
              quantity: line.quantity,
              condition: 'Conferido na separação',
            })),
            third_party: null,
            balance_exception: null,
          },
        };
      } else if (fresh.state === 'out') {
        const saved = await rentalRequest<Checklist>(`/${id}/checklist`);
        if (saved.version !== checklist?.version)
          throw new Error(
            'O checklist mudou. Atualize os dados e confira novamente.',
          );
        const outstanding = fresh.lines.filter((line) => line.outstanding > 0);
        if (
          outstanding.some((line) => !checked.includes(line.product_id)) ||
          (checklist?.extras ?? []).some((item) => !checked.includes(item.id))
        ) {
          throw new Error(
            'Confira todos os produtos e acessórios antes de confirmar.',
          );
        }
        command = outstanding.length
          ? {
              path: 'returns',
              finish: true,
              body: {
                ...versions(fresh),
                request_id: crypto.randomUUID(),
                business_date: String(form.get('date')),
                reason: 'Devolução integral conferida pela equipe',
                observation: checklist?.extras.length
                  ? `Acessórios conferidos (${checklist.extras.length}): ${checklist.extras.map((item) => item.label).join('; ')}`.slice(
                      0,
                      2000,
                    )
                  : null,
                lines: outstanding.map((line) => ({
                  product_id: line.product_id,
                  quantity: line.outstanding,
                  condition: 'fit',
                })),
              },
            }
          : {
              path: 'close',
              body: {
                ...versions(fresh),
                request_id: crypto.randomUUID(),
                reason: 'Todos os itens devolvidos e conferidos pela equipe',
              },
            };
      } else
        throw new Error('Esta etapa já foi registrada. Atualize a locação.');
      setPending(command);
      await write(command);
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : quotationFeedback(problem),
      );
    } finally {
      setBusy(false);
      flight.current = false;
    }
  }
  const returning = data?.state === 'out';
  const rows = returning
    ? [
        ...data.lines
          .filter((line) => line.outstanding > 0)
          .map((line) => ({
            id: line.product_id,
            label: `${line.outstanding} × ${line.name}`,
          })),
        ...(checklist?.extras ?? []).map((item) => ({
          id: item.id,
          label: item.label,
        })),
      ]
    : [];
  const complete = rows.every((row) => checked.includes(row.id));
  const blocked = busy || loading || readError || Boolean(pending);
  return (
    <section
      className="catalog-section custody-section guided-custody"
      aria-label="Conferência da locação"
    >
      <div ref={feedback} tabIndex={-1}>
        {error && (
          <p role="alert" className="auth-feedback">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="checklist-success">
            {notice}
          </p>
        )}
      </div>
      {loading && <p role="status">Carregando conferência…</p>}
      {pending && !busy && (
        <button className="auth-button" onClick={() => void recover()}>
          Recuperar confirmação
        </button>
      )}
      <header className="custody-step-heading">
        <h3>
          {data?.state === 'confirmed'
            ? 'Confirmar retirada'
            : returning
              ? 'Conferir devolução'
              : data?.state === 'completed'
                ? 'Devolução concluída'
                : 'Conferência da locação'}
        </h3>
        {!pending && (
          <button
            className="auth-retry"
            disabled={busy}
            onClick={() => {
              setLoading(true);
              setRevision((value) => value + 1);
            }}
          >
            Atualizar conferência
          </button>
        )}
      </header>
      {data?.state === 'confirmed' && (
        <>
          <p>Registre a entrega dos itens separados ao cliente.</p>
          {!prepared && (
            <p role="status" className="operational-warning">
              Conclua e salve o checklist na etapa Preparação.
            </p>
          )}
          {!data.contract.ready_for_pickup && (
            <div className="auth-feedback" role="status">
              Contrato opcional. A falta de assinatura não impede a retirada.
              <button
                className="auth-retry warning-action"
                onClick={onContract}
              >
                Conferir contrato
              </button>
            </div>
          )}
          {data.financial.remaining !== '0.00' && (
            <p role="status" className="operational-warning">
              Há saldo pendente. Registre o restante em Pagamento ou use a opção
              de exceção abaixo.
            </p>
          )}
          <form onSubmit={(event) => void submit(event)}>
            <fieldset disabled={blocked || exceptions || exceptionPending}>
              <legend>Quem retirou os itens?</legend>
              <label>
                Nome de quem retira
                <input
                  name="name"
                  autoComplete="off"
                  required
                  maxLength={200}
                />
              </label>
              <p>
                Retirada pelo cliente. Se outra pessoa vier buscar, registre a
                autorização em Mais opções.
              </p>
              <button
                className="auth-button"
                disabled={
                  !prepared ||
                  !data.financial.deposit_validated ||
                  data.financial.remaining !== '0.00'
                }
              >
                {busy ? 'Confirmando…' : 'Confirmar retirada'}
              </button>
            </fieldset>
          </form>
        </>
      )}
      {returning && (
        <>
          <p>
            Marque somente o que voltou em boas condições. Se faltou algo ou
            houve avaria, use a opção abaixo.
          </p>
          <form onSubmit={(event) => void submit(event)}>
            <fieldset disabled={blocked || exceptions || exceptionPending}>
              <legend>Itens devolvidos</legend>
              <ul className="checklist-rows">
                {rows.map((row) => (
                  <li key={row.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={checked.includes(row.id)}
                        onChange={(event) =>
                          setReturnChecks({
                            version: data.rental_version,
                            ids: event.target.checked
                              ? [...checked, row.id]
                              : checked.filter((item) => item !== row.id),
                          })
                        }
                      />
                      {row.label}
                    </label>
                  </li>
                ))}
              </ul>
              <label>
                Data da devolução
                <input
                  type="date"
                  name="date"
                  defaultValue={today()}
                  max={today()}
                  required
                />
              </label>
              <button
                className="auth-button"
                disabled={!complete || (!rows.length && !data.can_close)}
              >
                {busy ? 'Confirmando…' : 'Confirmar devolução e concluir'}
              </button>
            </fieldset>
          </form>
        </>
      )}
      {data?.state === 'completed' && (
        <p className="checklist-success">
          ✓ Devolução concluída. Itens conferidos.
        </p>
      )}
      <fieldset
        disabled={busy || Boolean(pending)}
        className="custody-more-options"
      >
        <details
          className="quotation-secondary"
          onToggle={(event) => {
            setExceptions(event.currentTarget.open);
            if (event.currentTarget.open) setExceptionsLoaded(true);
          }}
        >
          <summary>
            {returning
              ? 'Faltou item ou houve avaria'
              : 'Mais opções · autorização, exceções e histórico'}
          </summary>
          {exceptionsLoaded && (
            <CustodySection
              onPendingChange={setExceptionPending}
              quotation={quotation}
              onChanged={() => {
                setRevision((value) => value + 1);
                onChanged();
              }}
            />
          )}
        </details>
      </fieldset>
    </section>
  );
}
