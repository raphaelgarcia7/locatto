export type Address = {
  postal_code: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
};
export const emptyAddress: Address = {
  postal_code: null,
  street: null,
  number: null,
  complement: null,
  neighborhood: null,
  city: null,
  state: null,
};
export const addressLabels: Record<keyof Address, string> = {
  postal_code: 'CEP',
  street: 'Rua',
  number: 'Número',
  complement: 'Complemento (opcional)',
  neighborhood: 'Bairro',
  city: 'Cidade',
  state: 'UF',
};
export type Company = {
  version: number;
  name: string | null;
  identification: string | null;
  contact: string | null;
  address: Address;
  logo: { id: string } | null;
  pending: string[];
};
export type ContractEvent = {
  id: string;
  kind: 'delivery' | 'signature_upload' | 'signature_validation';
  data: {
    method?: string;
    business_date?: string;
    signed_date?: string;
    declaration?: string;
    reason?: string;
    attachment_id?: string;
  };
  actor_id: string;
  created_at: string;
};
export type Contract = {
  contract_id: string;
  quotation_id: string;
  number: number;
  current_version: number;
  quotation_version: number;
  financial_version: number;
  rental_version: number;
  company_version: number;
  template_revision: string;
  pdf_sha256: string;
  signature_state: 'pending' | 'awaiting_review' | 'signed';
  delivered: boolean;
  actor_id: string;
  created_at: string;
  events: ContractEvent[];
  differences: { field: string; before: unknown; after: unknown }[];
};
export type SignatureState = {
  quotation_version: number;
  rental_version: number;
  contract: Contract | null;
  matches_current_business: boolean;
  ready_for_pickup: boolean;
};
export type Preview = {
  pending: { field: string; message: string }[];
  differences: Contract['differences'];
  document: string;
  state: 'draft';
  number: number;
};
export class ContractError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export async function contractRequest<T>(
  path: string,
  body?: object | FormData,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers:
      body && !(body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : undefined,
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event('locatto-session-ended'));
    const data = (await response.json().catch(() => ({}))) as {
      detail?: string;
    };
    throw new ContractError(
      response.status,
      typeof data.detail === 'string'
        ? data.detail
        : 'Confira os campos obrigatórios. Seus campos foram mantidos.',
    );
  }
  return (await response.json()) as T;
}
export function feedback(error: unknown) {
  if (error instanceof ContractError && error.status < 500)
    return error.message;
  return 'Resultado desconhecido. Repita a mesma operação para consultar sua chave, sem duplicar o registro.';
}
export const unknownResult = (error: unknown) =>
  !(error instanceof ContractError) || error.status >= 500;
export const readFeedback = (error: unknown) =>
  error instanceof ContractError && error.status < 500
    ? error.message
    : 'Não foi possível carregar os dados. Tente novamente; seus campos foram mantidos.';
export const contractPath = (record: Contract) =>
  `/contracts/${record.contract_id}/versions/${record.number}`;
export const contractEventDate = (event: Contract['events'][number]) =>
  event.data.business_date ??
  event.data.signed_date ??
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(event.created_at),
  );
