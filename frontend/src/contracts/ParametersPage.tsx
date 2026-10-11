import { useContext, useEffect, useRef, useState } from 'react';
import { AuthContext } from '../authContext';
import { AddressFields } from './AddressFields';
import {
  contractRequest,
  emptyAddress,
  feedback,
  readFeedback,
  unknownResult,
} from './api';
import type { Company } from './api';
import './contracts.css';

export function ParametersPage() {
  const { authenticated } = useContext(AuthContext);
  const [record, setRecord] = useState<Company | null>(null);
  const [form, setForm] = useState({
    name: '',
    identification: '',
    contact: '',
    address: emptyAddress,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [unknown, setUnknown] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const pending = useRef<{ path: string; body: object | FormData } | null>(
    null,
  );
  const logoInput = useRef<HTMLInputElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  function load(signal?: AbortSignal) {
    return contractRequest<Company>('/parameters', undefined, signal)
      .then((data) => {
        if (!signal?.aborted) {
          setRecord(data);
          setError('');
          setForm({
            name: data.name ?? '',
            identification: data.identification ?? '',
            contact: data.contact ?? '',
            address: data.address,
          });
        }
      })
      .catch((problem: unknown) => {
        if (!signal?.aborted) setError(readFeedback(problem));
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false);
      });
  }
  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [authenticated]);
  async function mutate(path: string, body: object | FormData) {
    pending.current ??= { path, body };
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await contractRequest<Company>(
        pending.current.path,
        pending.current.body,
      );
      setRecord(result);
      setUnknown(false);
      pending.current = null;
      setNotice('Parâmetros salvos. Contratos anteriores foram preservados.');
      setFile(null);
      if (logoInput.current) logoInput.current.value = '';
    } catch (problem) {
      setError(feedback(problem));
      const uncertain = unknownResult(problem);
      setUnknown(uncertain);
      if (!uncertain) pending.current = null;
    } finally {
      setBusy(false);
    }
  }
  async function refreshVersion() {
    setBusy(true);
    setError('');
    try {
      setRecord(await contractRequest<Company>('/parameters'));
      setNotice(
        'Revisão atualizada. Seus campos foram mantidos; confira antes de salvar.',
      );
    } catch (problem) {
      setError(readFeedback(problem));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="catalog-panel contract-panel"
      aria-labelledby="parameters-title"
    >
      <span className="section-kicker">MINHA LOCADORA</span>
      <h1 id="parameters-title">Parâmetros do sistema</h1>
      <p>
        Personalize os contratos com os dados da locadora. Você pode salvar aos
        poucos; complete os campos obrigatórios antes da emissão final.
      </p>
      {loading && <p role="status">Carregando parâmetros…</p>}
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
      {!record && !loading && (
        <button
          className="auth-retry"
          onClick={() => {
            setLoading(true);
            setError('');
            void load();
          }}
        >
          Tentar novamente
        </button>
      )}
      {record && (
        <>
          <p>
            Revisão {record.version} ·{' '}
            {record.pending.length
              ? `${record.pending.length} campos pendentes para contratos`
              : 'Dados da locadora completos'}
          </p>
          <button
            className="auth-retry"
            disabled={busy || unknown}
            onClick={() => void refreshVersion()}
          >
            Reconsultar revisão sem apagar campos
          </button>
          {record.version === 0 && (
            <p>Nenhum parâmetro cadastrado. A logo é opcional.</p>
          )}
          {unknown && (
            <button
              className="auth-button"
              disabled={busy}
              onClick={() =>
                pending.current &&
                void mutate(pending.current.path, pending.current.body)
              }
            >
              Repetir mesma operação
            </button>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void mutate('/parameters', {
                ...form,
                request_id: crypto.randomUUID(),
                expected_version: record.version,
              });
            }}
          >
            <fieldset disabled={busy || unknown}>
              <legend>Dados da locadora</legend>
              <div className="contract-grid">
                <label>
                  Nome da empresa
                  <input
                    value={form.name}
                    maxLength={200}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Identificação da locadora (CPF/CNPJ)
                  <input
                    value={form.identification}
                    maxLength={100}
                    onChange={(event) =>
                      setForm({ ...form, identification: event.target.value })
                    }
                  />
                </label>
                <label>
                  Contato
                  <input
                    value={form.contact}
                    maxLength={200}
                    onChange={(event) =>
                      setForm({ ...form, contact: event.target.value })
                    }
                  />
                </label>
              </div>
              <AddressFields
                prefix="Endereço da locadora"
                value={form.address}
                onChange={(address) => setForm({ ...form, address })}
              />
              <button className="auth-button" type="submit">
                {busy ? 'Salvando…' : 'Salvar parâmetros'}
              </button>
            </fieldset>
          </form>
          <section aria-labelledby="logo-title">
            <h2 id="logo-title">Logo opcional</h2>
            {record.logo ? (
              <img
                className="contract-logo"
                src={`/api/parameters/logo?v=${record.version}`}
                alt="Logo atual da locadora"
              />
            ) : (
              <p>Sem logo. Isso não impede a emissão do contrato.</p>
            )}
            <p>
              JPEG, PNG ou WebP, até 10 MiB. Contratos usam a imagem preservada
              na emissão.
            </p>
            <label>
              Selecionar logo
              <input
                ref={logoInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy || unknown}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <div className="catalog-actions">
              <button
                className="auth-button"
                disabled={!file || busy || unknown}
                onClick={() => {
                  if (!file) return;
                  const body = new FormData();
                  body.set('file', file);
                  body.set('request_id', crypto.randomUUID());
                  body.set('expected_version', String(record.version));
                  void mutate('/parameters/logo', body);
                }}
              >
                Guardar logo
              </button>
              {record.logo && (
                <button
                  className="auth-retry"
                  disabled={busy || unknown}
                  onClick={() =>
                    void mutate('/parameters/logo/removal', {
                      request_id: crypto.randomUUID(),
                      expected_version: record.version,
                      remove: true,
                    })
                  }
                >
                  Remover logo dos próximos contratos
                </button>
              )}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
