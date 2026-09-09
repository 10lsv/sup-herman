import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, getSessionUser } from '../../api';
import { LeaveDetailModal } from '../../components/LeaveDetailModal';
import {
  LEAVE_STATUS_COLOR,
  LEAVE_STATUS_LABEL,
  formatDays,
  formatLeaveDate,
  isApprovedLeave,
  leaveTypeColor,
  todayISO,
} from '../../leaveLabels';
import type { LeaveBalanceSummary, LeaveRequestDetail } from '../../types';

export function LeaveDashboardPage() {
  const user = getSessionUser();
  const [balances, setBalances] = useState<LeaveBalanceSummary[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequestDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const userId = user?.id;

  // Aucun setState avant le premier await : au rafraîchissement, le contenu
  // courant reste affiché au lieu de repasser par un écran de chargement.
  const load = useCallback(async () => {
    if (userId === undefined) return;
    try {
      const [balanceData, leaveData] = await Promise.all([
        apiFetch<LeaveBalanceSummary[]>(`/api/leaves/balance/${userId}`),
        apiFetch<LeaveRequestDetail[]>('/api/leaves/mine'),
      ]);
      setBalances(balanceData);
      setLeaves(leaveData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const today = todayISO();

  const pending = useMemo(
    () =>
      leaves.filter(
        (l) => l.status === 'submitted' || l.status === 'approved_manager',
      ),
    [leaves],
  );

  // Congés validés qui n'ont pas encore commencé, du plus proche au plus loin.
  const upcoming = useMemo(
    () =>
      leaves
        .filter((l) => isApprovedLeave(l.status) && l.end_date >= today)
        .sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [leaves, today],
  );

  const capped = balances.filter((b) => b.is_capped);
  const uncapped = balances.filter((b) => !b.is_capped);

  return (
    <section>
      <header style={styles.header}>
        <h1 style={styles.title}>Mes congés</h1>
        <Link to="/leaves/new" style={styles.newButton}>
          + Demander un congé
        </Link>
      </header>

      {error && <div style={styles.error}>{error}</div>}
      {loading && <p style={styles.muted}>Chargement…</p>}

      {!loading && (
        <>
          <h2 style={styles.h2}>Soldes {balances[0]?.year ?? ''}</h2>
          <div style={styles.cards}>
            {capped.map((b) => {
              const usedRatio =
                b.allocated_days > 0
                  ? Math.min(1, (b.used_days + b.pending_days) / b.allocated_days)
                  : 0;
              return (
                <article key={b.leave_type_id} style={styles.card}>
                  <div style={styles.cardHead}>
                    <span
                      style={{ ...styles.dot, background: leaveTypeColor(b.code) }}
                    />
                    <span style={styles.cardLabel}>{b.label}</span>
                  </div>
                  <div style={styles.cardValue}>
                    {b.remaining_days}
                    <span style={styles.cardUnit}> / {b.allocated_days} j</span>
                  </div>
                  <div style={styles.bar}>
                    <div
                      style={{
                        ...styles.barFill,
                        width: `${usedRatio * 100}%`,
                        background: leaveTypeColor(b.code),
                      }}
                    />
                  </div>
                  <div style={styles.cardFoot}>
                    {b.used_days} pris
                    {b.pending_days > 0 && ` · ${b.pending_days} en attente`}
                  </div>
                </article>
              );
            })}
          </div>

          {uncapped.length > 0 && (
            <p style={styles.muted}>
              Sans plafond :{' '}
              {uncapped
                .map(
                  (b) =>
                    `${b.label} (${b.used_days + b.pending_days} j cette année)`,
                )
                .join(' · ')}
            </p>
          )}

          <div style={styles.columns}>
            <section style={styles.panel}>
              <h2 style={styles.h2}>Demandes en attente ({pending.length})</h2>
              {pending.length === 0 ? (
                <p style={styles.muted}>Aucune demande en cours de validation.</p>
              ) : (
                <ul style={styles.list}>
                  {pending.map((l) => (
                    <li key={l.id}>
                      <button
                        onClick={() => setSelectedId(l.id)}
                        style={styles.itemButton}
                      >
                        <span
                          style={{
                            ...styles.dot,
                            background: leaveTypeColor(l.leave_type_code),
                          }}
                        />
                        <span style={styles.itemMain}>
                          <strong>{l.leave_type_label}</strong>
                          <span style={styles.muted}>
                            {formatLeaveDate(l.start_date)} →{' '}
                            {formatLeaveDate(l.end_date)} ·{' '}
                            {formatDays(l.days_requested)}
                          </span>
                        </span>
                        <span
                          style={{
                            ...styles.badge,
                            background: LEAVE_STATUS_COLOR[l.status].bg,
                            color: LEAVE_STATUS_COLOR[l.status].fg,
                          }}
                        >
                          {LEAVE_STATUS_LABEL[l.status]}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section style={styles.panel}>
              <h2 style={styles.h2}>Prochains congés ({upcoming.length})</h2>
              {upcoming.length === 0 ? (
                <p style={styles.muted}>Aucun congé validé à venir.</p>
              ) : (
                <ul style={styles.list}>
                  {upcoming.map((l) => (
                    <li key={l.id}>
                      <button
                        onClick={() => setSelectedId(l.id)}
                        style={styles.itemButton}
                      >
                        <span
                          style={{
                            ...styles.dot,
                            background: leaveTypeColor(l.leave_type_code),
                          }}
                        />
                        <span style={styles.itemMain}>
                          <strong>{l.leave_type_label}</strong>
                          <span style={styles.muted}>
                            {formatLeaveDate(l.start_date)} →{' '}
                            {formatLeaveDate(l.end_date)} ·{' '}
                            {formatDays(l.days_requested)}
                          </span>
                        </span>
                        {l.start_date <= today && (
                          <span style={styles.nowTag}>En cours</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <p style={styles.muted}>
            <Link to="/leaves/list">Voir toutes mes demandes</Link>
          </p>
        </>
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
  h2: { margin: '0 0 12px', fontSize: 15, color: '#606066', fontWeight: 600 },
  newButton: {
    padding: '9px 16px',
    borderRadius: 6,
    background: '#0b5fff',
    color: '#fff',
    fontSize: 14,
    textDecoration: 'none',
  },
  cards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: 12,
    marginBottom: 12,
  },
  card: {
    padding: 16,
    border: '1px solid #e0e0e5',
    borderRadius: 8,
    display: 'grid',
    gap: 8,
  },
  cardHead: { display: 'flex', alignItems: 'center', gap: 8 },
  cardLabel: { fontSize: 13, color: '#606066' },
  cardValue: { fontSize: 28, fontWeight: 700, lineHeight: 1 },
  cardUnit: { fontSize: 14, fontWeight: 400, color: '#9a9aa0' },
  bar: { height: 6, borderRadius: 3, background: '#f0f0f2', overflow: 'hidden' },
  barFill: { height: '100%' },
  cardFoot: { fontSize: 12, color: '#9a9aa0' },
  columns: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: 20,
    margin: '24px 0 16px',
  },
  panel: { display: 'grid', gap: 4, alignContent: 'start' },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 },
  itemButton: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    border: '1px solid #e0e0e5',
    borderRadius: 6,
    background: '#fff',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
  },
  itemMain: { flex: 1, display: 'grid', gap: 2, fontSize: 14 },
  dot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  badge: {
    padding: '3px 9px',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  nowTag: {
    padding: '3px 9px',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 600,
    background: '#e6f4ea',
    color: '#14532d',
    whiteSpace: 'nowrap',
  },
  muted: { color: '#9a9aa0', fontSize: 13, margin: 0 },
  error: {
    padding: '8px 12px',
    borderRadius: 6,
    background: '#fdecea',
    color: '#b3261e',
    fontSize: 13,
    marginBottom: 16,
  },
};

export default LeaveDashboardPage;
