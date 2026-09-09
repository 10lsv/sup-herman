import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, apiUpload } from '../../api';
import { CATEGORY_LABEL, formatFileSize } from '../../expenseLabels';
import type { Attachment, ExpenseCategory, ExpenseNote } from '../../types';

const CATEGORIES = Object.keys(CATEGORY_LABEL) as ExpenseCategory[];

/** Doit rester aligné sur le fileFilter du back (routes/expenses.ts). */
const ACCEPTED = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function todayISO(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

export function ExpenseNewPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('travel');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayISO());
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

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const note = await apiFetch<ExpenseNote>('/api/expenses', {
        method: 'POST',
        body: {
          title: title.trim(),
          category,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
          ...(amount ? { amount: Number(amount) } : {}),
          ...(expenseDate ? { expense_date: expenseDate } : {}),
        },
      });

      // La note existe déjà : un échec d'upload ne doit pas la faire perdre,
      // on prévient et on reste sur le formulaire.
      if (files.length > 0) {
        const formData = new FormData();
        for (const file of files) formData.append('files', file);
        try {
          await apiUpload<Attachment[]>(`/api/expenses/${note.id}/attachments`, formData);
        } catch (err) {
          const reason = err instanceof Error ? err.message : 'erreur inconnue';
          setError(
            `Note créée (#${note.id}), mais l'envoi des pièces jointes a échoué : ${reason}. ` +
              'Vous pouvez les rajouter depuis le détail de la note.',
          );
          setSubmitting(false);
          return;
        }
      }

      navigate('/expenses', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h1 style={styles.title}>Nouvelle note de frais</h1>

      <form onSubmit={handleSubmit} style={styles.form}>
        <label style={styles.label}>
          Titre *
          <input
            type="text"
            required
            maxLength={255}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex. Taxi gare → client"
            style={styles.input}
          />
        </label>

        <label style={styles.label}>
          Commentaire
          <textarea
            rows={4}
            maxLength={5000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Contexte de la dépense…"
            style={styles.textarea}
          />
        </label>

        <div style={styles.row}>
          <label style={styles.label}>
            Catégorie *
            <select
              required
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
              style={styles.input}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.label}>
            Montant (€)
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Date de dépense
            <input
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              style={styles.input}
            />
          </label>
        </div>

        <label style={styles.label}>
          Justificatifs (PDF ou image, 10 Mo max, 10 fichiers max)
          <input
            type="file"
            multiple
            accept={ACCEPTED}
            onChange={handleFiles}
            style={styles.file}
          />
        </label>

        {files.length > 0 && (
          <ul style={styles.fileList}>
            {files.map((f) => (
              <li key={`${f.name}-${f.lastModified}`} style={styles.fileItem}>
                <span style={styles.fileName}>{f.name}</span>
                <span style={styles.muted}>{formatFileSize(f.size)}</span>
              </li>
            ))}
          </ul>
        )}

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.actions}>
          <button type="submit" disabled={submitting} style={styles.submit}>
            {submitting ? 'Envoi…' : 'Créer la note'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/expenses')}
            style={styles.cancel}
          >
            Annuler
          </button>
        </div>
      </form>
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
  file: { fontSize: 14 },
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
  muted: { color: '#9a9aa0', fontSize: 13 },
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
  cancel: {
    padding: '10px 18px',
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

export default ExpenseNewPage;
