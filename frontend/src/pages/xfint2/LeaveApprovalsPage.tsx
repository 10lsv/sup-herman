import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, getSessionUser } from '../../api';
import { LeaveDetailModal } from '../../components/LeaveDetailModal';
import {
  LEAVE_STATUS_COLOR,
  LEAVE_STATUS_LABEL,
  formatDays,
  formatLeaveDate,
  leaveTypeColor,
} from '../../leaveLabels';
import type { LeaveRequestDetail, LeaveStatus, UserRole } from '../../types';

/**
 * Étape sur laquelle le rôle courant a une décision à rendre. Aligné sur
 * resolveStatus() côté back : le manager traite les `submitted`, la RH les
 * `approved_manager`.
 */
const PENDING_BY_ROLE: Partial<Record<UserRole, LeaveStatus[]>> = {
  manager: ['submitted'],
  hr: ['approved_manager'],
  admin: ['submitted', 'approved_manager'],
};

/**
 * Filtre par libellé affiché : plusieurs statuts internes partagent le même
 * (`submitted` et `approved_manager` sont tous deux « En attente »).
 */
const STATUS_FILTERS: string[] = [
  ...new Set(
    (['submitted', 'approved_manager', 'approved_hr', 'rejected', 'cancelled'] as const).map(
      (s) => LEAVE_STATUS_LABEL[s],
    ),
  ),
];

export function LeaveApprovalsPage() {
  const user = getSessionUser();
  const [leaves, setLeaves] = useState<LeaveRequestDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [pendingOnly, setPendingOnly] = useState(true);
  const [employee, setEmployee] = useState('all');
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<LeaveRequestDetail[]>('/api/leaves/all');
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

  // Options dérivées des données : pas d'appel supplémentaire pour peupler les
  // filtres.
  const employees = useMemo(() => {
    const byEmail = new Map<string, string>();
    for (const l of leaves) {
      byEmail.set(
        l.user_email,
        `${l.user_first_name} ${l.user_last_name}`.trim() || l.user_email,
      );
    }
    return [...byEmail.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [leaves]);

  const types = useMemo(() => {
    const byCode = new Map<string, string>();
    for (const l of leaves) byCode.set(l.leave_type_code, l.leave_type_label);
    return [...byCode.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [leaves]);

  const pendingStatuses = user ? PENDING_BY_ROLE[user.role] : undefined;

  const visible = useMemo(() => {
    return leaves.filter((l) => {
      // « À traiter » exclut les demandes du valideur lui-même : le back refuse
      // qu'on valide sa propre demande.
      if (pendingOnly && pendingStatuses) {
        if (!pendingStatuses.includes(l.status)) return false;
        if (l.user_id === user?.id) return false;
      }
      if (employee !== 'all' && l.user_email !== employee) return false;
      if (status !== 'all' && LEAVE_STATUS_LABEL[l.status] !== status) return false;
      if (type !== 'all' && l.leave_type_code !== type) return false;
      return true;
    });
  }, [leaves, pendingOnly, pendingStatuses, employee, status, type, user?.id]);

  const resetFilters = () => {
    setPendingOnly(false);
    setEmployee('all');
    setStatus('all');
    setType('all');
  };

  return (
    <section>
      <header className="page-header" style={styles.header}>
        <h1 style={styles.title}>Congés — validation</h1>
        <span style={styles.count}>
          {visible.length} / {leaves.length} demande(s)
        </span>
      </header>

      <div className="filters" style={styles.filters}>
        {pendingStatuses && (
          <label style={styles.check}>
            <input
              type="checkbox"
              checked={pendingOnly}
              onChange={(e) => setPendingOnly(e.target.checked)}
            />
            À traiter par moi
          </label>
        )}

        <label style={styles.filterLabel}>
          Salarié
          <select
            value={employee}
            onChange={(e) => setEmployee(e.target.value)}
            style={styles.select}
          >
            <option value="all">Tous</option>
            {employees.map(([email, name]) => (
              <option key={email} value={email}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label style={styles.filterLabel}>
          Statut
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={styles.select}
          >
            <option value="all">Tous</option>
            {STATUS_FILTERS.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label style={styles.filterLabel}>
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            style={styles.select}
          >
            <option value="all">Tous</option>
            {types.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <button onClick={resetFilters} style={styles.reset}>
          Réinitialiser
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {loading ? (
        <p style={styles.muted}>Chargement…</p>
      ) : visible.length === 0 ? (
        <p style={styles.muted}>
          {leaves.length > 0
            ? 'Aucune demande ne correspond aux filtres.'
            : 'Aucune demande de congé.'}
        </p>
      ) : (
        <div className="table-scroll" style={styles.tableWrap}>
          <table className="data-table" style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Salarié</th>
                <th style={styles.th}>Type</th>
                <th style={styles.th}>Du</th>
                <th style={styles.th}>Au</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Jours</th>
                <th style={styles.th}>Statut</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((l) => (
                <tr key={l.id} onClick={() => setSelectedId(l.id)} style={styles.row}>
                  <td style={styles.td}>
                    <div>
                      {l.user_first_name} {l.user_last_name}
                    </div>
                    <div style={styles.subtle}>{l.user_email}</div>
                  </td>
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

      {/* La modale expose Approuver/Refuser selon le rôle et l'étape courante. */}
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
    marginBottom: 16,
  },
  title: { margin: 0, fontSize: 22 },
  count: { fontSize: 13, color: '#9a9aa0' },
  filters: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 16,
    flexWrap: 'wrap',
    padding: '12px 14px',
    background: '#f5f5f7',
    borderRadius: 8,
    marginBottom: 16,
  },
  check: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, height: 34 },
  filterLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: 12,
    color: '#606066',
  },
  select: {
    padding: '7px 10px',
    borderRadius: 6,
    border: '1px solid #d0d0d5',
    fontSize: 14,
    fontFamily: 'inherit',
    background: '#fff',
    minWidth: 140,
  },
  reset: {
    padding: '7px 12px',
    borderRadius: 6,
    border: '1px solid #d0d0d5',
    background: '#fff',
    fontSize: 13,
    cursor: 'pointer',
    height: 34,
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
  subtle: { color: '#9a9aa0', fontSize: 12 },
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

export default LeaveApprovalsPage;
