import { useState, type FormEvent } from 'react';
import { apiFetch } from '../../api';
import type { CreatedUser, CreateUserRequest, CreateUserRole } from '../../types';

const ROLE_OPTIONS: { value: CreateUserRole; label: string }[] = [
  { value: 'employee', label: 'Employee' },
  { value: 'manager', label: 'Manager' },
  { value: 'accounting', label: 'Comptabilité' },
];

export function AdminUsersPage() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CreateUserRole>('employee');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedUser | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Le compte est créé sans mot de passe : ce lien est le seul moyen pour le
  // salarié d'en choisir un. Le back n'en garde que le hash, il ne sera plus
  // jamais affiché — à défaut, la RH devra passer par une réinitialisation.
  const inviteLink = created
    ? `${window.location.origin}/set-password?user=${created.id}&token=${created.invite_token}`
    : null;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    setSubmitting(true);
    try {
      const body: CreateUserRequest = { email: email.trim().toLowerCase(), role };
      const user = await apiFetch<CreatedUser>('/api/users', { method: 'POST', body });
      setCreated(user);
      setCopied(false);
      setEmail('');
      setRole('employee');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h1 style={styles.title}>Création de compte</h1>
      <p style={styles.subtitle}>
        Provisionne un compte salarié, manager ou comptabilité.
      </p>

      <form onSubmit={handleSubmit} style={styles.form}>
        <label style={styles.label}>
          Email *
          <input
            type="email"
            required
            maxLength={255}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="prenom.nom@exemple.fr"
            style={styles.input}
          />
        </label>

        <label style={styles.label}>
          Rôle *
          <select
            required
            value={role}
            onChange={(e) => setRole(e.target.value as CreateUserRole)}
            style={styles.input}
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.actions}>
          <button type="submit" disabled={submitting} style={styles.submit}>
            {submitting ? 'Création…' : 'Créer le compte'}
          </button>
        </div>
      </form>

      {created && inviteLink && (
        <section style={styles.inviteCard}>
          <h2 style={styles.inviteTitle}>Compte créé pour {created.email}</h2>
          <p style={styles.inviteText}>
            Transmettez ce lien d'activation à l'intéressé : il y choisira son
            mot de passe. <strong>Il n'est affiché qu'une fois</strong> et expire
            le {new Date(created.invite_expires_at).toLocaleDateString('fr-FR')}.
          </p>
          <code style={styles.inviteLink}>{inviteLink}</code>
          <div style={styles.actions}>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(inviteLink)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
              style={styles.copy}
            >
              {copied ? 'Lien copié' : 'Copier le lien'}
            </button>
          </div>
        </section>
      )}
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  title: { marginTop: 0, marginBottom: 4, fontSize: 22 },
  subtitle: { marginTop: 0, marginBottom: 20, color: '#606066', fontSize: 14 },
  form: { display: 'grid', gap: 16, maxWidth: 480 },
  label: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 },
  input: {
    padding: '9px 12px',
    borderRadius: 6,
    border: '1px solid #d0d0d5',
    fontSize: 14,
    fontFamily: 'inherit',
  },
  actions: { display: 'flex', gap: 12 },
  submit: {
    padding: '10px 18px',
    borderRadius: 6,
    border: 'none',
    background: '#0b5fff',
    color: '#fff',
    fontSize: 14,
    cursor: 'pointer',
  },
  error: {
    padding: '8px 12px',
    borderRadius: 6,
    background: '#fdecea',
    color: '#b3261e',
    fontSize: 13,
  },
  inviteCard: {
    maxWidth: 620,
    marginTop: 24,
    padding: 16,
    border: '1px solid #b7e0c4',
    background: '#f2fbf5',
    borderRadius: 8,
    display: 'grid',
    gap: 10,
  },
  inviteTitle: { margin: 0, fontSize: 15, color: '#1e7c3a' },
  inviteText: { margin: 0, fontSize: 13, color: '#31543c' },
  inviteLink: {
    display: 'block',
    padding: '10px 12px',
    background: '#fff',
    border: '1px solid #d0e6d8',
    borderRadius: 6,
    fontSize: 12,
    wordBreak: 'break-all',
  },
  copy: {
    padding: '8px 14px',
    borderRadius: 6,
    border: '1px solid #1e7c3a',
    background: '#fff',
    color: '#1e7c3a',
    fontSize: 13,
    cursor: 'pointer',
  },
};

export default AdminUsersPage;
