import { priceLabel } from '../catalog/api';
import type { Payments } from './api';
import type { PaymentGoal } from './paymentSuggestions';

export function GuidedPayment({
  data,
  disabled,
  onReceive,
  onNext,
  onReview,
  reserveWithDeposit = false,
  editing = false,
}: {
  data: Payments;
  disabled: boolean;
  onReceive: (goal: PaymentGoal) => void;
  onNext?: () => void;
  onReview: () => void;
  reserveWithDeposit?: boolean;
  editing?: boolean;
}) {
  const unpaid =
    BigInt(data.total.replace('.', '')) -
    BigInt(data.net_received.replace('.', ''));
  const outstanding = unpaid > 0n ? unpaid : 0n;
  const outstandingAmount = `${outstanding / 100n}.${String(outstanding % 100n).padStart(2, '0')}`;
  return (
    <div className="payment-guide">
      <h4>Resumo do pagamento</h4>
      <dl className="payment-guide-totals">
        <div>
          <dt>Total da locação</dt>
          <dd>{priceLabel(data.total)}</dd>
        </div>
        <div>
          <dt>Pago</dt>
          <dd>{priceLabel(data.net_received)}</dd>
        </div>
        <div>
          <dt>Falta pagar</dt>
          <dd>{priceLabel(outstandingAmount)}</dd>
        </div>
      </dl>
      <p
        className={
          data.fully_paid
            ? 'payment-status payment-status--paid'
            : 'payment-status'
        }
      >
        {data.fully_paid
          ? 'Pagamento quitado.'
          : data.deposit_validated
            ? onNext
              ? 'Sinal recebido. Confirme a reserva para garantir os itens.'
              : 'Sinal recebido. Registre o restante quando o cliente pagar.'
            : `Para reservar, o sinal é de ${priceLabel(data.estimated_deposit)}.`}
      </p>
      {data.pending !== '0.00' && data.pending !== data.excess && (
        <p role="status">
          Há {priceLabel(data.pending)} já recebido(s) para conferir. Não
          registre esse dinheiro novamente.
        </p>
      )}
      {data.excess !== '0.00' && (
        <p role="status">
          Excedente de {priceLabel(data.excess)} para decisão da equipe, sem
          devolução automática.
        </p>
      )}
      <div className="catalog-actions">
        {!editing && !data.fully_paid && outstanding > 0n && (
          <button
            className="auth-button"
            disabled={disabled}
            onClick={() =>
              onReceive(data.deposit_validated ? 'balance' : 'deposit')
            }
          >
            {data.deposit_validated
              ? 'Registrar restante'
              : reserveWithDeposit
                ? 'Registrar sinal e reservar'
                : 'Registrar pagamento'}
          </button>
        )}
        {!editing && data.deposit_validated && onNext && (
          <button className="auth-button" disabled={disabled} onClick={onNext}>
            Confirmar reserva
          </button>
        )}
        {(data.pending !== '0.00' ||
          data.commercial_version_pending ||
          data.requires_reconciliation) && (
          <button className="auth-retry" disabled={disabled} onClick={onReview}>
            Conferir pagamento existente
          </button>
        )}
      </div>
    </div>
  );
}
