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

const resourceLabels = {
  company: 'dados da locadora',
  financial: 'pagamentos da locação',
  versions: 'contratos emitidos',
  state: 'situação da assinatura',
} as const;
type Resource = keyof typeof resourceLabels;
type ContractData = {
  company: Company;
  financial: Payments;
  versions: Contract[];
  state: SignatureState;
};

export function ContractsSection({ quotation }: { quotation: Quotation }) {
  const { authenticated } = useContext(AuthContext);
  const [company, setCompany] = useState<Company | null>(null);
  const [financial, setFinancial] = useState<Payments | null>(null);
  const [state, setState] = useState<SignatureState | null>(null);
  const [versions, setVersions] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<
    Partial<Record<Resource, string>>
  >({});
  const loadSequence = useRef(0);
  const previewPayload = useRef<object | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [unknown, setUnknown] = useState(false);
  const [actionsLocked, setActionsLocked] = useState(false);
  const [eventAddress, setEventAddress] = useState(emptyAddress);
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
    async (signal?: AbortSignal, only?: Resource) => {
      const sequence = ++loadSequence.current;
      setLoading(true);
      const paths: Record<Resource, string> = {
        company: '/parameters',
        financial: `/quotations/${quotation.id}/payments`,
        versions: `/quotations/${quotation.id}/contracts`,
        state: `/quotations/${quotation.id}/contracts/current-signature-state`,
      };
      const keys = only ? [only] : (Object.keys(paths) as Resource[]);
      const loaded: Partial<ContractData> = {};
      await Promise.all(
        keys.map(async (key) => {
          try {
            const result = await contractRequest<
              Company | Payments | Contract[] | SignatureState
            >(paths[key], undefined, signal);
            if (signal?.aborted || sequence !== loadSequence.current) return;
            if (key === 'company') {
              loaded.company = result as Company;
              setCompany(loaded.company);
            }
            if (key === 'financial') {
              loaded.financial = result as Payments;
              setFinancial(loaded.financial);
            }
            if (key === 'versions') {
              loaded.versions = result as Contract[];
              setVersions(loaded.versions);
            }
            if (key === 'state') {
              loaded.state = result as SignatureState;
              setState(loaded.state);
            }
            setLoadErrors((previous) => {
              const next = { ...previous };
              delete next[key];
              return next;
            });
          } catch (problem) {
            if (signal?.aborted || sequence !== loadSequence.current) return;
            if (key === 'company') setCompany(null);
            if (key === 'financial') setFinancial(null);
            if (key === 'versions') setVersions([]);
            if (key === 'state') setState(null);
            setLoadErrors((previous) => ({
              ...previous,
              [key]: readFeedback(problem),
            }));
          }
        }),
      );
      if (!signal?.aborted && sequence === loadSequence.current)
        setLoading(false);
      return !signal?.aborted && sequence === loadSequence.current
        ? loaded
        : undefined;
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
    previewPayload.current = null;
  }
  function payload(snapshot: ContractData) {
    return {
      expected_quotation_version: quotation.current_version,
      expected_financial_version: snapshot.financial.financial_version,
      expected_company_version: snapshot.company.version,
      expected_rental_version: snapshot.state.rental_version,
      expected_contract_version: snapshot.versions[0]?.current_version ?? 0,
      template_revision: 'pegue-e-monte-v0.4',
      event_address: eventAddress,
      items: products.map(([product_id]) => ({
        product_id,
      })),
    };
  }
  async function prepare() {
    if (
      loading ||
      busy ||
      actionsLocked ||
      unknown ||
      Object.keys(loadErrors).length ||
      !company ||
      !financial ||
      !state
    )
      return;
    setBusy(true);
    setError('');
    setNotice('');
    setConfirmed(false);
    setPreview(null);
    setPreviewUrl('');
    try {
      // Payment/company may have changed while this mounted section was closed.
      // Prepare from fresh responses, never from state captured before payment.
      const fresh = await load();
      if (
        !fresh?.company ||
        !fresh.financial ||
        !fresh.state ||
        !fresh.versions
      )
        return;
      const snapshot = payload(fresh as ContractData);
      const result = await contractRequest<Preview>(
        `/quotations/${quotation.id}/contracts/preview`,
        snapshot,
      );
      const bytes = Uint8Array.from(atob(result.document), (character) =>
        character.charCodeAt(0),
      );
      setPreviewUrl(
        URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })),
      );
      setPreview(result);
      previewPayload.current = snapshot;
    } catch (problem) {
      setError(readFeedback(problem));
    } finally {
      setBusy(false);
    }
  }
  async function issue() {
    if (busy || actionsLocked) return;
    if (
      !pending.current &&
      (!previewPayload.current ||
        !confirmed ||
        preview?.pending.length ||
        loading ||
        Object.keys(loadErrors).length)
    )
      return;
    pending.current ??= {
      ...previewPayload.current,
      request_id: crypto.randomUUID(),
    };
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
      <h3 id="contracts-title">Contratos</h3>
      <p>Confira os dados, visualize o documento e emita para assinatura.</p>
      {loading && <p role="status">Carregando contratos e versões…</p>}
      {error && (
        <p role="alert" className="auth-feedback">
          {error}
        </p>
      )}
      {(Object.entries(loadErrors) as [Resource, string][]).map(
        ([key, message]) => (
          <div key={key} className="auth-feedback" role="alert">
            <p>
              Não foi possível carregar {resourceLabels[key]}. {message}
            </p>
            <button
              className="auth-retry"
              disabled={loading || busy || unknown || actionsLocked}
              onClick={() => {
                invalidate();
                void load(undefined, key);
              }}
            >
              Tentar novamente: {resourceLabels[key]}
            </button>
          </div>
        ),
      )}
      {notice && (
        <p role="status" ref={noticeRef} tabIndex={-1}>
          {notice}
        </p>
      )}
      <button
        className="auth-retry"
        disabled={loading || busy || unknown || actionsLocked}
        onClick={() => {
          invalidate();
          setLoading(true);
          setError('');
          void load();
        }}
      >
        Atualizar dados do contrato
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
      {!loading && company?.pending.length ? (
        <p className="auth-feedback">
          Complete os dados da locadora para emitir.{' '}
          <Link to="/parametros">Completar cadastro da locadora</Link>
        </p>
      ) : null}
      <details className="contract-secondary">
        <summary>Cadastros e opções</summary>
        <p>
          <Link to="/parametros">Configurar locadora e logo</Link> ·{' '}
          <Link to={customerLink(quotation.customer_id)}>
            Completar documentos do cliente
          </Link>
        </p>
      </details>
      {versions[0] && !loadErrors.versions && (
        <div className="contract-current">
          <h4>Contrato atual</h4>
          <a
            className="auth-button"
            href={`/api${contractPath(versions[0])}/download`}
          >
            Baixar PDF do contrato
          </a>
          <ContractActions
            compact
            disabled={loading || Object.keys(loadErrors).length > 0}
            onLockChange={setActionsLocked}
            record={versions[0]}
            currentVersion={versions[0].current_version}
            onChanged={async () => {
              await load();
            }}
          />
        </div>
      )}
      <>
        <details className="contract-editor" open={!versions.length}>
          <summary>
            {versions.length
              ? 'Gerar nova versão do contrato'
              : 'Dados para o contrato'}
          </summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void prepare();
            }}
          >
            <fieldset
              disabled={
                busy ||
                actionsLocked ||
                unknown ||
                loading ||
                !company ||
                !financial ||
                !state ||
                Object.keys(loadErrors).length > 0
              }
            >
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
                Cliente, itens, fotos, datas e valores vêm dos cadastros.
                Preencha os dados específicos deste evento.
              </p>
              <button className="auth-button" type="submit">
                {busy ? 'Preparando documento…' : 'Visualizar contrato'}
              </button>
            </fieldset>
          </form>
        </details>
        {preview && (
          <div className="contract-pending">
            <h4>Prévia do contrato</h4>
            <a href={previewUrl} download={`rascunho-v${preview.number}.pdf`}>
              Baixar prévia em rascunho
            </a>
            {preview.pending.length ? (
              <>
                <p>Resolva as pendências para emitir:</p>
                <ul>
                  {preview.pending.map((item) => (
                    <li key={item.field}>
                      {item.message}{' '}
                      {item.field.startsWith('company') ? (
                        <Link to="/parametros">
                          Corrigir cadastro da locadora
                        </Link>
                      ) : item.field.startsWith('customer') ? (
                        <Link to={customerLink(quotation.customer_id)}>
                          Corrigir cadastro do cliente
                        </Link>
                      ) : item.field.startsWith('items') &&
                        item.field.includes('condition') ? (
                        <button
                          className="auth-retry"
                          onClick={() => {
                            const product = products.find(([id]) =>
                              item.field.includes(id),
                            );
                            const textarea = document.getElementById(
                              `contract-condition-${product?.[0]}`,
                            );
                            if (textarea) {
                              const details = textarea.closest('details');
                              if (details) details.open = true;
                              const editor = textarea.closest(
                                '.contract-editor',
                              ) as HTMLDetailsElement | null;
                              if (editor) editor.open = true;
                              textarea.focus();
                            }
                          }}
                        >
                          Preencher condição do item
                        </button>
                      ) : item.field.startsWith('items') ? (
                        <Link to="/catalogo">
                          Ver fotos e cadastro do produto
                        </Link>
                      ) : null}
                    </li>
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
              <details className="contract-secondary">
                <summary>Mudanças em relação ao contrato anterior</summary>
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
              </details>
            )}
            <label className="contract-checkbox">
              <input
                type="checkbox"
                disabled={
                  busy ||
                  unknown ||
                  actionsLocked ||
                  loading ||
                  Object.keys(loadErrors).length > 0 ||
                  preview.pending.length > 0
                }
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              Conferi esta prévia e confirmo a emissão final
            </label>
            <button
              className="auth-button"
              disabled={
                !confirmed ||
                busy ||
                unknown ||
                actionsLocked ||
                loading ||
                Object.keys(loadErrors).length > 0 ||
                preview.pending.length > 0
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
        <details className="contract-secondary" open={versions.length === 0}>
          <summary>Contratos emitidos e histórico</summary>
          {!versions.length && !loading && !loadErrors.versions && (
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
                <details>
                  <summary>Detalhes técnicos e autoria</summary>
                  <p>
                    Comercial v{record.quotation_version} · financeira v
                    {record.financial_version} · locadora v
                    {record.company_version}
                  </p>
                  <details>
                    <summary>Autoria e instante da emissão</summary>
                    <p>{new Date(record.created_at).toLocaleString('pt-BR')}</p>
                  </details>
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
                          {new Date(event.created_at).toLocaleString('pt-BR')}
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
                {record.number !== versions[0].number && (
                  <ContractActions
                    record={record}
                    currentVersion={versions[0].current_version}
                    onChanged={async () => {
                      await load();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </details>
      </>
    </section>
  );
}
