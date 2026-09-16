import { useCallback, useEffect, useState } from 'react';
import { apiFetch, downloadAttachment, getSessionUser } from '../api';
import {
  CATEGORY_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  formatAmount,
  formatDate,
  formatFileSize,
  isFinalStatus,
} from '../expenseLabels';
import type { ExpenseDecision, ExpenseNoteDetail } from '../types';

interface ExpenseDetailModalProps {
  expenseId: number;
  onClose: () => void;
  /** Appelé après une validation/refus pour rafraîchir la liste appelante. */
  onUpdated?: () => void;
}

export function ExpenseDetailModal({
  expenseId,
  onClose,
  onUpdated,
}: ExpenseDetailModalProps) {
  const user = getSessionUser();
  const [note, setNote] = useState<ExpenseNoteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState(false);

  // Aucun setState avant le premier await (cf. ExpenseListPage) : après une
  // décision, le contenu reste affiché pendant le rechargement.
  const load = useCallback(async () => {
    try {
      const data = await apiFetch<ExpenseNoteDetail>(`/api/expenses/${expenseId}`);
      setNote(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [expenseId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Fermeture au clavier — attendu pour une modale.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleDecision(decision: ExpenseDecision) {
    setActing(true);
    setError(null);
    try {
      await apiFetch(`/api/expenses/${expenseId}/status`, {
        method: 'PATCH',
        body: { status: decision, ...(comment.trim() ? { comment: comment.trim() } : {}) },
      });
      setComment('');
      await load();
      onUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setActing(false);
    }
  }

  async function handleDownload(attachmentId: number, fileName: string) {
    try {
      await downloadAttachment(expenseId, attachmentId, fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Téléchargement impossible');
    }
  }

  // Visibilité des actions calquée sur resolveStatus() côté back : on n'affiche
  // que les transitions réellement acceptées, pour ne pas provoquer de 409.
  const isOwnNote = !!note && !!user && note.user_id === user.id;
  const actionable = !!note && !!user && !isOwnNote && !isFinalStatus(note.status);
  const isManager = user?.role === 'manager' || user?.role === 'admin';
  const isAccounting = user?.role === 'accounting' || user?.role === 'admin';

  const canApprove =
    actionable &&
    ((isManager && note.status === 'submitted') ||
      (isAccounting && note.status === 'approved_manager'));
  // Le refus reste ouvert à tout rôle valideur tant que la note n'est pas close.
  const canReject = actionable && (isManager || isAccounting);
  const canReimburse =
    !!note && isAccounting && note.status === 'approved_accounting';

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
        aria-label="Détail de la note de frais"
      >
        <header className="modal-header" style={styles.header}>
          <h2 className="modal-title" style={styles.title}>{note ? note.title : 'Note de frais'}</h2>
          <button onClick={onClose} style={styles.close} aria-label="Fermer">
            ×
          </button>
        </header>

        <div className="modal-body" style={styles.content}>
          {loading && <p style={styles.muted}>Chargement…</p>}
          {error && <div style={styles.error}>{error}</div>}

          {note && (
            <>
              <div style={styles.badgeRow}>
                <span
                  style={{
                    ...styles.badge,
                    background: STATUS_COLOR[note.status].bg,
                    color: STATUS_COLOR[note.status].fg,
                  }}
                >
                  {STATUS_LABEL[note.status]}
                </span>
                <span style={styles.amount}>
                  {formatAmount(note.amount, note.currency)}
                </span>
              </div>

              <dl className="detail-grid" style={styles.grid}>
                <dt style={styles.dt}>Catégorie</dt>
                <dd style={styles.dd}>{CATEGORY_LABEL[note.category]}</dd>

                <dt style={styles.dt}>Date de dépense</dt>
                <dd style={styles.dd}>{formatDate(note.expense_date)}</dd>

                <dt style={styles.dt}>Salarié</dt>
                <dd style={styles.dd}>
                  {note.user_first_name} {note.user_last_name}
                  {note.user_email && (
                    <span style={styles.muted}> — {note.user_email}</span>
                  )}
                </dd>

                <dt style={styles.dt}>Créée le</dt>
                <dd style={styles.dd}>{formatDate(note.created_at)}</dd>
              </dl>

              <section style={styles.section}>
                <h3 style={styles.h3}>Commentaire</h3>
                <p style={note.description ? styles.text : styles.muted}>
                  {note.description || 'Aucun commentaire.'}
                </p>
              </section>

              {(note.manager_comment || note.accountant_comment) && (
                <section style={styles.section}>
                  <h3 style={styles.h3}>Décisions</h3>
                  {note.manager_comment && (
                    <p style={styles.text}>
                      <strong>Manager :</strong> {note.manager_comment}
                    </p>
                  )}
                  {note.accountant_comment && (
                    <p style={styles.text}>
                      <strong>Comptabilité :</strong> {note.accountant_comment}
                    </p>
                  )}
                </section>
              )}

              <section style={styles.section}>
                <h3 style={styles.h3}>
                  Pièces jointes ({note.attachments.length})
                </h3>
                {note.attachments.length === 0 ? (
                  <p style={styles.muted}>Aucune pièce jointe.</p>
                ) : (
                  <ul style={styles.fileList}>
                    {note.attachments.map((a) => (
                      <li key={a.id} style={styles.fileItem}>
                        <span style={styles.fileName}>{a.file_name}</span>
                        <span style={styles.muted}>
                          {formatFileSize(a.file_size_bytes)}
                        </span>
                        <button
                          onClick={() => void handleDownload(a.id, a.file_name)}
                          style={styles.linkButton}
                        >
                          Télécharger
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {(canApprove || canReject || canReimburse) && (
                <section style={styles.actions}>
                  <label style={styles.label}>
                    Commentaire de décision (optionnel)
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      rows={2}
                      style={styles.textarea}
                    />
                  </label>
                  <div className="modal-actions" style={styles.actionRow}>
                    {canApprove && (
                      <button
                        onClick={() => void handleDecision('approved')}
                        disabled={acting}
                        style={styles.approve}
                      >
                        {acting ? '…' : 'Valider'}
                      </button>
                    )}
                    {canReject && (
                      <button
                        onClick={() => void handleDecision('rejected')}
                        disabled={acting}
                        style={styles.reject}
                      >
                        {acting ? '…' : 'Refuser'}
                      </button>
                    )}
                    {canReimburse && (
                      <button
                        onClick={() => void handleDecision('reimbursed')}
                        disabled={acting}
                        style={styles.reimburse}
                      >
                        {acting ? '…' : 'Marquer traitée'}
                      </button>
                    )}
                  </div>
                </section>
              )}

              {isOwnNote && !isFinalStatus(note.status) && (
                <p style={styles.muted}>
                  Vous ne pouvez pas valider votre propre note de frais.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
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
    width: 'min(640px, 100%)',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#fff',
    borderRadius: 10,
    boxShadow: '0 12px 32px rgba(0,0,0,0.2)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    padding: '16px 20px',
    borderBottom: '1px solid #e0e0e5',
  },
  title: { margin: 0, fontSize: 18 },
  close: {
    border: 'none',
    background: 'transparent',
    fontSize: 24,
    lineHeight: 1,
    cursor: 'pointer',
    color: '#606066',
  },
  content: { padding: 20, overflowY: 'auto', display: 'grid', gap: 16 },
  badgeRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  badge: { padding: '4px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600 },
  amount: { fontSize: 20, fontWeight: 700 },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr',
    gap: '6px 16px',
    margin: 0,
    fontSize: 14,
  },
  dt: { color: '#606066' },
  dd: { margin: 0 },
  section: { display: 'grid', gap: 6 },
  h3: { margin: 0, fontSize: 14, color: '#606066', fontWeight: 600 },
  text: { margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' },
  muted: { margin: 0, color: '#9a9aa0', fontSize: 13 },
  fileList: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 },
  fileItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 12px',
    background: '#f5f5f7',
    borderRadius: 6,
    fontSize: 14,
  },
  fileName: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  linkButton: {
    border: 'none',
    background: 'transparent',
    color: '#0b5fff',
    cursor: 'pointer',
    fontSize: 13,
    padding: 0,
  },
  actions: {
    display: 'grid',
    gap: 10,
    paddingTop: 16,
    borderTop: '1px solid #e0e0e5',
  },
  label: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 },
  textarea: {
    padding: '8px 10px',
    borderRadius: 6,
    border: '1px solid #d0d0d5',
    fontSize: 14,
    fontFamily: 'inherit',
    resize: 'vertical',
  },
  actionRow: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  approve: {
    padding: '9px 16px',
    borderRadius: 6,
    border: 'none',
    background: '#1e7c3a',
    color: '#fff',
    fontSize: 14,
    cursor: 'pointer',
  },
  reject: {
    padding: '9px 16px',
    borderRadius: 6,
    border: 'none',
    background: '#b3261e',
    color: '#fff',
    fontSize: 14,
    cursor: 'pointer',
  },
  reimburse: {
    padding: '9px 16px',
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

export default ExpenseDetailModal;
