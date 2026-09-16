import { Link, useLocation } from 'react-router-dom';
import { getSessionUser } from '../../api';
import { ROLE_LABEL } from '../../roleLabels';

/** État de navigation accepté par /profile, posé par SetPasswordPage. */
export interface ProfileLocationState {
  notice?: string;
}

export function ProfilePage() {
  const user = getSessionUser();
  const notice = (useLocation().state as ProfileLocationState | null)?.notice;

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

      {notice && (
        <div role="status" style={styles.success}>
          {notice}
        </div>
      )}

      <dl className="detail-grid" style={styles.grid}>
        <dt style={styles.dt}>Email</dt>
        <dd style={styles.dd}>{user.email}</dd>

        <dt style={styles.dt}>Rôle</dt>
        <dd style={styles.dd}>
          <span style={styles.badge}>{ROLE_LABEL[user.role]}</span>
        </dd>
      </dl>

      <p style={styles.actions}>
        <Link to="/set-password" style={styles.action}>
          Changer mon mot de passe
        </Link>
      </p>
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
  actions: { margin: '16px 0 0' },
  action: {
    display: 'inline-block',
    padding: '9px 16px',
    borderRadius: 6,
    border: '1px solid #d0d0d5',
    background: '#fff',
    color: '#1a1a1f',
    fontSize: 14,
    textDecoration: 'none',
  },
  success: {
    maxWidth: 480,
    boxSizing: 'border-box',
    padding: '8px 12px',
    marginBottom: 16,
    borderRadius: 6,
    background: '#e6f4ea',
    color: '#1e7c3a',
    fontSize: 13,
  },
};

export default ProfilePage;
