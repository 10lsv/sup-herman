import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, apiUpload, getSessionUser } from '../../api';
import { businessDaysBetween, countBusinessDays } from '../../businessDays';
import { formatFileSize } from '../../expenseLabels';
import {
  formatLeaveDate,
  isActiveLeave,
  leaveTypeColor,
  todayISO,
} from '../../leaveLabels';
import type {
  LeaveAttachment,
  LeaveBalanceSummary,
  LeaveRequest,
  LeaveRequestDetail,
} from '../../types';

/** Doit rester aligné sur le fileFilter du back (lib/uploads.ts). */
const ACCEPTED = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Types pour lesquels un justificatif est attendu (colonne
 * leave_types.requires_justification côté base).
 */
const NEEDS_JUSTIFICATION = new Set(['SICK', 'TRAINING', 'FAMILY']);

export function LeaveNewPage() {
  const navigate = useNavigate();
  const user = getSessionUser();
  const userId = user?.id;

  const [balances, setBalances] = useState<LeaveBalanceSummary[]>([]);
  const [myLeaves, setMyLeaves] = useState<LeaveRequestDetail[]>([]);
  const [loading, setLoading] = useState(true);

  const [type, setType] = useState('');
  const [dateStart, setDateStart] = useState(todayISO());
  const [dateEnd, setDateEnd] = useState(todayISO());
  const [comment, setComment] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    const tooBig = picked.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) {
      setError(`« ${tooBig.name} » dépasse la limite de 10 Mo.`);
      return;
    }
    setError(null);
    setFiles(picked);
  }

  // Le endpoint de solde renvoie déjà la liste complète des types actifs :
  // il sert donc aussi à peupler le menu déroulant, sans appel dédié.
  const load = useCallback(async () => {
    if (userId === undefined) return;
    try {
      const [balanceData, leaveData] = await Promise.all([
        apiFetch<LeaveBalanceSummary[]>(`/api/leaves/balance/${userId}`),
        apiFetch<LeaveRequestDetail[]>('/api/leaves/mine'),
      ]);
      setBalances(balanceData);
      setMyLeaves(leaveData);
      setType((current) => current || (balanceData[0]?.code ?? ''));
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

  const selected = balances.find((b) => b.code === type);
  const datesOrdered = Boolean(dateStart && dateEnd && dateEnd >= dateStart);

  // Même calcul que le serveur (businessDays.ts est un miroir du module back) :
  // l'affichage correspond donc à ce qui sera réellement enregistré.
  const days = datesOrdered ? countBusinessDays(dateStart, dateEnd) : 0;

  const calendarDays = useMemo(
    () => (datesOrdered ? businessDaysBetween(dateStart, dateEnd) : []),
    [datesOrdered, dateStart, dateEnd],
  );

  const overlapping = useMemo(() => {
    if (!datesOrdered) return null;
    return (
      myLeaves.find(
        (l) =>
          isActiveLeave(l.status) &&
          l.start_date <= dateEnd &&
          l.end_date >= dateStart,
      ) ?? null
    );
  }, [myLeaves, datesOrdered, dateStart, dateEnd]);

  const remainingAfter = selected ? selected.remaining_days - days : 0;
  const overBalance = !!selected && selected.is_capped && days > selected.remaining_days;

  // Le back refait toutes ces vérifications ; ici c'est du retour immédiat.
  const blocking: string[] = [];
  if (dateStart && dateEnd && !datesOrdered) {
    blocking.push('La date de fin doit être postérieure ou égale à la date de début.');
  }
  if (datesOrdered && days === 0) {
    blocking.push(
      'La période ne contient aucun jour ouvré (week-ends et jours fériés exclus).',
    );
  }
  if (overlapping) {
    blocking.push(
      `Cette période chevauche votre demande #${overlapping.id} ` +
        `(${formatLeaveDate(overlapping.start_date)} → ${formatLeaveDate(overlapping.end_date)}).`,
    );
  }
  if (overBalance && selected) {
    blocking.push(
      `Solde insuffisant : ${selected.remaining_days} jour(s) restant(s) sur ` +
        `${selected.label}, ${days} demandé(s).`,
    );
  }

  const canSubmit = !!type && datesOrdered && days > 0 && blocking.length === 0;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const leave = await apiFetch<LeaveRequest>('/api/leaves', {
        method: 'POST',
        body: {
          type,
          date_start: dateStart,
          date_end: dateEnd,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        },
      });

      // La demande existe déjà : un échec d'upload ne doit pas la faire perdre,
      // on prévient et on reste sur le formulaire (même logique qu'ExpenseNewPage).
      if (files.length > 0) {
        const formData = new FormData();
        for (const file of files) formData.append('files', file);
        try {
          await apiUpload<LeaveAttachment[]>(
            `/api/leaves/${leave.id}/attachments`,
            formData,
          );
        } catch (err) {
          const reason = err instanceof Error ? err.message : 'erreur inconnue';
          setError(
            `Demande créée (#${leave.id}), mais l'envoi des justificatifs a échoué : ` +
              `${reason}. Vous pouvez les rajouter depuis le détail de la demande.`,
          );
          setSubmitting(false);
          return;
        }
      }

      navigate('/leaves/list', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h1 style={styles.title}>Demander un congé</h1>

      {loading ? (
        <p style={styles.muted}>Chargement…</p>
      ) : (
        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>
            Type de congé *
            <select
              required
              value={type}
              onChange={(e) => setType(e.target.value)}
              style={styles.input}
            >
              {balances.map((b) => (
                <option key={b.leave_type_id} value={b.code}>
                  {b.label}
                  {b.is_capped ? ` — ${b.remaining_days} j restants` : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="form-row" style={styles.row}>
            <label style={styles.label}>
              Date de début *
              <input
                type="date"
                required
                value={dateStart}
                onChange={(e) => {
                  const value = e.target.value;
                  setDateStart(value);
                  // Confort : on pousse la date de fin plutôt que de laisser
                  // l'utilisateur avec une période invalide.
                  if (dateEnd && value > dateEnd) setDateEnd(value);
                }}
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Date de fin *
              <input
                type="date"
                required
                min={dateStart || undefined}
                value={dateEnd}
                onChange={(e) => setDateEnd(e.target.value)}
                style={styles.input}
              />
            </label>
          </div>

          {/* Récapitulatif calculé en direct : jours ouvrés + impact sur le solde. */}
          <div style={styles.summary}>
            <div style={styles.summaryCell}>
              <span style={styles.summaryLabel}>Jours décomptés</span>
              <span style={styles.summaryValue}>{days}</span>
              <span style={styles.summaryHint}>week-ends et fériés exclus</span>
            </div>
            {selected && (
              <>
                <div style={styles.summaryCell}>
                  <span style={styles.summaryLabel}>
                    <span
                      style={{ ...styles.dot, background: leaveTypeColor(selected.code) }}
                    />
                    Solde {selected.label}
                  </span>
                  <span style={styles.summaryValue}>
                    {selected.is_capped ? selected.remaining_days : '∞'}
                  </span>
                  <span style={styles.summaryHint}>
                    {selected.is_capped
                      ? `sur ${selected.allocated_days} j alloués`
                      : 'type sans plafond'}
                  </span>
                </div>
                <div style={styles.summaryCell}>
                  <span style={styles.summaryLabel}>Après cette demande</span>
                  <span
                    style={{
                      ...styles.summaryValue,
                      color: overBalance ? '#b3261e' : '#1a1a1f',
                    }}
                  >
                    {selected.is_capped ? remainingAfter : '∞'}
                  </span>
                  <span style={styles.summaryHint}>jours restants</span>
                </div>
              </>
            )}
          </div>

          {calendarDays.length > 0 && calendarDays.length <= 31 && (
            <details style={styles.details}>
              <summary style={styles.summaryToggle}>
                Détail des {calendarDays.length} jour(s) décompté(s)
              </summary>
              <ul style={styles.dayList}>
                {calendarDays.map((d) => (
                  <li key={d} style={styles.dayChip}>
                    {formatLeaveDate(d)}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <label style={styles.label}>
            Motif
            <textarea
              rows={3}
              maxLength={5000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Contexte de la demande…"
              style={styles.textarea}
            />
          </label>

          <label style={styles.label}>
            Justificatif {type && NEEDS_JUSTIFICATION.has(type) ? '(attendu)' : '(optionnel)'}
            <input
              type="file"
              multiple
              accept={ACCEPTED}
              onChange={handleFiles}
              style={styles.file}
            />
            <span style={styles.hint}>
              PDF ou image, 10 Mo par fichier, 10 fichiers maximum.
            </span>
          </label>

          {files.length > 0 && (
            <ul style={styles.fileList}>
              {files.map((f) => (
                <li key={`${f.name}-${f.lastModified}`} style={styles.fileItem}>
                  <span style={styles.fileName}>{f.name}</span>
                  <span style={styles.hint}>{formatFileSize(f.size)}</span>
                </li>
              ))}
            </ul>
          )}

          {type && NEEDS_JUSTIFICATION.has(type) && files.length === 0 && (
            <div style={styles.notice}>
              Ce type de congé demande un justificatif. Vous pouvez l'ajouter
              maintenant ou depuis le détail de la demande après envoi.
            </div>
          )}

          {blocking.map((message) => (
            <div key={message} style={styles.warning}>
              {message}
            </div>
          ))}

          {error && <div style={styles.error}>{error}</div>}

          <div className="form-actions" style={styles.actions}>
            <button
              type="submit"
              disabled={submitting || !canSubmit}
              style={{
                ...styles.submit,
                ...(canSubmit ? {} : styles.submitDisabled),
              }}
            >
              {submitting ? 'Envoi…' : 'Envoyer la demande'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/leaves')}
              style={styles.cancel}
            >
              Annuler
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  title: { marginTop: 0, fontSize: 22 },
  form: { display: 'grid', gap: 16, maxWidth: 720 },
  label: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, flex: 1 },
  row: { display: 'flex', gap: 16, flexWrap: 'wrap' },
  input: {
    padding: '9px 12px',
    borderRadius: 6,
    border: '1px solid #d0d0d5',
    fontSize: 14,
    fontFamily: 'inherit',
  },
  textarea: {
    padding: '9px 12px',
    borderRadius: 6,
    border: '1px solid #d0d0d5',
    fontSize: 14,
    fontFamily: 'inherit',
    resize: 'vertical',
  },
  summary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 16,
    padding: 16,
    background: '#f5f5f7',
    borderRadius: 8,
  },
  summaryCell: { display: 'grid', gap: 4 },
  summaryLabel: {
    fontSize: 12,
    color: '#606066',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  summaryValue: { fontSize: 26, fontWeight: 700, lineHeight: 1 },
  summaryHint: { fontSize: 11, color: '#9a9aa0' },
  dot: { width: 9, height: 9, borderRadius: '50%', display: 'inline-block' },
  details: { fontSize: 13 },
  summaryToggle: { cursor: 'pointer', color: '#0b5fff' },
  dayList: {
    listStyle: 'none',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    margin: '10px 0 0',
    padding: 0,
  },
  dayChip: {
    padding: '3px 9px',
    borderRadius: 12,
    background: '#eef1f6',
    fontSize: 12,
  },
  notice: {
    padding: '8px 12px',
    borderRadius: 6,
    background: '#e3f0ff',
    color: '#0b5fff',
    fontSize: 13,
  },
  warning: {
    padding: '8px 12px',
    borderRadius: 6,
    background: '#fff4e0',
    color: '#b26a00',
    fontSize: 13,
  },
  error: {
    padding: '8px 12px',
    borderRadius: 6,
    background: '#fdecea',
    color: '#b3261e',
    fontSize: 13,
  },
  actions: { display: 'flex', gap: 12 },
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
  cancel: {
    padding: '10px 18px',
    borderRadius: 6,
    border: '1px solid #d0d0d5',
    background: '#fff',
    fontSize: 14,
    cursor: 'pointer',
  },
  muted: { color: '#9a9aa0' },
  file: { fontSize: 14 },
  hint: { fontSize: 11, color: '#9a9aa0' },
  fileList: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 },
  fileItem: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    padding: '8px 12px',
    background: '#f5f5f7',
    borderRadius: 6,
    fontSize: 14,
  },
  fileName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
};

export default LeaveNewPage;
