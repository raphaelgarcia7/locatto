import { Link } from 'react-router';
import { customerLink } from '../customers/api';
import { quotationLink } from '../quotations/api';
import { rentalStateLabel } from '../rentals/api';
import { priceLabel } from '../catalog/api';
import { dateLabel, queueLabels } from './api';
import type { OperationPage } from './api';

export function OperationList({
  data,
  label,
  onPage,
}: {
  data: OperationPage;
  label: string;
  onPage: (page: number) => void;
}) {
  return (
    <section aria-label={label} className="operations-list">
      <div className="operations-list-heading">
        <h2 id="operations-list-title" tabIndex={-1}>
          {label}
        </h2>
        <p>
          {data.total} registro(s) · Página {data.page} de{' '}
          {Math.max(1, Math.ceil(data.total / data.page_size))}
        </p>
      </div>
      {data.items.length ? (
        <ul className="operations-rows">
          {data.items.map((row) => (
            <li key={`${row.rental_id}-${row.kind}`}>
              <div className="operations-row-heading">
                <div>
                  <span className="section-kicker">
                    {queueLabels[row.kind]}
                  </span>
                  <h3>{row.customer_display_name}</h3>
                </div>
                <span className="operations-state">
                  {rentalStateLabel[row.operational_state]}
                </span>
              </div>
              <dl>
                <div>
                  <dt>
                    {row.kind === 'pickup'
                      ? 'Retirada combinada'
                      : row.kind === 'return'
                        ? 'Retorno previsto atual'
                        : row.kind === 'overdue'
                          ? 'Prazo original vencido'
                          : 'Data planejada de referência'}
                  </dt>
                  <dd>
                    {dateLabel(row.date)} ·{' '}
                    {row.optional_time ?? 'Horário não informado'}
                  </dd>
                </div>
                <div>
                  <dt>Devolução combinada</dt>
                  <dd>{dateLabel(row.return_date)}</dd>
                </div>
                {row.current_return_forecast !== row.return_date && (
                  <div>
                    <dt>Nova previsão de retorno</dt>
                    <dd>
                      {dateLabel(row.current_return_forecast)} · Não libera
                      estoque
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Retirada real</dt>
                  <dd>
                    {row.actual_pickup_date
                      ? dateLabel(row.actual_pickup_date)
                      : 'Ainda não registrada'}
                  </dd>
                </div>
                <div>
                  <dt>Último recebimento real</dt>
                  <dd>
                    {row.last_actual_return_date
                      ? dateLabel(row.last_actual_return_date)
                      : 'Ainda não registrado'}
                  </dd>
                </div>
                <div>
                  <dt>Unidades ainda em uso</dt>
                  <dd>{row.outstanding_qty}</dd>
                </div>
                <div>
                  <dt>Ocorrências abertas</dt>
                  <dd>{row.occurrence_count}</dd>
                </div>
                <div>
                  <dt>Financeiro · dívida</dt>
                  <dd>
                    {priceLabel(row.financial_summary.operational_debt)}
                    {row.financial_summary.pending
                      ? ' · Pendente'
                      : ' · Sem pendência'}
                  </dd>
                </div>
              </dl>
              {row.financial_summary.requires_reconciliation && (
                <p className="operations-warning">
                  Conferência financeira pendente. Recebimento não aplicado:{' '}
                  {priceLabel(row.financial_summary.unallocated_received)}.
                </p>
              )}
              <div className="catalog-actions">
                <Link
                  className="auth-retry"
                  to={quotationLink(row.quotation_id)}
                >
                  Abrir locação
                </Link>
                <Link
                  className="catalog-back"
                  to={customerLink(row.customer_id)}
                >
                  Histórico do cliente
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="operations-empty" role="status">
          Nenhum registro nesta fila com os filtros selecionados.
        </p>
      )}
      <nav className="catalog-pagination" aria-label={`Paginação: ${label}`}>
        <button
          className="auth-retry"
          disabled={data.page === 1}
          onClick={() => onPage(data.page - 1)}
        >
          Página anterior
        </button>
        <button
          className="auth-retry"
          disabled={data.page * data.page_size >= data.total}
          onClick={() => onPage(data.page + 1)}
        >
          Próxima página
        </button>
      </nav>
    </section>
  );
}
