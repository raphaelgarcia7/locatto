import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { priceLabel } from '../catalog/api';
import { customerLink } from '../customers/api';
import {
  dateLabels,
  quotationFeedback,
  quotationLink,
  quotationRequest,
} from './api';
import type { Quotation } from './api';
import { OfferSummary } from './OfferSummary';
import { FinancialSection } from '../payments/FinancialSection';
import { ConfirmationSection } from '../rentals/ConfirmationSection';
import { RentalChanges } from '../rentals/RentalChanges';
import { ContractsSection } from '../contracts/ContractsSection';
import { GuidedCustody } from '../rentals/GuidedCustody';
import { rentalStateLabel } from '../rentals/api';
import { ChecklistSection } from '../rentals/ChecklistSection';
import { paymentRequest, type Payments } from '../payments/api';
import { QuotationError } from './api';
import '../rentals/custody.css';

export function QuotationDetail({
  record,
  onEdit,
  onClose,
}: {
  record: Quotation;
  onEdit: () => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(record);
  const [versions, setVersions] = useState<Quotation[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [changed, setChanged] = useState(false);
  const [financialRead, setFinancialRead] = useState(0);
  const [financial, setFinancial] = useState<Payments | null>(null);
  const [prepared, setPrepared] = useState(false);
  const [custodyOpen, setCustodyOpen] = useState(
    record.rental?.state === 'out' || record.rental?.state === 'completed',
  );
  type Step = 'payment' | 'preparation' | 'custody';
  const [activeStep, setActiveStep] = useState<Step | null>(
    record.rental?.state === 'confirmed'
      ? 'preparation'
      : record.rental?.state === 'out' || record.rental?.state === 'completed'
        ? 'custody'
        : 'payment',
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const closing = useRef<HTMLDetailsElement>(null);
  const contract = useRef<HTMLDetailsElement>(null);
  const custody = useRef<HTMLDetailsElement>(null);
  const preparation = useRef<HTMLDetailsElement>(null);
  const onPrepared = useCallback(
    (complete: boolean) => setPrepared(complete),
    [],
  );
  const onPreparationComplete = useCallback(() => {
    if (preparation.current) preparation.current.open = false;
    if (custody.current) custody.current.open = true;
    custody.current?.querySelector('summary')?.focus();
    setActiveStep('custody');
  }, []);
  const reserved =
    selected.rental &&
    ['confirmed', 'out', 'completed'].includes(selected.rental.state);
  const nextStep: Step =
    selected.rental?.state === 'out' || selected.rental?.state === 'completed'
      ? 'custody'
      : reserved
        ? prepared
          ? 'custody'
          : 'preparation'
        : 'payment';
  const [reservationMessage, setReservationMessage] = useState('');
  const [reservationUnknown, setReservationUnknown] = useState(false);
  const [reserving, setReserving] = useState(false);
  const reservationCommand = useRef<object | null>(null);
  const reservationBusy = useRef(false);
  async function reserveAfterPayment(financial?: Payments): Promise<string> {
    if (reservationBusy.current)
      return 'A confirmação da reserva está em andamento.';
    reservationBusy.current = true;
    setReserving(true);
    if (financial && financial.quotation_version !== selected.current_version) {
      const message =
        'O pagamento está registrado, mas a proposta mudou. Reabra a locação e confira os novos valores antes de reservar.';
      setReservationMessage(message);
      reservationBusy.current = false;
      setReserving(false);
      return message;
    }
    const command =
      reservationCommand.current ??
      (financial
        ? {
            request_id: crypto.randomUUID(),
            expected_quotation_version: financial.quotation_version,
            expected_financial_version: financial.financial_version,
            ...(selected.rental?.state === 'review'
              ? { expected_rental_version: selected.rental.version }
              : {}),
          }
        : null);
    if (!command) {
      reservationBusy.current = false;
      setReserving(false);
      return '';
    }
    reservationCommand.current = command;
    try {
      await quotationRequest(`/${record.id}/confirm`, command);
      reservationCommand.current = null;
      setReservationUnknown(false);
      const message =
        'Sinal registrado e reserva confirmada. Próximo passo: separar os itens.';
      setReservationMessage(message);
      await consult();
      setActiveStep('preparation');
      return message;
    } catch (problem) {
      const unknown =
        !(problem instanceof QuotationError) || problem.status >= 500;
      setReservationUnknown(unknown);
      if (!unknown) reservationCommand.current = null;
      const message = unknown
        ? 'O pagamento foi registrado. Falta confirmar o resultado da reserva. Use Recuperar confirmação; não registre o sinal novamente.'
        : `O pagamento foi registrado, mas a reserva não foi confirmada. ${quotationFeedback(problem)} Não registre o sinal novamente.`;
      setReservationMessage(message);
      return message;
    } finally {
      reservationBusy.current = false;
      setReserving(false);
    }
  }
  function openStep(element: HTMLDetailsElement | null) {
    if (!element) return;
    for (const panel of [
      closing.current,
      preparation.current,
      custody.current,
    ]) {
      if (panel && panel !== element) panel.open = false;
    }
    element.open = true;
    element.querySelector('summary')?.focus();
  }
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void quotationRequest<Quotation[]>(
      `/${record.id}/versions`,
      undefined,
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) setVersions(value);
      })
      .catch((problem: unknown) => {
        if (!controller.signal.aborted) setError(quotationFeedback(problem));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [record.id]);
  async function consult() {
    setLoading(true);
    setError('');
    try {
      const latest = await quotationRequest<Quotation>(
        `/${record.id}${selected.version === selected.current_version ? '' : `/versions/${selected.version}`}`,
      );
      setChanged(
        JSON.stringify(latest.capacity) !== JSON.stringify(selected.capacity),
      );
      setSelected(latest);
      if (
        latest.rental?.state === 'out' ||
        latest.rental?.state === 'completed'
      )
        setActiveStep('custody');
      setVersions(
        await quotationRequest<Quotation[]>(`/${record.id}/versions`),
      );
    } catch (problem) {
      setError(quotationFeedback(problem));
    } finally {
      setLoading(false);
    }
  }
  return (
    <section
      className="catalog-panel quotation-detail"
      data-quotation-version={selected.version}
      aria-labelledby="quotation-detail-title"
    >
      <div className="catalog-panel-heading">
        <div>
          <span className="section-kicker">LOCAÇÃO</span>
          <h2 id="quotation-detail-title" tabIndex={-1} ref={heading}>
            Detalhes da locação
          </h2>
        </div>
        <div className="catalog-actions">
          <button className="auth-retry" onClick={onClose}>
            Voltar ao cliente
          </button>
          <button
            className="auth-button"
            onClick={() => {
              setActiveStep(nextStep);
              openStep(
                nextStep === 'payment'
                  ? closing.current
                  : nextStep === 'preparation'
                    ? preparation.current
                    : custody.current,
              );
            }}
          >
            {selected.rental?.state === 'confirmed'
              ? prepared
                ? 'Confirmar retirada'
                : 'Separar itens'
              : selected.rental?.state === 'out'
                ? 'Registrar devolução'
                : selected.rental && selected.rental.state !== 'review'
                  ? 'Ver pagamentos'
                  : 'Registrar sinal e reservar'}
          </button>
        </div>
      </div>
      <p>
        <Link to={customerLink(record.customer_id)}>
          Ver cadastro do cliente
        </Link>{' '}
        · <Link to={quotationLink(record.id)}>Link desta locação</Link>
      </p>
      {selected.rental && (
        <p className="quotation-state">
          {rentalStateLabel[selected.rental.state]}
        </p>
      )}
      {selected.rental?.inventory_pending && (
        <p role="status" className="auth-feedback operational-warning">
          Há uma pendência de estoque. Confira antes de prometer a retirada.
        </p>
      )}
      <dl className="catalog-attributes">
        {Object.entries(dateLabels)
          .filter(([key]) => key !== 'valid_until')
          .map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>
                {selected[key as keyof typeof dateLabels]
                  .split('-')
                  .reverse()
                  .join('/')}
              </dd>
            </div>
          ))}
      </dl>
      <details className="quotation-secondary">
        <summary>Horários combinados</summary>
        <dl className="catalog-attributes">
          {(['pickup_time', 'event_time', 'return_time'] as const)
            .filter((key) => selected[key])
            .map((key, index) => (
              <div key={key}>
                <dt>
                  {
                    [
                      'Horário da retirada',
                      'Horário do evento',
                      'Horário da devolução',
                    ][index]
                  }
                </dt>
                <dd>{selected[key] ?? 'Não informado'}</dd>
              </div>
            ))}
        </dl>
      </details>
      <h3>Itens da locação</h3>
      <ul className="quotation-capacity" aria-label="Itens da locação">
        {selected.lines.map((line) => (
          <li key={line.id}>
            <strong>{line.name}</strong>
            <span>
              {line.quantity} × {priceLabel(line.unit_price)}
            </span>
            {line.kind === 'kit' && (
              <details className="quotation-kit-items">
                <summary>Ver produtos do kit</summary>
                <ul>
                  {line.items.map((item) => (
                    <li key={item.product_id}>
                      {item.quantity} × {item.name}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {line.negotiation_reason && (
              <p>Negociação: {line.negotiation_reason}</p>
            )}
          </li>
        ))}
      </ul>
      {selected.discount && (
        <p>
          Desconto{' '}
          {selected.discount.kind === 'percent'
            ? `${selected.discount.value}%`
            : priceLabel(selected.discount.value)}{' '}
          · {selected.discount.reason ?? 'Sem desconto positivo'}
        </p>
      )}
      <OfferSummary
        offer={selected}
        showPaymentEstimate={!selected.rental}
        compact
      />
      <ol className="rental-journey" aria-label="Etapas da locação">
        {[
          {
            label: 'Pagamento',
            done: Boolean(reserved && financial?.deposit_validated),
            step: 'payment' as Step,
          },
          {
            label: 'Preparação',
            done:
              prepared ||
              selected.rental?.state === 'out' ||
              selected.rental?.state === 'completed',
            step: 'preparation' as Step,
          },
          {
            label: 'Retirada',
            done:
              selected.rental?.state === 'out' ||
              selected.rental?.state === 'completed',
            step: 'custody' as Step,
          },
          {
            label: 'Devolução',
            done: selected.rental?.state === 'completed',
            step: 'custody' as Step,
          },
        ].map(({ label, done, step }, index) => {
          return (
            <li key={label} className={done ? 'rental-journey--active' : ''}>
              <button
                className="rental-step-link"
                onClick={() => {
                  setActiveStep(step);
                  openStep(
                    step === 'payment'
                      ? closing.current
                      : step === 'preparation'
                        ? preparation.current
                        : custody.current,
                  );
                }}
              >
                <span aria-hidden="true">{done ? '✓' : index + 1}</span>
                {label}
                {done && <span className="sr-only"> concluído</span>}
              </button>
            </li>
          );
        })}
      </ol>
      {reservationMessage && (
        <div
          role={reservationUnknown ? 'alert' : 'status'}
          className="auth-feedback"
        >
          {reservationMessage}
          {reservationUnknown && (
            <button
              className="auth-retry"
              disabled={reserving}
              onClick={() => void reserveAfterPayment()}
            >
              Recuperar confirmação
            </button>
          )}
        </div>
      )}
      <details
        ref={closing}
        className="quotation-workflow"
        open={activeStep === 'payment'}
      >
        <summary>
          Pagamento{' '}
          <span className="workflow-status">
            {financial
              ? financial.fully_paid
                ? '✓ Quitado'
                : financial.deposit_validated
                  ? '✓ Sinal pago · restante pendente'
                  : 'Sinal pendente'
              : 'Consultando…'}
          </span>
        </summary>
        <FinancialSection
          compact
          onStateChange={setFinancial}
          quotationId={record.id}
          refreshVersion={financialRead}
          onReserve={
            !selected.rental || selected.rental.state === 'review'
              ? reserveAfterPayment
              : undefined
          }
          onNext={
            !selected.rental || selected.rental.state === 'review'
              ? () => {
                  void paymentRequest<Payments>(record.id, '')
                    .then((financial) => reserveAfterPayment(financial))
                    .catch(() =>
                      setReservationMessage(
                        'Não foi possível conferir o pagamento. Tente novamente, sem registrar outro sinal.',
                      ),
                    );
                }
              : undefined
          }
        />
      </details>
      <details
        ref={preparation}
        className="quotation-workflow"
        open={activeStep === 'preparation'}
      >
        <summary>
          Preparação{' '}
          <span className="workflow-status">
            {prepared ? '✓ Itens separados' : 'Separar itens'}
          </span>
        </summary>
        {selected.rental &&
        ['confirmed', 'out', 'completed'].includes(selected.rental.state) ? (
          <ChecklistSection
            key={`${selected.rental.id}:${selected.current_version}`}
            rentalId={selected.rental.id}
            onStateChange={onPrepared}
            onCompleted={onPreparationComplete}
          />
        ) : (
          <p>
            Registre o sinal para confirmar a reserva e iniciar a separação.
          </p>
        )}
      </details>
      <details
        ref={custody}
        onToggle={(event) => setCustodyOpen(event.currentTarget.open)}
        className="quotation-workflow"
        open={activeStep === 'custody'}
      >
        <summary>
          {selected.rental?.state === 'out' ||
          selected.rental?.state === 'completed'
            ? 'Devolução'
            : 'Retirada'}{' '}
          <span className="workflow-status">
            {selected.rental?.state === 'completed'
              ? '✓ Concluída'
              : selected.rental?.state === 'out'
                ? 'Conferir retorno dos itens'
                : 'Aguardando retirada'}
          </span>
        </summary>
        {reserved && selected.version === selected.current_version ? (
          <GuidedCustody
            active={custodyOpen}
            quotation={selected}
            prepared={prepared}
            onContract={() => openStep(contract.current)}
            onChanged={() => {
              void consult();
              setFinancialRead((version) => version + 1);
            }}
          />
        ) : (
          <p>A retirada fica disponível depois da confirmação da reserva.</p>
        )}
      </details>
      <details
        ref={contract}
        className="quotation-workflow quotation-workflow--secondary"
      >
        <summary>Contrato · gerar, baixar e conferir assinatura</summary>
        {selected.version === selected.current_version && (
          <ContractsSection
            key={`contracts:${record.id}:${selected.current_version}:${selected.rental?.version ?? 0}`}
            quotation={selected}
          />
        )}
      </details>
      <details className="quotation-workflow quotation-workflow--secondary">
        <summary>Mais opções · histórico e alterações</summary>
        <details className="quotation-secondary">
          <summary>
            {!selected.rental || selected.rental.state === 'review'
              ? 'Reservar com sinal já registrado'
              : 'Histórico da reserva'}
          </summary>
          <ConfirmationSection
            guided
            key={`${record.id}:${selected.current_version}:${selected.rental?.version ?? 0}`}
            quotation={selected}
            onConfirmed={() => void consult()}
            onFinancialRefresh={() =>
              setFinancialRead((version) => version + 1)
            }
          />
        </details>
        <details className="quotation-secondary">
          <summary>Alterações e cancelamento</summary>
          {!selected.rental && (
            <button className="auth-retry" onClick={onEdit}>
              Editar proposta
            </button>
          )}
          {selected.version === selected.current_version && (
            <RentalChanges
              key={`${record.id}:${selected.current_version}`}
              quotation={selected}
              onChanged={() => {
                void consult();
                setFinancialRead((version) => version + 1);
              }}
            />
          )}
        </details>
        <details className="quotation-secondary">
          <summary>Consulta de estoque e histórico</summary>
          <button
            className="auth-retry"
            disabled={loading}
            onClick={() => void consult()}
          >
            Reconsultar estoque cadastral
          </button>
          {changed && (
            <p role="status">
              O estoque cadastral mudou desde a última consulta. Os valores e a
              composição acordados foram preservados.
            </p>
          )}
          <section
            className="catalog-section"
            aria-labelledby="quotation-versions"
          >
            <h3 id="quotation-versions">Histórico de revisões</h3>
            {loading && <p role="status">Consultando revisões…</p>}
            {error && (
              <div role="alert" className="auth-feedback">
                {error}
                <button className="auth-retry" onClick={() => void consult()}>
                  Tentar novamente
                </button>
              </div>
            )}
            <ul className="catalog-history">
              {versions.map((version) => (
                <li key={version.version}>
                  <div>
                    <strong>
                      Revisão {version.version} · {priceLabel(version.total)}
                    </strong>
                    <button
                      className="auth-retry"
                      onClick={() => {
                        setSelected(version);
                        setChanged(false);
                      }}
                    >
                      Consultar revisão {version.version}
                    </button>
                  </div>
                  <p>
                    {version.reason ?? 'Proposta inicial'} ·{' '}
                    {version.expired ? 'Vencido' : 'Validade vigente'}
                  </p>
                  <time dateTime={version.revised_at}>
                    {new Date(version.revised_at).toLocaleString('pt-BR', {
                      timeZone: 'America/Sao_Paulo',
                    })}
                  </time>
                </li>
              ))}
            </ul>
          </section>
        </details>
      </details>
    </section>
  );
}
