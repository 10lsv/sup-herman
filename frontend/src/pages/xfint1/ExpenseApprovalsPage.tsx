import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, getSessionUser } from '../../api';
import { ExpenseDetailModal } from '../../components/ExpenseDetailModal';
import {
  EXPENSE_PENDING_BY_ROLE,
  STATUS_COLOR,
  STATUS_LABEL,
  formatAmount,
  formatDate,
} from '../../expenseLabels';
import type { ExpenseNoteWithUser } from '../../types';

export function ExpenseApprovalsPage() {
  const user = getSessionUser();
  const [notes, setNotes] = useState<ExpenseNoteWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pendingOnly, setPendingOnly] = useState(true);

  // Aucun setState avant le premier await : après une décision prise dans la
  // modale, la liste reste affichée pendant le rechargement.
  const load = useCallback(async () => {
    try {
      const data = await apiFetch<ExpenseNoteWithUser[]>('/api/expenses/all');
      setNotes(data);
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

  const pendingStatuses = user ? EXPENSE_PENDING_BY_ROLE[user.role] : undefined;

  // On ne peut pas valider sa propre note : elle est exclue de la file d'attente
  // (mais reste visible en vue complète).
  const visible = useMemo(() => {
    if (!pendingOnly || !pendingStatuses) return notes;
    return notes.filter(
      (n) => pendingStatuses.includes(n.status) && n.user_id !== user?.id,
    );
  }, [notes, pendingOnly, pendingStatuses, user?.id]);

  return (
    <section>
      <header className="page-header" style={styles.header}>
        <h1 style={styles.title}>Notes de frais — validation</h1>
        {pendingStatuses && (
          <label style={styles.filter}>
            <input
              type="checkbox"
              checked={pendingOnly}
              onChange={(e) => setPendingOnly(e.target.checked)}
            />
            À traiter uniquement
          </label>
        )}
      </header>

      {error && <div style={styles.error}>{error}</div>}

      {loading ? (
        <p style={styles.muted}>Chargement…</p>
      ) : visible.length === 0 ? (
        <p style={styles.muted}>
          {pendingOnly && notes.length > 0
            ? 'Aucune note en attente de votre décision.'
            : 'Aucune note de frais.'}
        </p>
      ) : (
        <div className="table-scroll" style={styles.tableWrap}>
          <table className="data-table" style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Salarié</th>
                <th style={styles.th}>Titre</th>
                <th style={styles.th}>Statut</th>
                <th style={styles.th}>Date</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Montant</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((note) => (
                <tr
                  key={note.id}
                  onClick={() => setSelectedId(note.id)}
                  style={styles.row}
                >
                  <td style={styles.td}>
                    <div>
                      {note.user_first_name} {note.user_last_name}
                    </div>
                    <div style={styles.subtle}>{note.user_email}</div>
                  </td>
                  <td style={styles.td}>{note.title}</td>
                  <td style={styles.td}>
                    <span
                      style={{
                        ...styles.badge,
                        background: STATUS_COLOR[note.status].bg,
                        color: STATUS_COLOR[note.status].fg,
                      }}
                    >
                      {STATUS_LABEL[note.status]}
                    </span>
                  </td>
                  <td style={styles.td}>{formatDate(note.expense_date)}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    {formatAmount(note.amount, note.currency)}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId(note.id);
                      }}
                      style={styles.linkButton}
                    >
                      Voir détails
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* La modale expose déjà Valider/Refuser (manager) et Marquer traitée
          (comptabilité) selon le rôle et le statut courant. */}
      {selectedId !== null && (
        <ExpenseDetailModal
          expenseId={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdated={() => void load()}
        />
      )}
    </section>
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
  filter: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 },
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
  row: { cursor: 'pointer' },
  td: { padding: '10px 14px', borderBottom: '1px solid #f0f0f2' },
  subtle: { color: '#9a9aa0', fontSize: 12 },
  badge: {
    display: 'inline-block',
    padding: '3px 9px',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  linkButton: {
    border: 'none',
    background: 'transparent',
    color: '#0b5fff',
    cursor: 'pointer',
    fontSize: 13,
    padding: 0,
  },
  muted: { color: '#9a9aa0' },
  error: {
    padding: '8px 12px',
    borderRadius: 6,
    background: '#fdecea',
    color: '#b3261e',
    fontSize: 13,
    marginBottom: 16,
  },
};

export default ExpenseApprovalsPage;
