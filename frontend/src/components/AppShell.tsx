import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { modules } from '../modules';
import { BrandLogo } from './BrandLogo';
import { Icon } from './Icon';

export function AppShell({
  children,
  logout,
  logoutBusy,
}: {
  children: ReactNode;
  logout: () => void;
  logoutBusy: boolean;
}) {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const previousPath = useRef(pathname);
  const pageTitle =
    pathname === '/'
      ? 'Visão geral'
      : (modules.find(
          (module) => module.path === pathname.replace(/\/$/, '').toLowerCase(),
        )?.title ?? 'Página não encontrada');
  useEffect(() => {
    document.title = `${pageTitle} · Locatto`;
    if (previousPath.current !== pathname) {
      mainRef.current?.focus();
      window.scrollTo(0, 0);
      previousPath.current = pathname;
    }
  }, [pathname, pageTitle]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Pular para o conteúdo
      </a>
      <aside className="sidebar" aria-label="Espaço de trabalho">
        <Link className="brand" to="/" aria-label="Locatto, início">
          <BrandLogo />
        </Link>
        <div className="sidebar-label">MINHA LOCADORA</div>
        <nav className="main-nav" aria-label="Navegação principal">
          <NavLink className="nav-item" to="/" end>
            <Icon name="home" size={20} />
            Visão geral
          </NavLink>
          {modules.map((module) => (
            <NavLink
              className="nav-item"
              key={module.path}
              to={module.path}
              end
            >
              <Icon
                name={module.path === '/parametros' ? 'settings' : module.icon}
                size={20}
              />
              {module.title}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <strong>{pageTitle}</strong>
          </div>
          <button
            className="auth-retry app-signout"
            type="button"
            disabled={logoutBusy}
            onClick={logout}
          >
            <Icon name="logout" size={18} />
            {logoutBusy ? 'Saindo…' : 'Sair'}
          </button>
        </header>
        <main
          className="page-content"
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          aria-label={pageTitle}
        >
          {children}
        </main>
        <footer className="page-footer">
          <span>Locatto · Gestão de locações</span>
        </footer>
      </div>
    </div>
  );
}
