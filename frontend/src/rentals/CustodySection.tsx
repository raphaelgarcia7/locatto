import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Quotation } from '../quotations/api';
import { QuotationError, quotationFeedback } from '../quotations/api';
import { priceLabel } from '../catalog/api';
import { rentalRequest, rentalStateLabel } from './api';
import type { Payments } from '../payments/api';

type CustodyLine = {
  product_id: string;
  name: string;
  quantity: number;
  condition: string;
  received: number;
  lost: number;
  outstanding: number;
};
type Incident = {
  id: string;
  product_id: string;
  kind: 'outstanding' | 'cleaning' | 'damaged';
  quantity: number;
  remaining: number;
  maintenance_decided: number;
  reason: string;
  actor_id: string;
};
type Event = {
  id: string;
  reason: string;
  actor_id: string;
  created_at: string;
  disposition?: string;
  quantity?: number;
  kind?: string;
  amount?: string;
  business_date?: string;
  lines?: { product_id: string; quantity: number; condition: string }[];
  observation?: string | null;
  third_party?: { name: string; authorization: string } | null;
  balance_exception?: string | null;
};
export type Custody = {
  rental_id: string;
  rental_version: number;
  quotation_version: number;
  financial_version: number;
  state: 'confirmed' | 'out' | 'completed' | 'cancelled' | 'review';
  contract: { version: number; ready_for_pickup: boolean; signed: boolean };
  financial: Payments;
  handover: Event | null;
  lines: CustodyLine[];
  incidents: Incident[];
  returns: Event[];
  resolutions: Event[];
  agreements: Event[];
  forecasts: Event[];
  late: boolean;
  can_close: boolean;
};
type Pending = { path: string; body: object; label: string };
const conditionLabel = {
  fit: 'Aptos',
  cleaning: 'Higienização',
  damaged: 'Avaria',
};
const decisionLabel: Record<string, string> = {
  maintenance: 'Encaminhar à manutenção',
  repaired: 'Reparo concluído',
  released: 'Liberar manutenção',
  lost: 'Formalizar perda',
};
const agreementLabel: Record<string, string> = {
  delay: 'Atraso acordado',
  repair: 'Reparo comprovado',
  replacement: 'Reposição acordada',
};
function decisionChoices(incident: Incident) {
  return Object.entries(decisionLabel).filter(([key]) =>
    incident.kind === 'outstanding'
      ? key === 'lost'
      : (key !== 'repaired' || incident.kind === 'damaged') &&
        (key !== 'maintenance' ||
          incident.remaining > incident.maintenance_decided),
  );
}
function selectedDecision(incident: Incident, selected: string | undefined) {
  const choices = decisionChoices(incident);
  return choices.find(([key]) => key === selected)?.[0] ?? choices[0]?.[0];
}
function versions(data: Custody) {
  return {
    expected_rental_version: data.rental_version,
    expected_quotation_version: data.quotation_version,
    expected_financial_version: data.financial_version,
    expected_contract_version: data.contract.version,
  };
}
function day() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());
}
function reason(form: FormData) {
  return String(form.get('reason') ?? '');
}

export function CustodySection({
  quotation,
  onChanged,
  onPendingChange,
}: {
  quotation: Quotation;
  onChanged: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const id = quotation.rental?.id;
  const [data, setData] = useState<Custody | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [thirdParty, setThirdParty] = useState(false);
  const [exception, setException] = useState(false);
  const [returnRevision, setReturnRevision] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const flight = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  const approval = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    onPendingChange?.(busy || Boolean(pending));
  }, [busy, pending, onPendingChange]);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    void rentalRequest<Custody>(`/${id}/operations`, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((problem: unknown) => {
        if (!controller.signal.aborted) setError(quotationFeedback(problem));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id]);
  useEffect(() => {
    if (error || notice) feedback.current?.focus();
  }, [error, notice]);
  useEffect(() => {
    if (pending) approval.current?.focus();
  }, [pending]);
  async function consult() {
    if (!id || flight.current || unknown) return;
    setLoading(true);
    setError('');
    try {
      setData(await rentalRequest<Custody>(`/${id}/operations`));
      setNotice('Conferência reconsultada. Seus campos foram mantidos.');
    } catch (problem) {
      setError(quotationFeedback(problem));
    } finally {
      setLoading(false);
    }
  }
  async function prepare(path: string, payload: object, label: string) {
    if (!data || flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setConfirmed(false);
    try {
      if (path === 'handover')
        setData(
          await rentalRequest<Custody>(
            `/${data.rental_id}/handover-preview`,
            undefined,
            versions(data),
          ),
        );
      setPending({
        path,
        label,
        body: {
          ...versions(data),
          ...payload,
          request_id: crypto.randomUUID(),
        },
      });
    } catch (problem) {
      setError(quotationFeedback(problem));
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  async function execute() {
    if (!data || !pending || flight.current || (!confirmed && !unknown)) return;
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      const value = await rentalRequest<Custody>(
        `/${data.rental_id}/${pending.path}`,
        undefined,
        pending.body,
      );
      setData(value);
      if (pending.path === 'returns')
        setReturnRevision((version) => version + 1);
      setPending(null);
      setUnknown(false);
      setNotice(
        'Conferência registrada pelo servidor. Estoque e dívida atualizados conforme a decisão.',
      );
      onChanged();
    } catch (problem) {
      if (problem instanceof QuotationError && problem.status < 500) {
        setError(quotationFeedback(problem));
        setPending(null);
        setUnknown(false);
      } else {
        setUnknown(true);
        setError(
          'Resultado desconhecido. Repetir a mesma operação consulta ou conclui a tentativa sem duplicar registros.',
        );
      }
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  const disabled = busy || Boolean(pending) || loading;
  function submit(
    event: FormEvent<HTMLFormElement>,
    path: string,
    label: string,
    payload: (form: FormData) => object,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void prepare(path, { reason: reason(form), ...payload(form) }, label);
  }
  return (
    <section
      className="catalog-section custody-section"
      aria-labelledby="custody-title"
    >
      <h3 id="custody-title">Retirada, devolução e ocorrências</h3>
      <p>
        Confira produtos completos. Contrato e assinatura são opcionais e não
        bloqueiam a saída. Recebidos aptos ficam disponíveis no dia seguinte em
        São Paulo; manutenção exige liberação explícita.
      </p>
      {loading && <p role="status">Carregando conferência…</p>}
      {!id && (
        <p>
          Confirme a reserva após conferir sinal e estoque para preparar a
          retirada.
        </p>
      )}
      <div ref={feedback} tabIndex={-1}>
        {error && (
          <p role="alert" className="auth-feedback">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
      </div>
      {id && (
        <button
          className="auth-retry"
          disabled={busy || unknown || loading}
          onClick={() => void consult()}
        >
          Reconsultar conferência sem apagar campos
        </button>
      )}
      {data && (
        <>
          <p>
            <strong>
              {rentalStateLabel[data.state]} · conferência v
              {data.rental_version}
            </strong>
          </p>
          <p>
            Saldo comercial {priceLabel(data.financial.remaining)} · extras
            acordados {priceLabel(data.financial.extra_agreed ?? '0.00')} ·
            dívida total{' '}
            {priceLabel(
              data.financial.operational_debt ?? data.financial.remaining,
            )}
          </p>
          {data.late && (
            <p role="status">
              Devolução atrasada. Faltantes continuam indisponíveis até
              recebimento real ou perda formalizada, mesmo com nova previsão.
              Conflitos com reservas exigem decisão da equipe.
            </p>
          )}
          <ul className="quotation-capacity">
            {data.lines.map((line) => (
              <li key={line.product_id}>
                <strong>{line.name}</strong>
                <span>
                  Enviados {line.quantity} · recebidos {line.received} · perda
                  formalizada {line.lost} · faltantes {line.outstanding}
                </span>
                {line.condition && (
                  <span>Condição na saída: {line.condition}</span>
                )}
              </li>
            ))}
          </ul>
          {data.state === 'confirmed' && (
            <form
              onSubmit={(event) =>
                submit(
                  event,
                  'handover',
                  'Registrar saída integral',
                  (form) => ({
                    lines: data.lines.map((line) => ({
                      product_id: line.product_id,
                      quantity: line.quantity,
                      condition: String(
                        form.get(`condition-${line.product_id}`),
                      ),
                    })),
                    third_party: thirdParty
                      ? {
                          name: String(form.get('third-name')),
                          authorization: String(form.get('authorization')),
                        }
                      : null,
                    balance_exception: exception
                      ? String(form.get('exception'))
                      : null,
                  }),
                )
              }
            >
              <fieldset disabled={disabled}>
                <legend>Checklist de saída integral</legend>
                <p>
                  {data.contract.ready_for_pickup
                    ? 'Contrato vigente assinado e conferido.'
                    : 'Contrato e assinatura opcionais. A retirada pode seguir sem documento.'}
                </p>
                {data.lines.map((line) => (
                  <label key={line.product_id}>
                    {line.name} · {line.quantity} unidades · condição conferida
                    <input
                      name={`condition-${line.product_id}`}
                      required
                      maxLength={1000}
                    />
                  </label>
                ))}
                <label>
                  <input
                    type="checkbox"
                    checked={thirdParty}
                    onChange={(event) => setThirdParty(event.target.checked)}
                  />{' '}
                  Retirada por terceiro autorizado
                </label>
                {thirdParty && (
                  <>
                    <label>
                      Nome de quem retira
                      <input name="third-name" required maxLength={200} />
                    </label>
                    <label>
                      Autorização do cliente
                      <textarea
                        name="authorization"
                        required
                        maxLength={1000}
                      />
                    </label>
                  </>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={exception}
                    onChange={(event) => setException(event.target.checked)}
                  />{' '}
                  Autorizar exceção de saldo pendente
                </label>
                {exception && (
                  <label>
                    Justificativa da exceção financeira
                    <textarea name="exception" required maxLength={1000} />
                  </label>
                )}
                <Reason />
                <button
                  className="auth-button"
                  disabled={
                    !data.financial.deposit_validated ||
                    (data.financial.remaining !== '0.00' && !exception)
                  }
                >
                  Preparar prévia da saída
                </button>
              </fieldset>
            </form>
          )}
          {data.state === 'out' && (
            <>
              <form
                key={returnRevision}
                onSubmit={(event) =>
                  submit(
                    event,
                    'returns',
                    'Registrar recebimento real',
                    (form) => ({
                      business_date: String(form.get('date')),
                      observation: String(form.get('observation')) || null,
                      lines: data.lines.flatMap((line) =>
                        (
                          Object.keys(
                            conditionLabel,
                          ) as (keyof typeof conditionLabel)[]
                        )
                          .map((condition) => ({
                            product_id: line.product_id,
                            quantity: Number(
                              form.get(`${line.product_id}-${condition}`),
                            ),
                            condition,
                          }))
                          .filter((line) => line.quantity > 0),
                      ),
                    }),
                  )
                }
              >
                <fieldset disabled={disabled}>
                  <legend>Recebimento por produto</legend>
                  <label>
                    Data real do recebimento
                    <input
                      type="date"
                      name="date"
                      required
                      defaultValue={day()}
                      max={day()}
                    />
                  </label>
                  {data.lines
                    .filter((line) => line.outstanding > 0)
                    .map((line) => (
                      <fieldset key={line.product_id}>
                        <legend>
                          {line.name} · faltam {line.outstanding}
                        </legend>
                        {(
                          Object.keys(
                            conditionLabel,
                          ) as (keyof typeof conditionLabel)[]
                        ).map((condition) => (
                          <label key={condition}>
                            {conditionLabel[condition]} · {line.name}
                            <input
                              name={`${line.product_id}-${condition}`}
                              type="number"
                              min={0}
                              max={line.outstanding}
                              step={1}
                              defaultValue={0}
                            />
                          </label>
                        ))}
                      </fieldset>
                    ))}
                  <label>
                    Observação privada
                    <textarea name="observation" maxLength={2000} />
                  </label>
                  <Reason />
                  <button className="auth-button">Preparar recebimento</button>
                </fieldset>
              </form>
              <form
                onSubmit={(event) =>
                  submit(
                    event,
                    'return-forecast',
                    'Registrar previsão informativa',
                    (form) => ({ business_date: String(form.get('date')) }),
                  )
                }
              >
                <fieldset disabled={disabled}>
                  <legend>Nova previsão informativa</legend>
                  <p>A previsão não libera faltantes nem garante capacidade.</p>
                  <label>
                    Nova previsão de devolução
                    <input name="date" type="date" required min={day()} />
                  </label>
                  <Reason />
                  <button className="auth-retry">Preparar previsão</button>
                </fieldset>
              </form>
            </>
          )}
          {data.incidents.length > 0 && (
            <div>
              <h4>Ocorrências e decisões da equipe</h4>
              {data.incidents.map((incident) => (
                <div className="custody-incident" key={incident.id}>
                  <h5>
                    {
                      data.lines.find(
                        (line) => line.product_id === incident.product_id,
                      )?.name
                    }{' '}
                    ·{' '}
                    {incident.kind === 'outstanding'
                      ? 'Conferência de faltantes'
                      : conditionLabel[incident.kind]}
                  </h5>
                  <p>
                    Quantidade {incident.quantity} · pendente fisicamente{' '}
                    {incident.remaining} · encaminhada à manutenção{' '}
                    {incident.maintenance_decided}.
                  </p>
                  <p>{incident.reason}</p>
                  {incident.remaining > 0 && (
                    <form
                      onSubmit={(event) =>
                        submit(
                          event,
                          `incidents/${incident.id}/resolutions`,
                          'Registrar decisão operacional',
                          (form) => ({
                            disposition: String(form.get('disposition')),
                            quantity: Number(form.get('quantity')),
                            agreed: true,
                          }),
                        )
                      }
                    >
                      <fieldset disabled={disabled}>
                        <legend>Decidir ocorrência</legend>
                        <label>
                          Decisão
                          <select
                            name="disposition"
                            value={selectedDecision(
                              incident,
                              decisions[incident.id],
                            )}
                            onChange={(event) =>
                              setDecisions((previous) => ({
                                ...previous,
                                [incident.id]: event.target.value,
                              }))
                            }
                          >
                            {decisionChoices(incident).map(([key, label]) => (
                              <option key={key} value={key}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Quantidade da decisão
                          <input
                            name="quantity"
                            type="number"
                            min={1}
                            max={
                              selectedDecision(
                                incident,
                                decisions[incident.id],
                              ) === 'maintenance'
                                ? incident.remaining -
                                  incident.maintenance_decided
                                : incident.remaining
                            }
                            step={1}
                            required
                          />
                        </label>
                        <Reason />
                        <button className="auth-retry">
                          Preparar decisão da ocorrência
                        </button>
                      </fieldset>
                    </form>
                  )}
                  <form
                    onSubmit={(event) =>
                      submit(
                        event,
                        `incidents/${incident.id}/financial-agreements`,
                        'Registrar obrigação financeira manual',
                        (form) => ({
                          kind: String(form.get('kind')),
                          amount: String(form.get('amount')),
                          quantity: Number(form.get('quantity')),
                          agreed: true,
                        }),
                      )
                    }
                  >
                    <fieldset disabled={disabled}>
                      <legend>Acordo financeiro explícito</legend>
                      <p>
                        Somente valor acordado e documentado, sem recebimento ou
                        multa automática. Não acumule reparo e reposição na
                        mesma quantidade.
                      </p>
                      <label>
                        Tipo do acordo
                        <select name="kind">
                          {Object.entries(agreementLabel).map(
                            ([key, label]) => (
                              <option key={key} value={key}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      <label>
                        Quantidade do acordo
                        <input
                          name="quantity"
                          type="number"
                          min={1}
                          max={incident.quantity}
                          step={1}
                          required
                        />
                      </label>
                      <label>
                        Valor extra acordado
                        <input
                          name="amount"
                          inputMode="decimal"
                          pattern="[0-9]+\.[0-9]{2}"
                          placeholder="0.00"
                          required
                        />
                      </label>
                      <Reason />
                      <button className="auth-retry">
                        Preparar acordo financeiro
                      </button>
                    </fieldset>
                  </form>
                </div>
              ))}
            </div>
          )}
          {data.state === 'out' && (
            <form
              onSubmit={(event) =>
                submit(
                  event,
                  'close',
                  'Encerrar operacionalmente a locação',
                  () => ({}),
                )
              }
            >
              <fieldset disabled={disabled}>
                <legend>Encerramento operacional</legend>
                <p>
                  {data.can_close
                    ? 'Todos os itens foram contabilizados e as decisões operacionais registradas. Encerrar preserva dívidas e manutenção.'
                    : 'Há faltantes ou ocorrências sem decisão. Receba, formalize a perda ou encaminhe explicitamente as quantidades recebidas à manutenção.'}
                </p>
                <Reason />
                <button className="auth-button" disabled={!data.can_close}>
                  Preparar encerramento
                </button>
              </fieldset>
            </form>
          )}
          {data.state === 'completed' && (
            <p>
              Locação encerrada. A dívida continua visível e itens em manutenção
              permanecem indisponíveis até liberação explícita.
            </p>
          )}
          <h4>Histórico privado da conferência</h4>
          {!data.handover && <p>Nenhuma saída registrada.</p>}
          <ul className="catalog-history">
            {[
              ...(data.handover ? [data.handover] : []),
              ...data.returns,
              ...data.resolutions,
              ...data.agreements,
              ...data.forecasts,
            ]
              .sort((a, b) => a.created_at.localeCompare(b.created_at))
              .map((event) => (
                <li key={event.id}>
                  {event.disposition
                    ? decisionLabel[event.disposition]
                    : (event.kind ?? 'Conferência')}
                  {event.quantity ? ` · quantidade ${event.quantity}` : ''}
                  {event.amount ? ` · ${priceLabel(event.amount)}` : ''}
                  {event.business_date && (
                    <p>Data de negócio: {event.business_date}</p>
                  )}
                  {event.third_party && (
                    <p>
                      Retirante autorizado: {event.third_party.name}.
                      Autorização do cliente: {event.third_party.authorization}
                    </p>
                  )}
                  {event.balance_exception && (
                    <p>
                      Exceção financeira, sem quitação:{' '}
                      {event.balance_exception}
                    </p>
                  )}
                  {event.observation && (
                    <p>Relato privado: {event.observation}</p>
                  )}
                  {event.lines && (
                    <ul>
                      {event.lines.map((line) => (
                        <li key={`${line.product_id}-${line.condition}`}>
                          {
                            data.lines.find(
                              (item) => item.product_id === line.product_id,
                            )?.name
                          }{' '}
                          · quantidade {line.quantity} ·{' '}
                          {conditionLabel[
                            line.condition as keyof typeof conditionLabel
                          ] ?? line.condition}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p>{event.reason}</p>
                  <time dateTime={event.created_at}>
                    {new Date(event.created_at).toLocaleString('pt-BR', {
                      timeZone: 'America/Sao_Paulo',
                    })}
                  </time>
                </li>
              ))}
          </ul>
        </>
      )}
      {pending && (
        <section
          className="custody-approval"
          aria-labelledby="custody-approval-title"
        >
          <h4 id="custody-approval-title" ref={approval} tabIndex={-1}>
            {pending.label}
          </h4>
          <p>
            Confira esta decisão. Ela registra autoria e histórico; encaminhar à
            manutenção ou encerrar não libera estoque nem perdoa dívida.
          </p>
          <Review body={pending.body} data={data} path={pending.path} />
          <label>
            <input
              type="checkbox"
              disabled={busy || unknown}
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />{' '}
            Conferi os dados e autorizo esta operação
          </label>
          <div className="catalog-actions">
            <button
              className="auth-button"
              disabled={busy || (!confirmed && !unknown)}
              onClick={() => void execute()}
            >
              {busy
                ? 'Registrando conferência…'
                : unknown
                  ? 'Repetir mesma conferência'
                  : 'Confirmar conferência'}
            </button>
            {!unknown && (
              <button
                className="auth-retry"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                Voltar aos campos
              </button>
            )}
          </div>
        </section>
      )}
    </section>
  );
}

function Review({
  body,
  data,
  path,
}: {
  body: object;
  data: Custody | null;
  path: string;
}) {
  const value = body as Record<string, unknown>;
  const lines = value.lines as
    { product_id: string; quantity: number; condition: string }[] | undefined;
  const thirdParty = value.third_party as Event['third_party'];
  const incident = data?.incidents.find(
    (item) => item.id === path.split('/')[1],
  );
  return (
    <div>
      <p>Motivo: {String(value.reason)}</p>
      <p>
        Versões desta decisão: locação {String(value.expected_rental_version)} ·
        proposta {String(value.expected_quotation_version)} · financeiro{' '}
        {String(value.expected_financial_version)} · contrato{' '}
        {String(value.expected_contract_version)}
      </p>
      {incident && (
        <p>
          Ocorrência:{' '}
          {
            data?.lines.find((line) => line.product_id === incident.product_id)
              ?.name
          }{' '}
          ·{' '}
          {incident.kind === 'outstanding'
            ? 'Conferência de faltantes'
            : conditionLabel[incident.kind]}
        </p>
      )}
      {'third_party' in value &&
        (thirdParty ? (
          <>
            <p>Nome de quem retira: {thirdParty.name}</p>
            <p>Autorização do cliente: {thirdParty.authorization}</p>
          </>
        ) : (
          <p>Retirada pelo cliente, sem terceiro autorizado.</p>
        ))}
      {'balance_exception' in value &&
        (value.balance_exception ? (
          <p>
            Justificativa da exceção financeira:{' '}
            {String(value.balance_exception)}
          </p>
        ) : (
          <p>Sem exceção financeira de saldo.</p>
        ))}
      {value.observation ? (
        <p>Relato privado: {String(value.observation)}</p>
      ) : null}
      {value.business_date ? <p>Data: {String(value.business_date)}</p> : null}
      {value.quantity ? <p>Quantidade: {String(value.quantity)}</p> : null}
      {value.disposition ? (
        <p>Decisão: {decisionLabel[String(value.disposition)]}</p>
      ) : null}
      {value.amount ? (
        <p>Valor acordado: {priceLabel(String(value.amount))}</p>
      ) : null}
      {value.kind ? (
        <p>Tipo do acordo: {agreementLabel[String(value.kind)]}</p>
      ) : null}
      {lines ? (
        <ul>
          {lines.map((line) => (
            <li key={`${line.product_id}-${line.condition}`}>
              {
                data?.lines.find((item) => item.product_id === line.product_id)
                  ?.name
              }{' '}
              · {line.quantity} ·{' '}
              {conditionLabel[line.condition as keyof typeof conditionLabel] ??
                line.condition}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Reason() {
  return (
    <label>
      Motivo / acordo documentado
      <textarea name="reason" required maxLength={1000} />
    </label>
  );
}
