import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AuthContext } from '../authContext';
import { customerLink } from '../customers/api';
import { quotationFeedback, quotationRequest } from './api';
import type { Quotation } from './api';
import { QuotationEditor } from './QuotationEditor';
import { QuotationDetail } from './QuotationDetail';
import '../catalog/catalog.css';
import './quotations.css';

export function QuotationsPage() {
  const { authenticated } = useContext(AuthContext);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const identifier = params.get('orcamento');
  const [record, setRecord] = useState<Quotation | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(Boolean(identifier));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const loaded = useRef<string | null>(null);
  const currentIdentifier = useRef(identifier);
  useLayoutEffect(() => {
    currentIdentifier.current = identifier;
  }, [identifier]);

  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    if (!identifier) {
      loaded.current = null;
      queueMicrotask(() => {
        if (controller.signal.aborted) return;
        setRecord(null);
        setEditing(false);
        setError('');
        setNotice('');
        setLoading(false);
      });
      return () => controller.abort();
    }
    if (loaded.current === identifier) return;
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setEditing(false);
      setError('');
      setNotice('');
    });
    void quotationRequest<Quotation>(
      `/${encodeURIComponent(identifier)}`,
      undefined,
      controller.signal,
    )
      .then((value) => {
        if (controller.signal.aborted) return;
        loaded.current = identifier;
        setRecord(value);
      })
      .catch((problem: unknown) => {
        if (!controller.signal.aborted) setError(quotationFeedback(problem));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [authenticated, identifier, refresh]);

  function saved(value: Quotation) {
    loaded.current = value.id;
    setParams({ orcamento: value.id });
    setRecord(value);
    setEditing(false);
    setLoading(false);
    setNotice('Orçamento salvo com sucesso. Nenhum estoque foi reservado.');
  }
  async function edit() {
    if (!record) return;
    const selectedId = record.id;
    try {
      const latest = await quotationRequest<Quotation>(`/${selectedId}`);
      if (currentIdentifier.current !== selectedId) return;
      setRecord(latest);
      setEditing(true);
      setError('');
      setNotice('');
    } catch (problem) {
      if (currentIdentifier.current === selectedId)
        setError(quotationFeedback(problem));
    }
  }
  const selected = record?.id === identifier ? record : null;
  return (
    <div className="catalog-workspace quotation-workspace">
      <header className="page-heading">
        <h1>Locações</h1>
        {!identifier && (
          <p>
            Prepare uma nova locação. Os orçamentos anteriores ficam no cadastro
            de cada cliente.
          </p>
        )}
        <nav className="rental-page-links" aria-label="Atalhos de locações">
          <Link className="catalog-back" to="/">
            Visão geral
          </Link>
          <Link className="catalog-back" to="/clientes">
            Consultar orçamentos por cliente
          </Link>
        </nav>
      </header>
      {notice && (
        <p role="status" className="auth-feedback">
          {notice}
        </p>
      )}
      {error && (
        <div role="alert" className="auth-feedback">
          {error}
          <button
            className="auth-retry"
            onClick={() => {
              loaded.current = null;
              setRefresh((value) => value + 1);
            }}
          >
            Tentar novamente
          </button>
        </div>
      )}
      {!identifier ? (
        <QuotationEditor onSaved={saved} onCancel={() => void navigate('/')} />
      ) : loading || !selected ? (
        !error && <p role="status">Carregando locação…</p>
      ) : editing ? (
        <QuotationEditor
          key={`edit:${selected.id}`}
          initial={selected}
          onSaved={saved}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <QuotationDetail
          key={`${selected.id}-${selected.version}`}
          record={selected}
          onEdit={() => void edit()}
          onClose={() => void navigate(customerLink(selected.customer_id))}
        />
      )}
    </div>
  );
}
