import type { RentalSummary } from '../rentals/api';

export type Queue = 'pickup' | 'return' | 'overdue' | 'debt' | 'occurrence';
export const queueLabels: Record<Queue, string> = {
  pickup: 'Retiradas do dia',
  return: 'Devoluções do dia',
  overdue: 'Atrasados',
  debt: 'Pendências financeiras',
  occurrence: 'Ocorrências abertas',
};
export type OperationRow = {
  rental_id: string;
  quotation_id: string;
  customer_id: string;
  customer_display_name: string;
  kind: Queue;
  date: string;
  optional_time: string | null;
  operational_state: RentalSummary['state'];
  financial_summary: {
    remaining: string;
    extra_agreed: string;
    operational_debt: string;
    unallocated_received: string;
    requires_reconciliation: boolean;
    pending: boolean;
  };
  occurrence_count: number;
  outstanding_qty: number;
  pickup_date: string;
  return_date: string;
  current_return_forecast: string;
  actual_pickup_date: string | null;
  last_actual_return_date: string | null;
};
export type OperationPage = {
  items: OperationRow[];
  total: number;
  page: number;
  page_size: number;
};
export type Day = {
  date: string;
  timezone: string;
  checked_at: string;
  queues: Record<Queue, OperationPage>;
};
export type Calendar = {
  month: string;
  timezone: string;
  checked_at: string;
  days: { date: string; pickup: number; returns: number }[];
};
export type Upcoming = OperationPage & {
  from_date: string;
  to_date: string;
  checked_at: string;
};
export type Filters = {
  operational_state: string;
  financial_pending: string;
  customer_id: string;
};

export async function operationRequest<T>(
  path: string,
  fields: Record<string, string | number>,
  signal?: AbortSignal,
): Promise<T> {
  const query = new URLSearchParams(
    Object.entries(fields)
      .filter(([, value]) => value !== '')
      .map(([key, value]) => [key, String(value)]),
  );
  const response = await fetch(`/api/operations/${path}?${query}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event('locatto-session-ended'));
    throw new Error(
      response.status === 422
        ? 'Confira as datas, o período de até 90 dias e os filtros.'
        : 'Não foi possível consultar a operação. Tente atualizar novamente.',
    );
  }
  return (await response.json()) as T;
}
export function localToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
export function dateLabel(value: string) {
  return value.split('-').reverse().join('/');
}
export function addDays(value: string, count: number) {
  const day = new Date(`${value}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + count);
  return day.toISOString().slice(0, 10);
}
