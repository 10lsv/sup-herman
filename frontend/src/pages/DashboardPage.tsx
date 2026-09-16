import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, getSessionUser } from '../api';
import { ExpenseDetailModal } from '../components/ExpenseDetailModal';
import { LeaveDetailModal } from '../components/LeaveDetailModal';
import {
  EXPENSE_PENDING_BY_ROLE,
  STATUS_COLOR,
  STATUS_LABEL,
  formatAmount,
  formatDate,
} from '../expenseLabels';
import {
  LEAVE_PENDING_BY_ROLE,
  formatDays,
  formatLeaveDate,
  isApprovedLeave,
  leaveTypeColor,
  todayISO,
} from '../leaveLabels';
import { ROLE_LABEL } from '../roleLabels';
import type {
  ExpenseNote,
  ExpenseNoteWithUser,
  LeaveBalanceSummary,
  LeaveRequestDetail,
} from '../types';

/** Libellés du sujet xFINT1, dans l'ordre du circuit. */
const EXPENSE_LABELS = ['Créée', 'Validée', 'Refusée', 'Traitée'];

/** Soldes mis en avant sur la carte Congés. */
const HEADLINE_BALANCES = [
  { code: 'PAID', label: 'Congés payés' },
  { code: 'RTT', label: 'RTT' },
];

/**
 * Page d'accueil : synthèse des notes de frais et des congés de l'utilisateur,
 * plus, pour les rôles valideurs, ce qui attend leur décision.
 */
export function DashboardPage() {
  const user = getSessionUser();
  const userId = user?.id;
  const role = user?.role;

  // Les listes globales ne sont lisibles que par les rôles valideurs
  // (GET /api/expenses/all : manager, comptabilité, admin ; GET /api/leaves/all :
  // manager, RH, admin). On n'appelle que celles auxquelles le rôle a droit.
  const expensePending = role ? EXPENSE_PENDING_BY_ROLE[role] : undefined;
  const leavePending = role ? LEAVE_PENDING_BY_ROLE[role] : undefined;

  const [notes, setNotes] = useState<ExpenseNote[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequestDetail[]>([]);
  const [balances, setBalances] = useState<LeaveBalanceSummary[]>([]);
  const [expenseQueue, setExpenseQueue] = useState<number | null>(null);
  const [leaveQueue, setLeaveQueue] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<number | null>(null);
  const [selectedLeave, setSelectedLeave] = useState<number | null>(null);

  // Aucun setState avant le premier await : après une décision prise dans une
  // modale, la page reste affichée pendant le rechargement.
  const load = useCallback(async () => {
    if (userId === undefined) return;
    try {
      const [noteData, leaveData, balanceData, allNotes, allLeaves] = await Promise.all([
        apiFetch<ExpenseNote[]>('/api/expenses/mine'),
        apiFetch<LeaveRequestDetail[]>('/api/leaves/mine'),
        apiFetch<LeaveBalanceSummary[]>(`/api/leaves/balance/${userId}`),
        expensePending
          ? apiFetch<ExpenseNoteWithUser[]>('/api/expenses/all')
          : Promise.resolve(null),
        leavePending
          ? apiFetch<LeaveRequestDetail[]>('/api/leaves/all')
          : Promise.resolve(null),
      ]);
      setNotes(noteData);
      setLeaves(leaveData);
      setBalances(balanceData);
      // Même règle que les écrans de validation : on ne compte pas ses propres
      // éléments, qu'on n'a pas le droit de valider.
      setExpenseQueue(
        allNotes && expensePending
          ? allNotes.filter((n) => expensePending.includes(n.status) && n.user_id !== userId)
              .length
          : null,
      );
      setLeaveQueue(
        allLeaves && leavePending
          ? allLeaves.filter((l) => leavePending.includes(l.status) && l.user_id !== userId)
              .length
          : null,
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [userId, expensePending, leavePending]);

  useEffect(() => {
    void load();
  }, [load]);

  const today = todayISO();

  const expenseCounts = useMemo(() => {
    const counts = new Map<string, number>(EXPENSE_LABELS.map((l) => [l, 0]));
    for (const n of notes) {
      const label = STATUS_LABEL[n.status];
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return counts;
  }, [notes]);

  const latestNotes = useMemo(
    () =>
      [...notes]
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
        .slice(0, 3),
    [notes],
  );

  // En cours de validation : ni refusée ni annulée, pas encore confirmée par la RH.
  const pendingLeaves = leaves.filter(
    (l) => l.status === 'submitted' || l.status === 'approved_manager',
  ).length;

  // Prochain congé validé, y compris celui en cours.
  const nextLeave = useMemo(
    () =>
      leaves
        .filter((l) => isApprovedLeave(l.status) && l.end_date >= today)
        .sort((a, b) => a.start_date.localeCompare(b.start_date))[0],
    [leaves, today],
  );

  if (!user) {
    return (
      <section>
        <h1 style={styles.title}>Accueil</h1>
        <p style={styles.muted}>
          Session introuvable. <Link to="/login">Se reconnecter</Link>.
        </p>
      </section>
    );
  }

  const showQueue = expensePending !== undefined || leavePending !== undefined;

  return (
    <section>
      <header style={styles.banner}>
        <h1 style={styles.title}>Bonjour {user.first_name || user.email}</h1>
        <span style={styles.roleTag}>{ROLE_LABEL[user.role]}</span>
      </header>

      {error && <div style={styles.error}>{error}</div>}
      {loading && <p style={styles.muted}>Chargement…</p>}

      {!loading && (
        <div style={styles.grid}>
          {/* ------------------------------------------------ Notes de frais */}
          <article style={styles.card}>
            <h2 style={styles.h2}>Notes de frais</h2>

            <div style={styles.stats}>
              {EXPENSE_LABELS.map((label) => (
                <div key={label} style={styles.stat}>
                  <span style={styles.statValue}>{expenseCounts.get(label)}</span>
                  <span style={styles.statLabel}>{label}</span>
                </div>
              ))}
            </div>

            <h3 style={styles.h3}>Dernières notes</h3>
            {latestNotes.length === 0 ? (
              <p style={styles.muted}>Aucune note de frais pour l'instant.</p>
            ) : (
              <ul style={styles.list}>
                {latestNotes.map((n) => (
                  <li key={n.id}>
                    <button onClick={() => setSelectedNote(n.id)} style={styles.item}>
                      <span style={styles.itemMain}>
                        <strong style={styles.itemTitle}>{n.title}</strong>
                        <span style={styles.muted}>
                          {formatDate(n.expense_date)} · {formatAmount(n.amount, n.currency)}
                        </span>
                      </span>
                      <span
                        style={{
                          ...styles.badge,
                          background: STATUS_COLOR[n.status].bg,
                          color: STATUS_COLOR[n.status].fg,
                        }}
                      >
                        {STATUS_LABEL[n.status]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div style={styles.actions}>
              <Link to="/expenses" style={styles.secondary}>
                Mes notes
              </Link>
              <Link to="/expenses/new" style={styles.primary}>
                + Nouvelle note
              </Link>
            </div>
          </article>

          {/* -------------------------------------------------------- Congés */}
          <article style={styles.card}>
            <h2 style={styles.h2}>Congés</h2>

            <div style={styles.stats}>
              {HEADLINE_BALANCES.map(({ code, label }) => {
                const balance = balances.find((b) => b.code === code);
                return (
                  <div key={code} style={styles.stat}>
                    <span style={styles.statValue}>
                      {balance ? balance.remaining_days : '—'}
                      <span style={styles.statUnit}> j</span>
                    </span>
                    <span style={styles.statLabel}>
                      <span style={{ ...styles.dot, background: leaveTypeColor(code) }} />
                      {label} restants
                    </span>
                  </div>
                );
              })}
              <div style={styles.stat}>
                <span style={styles.statValue}>{pendingLeaves}</span>
                <span style={styles.statLabel}>En attente de validation</span>
              </div>
            </div>

            <h3 style={styles.h3}>Prochain congé validé</h3>
            {nextLeave ? (
              <button onClick={() => setSelectedLeave(nextLeave.id)} style={styles.item}>
                <span
                  style={{ ...styles.dot, background: leaveTypeColor(nextLeave.leave_type_code) }}
                />
                <span style={styles.itemMain}>
                  <strong style={styles.itemTitle}>{nextLeave.leave_type_label}</strong>
                  <span style={styles.muted}>
                    {formatLeaveDate(nextLeave.start_date)} →{' '}
                    {formatLeaveDate(nextLeave.end_date)} · {formatDays(nextLeave.days_requested)}
                  </span>
                </span>
                {nextLeave.start_date <= today && <span style={styles.nowTag}>En cours</span>}
              </button>
            ) : (
              <p style={styles.muted}>Aucun congé validé à venir.</p>
            )}

            <div style={styles.actions}>
              <Link to="/leaves/list" style={styles.secondary}>
                Mes demandes
              </Link>
              <Link to="/leaves/new" style={styles.primary}>
                + Demander un congé
              </Link>
            </div>
          </article>

          {/* ---------------------------------------------------- À traiter */}
          {showQueue && (
            <article style={styles.card}>
              <h2 style={styles.h2}>À traiter</h2>
              <ul style={styles.list}>
                {expenseQueue !== null && (
                  <li>
                    <Link to="/expenses/approvals" style={styles.queueItem}>
                      <span style={styles.statValue}>{expenseQueue}</span>
                      <span style={styles.itemMain}>
                        <strong>Notes de frais à valider</strong>
                        <span style={styles.muted}>Ouvrir l'écran de validation →</span>
                      </span>
                    </Link>
                  </li>
                )}
                {leaveQueue !== null && (
                  <li>
                    <Link to="/leaves/approvals" style={styles.queueItem}>
                      <span style={styles.statValue}>{leaveQueue}</span>
                      <span style={styles.itemMain}>
                        <strong>Congés à valider</strong>
                        <span style={styles.muted}>Ouvrir l'écran de validation →</span>
                      </span>
                    </Link>
                  </li>
                )}
              </ul>
            </article>
          )}
        </div>
      )}

      {selectedNote !== null && (
        <ExpenseDetailModal
          expenseId={selectedNote}
          onClose={() => setSelectedNote(null)}
          onUpdated={() => void load()}
        />
      )}
      {selectedLeave !== null && (
        <LeaveDetailModal
          leaveId={selectedLeave}
          onClose={() => setSelectedLeave(null)}
          onUpdated={() => void load()}
        />
      )}
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  title: { margin: 0, fontSize: 22 },
  roleTag: {
    padding: '3px 10px',
    borderRadius: 12,
    background: '#e3f0ff',
    color: '#0b5fff',
    fontSize: 12,
    fontWeight: 600,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
    gap: 16,
    alignItems: 'start',
  },
  card: {
    padding: 16,
    border: '1px solid #e0e0e5',
    borderRadius: 8,
    display: 'grid',
    gap: 12,
    minWidth: 0,
  },
  h2: { margin: 0, fontSize: 17, color: '#1a1a1f', fontWeight: 600 },
  h3: { margin: 0, fontSize: 13, color: '#606066', fontWeight: 600 },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))',
    gap: 8,
  },
  stat: {
    display: 'grid',
    gap: 4,
    padding: '10px 8px',
    background: '#f5f5f7',
    borderRadius: 6,
  },
  statValue: { fontSize: 24, fontWeight: 700, lineHeight: 1, color: '#1a1a1f' },
  statUnit: { fontSize: 13, fontWeight: 400, color: '#9a9aa0' },
  statLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: '#606066',
  },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 },
  item: {
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
    color: 'inherit',
  },
  queueItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '12px',
    border: '1px solid #e0e0e5',
    borderRadius: 6,
    color: '#1a1a1f',
    textDecoration: 'none',
  },
  itemMain: { flex: 1, minWidth: 0, display: 'grid', gap: 2, fontSize: 14 },
  itemTitle: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
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
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  primary: {
    padding: '9px 16px',
    borderRadius: 6,
    background: '#0b5fff',
    color: '#fff',
    fontSize: 14,
    textDecoration: 'none',
  },
  secondary: {
    padding: '9px 16px',
    borderRadius: 6,
    border: '1px solid #d0d0d5',
    background: '#fff',
    color: '#1a1a1f',
    fontSize: 14,
    textDecoration: 'none',
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

export default DashboardPage;
