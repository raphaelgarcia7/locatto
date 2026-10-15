import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { catalogRequest, feedback } from './api';
import type { CatalogPage } from './api';

type Category = { id: string; name: string };

export function CategoryPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <div className="catalog-category-field">
      <span id="category-label">Categoria</span>
      <button
        ref={trigger}
        type="button"
        className="catalog-category-select"
        aria-haspopup="dialog"
        aria-label={`Selecionar categoria${value ? `: ${value}` : ''}`}
        onClick={() => setOpen(true)}
      >
        <span>{value || 'Sem categoria'}</span>
        <span>Escolher</span>
      </button>
      {open &&
        createPortal(
          <CategoryDialog
            value={value}
            onSelect={(category) => {
              onChange(category);
              close();
            }}
            onClose={close}
          />,
          document.body,
        )}
    </div>
  );
}

function CategoryDialog({
  value,
  onSelect,
  onClose,
}: {
  value: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CatalogPage<Category> | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  function close() {
    dialog.current?.close();
    onClose();
  }
  function select(name: string) {
    dialog.current?.close();
    onSelect(name);
  }
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setLoading(true);
        setError('');
      }
    });
    void catalogRequest<CatalogPage<Category>>(
      `product-categories?search=${encodeURIComponent(query)}&page=${page}`,
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(feedback(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, page, retry]);
  async function createCategory() {
    setSaving(true);
    setError('');
    try {
      const category = await catalogRequest<Category>('product-categories', {
        method: 'POST',
        body: { name: name.trim() },
      });
      select(category.name);
    } catch (failure) {
      setError(feedback(failure));
    } finally {
      setSaving(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="catalog-category-dialog catalog-workspace"
      aria-labelledby="category-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) close();
      }}
    >
      <div className="catalog-panel-heading">
        <h2 id="category-dialog-title">Categorias de produtos</h2>
        <button
          type="button"
          className="auth-retry"
          onClick={close}
          disabled={saving}
        >
          Fechar
        </button>
      </div>
      <p className="catalog-help">
        Escolha uma categoria cadastrada ou crie uma nova para organizar o
        acervo.
      </p>
      <form
        className="catalog-search"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setQuery(search);
          setPage(1);
        }}
      >
        <label>
          Buscar categoria
          <input
            value={search}
            maxLength={100}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button className="auth-retry" disabled={saving}>
          Buscar
        </button>
      </form>
      {error && (
        <div className="auth-feedback auth-feedback--error">
          <p role="alert">{error}</p>
          <button
            type="button"
            className="auth-retry"
            onClick={() => setRetry((value) => value + 1)}
          >
            Atualizar categorias
          </button>
        </div>
      )}
      {loading ? (
        <p role="status">Carregando categorias…</p>
      ) : (
        !error &&
        data && (
          <>
            {data.items.length ? (
              <ul className="catalog-category-list">
                {data.items.map((category) => (
                  <li key={category.id}>
                    <button
                      type="button"
                      disabled={saving}
                      aria-pressed={category.name === value}
                      aria-label={`Usar categoria ${category.name}`}
                      onClick={() => select(category.name)}
                    >
                      {category.name}
                      <span>
                        {category.name === value ? 'Selecionada' : 'Selecionar'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="catalog-help">
                Nenhuma categoria encontrada. Cadastre a primeira abaixo.
              </p>
            )}
            {data.total > data.page_size && (
              <nav
                className="catalog-pagination"
                aria-label="Paginação de categorias"
              >
                <button
                  type="button"
                  className="auth-retry"
                  disabled={page === 1 || saving}
                  onClick={() => setPage(page - 1)}
                >
                  Anteriores
                </button>
                <span>Página {page}</span>
                <button
                  type="button"
                  className="auth-retry"
                  disabled={page * data.page_size >= data.total || saving}
                  onClick={() => setPage(page + 1)}
                >
                  Próximas
                </button>
              </nav>
            )}
          </>
        )
      )}
      {value && (
        <button
          type="button"
          className="catalog-back"
          disabled={saving}
          onClick={() => select('')}
        >
          Deixar sem categoria
        </button>
      )}
      <form
        className="catalog-category-create"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void createCategory();
        }}
      >
        <h3>Nova categoria</h3>
        <label>
          Nome da categoria
          <input
            required
            maxLength={100}
            value={name}
            disabled={saving}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button className="auth-button" disabled={!name.trim() || saving}>
          {saving ? 'Cadastrando…' : 'Cadastrar e selecionar'}
        </button>
      </form>
    </dialog>
  );
}
