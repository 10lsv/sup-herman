import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../api';
import { LeaveDetailModal } from '../../components/LeaveDetailModal';
import {
  LEAVE_STATUS_COLOR,
  LEAVE_STATUS_LABEL,
  formatDays,
  formatLeaveDate,
  leaveTypeColor,
} from '../../leaveLabels';
import type { LeaveRequestDetail } from '../../types';

export function LeaveListPage() {
  const [leaves, setLeaves] = useState<LeaveRequestDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<LeaveRequestDetail[]>('/api/leaves/mine');
      setLeaves(data);
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
        <h1 style={styles.title}>Mes demandes de congé</h1>
        <Link to="/leaves/new" style={styles.newButton}>
          + Demander un congé
        </Link>
      </header>

      {error && <div style={styles.error}>{error}</div>}

      {loading ? (
        <p style={styles.muted}>Chargement…</p>
      ) : leaves.length === 0 ? (
        <p style={styles.muted}>
          Aucune demande pour l'instant.{' '}
          <Link to="/leaves/new">Créer la première</Link>.
        </p>
      ) : (
        <div className="table-scroll" style={styles.tableWrap}>
          <table className="data-table" style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Type</th>
                <th style={styles.th}>Du</th>
                <th style={styles.th}>Au</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Jours</th>
                <th style={styles.th}>Statut</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {leaves.map((l) => (
                <tr key={l.id} onClick={() => setSelectedId(l.id)} style={styles.row}>
                  <td style={styles.td}>
                    <span style={styles.typeCell}>
                      <span
                        style={{
                          ...styles.dot,
                          background: leaveTypeColor(l.leave_type_code),
                        }}
                      />
                      {l.leave_type_label}
                    </span>
                  </td>
                  <td style={styles.td}>{formatLeaveDate(l.start_date)}</td>
                  <td style={styles.td}>{formatLeaveDate(l.end_date)}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    {formatDays(l.days_requested)}
                  </td>
                  <td style={styles.td}>
                    <span
                      style={{
                        ...styles.badge,
                        background: LEAVE_STATUS_COLOR[l.status].bg,
                        color: LEAVE_STATUS_COLOR[l.status].fg,
                      }}
                    >
                      {LEAVE_STATUS_LABEL[l.status]}
                    </span>
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId(l.id);
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
        <LeaveDetailModal
          leaveId={selectedId}
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
  typeCell: { display: 'flex', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
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

export default LeaveListPage;
