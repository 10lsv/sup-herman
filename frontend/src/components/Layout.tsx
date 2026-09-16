import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { getSessionUser } from '../api';
import { ROLE_LABEL } from '../roleLabels';
import type { UserRole } from '../types';

interface MenuItem {
  to: string;
  label: string;
  roles: UserRole[];
}

interface MenuGroup {
  /** Absent pour le groupe de bas de menu (comptes). */
  title?: string;
  items: MenuItem[];
}

const ALL: UserRole[] = ['employee', 'manager', 'accounting', 'hr', 'admin'];

// Menu unifié xFINT1 + xFINT2, filtré selon le rôle. L'accueil (/dashboard)
// est joignable par le nom de l'application dans la barre du haut. Le
// changement de mot de passe se fait depuis Mon profil.
const MENU: MenuGroup[] = [
  {
    title: 'Notes de frais',
    items: [
      { to: '/expenses',           label: 'Mes notes',     roles: ALL },
      { to: '/expenses/new',       label: 'Nouvelle note', roles: ALL },
      { to: '/expenses/approvals', label: 'À valider',     roles: ['manager', 'accounting', 'admin'] },
    ],
  },
  {
    title: 'Congés',
    items: [
      { to: '/leaves',           label: 'Tableau de bord',  roles: ALL },
      { to: '/leaves/list',      label: 'Mes demandes',     roles: ALL },
      { to: '/leaves/new',       label: 'Nouvelle demande', roles: ALL },
      { to: '/leaves/calendar',  label: 'Calendrier',       roles: ALL },
      { to: '/leaves/approvals', label: 'À valider',        roles: ['manager', 'hr', 'admin'] },
      { to: '/leaves/hr',        label: 'Gestion RH',       roles: ['hr', 'admin'] },
    ],
  },
  {
    items: [
      { to: '/admin/users', label: 'Utilisateurs', roles: ['manager', 'hr', 'admin'] },
      { to: '/profile',     label: 'Mon profil',   roles: ALL },
    ],
  },
];

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const navigate = useNavigate();
  const user = getSessionUser();
  // Tiroir de navigation, utilisé seulement sous 768 px (voir responsive.css).
  const [menuOpen, setMenuOpen] = useState(false);

  // Le localStorage est partagé entre onglets : une connexion ou déconnexion
  // ailleurs remplace le jeton que cet onglet envoie, sans toucher à ce qu'il
  // affiche. On recharge pour réaligner l'écran sur la session réelle.
  // L'événement n'est émis que dans les *autres* onglets ; `key` vaut null
  // après un localStorage.clear().
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.storageArea !== localStorage) return;
      if (e.key === null || e.key === 'token' || e.key === 'user') {
        window.location.reload();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login', { replace: true });
  }

  const visibleMenu = user
    ? MENU.map((group) => ({
        ...group,
        items: group.items.filter((item) => item.roles.includes(user.role)),
      })).filter((group) => group.items.length > 0)
    : [];

  return (
    <div style={styles.shell}>
      <header className="app-navbar" style={styles.navbar}>
        <button
          type="button"
          className="app-menu-toggle"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
          aria-label={menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
        >
          {menuOpen ? '×' : '☰'}
        </button>
        <Link
          to="/dashboard"
          onClick={() => setMenuOpen(false)}
          className="app-brand"
          style={styles.brand}
        >
          sup-herman
        </Link>
        <div className="app-nav-right" style={styles.navRight}>
          {user && (
            <>
              <span className="app-user-info" style={styles.userInfo}>
                <span className="app-user-name">
                  {user.first_name} {user.last_name}
                </span>
                <span className="app-role-tag" style={styles.roleTag}>{ROLE_LABEL[user.role]}</span>
              </span>
              <button
                onClick={handleLogout}
                className="app-logout"
                aria-label="Déconnexion"
                title="Déconnexion"
                style={styles.logout}
              >
                <span className="app-logout-label">Déconnexion</span>
                {/* Remplace le libellé sous 768 px. */}
                <svg
                  className="app-logout-icon"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="M16 17l5-5-5-5" />
                  <path d="M21 12H9" />
                </svg>
              </button>
            </>
          )}
        </div>
      </header>

      <div style={styles.body}>
        {menuOpen && (
          <button
            type="button"
            className="app-backdrop"
            onClick={() => setMenuOpen(false)}
            aria-label="Fermer le menu"
            tabIndex={-1}
          />
        )}
        <aside
          id="app-sidebar"
          className={menuOpen ? 'app-sidebar is-open' : 'app-sidebar'}
          style={styles.sidebar}
        >
          <nav style={styles.nav}>
            {visibleMenu.map((group, index) => (
              <div
                key={group.title ?? `group-${index}`}
                style={{
                  ...styles.navGroup,
                  ...(group.title ? {} : styles.navGroupFooter),
                }}
              >
                {group.title && <div style={styles.navTitle}>{group.title}</div>}
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end
                    onClick={() => setMenuOpen(false)}
                    style={({ isActive }) => ({
                      ...styles.navLink,
                      ...(isActive ? styles.navLinkActive : {}),
                    })}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <main className="app-main" style={styles.main}>{children}</main>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: '#1a1a1f',
  },
  navbar: {
    height: 56,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 24px',
    background: '#0b5fff',
    color: '#fff',
  },
  brand: {
    fontWeight: 700,
    fontSize: 18,
    whiteSpace: 'nowrap',
    color: 'inherit',
    textDecoration: 'none',
  },
  navRight: { display: 'flex', alignItems: 'center', gap: 16 },
  userInfo: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 },
  roleTag: {
    padding: '2px 8px',
    borderRadius: 12,
    background: 'rgba(255,255,255,0.2)',
    fontSize: 12,
  },
  logout: {
    padding: '6px 12px',
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.4)',
    background: 'transparent',
    color: '#fff',
    fontSize: 13,
    cursor: 'pointer',
  },
  body: { display: 'flex', flex: 1 },
  sidebar: {
    width: 240,
    background: '#f5f5f7',
    borderRight: '1px solid #e0e0e5',
    padding: '16px 8px',
  },
  nav: { display: 'flex', flexDirection: 'column', gap: 16 },
  navGroup: { display: 'flex', flexDirection: 'column', gap: 2 },
  navGroupFooter: { paddingTop: 12, borderTop: '1px solid #e0e0e5' },
  navTitle: {
    padding: '0 12px 4px',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: '#9a9aa0',
  },
  navLink: {
    padding: '8px 12px',
    borderRadius: 6,
    textDecoration: 'none',
    color: '#1a1a1f',
    fontSize: 14,
  },
  navLinkActive: {
    background: '#0b5fff',
    color: '#fff',
    fontWeight: 600,
  },
  // minWidth 0 : sans lui, un élément flex ne rétrécit pas sous la largeur de
  // son contenu, et un tableau large élargirait toute la page au lieu de
  // défiler dans son cadre.
  main: { flex: 1, minWidth: 0, padding: 24, background: '#fff' },
};

export default Layout;
