import type { ReactNode } from 'react';
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
      <header style={styles.navbar}>
        <div style={styles.brand}>sup-herman</div>
        <div style={styles.navRight}>
          {user && (
            <>
              <span style={styles.userInfo}>
                {user.first_name} {user.last_name}
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
        <aside style={styles.sidebar}>
          <nav style={styles.nav}>
            {visibleMenu.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
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

        <main style={styles.main}>{children}</main>
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
  main: { flex: 1, padding: 24, background: '#fff' },
};

export default Layout;
