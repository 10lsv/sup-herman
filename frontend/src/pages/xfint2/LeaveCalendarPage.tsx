import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, getSessionUser } from '../../api';
import { LeaveDetailModal } from '../../components/LeaveDetailModal';
import { isHoliday, isWeekend } from '../../businessDays';
import {
  formatDays,
  leaveTypeColor,
  todayISO,
} from '../../leaveLabels';
import type { CalendarLeave, ManagerSummary, UserRole } from '../../types';

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

function isoOf(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Cases du mois affiché, complétées pour commencer un lundi et finir un
 * dimanche. `null` = case de remplissage hors du mois.
 */
function monthGrid(year: number, month: number): (string | null)[] {
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  // getUTCDay() renvoie 0 pour dimanche ; la grille commence le lundi.
  const leading = (firstDay + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const cells: (string | null)[] = Array<string | null>(leading).fill(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(isoOf(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Rôles autorisés à ouvrir le détail d'une demande qui n'est pas la leur. */
const DETAIL_ROLES: UserRole[] = ['manager', 'hr', 'admin'];

/** `mine`, `all` ou `team:<manager_id>`. */
type Scope = 'mine' | 'all' | `team:${number}`;

function personName(first: string, last: string, fallback: string): string {
  return `${first} ${last}`.trim() || fallback;
}

export function LeaveCalendarPage() {
  const user = getSessionUser();
  const [leaves, setLeaves] = useState<CalendarLeave[]>([]);
  const [managers, setManagers] = useState<ManagerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Un manager arrive sur son équipe ; les autres sur toute l'entreprise.
  const [scope, setScope] = useState<Scope>(() =>
    user?.role === 'manager' ? `team:${user.id}` : 'all',
  );

  const today = todayISO();
  const [cursor, setCursor] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)) - 1,
  }));

  useEffect(() => {
    apiFetch<ManagerSummary[]>('/api/users/managers')
      .then(setManagers)
      .catch(() => setManagers([]));
  }, []);

  // Le serveur ne renvoie que les congés validés qui chevauchent le mois
  // affiché ; l'équipe est filtrée côté serveur, « Mes congés » côté client.
  // Aucun setState avant le premier await : le mois courant reste affiché
  // pendant le chargement du suivant.
  const load = useCallback(async () => {
    const daysInMonth = new Date(Date.UTC(cursor.year, cursor.month + 1, 0)).getUTCDate();
    const params = new URLSearchParams({
      from: isoOf(cursor.year, cursor.month, 1),
      to: isoOf(cursor.year, cursor.month, daysInMonth),
    });
    if (scope.startsWith('team:')) params.set('team', scope.slice('team:'.length));
    try {
      const data = await apiFetch<CalendarLeave[]>(`/api/leaves/calendar?${params}`);
      setLeaves(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [cursor.year, cursor.month, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => (scope === 'mine' ? leaves.filter((l) => l.user_id === user?.id) : leaves),
    [leaves, scope, user?.id],
  );

  const canOpen = (l: CalendarLeave) =>
    l.user_id === user?.id || (user !== null && DETAIL_ROLES.includes(user.role));

  const cells = useMemo(
    () => monthGrid(cursor.year, cursor.month),
    [cursor.year, cursor.month],
  );

  // Index jour ISO → congés couvrant ce jour, construit une fois par mois affiché.
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarLeave[]>();
    for (const iso of cells) {
      if (!iso) continue;
      const hits = visible.filter((l) => l.date_start <= iso && l.date_end >= iso);
      if (hits.length > 0) map.set(iso, hits);
    }
    return map;
  }, [cells, visible]);

  const legend = useMemo(() => {
    const byCode = new Map<string, string>();
    for (const l of visible) byCode.set(l.leave_type.code, l.leave_type.label);
    return [...byCode.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [visible]);

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const m = c.month + delta;
      return {
        year: c.year + Math.floor(m / 12),
        month: ((m % 12) + 12) % 12,
      };
    });
  }

  return (
    <section>
      <header style={styles.header}>
        <h1 style={styles.title}>Calendrier des congés</h1>
        <div className="cal-controls" style={styles.controls}>
          <label style={styles.filterLabel}>
            Affichage
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
              style={styles.select}
            >
              <option value="mine">Mes congés</option>
              <option value="all">Toute l'entreprise</option>
              {managers.length > 0 && (
                <optgroup label="Équipes">
                  {managers.map((m) => (
                    <option key={m.id} value={`team:${m.id}`}>
                      Équipe {personName(m.first_name, m.last_name, `#${m.id}`)}
                      {m.id === user?.id ? ' (la mienne)' : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <div className="cal-nav" style={styles.nav}>
            <button onClick={() => shiftMonth(-1)} style={styles.navButton}>
              ‹
            </button>
            <span className="cal-month" style={styles.monthLabel}>
              {MONTHS[cursor.month]} {cursor.year}
            </span>
            <button onClick={() => shiftMonth(1)} style={styles.navButton}>
              ›
            </button>
          </div>
        </div>
      </header>

      {error && <div style={styles.error}>{error}</div>}
      {loading && <p style={styles.muted}>Chargement…</p>}

      {!loading && (
        <>
          {legend.length > 0 && (
            <div style={styles.legend}>
              {legend.map(([code, label]) => (
                <span key={code} style={styles.legendItem}>
                  <span style={{ ...styles.dot, background: leaveTypeColor(code) }} />
                  {label}
                </span>
              ))}
            </div>
          )}

          <div style={styles.grid}>
            {WEEKDAYS.map((d) => (
              <div key={d} className="cal-weekday" style={styles.weekday}>
                {d}
              </div>
            ))}

            {cells.map((iso, index) => {
              if (!iso) {
                return <div key={`pad-${index}`} className="cal-pad" style={styles.padCell} />;
              }
              const dayLeaves = byDay.get(iso) ?? [];
              const off = isWeekend(iso) || isHoliday(iso);
              return (
                <div
                  key={iso}
                  className="cal-cell"
                  style={{
                    ...styles.cell,
                    ...(off ? styles.offCell : {}),
                    ...(iso === today ? styles.todayCell : {}),
                  }}
                >
                  <div className="cal-day" style={styles.dayNumber}>
                    {Number(iso.slice(8, 10))}
                    {isHoliday(iso) && (
                      <span className="cal-holiday" title="Jour férié" style={styles.holiday}>
                        férié
                      </span>
                    )}
                  </div>
                  <div style={styles.entries}>
                    {dayLeaves.slice(0, 3).map((l) => {
                      const name = personName(
                        l.user_first_name,
                        l.user_last_name,
                        `Salarié #${l.user_id}`,
                      );
                      const openable = canOpen(l);
                      return (
                        <button
                          key={l.id}
                          type="button"
                          onClick={openable ? () => setSelectedId(l.id) : undefined}
                          aria-disabled={!openable}
                          title={
                            `${name} — ${l.leave_type.label} (${formatDays(l.days_requested)})` +
                            (l.status === 'approved_manager' ? ' — en attente de confirmation RH' : '')
                          }
                          className="cal-entry"
                          style={{
                            ...styles.entry,
                            background: leaveTypeColor(l.leave_type.code),
                            ...(openable ? {} : styles.entryStatic),
                            ...(l.status === 'approved_manager' ? styles.entryPending : {}),
                          }}
                        >
                          {l.user_first_name || name}
                        </button>
                      );
                    })}
                    {dayLeaves.length > 3 && (
                      <span className="cal-more" style={styles.more}>+{dayLeaves.length - 3}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {visible.length === 0 && (
            <p style={styles.muted}>Aucun congé validé à afficher.</p>
          )}
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
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  title: { margin: 0, fontSize: 22 },
  controls: { display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' },
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
  },
  nav: { display: 'flex', alignItems: 'center', gap: 8 },
  navButton: {
    width: 32,
    height: 32,
    borderRadius: 6,
    border: '1px solid #d0d0d5',
    background: '#fff',
    fontSize: 18,
    lineHeight: 1,
    cursor: 'pointer',
  },
  monthLabel: { fontSize: 15, fontWeight: 600, minWidth: 140, textAlign: 'center' },
  legend: { display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12, fontSize: 13 },
  legendItem: { display: 'flex', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: '50%', display: 'inline-block' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gap: 1,
    background: '#e0e0e5',
    border: '1px solid #e0e0e5',
    borderRadius: 8,
    overflow: 'hidden',
  },
  weekday: {
    background: '#f5f5f7',
    padding: '8px 4px',
    fontSize: 12,
    fontWeight: 600,
    color: '#606066',
    textAlign: 'center',
  },
  padCell: { background: '#fafafb', minHeight: 92 },
  // minmax(0, 1fr) : sans piste explicite, une entrée en nowrap élargit la case
  // au lieu d'être tronquée par son ellipsis.
  cell: {
    background: '#fff',
    minHeight: 92,
    padding: 6,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: 4,
    alignContent: 'start',
  },
  offCell: { background: '#fafafb' },
  todayCell: { boxShadow: 'inset 0 0 0 2px #0b5fff' },
  dayNumber: {
    fontSize: 12,
    color: '#606066',
    display: 'flex',
    justifyContent: 'space-between',
    gap: 4,
  },
  holiday: { fontSize: 10, color: '#b3261e' },
  entries: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 2 },
  entry: {
    border: 'none',
    borderRadius: 4,
    padding: '2px 6px',
    color: '#fff',
    fontSize: 11,
    fontFamily: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // Détail réservé au salarié concerné et aux valideurs (GET /api/leaves/:id).
  entryStatic: { cursor: 'default' },
  // Validé par le manager, pas encore confirmé par la RH.
  entryPending: { opacity: 0.6 },
  more: { fontSize: 10, color: '#9a9aa0' },
  muted: { color: '#9a9aa0', marginTop: 12 },
  error: {
    padding: '8px 12px',
    borderRadius: 6,
    background: '#fdecea',
    color: '#b3261e',
    fontSize: 13,
    marginBottom: 16,
  },
};

export default LeaveCalendarPage;
