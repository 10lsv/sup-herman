import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../api';
import { ExpenseDetailModal } from '../../components/ExpenseDetailModal';
import {
  STATUS_COLOR,
  STATUS_LABEL,
  formatAmount,
  formatDate,
} from '../../expenseLabels';
import type { ExpenseNote } from '../../types';

export function ExpenseListPage() {
  const [notes, setNotes] = useState<ExpenseNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Aucun setState avant le premier await : au rafraîchissement on garde la
  // liste courante affichée au lieu de repasser par un état de chargement.
  const load = useCallback(async () => {
    try {
      const data = await apiFetch<ExpenseNote[]>('/api/expenses/mine');
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

  return (
    <section>
      <header className="page-header" style={styles.header}>
        <h1 style={styles.title}>Mes notes de frais</h1>
        <Link to="/expenses/new" style={styles.newButton}>
          + Nouvelle note
        </Link>
      </header>

      {error && <div style={styles.error}>{error}</div>}

      {loading ? (
        <p style={styles.muted}>Chargement…</p>
      ) : notes.length === 0 ? (
        <p style={styles.muted}>
          Aucune note de frais pour l'instant.{' '}
          <Link to="/expenses/new">Créer la première</Link>.
        </p>
      ) : (
        <div className="table-scroll" style={styles.tableWrap}>
          <table className="data-table" style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Titre</th>
                <th style={styles.th}>Statut</th>
                <th style={styles.th}>Date</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Montant</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {notes.map((note) => (
                <tr
                  key={note.id}
                  onClick={() => setSelectedId(note.id)}
                  style={styles.row}
                >
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
  newButton: {
    padding: '9px 16px',
    borderRadius: 6,
    background: '#0b5fff',
    color: '#fff',
    fontSize: 14,
    textDecoration: 'none',
  },
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

export default ExpenseListPage;
