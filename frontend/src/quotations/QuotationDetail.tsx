import { useEffect, useRef, useState } from 'react';
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
import { CustodySection } from '../rentals/CustodySection';
import { rentalStateLabel } from '../rentals/api';
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
  const heading = useRef<HTMLHeadingElement>(null);
  const closing = useRef<HTMLDetailsElement>(null);
  const contract = useRef<HTMLDetailsElement>(null);
  function openStep(element: HTMLDetailsElement | null) {
    if (!element) return;
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
            Voltar à lista
          </button>
          <button
            className="auth-button"
            onClick={() =>
              openStep(
                selected.rental?.state === 'confirmed'
                  ? contract.current
                  : closing.current,
              )
            }
          >
            {selected.rental?.state === 'confirmed'
              ? 'Ver contrato'
              : 'Pagamento e confirmação'}
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
        <p role="status" className="auth-feedback">
          Há uma pendência de estoque. Confira antes de prometer a retirada.
        </p>
      )}
      {selected.rental?.financial_pending && (
        <p role="status" className="auth-feedback">
          Há uma pendência financeira. Confira o pagamento desta locação.
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
      <p className="quotation-flow-note">
        Confirme o pagamento e a reserva, gere o contrato e registre a retirada
        após a assinatura.
      </p>
      <details ref={closing} className="quotation-workflow">
        <summary>1. Pagamento e confirmação</summary>
        <FinancialSection
          compact
          quotationId={record.id}
          refreshVersion={financialRead}
          onNext={
            !selected.rental || selected.rental.state === 'review'
              ? () => {
                  document.getElementById('rental-confirmation-title')?.focus();
                  document.getElementById('prepare-reservation')?.click();
                }
              : undefined
          }
        />
        <ConfirmationSection
          guided
          key={`${record.id}:${selected.current_version}:${selected.rental?.version ?? 0}`}
          quotation={selected}
          onConfirmed={() => void consult()}
          onFinancialRefresh={() => setFinancialRead((version) => version + 1)}
        />
      </details>
      <details ref={contract} className="quotation-workflow">
        <summary>2. Contrato</summary>
        {selected.version === selected.current_version && (
          <ContractsSection
            key={`contracts:${record.id}:${selected.current_version}:${selected.rental?.version ?? 0}`}
            quotation={selected}
          />
        )}
      </details>
      <details className="quotation-workflow">
        <summary>3. Retirada e devolução</summary>
        {selected.version === selected.current_version && (
          <CustodySection
            quotation={selected}
            onChanged={() => {
              void consult();
              setFinancialRead((version) => version + 1);
            }}
          />
        )}
      </details>
      <details className="quotation-workflow quotation-workflow--secondary">
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
      <details className="quotation-workflow quotation-workflow--secondary">
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
    </section>
  );
}
