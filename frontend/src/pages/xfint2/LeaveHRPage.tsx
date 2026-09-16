import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { apiFetch, getSessionUser } from '../../api';
import { leaveTypeColor } from '../../leaveLabels';
import type { LeaveBalanceSummary, UserWithBalances, UserRole } from '../../types';

const ROLE_LABEL: Record<UserRole, string> = {
  employee: 'Salarié',
  manager: 'Manager',
  accounting: 'Comptabilité',
  hr: 'RH',
  admin: 'Admin',
};

/** Colonnes de solde affichées directement dans le tableau. */
const HEADLINE_CODES = ['PAID', 'RTT'];

/** Doit rester aligné sur ASSIGNABLE_ROLES côté back (routes/users.ts). */
const ASSIGNABLE_ROLES: UserRole[] = [
  'employee',
  'manager',
  'accounting',
  'hr',
  'admin',
];

type Dialog =
  | { kind: 'balance'; user: UserWithBalances }
  | { kind: 'password'; user: UserWithBalances }
  | { kind: 'edit'; user: UserWithBalances };

export function LeaveHRPage() {
  const session = getSessionUser();
  const [users, setUsers] = useState<UserWithBalances[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<UserWithBalances[]>('/api/users');
      setUsers(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function balanceOf(user: UserWithBalances, code: string): LeaveBalanceSummary | undefined {
    return user.balances.find((b) => b.code === code);
  }

  // Nom du manager rattaché : l'annuaire est déjà chargé, pas d'appel en plus.
  const nameOf = useCallback(
    (id: number | null): string => {
      if (id === null) return '—';
      const m = users.find((u) => u.id === id);
      if (!m) return `#${id}`;
      return `${m.first_name} ${m.last_name}`.trim() || m.email;
    },
    [users],
  );

  async function toggleActive(user: UserWithBalances) {
    setTogglingId(user.id);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        body: { is_active: !user.is_active },
      });
      setNotice(
        `${user.email} ${user.is_active ? 'désactivé' : 'réactivé'}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <section>
      <header className="page-header" style={styles.header}>
        <h1 style={styles.title}>RH — utilisateurs et soldes</h1>
        <span style={styles.count}>{users.length} compte(s)</span>
      </header>

      {error && <div style={styles.error}>{error}</div>}
      {notice && <div style={styles.success}>{notice}</div>}

      {loading ? (
        <p style={styles.muted}>Chargement…</p>
      ) : (
        <div className="table-scroll" style={styles.tableWrap}>
          <table className="data-table" style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Utilisateur</th>
                <th style={styles.th}>Rôle</th>
                <th style={styles.th}>Manager</th>
                <th style={styles.th}>Actif</th>
                {HEADLINE_CODES.map((code) => (
                  <th key={code} style={{ ...styles.th, textAlign: 'right' }}>
                    {code === 'PAID' ? 'CP' : code}
                  </th>
                ))}
                <th style={styles.th}>Compte</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  onClick={() => setDialog({ kind: 'edit', user: u })}
                  style={{
                    ...styles.row,
                    ...(u.is_active ? {} : styles.inactiveRow),
                  }}
                >
                  <td style={styles.td}>
                    <div>
                      {u.first_name || u.last_name
                        ? `${u.first_name} ${u.last_name}`.trim()
                        : '—'}
                    </div>
                    <div style={styles.subtle}>{u.email}</div>
                  </td>
                  <td style={styles.td}>{ROLE_LABEL[u.role]}</td>
                  <td style={styles.td}>{nameOf(u.manager_id)}</td>
                  <td style={styles.td}>
                    {/* Bascule directe : le clic ne doit pas ouvrir la modale. */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={u.is_active}
                      aria-label={`${u.is_active ? 'Désactiver' : 'Réactiver'} ${u.email}`}
                      disabled={togglingId === u.id || u.id === session?.id}
                      title={
                        u.id === session?.id
                          ? 'Vous ne pouvez pas désactiver votre propre compte'
                          : undefined
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleActive(u);
                      }}
                      style={{
                        ...styles.switch,
                        ...(u.is_active ? styles.switchOn : {}),
                        ...(u.id === session?.id ? styles.switchLocked : {}),
                      }}
                    >
                      <span
                        style={{
                          ...styles.knob,
                          ...(u.is_active ? styles.knobOn : {}),
                        }}
                      />
                    </button>
                  </td>
                  {HEADLINE_CODES.map((code) => {
                    const b = balanceOf(u, code);
                    return (
                      <td
                        key={code}
                        style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}
                      >
                        {b ? (
                          <>
                            <strong>{b.remaining_days}</strong>
                            <span style={styles.subtle}> / {b.allocated_days}</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    );
                  })}
                  <td style={styles.td}>
                    {u.has_password ? (
                      <span style={{ ...styles.pill, ...styles.pillOk }}>Actif</span>
                    ) : (
                      <span style={{ ...styles.pill, ...styles.pillWait }}>
                        Sans mot de passe
                      </span>
                    )}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDialog({ kind: 'balance', user: u });
                      }}
                      style={styles.linkButton}
                    >
                      Soldes
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDialog({ kind: 'password', user: u });
                      }}
                      style={styles.linkButton}
                    >
                      Mot de passe
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog?.kind === 'balance' && (
        <BalanceDialog
          user={dialog.user}
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            setNotice(message);
            setDialog(null);
            void load();
          }}
        />
      )}
      {dialog?.kind === 'edit' && (
        <EditUserDialog
          user={dialog.user}
          users={users}
          isSelf={dialog.user.id === session?.id}
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            setNotice(message);
            setDialog(null);
            void load();
          }}
        />
      )}
      {dialog?.kind === 'password' && (
        <PasswordDialog
          user={dialog.user}
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            setNotice(message);
            setDialog(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Modale : dotation par type de congé
// ---------------------------------------------------------------------------

function BalanceDialog({
  user,
  onClose,
  onSaved,
}: {
  user: UserWithBalances;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [code, setCode] = useState(user.balances[0]?.code ?? '');
  const [allocated, setAllocated] = useState(
    String(user.balances[0]?.allocated_days ?? 0),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selected = user.balances.find((b) => b.code === code);
  const committed = selected ? selected.used_days + selected.pending_days : 0;

  function pickType(nextCode: string) {
    setCode(nextCode);
    const next = user.balances.find((b) => b.code === nextCode);
    setAllocated(String(next?.allocated_days ?? 0));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await apiFetch(`/api/leaves/balance/${user.id}`, {
        method: 'PATCH',
        body: { type: code, allocated_days: Number(allocated) },
      });
      onSaved(`Solde ${selected?.label ?? code} mis à jour pour ${user.email}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
      setSaving(false);
    }
  }

  return (
    <Dialog title={`Soldes — ${user.email}`} onClose={onClose}>
      <form onSubmit={handleSubmit} style={styles.form}>
        <ul style={styles.balanceList}>
          {user.balances.map((b) => (
            <li key={b.leave_type_id} style={styles.balanceRow}>
              <span style={{ ...styles.dot, background: leaveTypeColor(b.code) }} />
              <span style={styles.balanceLabel}>{b.label}</span>
              <span style={styles.subtle}>
                {b.used_days} pris · {b.pending_days} en attente
              </span>
              <strong>
                {b.remaining_days} / {b.allocated_days}
              </strong>
            </li>
          ))}
        </ul>

        <label style={styles.label}>
          Type à ajuster
          <select value={code} onChange={(e) => pickType(e.target.value)} style={styles.input}>
            {user.balances.map((b) => (
              <option key={b.leave_type_id} value={b.code}>
                {b.label}
              </option>
            ))}
          </select>
        </label>

        <label style={styles.label}>
          Jours alloués
          <input
            type="number"
            min={committed}
            max={400}
            step="0.5"
            value={allocated}
            onChange={(e) => setAllocated(e.target.value)}
            style={styles.input}
          />
        </label>

        <p style={styles.muted}>
          Minimum {committed} j : les jours déjà pris ou en attente ne peuvent pas
          être retirés. `used` et `pending` sont dérivés des demandes et ne
          s'éditent pas ici.
        </p>

        {error && <div style={styles.error}>{error}</div>}

        <div className="modal-actions" style={styles.actionRow}>
          <button type="submit" disabled={saving} style={styles.primary}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <button type="button" onClick={onClose} style={styles.secondary}>
            Annuler
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Modale : fiche complète (identité, rôle, rattachement, activation)
// ---------------------------------------------------------------------------

function EditUserDialog({
  user,
  users,
  isSelf,
  onClose,
  onSaved,
}: {
  user: UserWithBalances;
  users: UserWithBalances[];
  isSelf: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [firstName, setFirstName] = useState(user.first_name);
  const [lastName, setLastName] = useState(user.last_name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<UserRole>(user.role);
  // '' encode « aucun manager » : un <select> ne transporte que des chaînes.
  const [managerId, setManagerId] = useState(
    user.manager_id === null ? '' : String(user.manager_id),
  );
  const [isActive, setIsActive] = useState(user.is_active);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Le back refuse l'auto-rattachement (chk_users_not_self_manager).
  const managerOptions = users.filter((u) => u.id !== user.id);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const updated = await apiFetch<UserWithBalances>(`/api/users/${user.id}`, {
        method: 'PATCH',
        body: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim().toLowerCase(),
          role,
          manager_id: managerId === '' ? null : Number(managerId),
          is_active: isActive,
        },
      });
      onSaved(`Fiche de ${updated.email} mise à jour.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
      setSaving(false);
    }
  }

  return (
    <Dialog title={`Fiche — ${user.email}`} onClose={onClose}>
      <form onSubmit={handleSubmit} style={styles.form}>
        <div className="form-row" style={styles.fieldRow}>
          <label style={styles.label}>
            Prénom
            <input
              type="text"
              maxLength={100}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              style={styles.input}
            />
          </label>
          <label style={styles.label}>
            Nom
            <input
              type="text"
              maxLength={100}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              style={styles.input}
            />
          </label>
        </div>

        <label style={styles.label}>
          Email
          <input
            type="email"
            required
            maxLength={255}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.input}
          />
        </label>

        <div className="form-row" style={styles.fieldRow}>
          <label style={styles.label}>
            Rôle
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              style={styles.input}
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.label}>
            Manager
            <select
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
              style={styles.input}
            >
              <option value="">Aucun</option>
              {managerOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {`${m.first_name} ${m.last_name}`.trim() || m.email}
                  {` — ${ROLE_LABEL[m.role]}`}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label style={styles.checkLabel}>
          <input
            type="checkbox"
            checked={isActive}
            disabled={isSelf}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Compte actif
          {isSelf && (
            <span style={styles.subtle}>
              — vous ne pouvez pas désactiver votre propre compte
            </span>
          )}
        </label>

        {!user.has_password && (
          <p style={styles.muted}>
            Ce compte n'a pas encore de mot de passe : son lien d'activation
            n'est plus affichable. Utilisez « Mot de passe » pour lui en définir
            un directement.
          </p>
        )}

        {error && <div style={styles.error}>{error}</div>}

        <div className="modal-actions" style={styles.actionRow}>
          <button type="submit" disabled={saving} style={styles.primary}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <button type="button" onClick={onClose} style={styles.secondary}>
            Annuler
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Modale : réinitialisation du mot de passe
// ---------------------------------------------------------------------------

function PasswordDialog({
  user,
  onClose,
  onSaved,
}: {
  user: UserWithBalances;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await apiFetch(`/api/users/${user.id}/password`, {
        method: 'PATCH',
        body: { password },
      });
      onSaved(
        `Mot de passe réinitialisé pour ${user.email}. Communiquez-le lui : ` +
          `il pourra le changer depuis son profil.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
      setSaving(false);
    }
  }

  return (
    <Dialog title={`Mot de passe — ${user.email}`} onClose={onClose}>
      <form onSubmit={handleSubmit} style={styles.form}>
        <p style={styles.muted}>
          Vous définissez directement un mot de passe provisoire. Il n'est pas
          envoyé par mail : transmettez-le à l'intéressé par un autre canal.
        </p>
        <label style={styles.label}>
          Nouveau mot de passe (8 caractères minimum)
          <input
            type="text"
            required
            minLength={8}
            maxLength={200}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
          />
        </label>

        {error && <div style={styles.error}>{error}</div>}

        <div className="modal-actions" style={styles.actionRow}>
          <button
            type="submit"
            disabled={saving || password.length < 8}
            style={styles.primary}
          >
            {saving ? 'Enregistrement…' : 'Réinitialiser'}
          </button>
          <button type="button" onClick={onClose} style={styles.secondary}>
            Annuler
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Coquille de modale partagée par les trois dialogues
// ---------------------------------------------------------------------------

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      style={styles.overlay}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal"
        style={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-header" style={styles.modalHeader}>
          <h2 className="modal-title" style={styles.modalTitle}>{title}</h2>
          <button onClick={onClose} style={styles.close} aria-label="Fermer">
            ×
          </button>
        </header>
        <div className="modal-body" style={styles.modalBody}>{children}</div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 20,
  },
  title: { margin: 0, fontSize: 22 },
  count: { fontSize: 13, color: '#9a9aa0' },
  tableWrap: { overflowX: 'auto', border: '1px solid #e0e0e5', borderRadius: 8 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: {
    textAlign: 'left',
    padding: '10px 14px',
    background: '#f5f5f7',
    borderBottom: '1px solid #e0e0e5',
    fontWeight: 600,
    color: '#606066',
    whiteSpace: 'nowrap',
  },
  td: { padding: '10px 14px', borderBottom: '1px solid #f0f0f2' },
  subtle: { color: '#9a9aa0', fontSize: 12 },
  pill: { padding: '3px 9px', borderRadius: 12, fontSize: 12, fontWeight: 600 },
  pillOk: { background: '#e6f4ea', color: '#1e7c3a' },
  pillWait: { background: '#fff4e0', color: '#b26a00' },
  linkButton: {
    border: 'none',
    background: 'transparent',
    color: '#0b5fff',
    cursor: 'pointer',
    fontSize: 13,
    padding: '0 0 0 12px',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    zIndex: 1000,
  },
  modal: {
    width: 'min(520px, 100%)',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#fff',
    borderRadius: 10,
    boxShadow: '0 12px 32px rgba(0,0,0,0.2)',
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    padding: '16px 20px',
    borderBottom: '1px solid #e0e0e5',
  },
  modalTitle: { margin: 0, fontSize: 17 },
  modalBody: { padding: 20, overflowY: 'auto' },
  close: {
    border: 'none',
    background: 'transparent',
    fontSize: 24,
    lineHeight: 1,
    cursor: 'pointer',
    color: '#606066',
  },
  form: { display: 'grid', gap: 14 },
  label: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 },
  input: {
    padding: '9px 12px',
    borderRadius: 6,
    border: '1px solid #d0d0d5',
    fontSize: 14,
    fontFamily: 'inherit',
  },
  balanceList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'grid',
    gap: 6,
  },
  balanceRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    background: '#f5f5f7',
    borderRadius: 6,
    fontSize: 13,
  },
  balanceLabel: { flex: 1 },
  dot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  actionRow: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  fieldRow: { display: 'flex', gap: 14, flexWrap: 'wrap' },
  checkLabel: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 },
  row: { cursor: 'pointer' },
  inactiveRow: { opacity: 0.55 },
  switch: {
    width: 38,
    height: 22,
    borderRadius: 11,
    border: 'none',
    background: '#c9ccd4',
    padding: 2,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
  },
  switchOn: { background: '#1e7c3a' },
  switchLocked: { cursor: 'not-allowed', opacity: 0.5 },
  knob: {
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: '#fff',
    transition: 'transform 120ms',
  },
  knobOn: { transform: 'translateX(16px)' },
  primary: {
    padding: '9px 16px',
    borderRadius: 6,
    border: 'none',
    background: '#0b5fff',
    color: '#fff',
    fontSize: 14,
    cursor: 'pointer',
  },
  secondary: {
    padding: '9px 16px',
    borderRadius: 6,
    border: '1px solid #d0d0d5',
    background: '#fff',
    fontSize: 14,
    cursor: 'pointer',
  },
  muted: { margin: 0, color: '#9a9aa0', fontSize: 13 },
  success: {
    padding: '8px 12px',
    borderRadius: 6,
    background: '#e6f4ea',
    color: '#1e7c3a',
    fontSize: 13,
    marginBottom: 16,
  },
  error: {
    padding: '8px 12px',
    borderRadius: 6,
    background: '#fdecea',
    color: '#b3261e',
    fontSize: 13,
  },
};

export default LeaveHRPage;
