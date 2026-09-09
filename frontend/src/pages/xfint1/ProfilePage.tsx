import { Link } from 'react-router-dom';
import { getSessionUser } from '../../api';
import type { UserRole } from '../../types';

const ROLE_LABEL: Record<UserRole, string> = {
  employee: 'Salarié',
  manager: 'Manager',
  accounting: 'Comptabilité',
  hr: 'RH',
  admin: 'Admin',
};

export function ProfilePage() {
  const user = getSessionUser();

  // ProtectedRoute garantit la session, mais le localStorage peut être vidé
  // entre-temps : on affiche un message plutôt que de planter.
  if (!user) {
    return (
      <section>
        <h1 style={styles.title}>Mon profil</h1>
        <p style={styles.muted}>
          Session introuvable. <Link to="/login">Se reconnecter</Link>.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h1 style={styles.title}>Mon profil</h1>

      <dl style={styles.grid}>
        <dt style={styles.dt}>Email</dt>
        <dd style={styles.dd}>{user.email}</dd>

        <dt style={styles.dt}>Rôle</dt>
        <dd style={styles.dd}>
          <span style={styles.badge}>{ROLE_LABEL[user.role]}</span>
        </dd>
      </dl>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  title: { marginTop: 0, fontSize: 22 },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr',
    gap: '10px 24px',
    margin: 0,
    maxWidth: 480,
    padding: 20,
    border: '1px solid #e0e0e5',
    borderRadius: 8,
    fontSize: 14,
  },
  dt: { color: '#606066' },
  dd: { margin: 0 },
  badge: {
    display: 'inline-block',
    padding: '3px 9px',
    borderRadius: 12,
    background: '#e3f0ff',
    color: '#0b5fff',
    fontSize: 12,
    fontWeight: 600,
  },
  muted: { color: '#9a9aa0' },
};

export default ProfilePage;
