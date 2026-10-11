import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AuthContext } from '../authContext';
import { Link } from 'react-router';
import { customerLink } from '../customers/api';
import type { Quotation } from '../quotations/api';
import type { Payments } from '../payments/api';
import { AddressFields } from './AddressFields';
import { ContractActions } from './ContractActions';
import {
  contractPath,
  contractEventDate,
  contractRequest,
  emptyAddress,
  feedback,
  readFeedback,
  unknownResult,
} from './api';
import type { Company, Contract, Preview, SignatureState } from './api';
import './contracts.css';

export function ContractsSection({ quotation }: { quotation: Quotation }) {
  const { authenticated } = useContext(AuthContext);
  const [company, setCompany] = useState<Company | null>(null);
  const [financial, setFinancial] = useState<Payments | null>(null);
  const [state, setState] = useState<SignatureState | null>(null);
  const [versions, setVersions] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [unknown, setUnknown] = useState(false);
  const [eventAddress, setEventAddress] = useState(emptyAddress);
  const [conditions, setConditions] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const pending = useRef<object | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);
  const [previewUrl, setPreviewUrl] = useState('');
  const products = useMemo(() => {
    const result = new Map<string, { name: string; quantity: number }>();
    for (const line of quotation.lines)
      for (const item of line.items) {
        const previous = result.get(item.product_id);
        result.set(item.product_id, {
          name: item.name,
          quantity: (previous?.quantity ?? 0) + item.quantity * line.quantity,
        });
      }
    return [...result.entries()];
  }, [quotation.lines]);
  const load = useCallback(
    (signal?: AbortSignal) => {
      return Promise.all([
        contractRequest<Company>('/parameters', undefined, signal),
        contractRequest<Payments>(
          `/quotations/${quotation.id}/payments`,
          undefined,
          signal,
        ),
        contractRequest<Contract[]>(
          `/quotations/${quotation.id}/contracts`,
          undefined,
          signal,
        ),
        contractRequest<SignatureState>(
          `/quotations/${quotation.id}/contracts/current-signature-state`,
          undefined,
          signal,
        ),
      ])
        .then(([parameters, money, history, signature]) => {
          if (!signal?.aborted) {
            setCompany(parameters);
            setError('');
            setFinancial(money);
            setVersions(history);
            setState(signature);
          }
        })
        .catch((problem: unknown) => {
          if (!signal?.aborted) setError(readFeedback(problem));
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        });
    },
    [quotation.id],
  );
  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, authenticated]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);
  function invalidate() {
    setPreview(null);
    setPreviewUrl('');
    setConfirmed(false);
  }
  function payload() {
    return {
      expected_quotation_version: quotation.current_version,
      expected_financial_version: financial?.financial_version ?? 0,
      expected_company_version: company?.version ?? 0,
      expected_rental_version: state?.rental_version ?? 0,
      expected_contract_version: versions[0]?.current_version ?? 0,
      template_revision: 'pegue-e-monte-v0.4',
      event_address: eventAddress,
      items: products.map(([product_id]) => ({
        product_id,
        condition: conditions[product_id] ?? null,
      })),
    };
  }
  async function prepare() {
    setBusy(true);
    setError('');
    setNotice('');
    setConfirmed(false);
    try {
      const result = await contractRequest<Preview>(
        `/quotations/${quotation.id}/contracts/preview`,
        payload(),
      );
      const bytes = Uint8Array.from(atob(result.document), (character) =>
        character.charCodeAt(0),
      );
      setPreviewUrl(
        URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })),
      );
      setPreview(result);
    } catch (problem) {
      setError(readFeedback(problem));
    } finally {
      setBusy(false);
    }
  }
  async function issue() {
    pending.current ??= { ...payload(), request_id: crypto.randomUUID() };
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await contractRequest<Contract>(
        `/quotations/${quotation.id}/contracts`,
        pending.current,
      );
      pending.current = null;
      setUnknown(false);
      invalidate();
      setNotice(
        'Contrato emitido. Consulte abaixo a entrega e a assinatura desta versão.',
      );
      await load();
    } catch (problem) {
      const uncertain = unknownResult(problem);
      setUnknown(uncertain);
      setError(feedback(problem));
      if (!uncertain) {
        pending.current = null;
        invalidate();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="contract-panel" aria-labelledby="contracts-title">
      <span className="section-kicker">DOCUMENTOS PRIVADOS</span>
      <h3 id="contracts-title">Contratos</h3>
      <p>
        Prepare a versão Pegue e Monte para assinatura fora do sistema. Emissão,
        entrega e assinatura não confirmam reserva nem movimentam dinheiro ou
        estoque.
      </p>
      <p>
        <Link to="/parametros">Configurar locadora e logo</Link> ·{' '}
        <Link to={customerLink(quotation.customer_id)}>
          Completar documentos do cliente
        </Link>
      </p>
      {loading && <p role="status">Carregando contratos e versões…</p>}
      {error && (
        <p role="alert" className="auth-feedback">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" ref={noticeRef} tabIndex={-1}>
          {notice}
        </p>
      )}
      <button
        className="auth-retry"
        disabled={loading || busy || unknown}
        onClick={() => {
          invalidate();
          setLoading(true);
          setError('');
          void load();
        }}
      >
        Reconsultar contratos e parâmetros
      </button>
      {state && (
        <p className="contract-status">
          {state.ready_for_pickup
            ? 'Assinatura vigente registrada pela equipe.'
            : state.contract && !state.matches_current_business
              ? 'Contrato desatualizado: emita nova versão e registre nova assinatura.'
              : state.contract?.signature_state === 'awaiting_review'
                ? 'Anexo recebido, aguardando conferência manual.'
                : 'Assinatura vigente pendente.'}
        </p>
      )}
      {company && financial && state && (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void prepare();
            }}
          >
            <fieldset disabled={busy || unknown || loading}>
              <legend>Preparar contrato</legend>
              <AddressFields
                prefix="Endereço do evento"
                value={eventAddress}
                onChange={(value) => {
                  setEventAddress(value);
                  invalidate();
                }}
              />
              <p>
                Fotos dos produtos são selecionadas do catálogo, priorizando a
                foto principal. Todos os componentes e avulsos estão abaixo.
              </p>
              {products.map(([id, item]) => (
                <label key={id}>
                  {item.quantity} × {item.name} — condição na saída
                  <textarea
                    maxLength={1000}
                    value={conditions[id] ?? ''}
                    onChange={(event) => {
                      setConditions({
                        ...conditions,
                        [id]: event.target.value,
                      });
                      invalidate();
                    }}
                  />
                </label>
              ))}
              <button className="auth-button" type="submit">
                {busy ? 'Compondo…' : 'Preparar prévia do contrato'}
              </button>
            </fieldset>
          </form>
          {preview && (
            <div className="contract-pending">
              <h4>Prévia em rascunho · versão {preview.number}</h4>
              <a href={previewUrl} download={`rascunho-v${preview.number}.pdf`}>
                Baixar prévia em rascunho
              </a>
              {preview.pending.length ? (
                <>
                  <p>Resolva as pendências para emitir:</p>
                  <ul>
                    {preview.pending.map((item) => (
                      <li key={item.field}>{item.message}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>
                  Dados completos para emissão final. Confira o PDF antes de
                  confirmar.
                </p>
              )}
              {preview.differences.length > 0 && (
                <>
                  <p>Mudanças em relação à versão anterior:</p>
                  <ul>
                    {preview.differences.map((item) => (
                      <li key={item.field}>
                        {item.field}
                        <details>
                          <summary>Comparar valores</summary>
                          <pre>
                            {JSON.stringify(
                              { antes: item.before, depois: item.after },
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <label className="contract-checkbox">
                <input
                  type="checkbox"
                  disabled={busy || unknown || preview.pending.length > 0}
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                Conferi esta prévia e confirmo a emissão final
              </label>
              <button
                className="auth-button"
                disabled={
                  !confirmed || busy || unknown || preview.pending.length > 0
                }
                onClick={() => void issue()}
              >
                Emitir contrato final
              </button>
            </div>
          )}
          {unknown && (
            <button
              className="auth-button"
              disabled={busy}
              onClick={() => void issue()}
            >
              Repetir mesma emissão
            </button>
          )}
          <h4>Histórico de contratos</h4>
          {!versions.length && !loading && (
            <p>
              Nenhum contrato emitido. Você pode preparar o documento antes do
              pagamento do sinal.
            </p>
          )}
          <ul className="contract-history">
            {versions.map((record) => (
              <li key={record.number}>
                <h4>
                  Contrato v{record.number}
                  {record.number === record.current_version
                    ? ' · versão vigente'
                    : ' · versão anterior'}
                </h4>
                <p>
                  Emitido ·{' '}
                  {record.delivered ? 'Entrega registrada' : 'Entrega pendente'}{' '}
                  ·{' '}
                  {record.signature_state === 'signed'
                    ? 'Assinatura conferida'
                    : record.signature_state === 'awaiting_review'
                      ? 'Anexo aguardando conferência'
                      : 'Assinatura pendente'}
                </p>
                <p>
                  Comercial v{record.quotation_version} · financeira v
                  {record.financial_version} · locadora v
                  {record.company_version}
                </p>
                <details>
                  <summary>Autoria e instante da emissão</summary>
                  <p>
                    {record.actor_id} · {record.created_at}
                  </p>
                </details>
                <a href={`/api${contractPath(record)}/download`}>
                  Baixar PDF v{record.number}
                </a>
                {record.differences.length > 0 && (
                  <p>
                    Campos alterados:{' '}
                    {record.differences.map((item) => item.field).join(', ')}
                  </p>
                )}
                <ul>
                  {record.events.map((event) => (
                    <li key={event.id}>
                      {event.kind === 'delivery'
                        ? 'Entrega registrada'
                        : event.kind === 'signature_upload'
                          ? 'Anexo recebido'
                          : 'Conferência manual'}{' '}
                      · {contractEventDate(event)}
                      <details>
                        <summary>Detalhes do registro</summary>
                        <p>
                          {event.actor_id} · {event.created_at}
                        </p>
                        {event.data.method && <p>Meio: {event.data.method}</p>}
                        {event.data.reason && <p>{event.data.reason}</p>}
                        {event.data.declaration && (
                          <p>{event.data.declaration}</p>
                        )}
                      </details>
                      {event.kind === 'signature_upload' && (
                        <>
                          {' '}
                          ·{' '}
                          <a
                            href={`/api${contractPath(record)}/signatures/${event.id}/download`}
                          >
                            Baixar anexo da versão {record.number}
                          </a>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                <ContractActions
                  record={record}
                  currentVersion={versions[0].current_version}
                  onChanged={() => load()}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
