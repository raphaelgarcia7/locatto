import { useEffect, useRef, useState } from 'react';
import { businessToday } from '../payments/api';
import { contractPath, contractRequest, feedback, unknownResult } from './api';
import type { Contract } from './api';

export function ContractActions({
  record,
  currentVersion,
  onChanged,
  compact = false,
  disabled = false,
  onLockChange,
}: {
  record: Contract;
  currentVersion: number;
  onChanged: () => Promise<void>;
  compact?: boolean;
  disabled?: boolean;
  onLockChange?: (locked: boolean) => void;
}) {
  const [mode, setMode] = useState<'delivery' | 'upload' | 'validation' | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [unknown, setUnknown] = useState(false);
  const [date, setDate] = useState(businessToday());
  const [text, setText] = useState('');
  const [method, setMethod] = useState('in_person');
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const pending = useRef<{ path: string; body: object | FormData } | null>(
    null,
  );
  useEffect(() => {
    onLockChange?.(busy || unknown);
  }, [busy, unknown, onLockChange]);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);
  const uploads = record.events.filter(
    (event) => event.kind === 'signature_upload',
  );
  const latest = uploads.at(-1);
  async function send(path: string, body: object | FormData) {
    pending.current ??= { path, body };
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await contractRequest<Contract>(
        pending.current.path,
        pending.current.body,
      );
      pending.current = null;
      setUnknown(false);
      setMode(null);
      setConfirmed(false);
      setFile(null);
      setNotice('Registro confirmado pelo servidor.');
      await onChanged();
    } catch (problem) {
      const uncertain = unknownResult(problem);
      setUnknown(uncertain);
      setError(feedback(problem));
      if (!uncertain) pending.current = null;
    } finally {
      setBusy(false);
    }
  }
  function submit() {
    const base = {
      request_id: crypto.randomUUID(),
      expected_contract_version: currentVersion,
    };
    if (mode === 'delivery')
      void send(`${contractPath(record)}/deliveries`, {
        ...base,
        method,
        business_date: date,
        reason: text,
      });
    if (mode === 'upload' && file) {
      const form = new FormData();
      form.set('file', file);
      form.set('request_id', base.request_id);
      form.set('expected_contract_version', String(currentVersion));
      form.set('reviewed', 'false');
      form.set('signed_date', '');
      form.set('declaration', '');
      void send(`${contractPath(record)}/signatures`, form);
    }
    if (mode === 'validation' && latest)
      void send(`${contractPath(record)}/signatures/${latest.id}/validations`, {
        ...base,
        signed_date: date,
        declaration: text,
      });
  }
  return (
    <>
      <div className="catalog-actions">
        <button
          className="auth-retry"
          disabled={disabled || busy || unknown}
          onClick={() => {
            setMode('delivery');
            setText('');
            setConfirmed(false);
          }}
        >
          {compact
            ? 'Registrar entrega'
            : `Registrar entrega v${record.number}`}
        </button>
        <button
          className="auth-retry"
          disabled={disabled || busy || unknown}
          onClick={() => {
            setMode('upload');
            setConfirmed(false);
          }}
        >
          {compact
            ? 'Anexar contrato assinado'
            : `Anexar assinatura v${record.number}`}
        </button>
        {latest && (
          <button
            className="auth-retry"
            disabled={disabled || busy || unknown}
            onClick={() => {
              setMode('validation');
              setText('');
              setConfirmed(false);
            }}
          >
            {compact
              ? 'Conferir assinatura'
              : `Conferir anexo v${record.number}`}
          </button>
        )}
      </div>
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
      {unknown && (
        <button
          className="auth-button"
          disabled={disabled || busy}
          onClick={() =>
            pending.current &&
            void send(pending.current.path, pending.current.body)
          }
        >
          {compact
            ? 'Repetir mesmo registro'
            : `Repetir mesmo registro v${record.number}`}
        </button>
      )}
      {mode && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <fieldset disabled={disabled || busy || unknown}>
            <legend>
              {mode === 'delivery'
                ? 'Entrega manual'
                : mode === 'upload'
                  ? 'Documento assinado externamente'
                  : 'Conferência manual da assinatura'}{' '}
              {!compact && `· versão ${record.number}`}
            </legend>
            {mode === 'upload' ? (
              <>
                <p>
                  PDF, JPEG ou PNG até 10.000.000 bytes. Anexar não marca como
                  assinado. Depois, confira o documento desta versão.
                </p>
                <label>
                  Arquivo assinado
                  <input
                    type="file"
                    required
                    accept="application/pdf,image/jpeg,image/png"
                    onChange={(event) =>
                      setFile(event.target.files?.[0] ?? null)
                    }
                  />
                </label>
              </>
            ) : (
              <>
                {mode === 'delivery' && (
                  <label>
                    Meio de entrega
                    <select
                      value={method}
                      onChange={(event) => setMethod(event.target.value)}
                    >
                      <option value="in_person">Pessoalmente</option>
                      <option value="email">E-mail</option>
                      <option value="messaging">Mensagem</option>
                      <option value="other">Outro</option>
                    </select>
                  </label>
                )}
                {mode === 'validation' && (
                  <p>
                    Abra e confira o anexo mais recente, a identidade, a
                    assinatura e a versão. Este registro é manual, sem
                    certificação criptográfica.
                  </p>
                )}
                <label>
                  {mode === 'delivery'
                    ? 'Data da entrega'
                    : 'Data da assinatura'}
                  <input
                    type="date"
                    required
                    max={businessToday()}
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                </label>
                <label>
                  {mode === 'delivery'
                    ? 'Motivo / registro da entrega'
                    : 'Declaração de conferência'}
                  <textarea
                    required
                    maxLength={1000}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                  />
                </label>
              </>
            )}
            <label className="contract-checkbox">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              {compact
                ? 'Confirmo os dados deste registro'
                : `Confirmo o registro para a versão ${record.number}`}
            </label>
            <div className="catalog-actions">
              <button
                className="auth-button"
                disabled={!confirmed || (mode === 'upload' && !file)}
                type="submit"
              >
                {busy ? 'Registrando…' : 'Confirmar registro'}
              </button>
              <button
                className="auth-retry"
                type="button"
                onClick={() => setMode(null)}
              >
                Cancelar
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </>
  );
}
