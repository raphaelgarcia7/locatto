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
  const outstanding = BigInt(data.remaining.replace('.', ''));
  const canReceive =
    BigInt(data.net_received.replace('.', '')) <
    BigInt(data.total.replace('.', ''));
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
          <dd>{priceLabel(data.remaining)}</dd>
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
            : reserveWithDeposit
              ? 'Marque o sinal como pago após receber. Vamos conferir o estoque e confirmar a reserva.'
              : `Sinal previsto: ${priceLabel(data.estimated_deposit)}.`}
      </p>
      {data.pending !== '0.00' && data.pending !== data.excess && (
        <p role="status" className="operational-warning">
          Há {priceLabel(data.pending)} já recebido(s) para conferir. Não
          registre esse dinheiro novamente.
        </p>
      )}
      {data.excess !== '0.00' && (
        <p role="status" className="operational-warning">
          Excedente de {priceLabel(data.excess)} para decisão da equipe, sem
          devolução automática.
        </p>
      )}
      <div className="payment-milestones">
        <div
          className={
            data.deposit_validated
              ? 'payment-milestone payment-milestone--done'
              : 'payment-milestone'
          }
        >
          <strong>Sinal · {priceLabel(data.estimated_deposit)}</strong>
          <span>
            {data.deposit_validated ? '✓ Sinal pago' : 'Aguardando pagamento'}
          </span>
          {!editing &&
            canReceive &&
            !data.deposit_validated &&
            !data.fully_paid && (
              <button
                className="auth-button"
                disabled={disabled}
                onClick={() => onReceive('deposit')}
              >
                Sinal pago
              </button>
            )}
        </div>
        <div
          className={
            data.fully_paid
              ? 'payment-milestone payment-milestone--done'
              : 'payment-milestone'
          }
        >
          <strong>Restante</strong>
          <span>
            {data.fully_paid
              ? '✓ Restante pago'
              : data.deposit_validated
                ? `Pendente · ${priceLabel(data.remaining)}`
                : `Após o sinal · ${priceLabel(data.balance_remaining)}`}
          </span>
          {!editing &&
            data.deposit_validated &&
            canReceive &&
            !data.fully_paid &&
            outstanding > 0n && (
              <button
                className="auth-button"
                disabled={disabled}
                onClick={() => onReceive('balance')}
              >
                Restante pago
              </button>
            )}
        </div>
      </div>
      {!data.fully_paid && outstanding > 0n && (
        <p className="payment-due">
          Pendência financeira: {priceLabel(data.remaining)}. Registre somente
          quando o cliente pagar.
        </p>
      )}
      <div className="catalog-actions">
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
