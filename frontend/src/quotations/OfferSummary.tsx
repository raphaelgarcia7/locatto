import { priceLabel } from '../catalog/api';
import type { Offer } from './api';

export function OfferSummary({
  offer,
  financialTerms,
  showPaymentEstimate = true,
  compact = false,
}: {
  offer: Offer;
  financialTerms?: { deposit: string; balance: string };
  showPaymentEstimate?: boolean;
  compact?: boolean;
}) {
  return (
    <section
      className="quotation-summary"
      aria-label="Prévia comercial do servidor"
    >
      <h3>Valores por locação</h3>
      <dl className="catalog-attributes">
        {(
          [
            ...(!compact || Number(offer.discount_amount) > 0
              ? [
                  ['Subtotal', offer.subtotal],
                  ['Desconto calculado', offer.discount_amount],
                ]
              : []),
            ['Total', offer.total],
            ...(showPaymentEstimate
              ? [
                  [
                    'Sinal previsto',
                    financialTerms?.deposit ?? offer.estimated_deposit,
                  ],
                  [
                    'Saldo previsto',
                    financialTerms?.balance ?? offer.estimated_balance,
                  ],
                ]
              : []),
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{priceLabel(value)}</dd>
          </div>
        ))}
      </dl>
      {!compact && (
        <p>
          {showPaymentEstimate
            ? 'Sinal e saldo são previsões comerciais; registrar e conciliar recebimentos são operações separadas.'
            : 'Consulte o sinal e o saldo vigentes no financeiro. Cancelar não renegocia valores; uma retomada exige revisão e conferência explícitas. O aumento de uma reserva confirmada vai ao saldo, sem complemento do sinal.'}
        </p>
      )}
      {!compact && (
        <p className="quotation-scope">
          Orçamento não reserva estoque. A consulta considera compromissos
          simultâneos no período; confirmar sempre faz nova checagem.
        </p>
      )}
      {compact && !showPaymentEstimate && (
        <p>
          Cancelar não renegocia valores. Consulte o sinal e o saldo vigentes no
          financeiro.
        </p>
      )}
      <details
        className="quotation-stock-details"
        open={compact ? undefined : true}
      >
        <summary>Disponibilidade dos produtos</summary>
        <ul className="quotation-capacity">
          {offer.capacity.map((item) => (
            <li key={item.product_id}>
              <strong>{item.name}</strong>
              <span>
                Necessários {item.demand} · Em condições de uso {item.apt}
              </span>
              <span>
                Disponível no período {item.available ?? item.apt} · pico
                comprometido {item.committed ?? 0}
              </span>
              <span
                className={
                  item.shortage
                    ? 'catalog-badge catalog-badge--warning'
                    : 'catalog-badge'
                }
              >
                {item.shortage
                  ? `Faltam ${item.shortage} · pendência comercial`
                  : 'Quantidade disponível'}
              </span>
            </li>
          ))}
        </ul>
        {offer.stock_pending && (
          <p role="status">
            Você pode salvar com esta pendência. Combine a solução com a equipe;
            não prometa disponibilidade.
          </p>
        )}
        <small>
          Consulta cadastral:{' '}
          {new Date(offer.capacity_checked_at).toLocaleString('pt-BR', {
            timeZone: 'America/Sao_Paulo',
          })}
          . Devolução inclui o dia previsto; planejamento a partir de{' '}
          {offer.planning_available_from}.
        </small>
      </details>
      {compact && offer.stock_pending && (
        <p role="status" className="auth-feedback">
          Faltam produtos para esta locação. Confira a disponibilidade antes de
          confirmar.
        </p>
      )}
    </section>
  );
}
