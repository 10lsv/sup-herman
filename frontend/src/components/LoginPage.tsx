import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { LoginResponse, ApiError } from '../types';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiError | null;
        throw new Error(body?.error ?? `Login failed (${res.status})`);
      }
      const data = (await res.json()) as LoginResponse;
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <form onSubmit={handleSubmit} className="auth-card" style={styles.form}>
        <h1 style={styles.title}>Connexion</h1>

        <label style={styles.label}>
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.input}
          />
        </label>

        <label style={styles.label}>
          Mot de passe
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
          />
        </label>

        {error && <div style={styles.error}>{error}</div>}

        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </div>
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
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    width: 'min(360px, 100%)',
    boxSizing: 'border-box',
    padding: 32,
    background: '#fff',
    borderRadius: 8,
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  },
  title: { margin: 0, fontSize: 24 },
  label: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 },
  input: {
    padding: '10px 12px',
    borderRadius: 6,
    border: '1px solid #d0d0d5',
    fontSize: 14,
  },
  button: {
    padding: '10px 12px',
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
};

export default LoginPage;
