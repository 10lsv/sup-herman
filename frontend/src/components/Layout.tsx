import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import type { User, UserRole } from '../types';

interface MenuItem {
  to: string;
  label: string;
  roles: UserRole[];
}

// Menu unifié xFINT1 + xFINT2, filtré selon le rôle.
const MENU: MenuItem[] = [
  { to: '/dashboard',           label: 'Tableau de bord',      roles: ['employee', 'manager', 'accounting', 'hr', 'admin'] },

  // xFINT1 — Notes de frais
  { to: '/expenses',            label: 'Mes notes de frais',   roles: ['employee', 'manager', 'accounting', 'hr', 'admin'] },
  { to: '/expenses/new',        label: 'Nouvelle note',        roles: ['employee', 'manager', 'accounting', 'hr', 'admin'] },
  { to: '/expenses/approvals',  label: 'À valider (manager)',  roles: ['manager', 'admin'] },
  { to: '/expenses/accounting', label: 'Comptabilité',         roles: ['accounting', 'admin'] },

  // xFINT2 — Congés
  { to: '/leaves',              label: 'Congés — tableau de bord', roles: ['employee', 'manager', 'accounting', 'hr', 'admin'] },
  { to: '/leaves/list',         label: 'Mes demandes',         roles: ['employee', 'manager', 'accounting', 'hr', 'admin'] },
  { to: '/leaves/new',          label: 'Demander un congé',    roles: ['employee', 'manager', 'accounting', 'hr', 'admin'] },
  { to: '/leaves/calendar',     label: 'Calendrier',           roles: ['employee', 'manager', 'accounting', 'hr', 'admin'] },
  { to: '/leaves/approvals',    label: 'À valider (congés)',   roles: ['manager', 'hr', 'admin'] },
  { to: '/leaves/hr',           label: 'RH — Soldes & utilisateurs', roles: ['hr', 'admin'] },

  // Compte
  { to: '/profile',             label: 'Mon profil',           roles: ['employee', 'manager', 'accounting', 'hr', 'admin'] },
  { to: '/set-password',        label: 'Changer mon mot de passe', roles: ['employee', 'manager', 'accounting', 'hr', 'admin'] },

  // Admin
  { to: '/admin/users',         label: 'Utilisateurs',         roles: ['manager', 'admin'] },
];

function getSessionUser(): User | null {
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

const ROLE_LABEL: Record<UserRole, string> = {
  employee: 'Salarié',
  manager: 'Manager',
  accounting: 'Comptabilité',
  hr: 'RH',
  admin: 'Admin',
};

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const navigate = useNavigate();
  const user = getSessionUser();
  // Tiroir de navigation, utilisé seulement sous 768 px (voir responsive.css).
  const [menuOpen, setMenuOpen] = useState(false);

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
    ? MENU.filter((item) => item.roles.includes(user.role))
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
        <div className="app-brand" style={styles.brand}>sup-herman</div>
        <div style={styles.navRight}>
          {user && (
            <>
              <span style={styles.userInfo}>
                <span className="app-user-name">
                  {user.first_name} {user.last_name}
                </span>
                <span style={styles.roleTag}>{ROLE_LABEL[user.role]}</span>
              </span>
              <button onClick={handleLogout} style={styles.logout}>
                Déconnexion
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
            {visibleMenu.map((item) => (
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
  brand: { fontWeight: 700, fontSize: 18 },
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
  nav: { display: 'flex', flexDirection: 'column', gap: 2 },
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
