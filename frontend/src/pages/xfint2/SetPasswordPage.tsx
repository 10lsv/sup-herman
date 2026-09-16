import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { API_BASE, getSessionUser } from '../../api';
import type { ApiError, UpdatePasswordRequest } from '../../types';

const MIN_LENGTH = 8;

/**
 * Deux usages pour un même écran :
 *   • activation — le lien reçu porte ?user=&token=, l'utilisateur n'est pas
 *     encore connecté (son compte n'a pas de mot de passe) ;
 *   • changement — l'utilisateur connecté choisit un nouveau mot de passe et
 *     doit fournir l'actuel.
 * On n'utilise pas apiFetch : en mode activation il ne faut surtout pas
 * envoyer le jeton de session d'un éventuel autre compte déjà connecté.
 */
export function SetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const sessionUser = getSessionUser();

  const token = params.get('token');
  const userIdParam = params.get('user');
  const isActivation = Boolean(token && userIdParam);

  const targetId = isActivation ? Number(userIdParam) : sessionUser?.id;

  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit =
    targetId !== undefined &&
    password.length >= MIN_LENGTH &&
    confirm === password &&
    (isActivation || currentPassword.length > 0);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit || targetId === undefined) return;
    setError(null);
    setSubmitting(true);
    try {
      const body: UpdatePasswordRequest = {
        password,
        ...(isActivation && token
          ? { token }
          : { current_password: currentPassword }),
      };
      const res = await fetch(`${API_BASE}/api/users/${targetId}/password`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          // Mode changement uniquement : l'activation reste anonyme.
          ...(!isActivation && localStorage.getItem('token')
            ? { Authorization: `Bearer ${localStorage.getItem('token')}` }
            : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as ApiError | null;
        throw new Error(payload?.error ?? `Requête échouée (${res.status})`);
      }

      setDone(true);
      // Le mot de passe a changé : la session en cours n'est plus cohérente.
      if (!isActivation) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
      setTimeout(() => navigate('/login', { replace: true }), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
      setSubmitting(false);
    }
  }

  if (!isActivation && !sessionUser) {
    return (
      <main style={styles.page}>
        <section className="auth-card" style={styles.card}>
          <h1 style={styles.title}>Définir un mot de passe</h1>
          <p style={styles.muted}>
            Ce lien d'activation est incomplet. Demandez-en un nouveau à votre
            manager, ou <Link to="/login">connectez-vous</Link> si vous avez déjà
            un mot de passe.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <section className="auth-card" style={styles.card}>
        <h1 style={styles.title}>
          {isActivation ? 'Activer mon compte' : 'Changer mon mot de passe'}
        </h1>
        <p style={styles.muted}>
          {isActivation
            ? 'Choisissez le mot de passe qui vous servira à vous connecter.'
            : `Compte ${sessionUser?.email}.`}
        </p>

        {done ? (
          <div style={styles.success}>
            Mot de passe enregistré. Redirection vers la connexion…
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={styles.form}>
            {!isActivation && (
              <label style={styles.label}>
                Mot de passe actuel *
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  style={styles.input}
                />
              </label>
            )}

            <label style={styles.label}>
              Nouveau mot de passe *
              <input
                type="password"
                required
                minLength={MIN_LENGTH}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Confirmation *
              <input
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                style={styles.input}
              />
            </label>

            {tooShort && (
              <div style={styles.warning}>
                {MIN_LENGTH} caractères minimum.
              </div>
            )}
            {mismatch && (
              <div style={styles.warning}>
                Les deux mots de passe ne correspondent pas.
              </div>
            )}
            {error && <div style={styles.error}>{error}</div>}

            <button
              type="submit"
              disabled={submitting || !canSubmit}
              style={{
                ...styles.submit,
                ...(canSubmit ? {} : styles.submitDisabled),
              }}
            >
              {submitting ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    background: '#f5f5f7',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: '#1a1a1f',
  },
  card: {
    width: 'min(420px, 100%)',
    // Sans border-box, le padding s'ajoute à la largeur : 476 px, plus large
    // qu'un écran de 375 px.
    boxSizing: 'border-box',
    padding: 28,
    background: '#fff',
    borderRadius: 10,
    boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
    display: 'grid',
    gap: 12,
  },
  title: { margin: 0, fontSize: 20 },
  form: { display: 'grid', gap: 14, marginTop: 4 },
  label: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 },
  input: {
    padding: '9px 12px',
    borderRadius: 6,
    border: '1px solid #d0d0d5',
    fontSize: 14,
    fontFamily: 'inherit',
  },
  submit: {
    padding: '10px 18px',
    borderRadius: 6,
    border: 'none',
    background: '#0b5fff',
    color: '#fff',
    fontSize: 14,
    cursor: 'pointer',
  },
  submitDisabled: { background: '#b8c6dd', cursor: 'not-allowed' },
  muted: { margin: 0, color: '#9a9aa0', fontSize: 13 },
  warning: {
    padding: '8px 12px',
    borderRadius: 6,
    background: '#fff4e0',
    color: '#b26a00',
    fontSize: 13,
  },
  success: {
    padding: '8px 12px',
    borderRadius: 6,
    background: '#e6f4ea',
    color: '#1e7c3a',
    fontSize: 13,
  },
  error: {
    padding: '8px 12px',
    borderRadius: 6,
    background: '#fdecea',
    color: '#b3261e',
    fontSize: 13,
  },
};

export default SetPasswordPage;
