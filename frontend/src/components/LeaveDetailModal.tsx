import { useCallback, useEffect, useState } from 'react';
import {
  apiDelete,
  apiFetch,
  apiUpload,
  downloadLeaveAttachment,
  getSessionUser,
} from '../api';
import { formatFileSize } from '../expenseLabels';
import {
  LEAVE_STATUS_COLOR,
  LEAVE_STATUS_LABEL,
  formatDays,
  formatLeaveDate,
  isApprovedLeave,
  isFinalLeaveStatus,
  leaveTypeColor,
} from '../leaveLabels';
import type {
  LeaveAttachment,
  LeaveDecision,
  LeaveRequestFullDetail,
} from '../types';

/** Doit rester aligné sur le fileFilter du back (lib/uploads.ts). */
const ACCEPTED = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';

interface LeaveDetailModalProps {
  leaveId: number;
  onClose: () => void;
  /** Appelé après une décision pour rafraîchir la liste appelante. */
  onUpdated?: () => void;
}

export function LeaveDetailModal({ leaveId, onClose, onUpdated }: LeaveDetailModalProps) {
  const user = getSessionUser();
  const [leave, setLeave] = useState<LeaveRequestFullDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState(false);

  // Aucun setState avant le premier await : après une décision, le contenu
  // reste affiché pendant le rechargement.
  const load = useCallback(async () => {
    try {
      const data = await apiFetch<LeaveRequestFullDetail>(`/api/leaves/${leaveId}`);
      setLeave(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [leaveId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleDecision(decision: LeaveDecision) {
    setActing(true);
    setError(null);
    try {
      await apiFetch(`/api/leaves/${leaveId}/status`, {
        method: 'PATCH',
        body: {
          status: decision,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        },
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

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    setActing(true);
    setError(null);
    try {
      const formData = new FormData();
      for (const file of picked) formData.append('files', file);
      await apiUpload<LeaveAttachment[]>(
        `/api/leaves/${leaveId}/attachments`,
        formData,
      );
      e.target.value = '';
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Envoi impossible');
    } finally {
      setActing(false);
    }
  }

  async function handleDownload(attachmentId: number, fileName: string) {
    try {
      await downloadLeaveAttachment(leaveId, attachmentId, fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Téléchargement impossible');
    }
  }

  async function handleRemove(attachmentId: number) {
    setActing(true);
    setError(null);
    try {
      await apiDelete(`/api/leaves/${leaveId}/attachments/${attachmentId}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suppression impossible');
    } finally {
      setActing(false);
    }
  }

  // Visibilité calquée sur resolveStatus() côté back : on n'affiche que les
  // transitions réellement acceptées, pour ne pas provoquer de 409.
  const isOwner = !!leave && !!user && leave.user_id === user.id;
  const isManager = user?.role === 'manager' || user?.role === 'admin';
  const isHR = user?.role === 'hr' || user?.role === 'admin';
  const open = !!leave && !isFinalLeaveStatus(leave.status);

  const canApprove =
    open &&
    !isOwner &&
    ((isManager && leave.status === 'submitted') ||
      (isHR && leave.status === 'approved_manager'));
  const canReject = open && !isOwner && (isManager || isHR);
  // Le demandeur peut retirer sa demande tant qu'elle n'est pas close.
  const canCancel = open && (isOwner || isManager || isHR);
  // Dépôt et suppression : le demandeur, la RH ou un admin (miroir du back).
  const canEditAttachments = !!leave && (isOwner || isHR);

  return (
    <div style={styles.overlay} onClick={onClose} role="presentation">
      <div
        style={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Détail de la demande de congé"
      >
        <header style={styles.header}>
          <h2 style={styles.title}>
            {leave ? leave.leave_type_label : 'Demande de congé'}
          </h2>
          <button onClick={onClose} style={styles.close} aria-label="Fermer">
            ×
          </button>
        </header>

        <div style={styles.content}>
          {loading && <p style={styles.muted}>Chargement…</p>}
          {error && <div style={styles.error}>{error}</div>}

          {leave && (
            <>
              <div style={styles.badgeRow}>
                <span
                  style={{
                    ...styles.badge,
                    background: LEAVE_STATUS_COLOR[leave.status].bg,
                    color: LEAVE_STATUS_COLOR[leave.status].fg,
                  }}
                >
                  {LEAVE_STATUS_LABEL[leave.status]}
                </span>
                <span style={styles.days}>{formatDays(leave.days_requested)}</span>
              </div>

              <dl style={styles.grid}>
                <dt style={styles.dt}>Type</dt>
                <dd style={styles.dd}>
                  <span
                    style={{
                      ...styles.dot,
                      background: leaveTypeColor(leave.leave_type_code),
                    }}
                  />
                  {leave.leave_type_label}
                </dd>

                <dt style={styles.dt}>Période</dt>
                <dd style={styles.dd}>
                  du {formatLeaveDate(leave.start_date)} au{' '}
                  {formatLeaveDate(leave.end_date)}
                </dd>

                <dt style={styles.dt}>Jours ouvrés</dt>
                <dd style={styles.dd}>
                  {formatDays(leave.days_requested)}
                  <span style={styles.muted}> (week-ends et fériés exclus)</span>
                </dd>

                <dt style={styles.dt}>Salarié</dt>
                <dd style={styles.dd}>
                  {leave.user_first_name} {leave.user_last_name}
                  <span style={styles.muted}> — {leave.user_email}</span>
                </dd>

                <dt style={styles.dt}>Demandée le</dt>
                <dd style={styles.dd}>{formatLeaveDate(leave.submitted_at)}</dd>
              </dl>

              <section style={styles.section}>
                <h3 style={styles.h3}>Motif</h3>
                <p style={leave.reason ? styles.text : styles.muted}>
                  {leave.reason || 'Aucun motif renseigné.'}
                </p>
              </section>

              {(leave.manager_comment || leave.hr_comment) && (
                <section style={styles.section}>
                  <h3 style={styles.h3}>Décisions</h3>
                  {leave.manager_comment && (
                    <p style={styles.text}>
                      <strong>Manager :</strong> {leave.manager_comment}
                    </p>
                  )}
                  {leave.hr_comment && (
                    <p style={styles.text}>
                      <strong>RH :</strong> {leave.hr_comment}
                    </p>
                  )}
                </section>
              )}

              <section style={styles.section}>
                <h3 style={styles.h3}>
                  Justificatifs ({leave.attachments.length})
                </h3>
                {leave.attachments.length === 0 ? (
                  <p style={styles.muted}>Aucun justificatif.</p>
                ) : (
                  <ul style={styles.fileList}>
                    {leave.attachments.map((a) => (
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
                        {canEditAttachments && (
                          <button
                            onClick={() => void handleRemove(a.id)}
                            disabled={acting}
                            style={styles.removeButton}
                          >
                            Supprimer
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {canEditAttachments && (
                  <label style={styles.uploadLabel}>
                    Ajouter un justificatif
                    <input
                      type="file"
                      multiple
                      accept={ACCEPTED}
                      disabled={acting}
                      onChange={(e) => void handleUpload(e)}
                      style={styles.file}
                    />
                  </label>
                )}
              </section>

              {(canApprove || canReject || canCancel) && (
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
                  <div style={styles.actionRow}>
                    {canApprove && (
                      <button
                        onClick={() => void handleDecision('approved')}
                        disabled={acting}
                        style={styles.approve}
                      >
                        {acting
                          ? '…'
                          : leave.status === 'submitted'
                            ? 'Approuver (manager)'
                            : 'Approuver (RH)'}
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
                    {canCancel && (
                      <button
                        onClick={() => void handleDecision('cancelled')}
                        disabled={acting}
                        style={styles.cancel}
                      >
                        {acting ? '…' : 'Annuler la demande'}
                      </button>
                    )}
                  </div>
                  {isApprovedLeave(leave.status) && (
                    <p style={styles.muted}>
                      Annuler un congé validé restitue les jours au solde.
                    </p>
                  )}
                </section>
              )}

              {isOwner && open && (
                <p style={styles.muted}>
                  Vous ne pouvez pas valider votre propre demande.
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
  days: { fontSize: 20, fontWeight: 700 },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr',
    gap: '6px 16px',
    margin: 0,
    fontSize: 14,
  },
  dt: { color: '#606066' },
  dd: { margin: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  dot: { width: 10, height: 10, borderRadius: '50%', display: 'inline-block' },
  section: { display: 'grid', gap: 6 },
  h3: { margin: 0, fontSize: 14, color: '#606066', fontWeight: 600 },
  text: { margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' },
  muted: { margin: 0, color: '#9a9aa0', fontSize: 13 },
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
  removeButton: {
    border: 'none',
    background: 'transparent',
    color: '#b3261e',
    cursor: 'pointer',
    fontSize: 13,
    padding: 0,
  },
  uploadLabel: { display: 'grid', gap: 6, fontSize: 13, marginTop: 4 },
  file: { fontSize: 13 },
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
  cancel: {
    padding: '9px 16px',
    borderRadius: 6,
    border: '1px solid #d0d0d5',
    background: '#fff',
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

export default LeaveDetailModal;
