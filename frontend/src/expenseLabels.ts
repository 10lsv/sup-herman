// Libellés et couleurs partagés entre la liste et la modale de détail.

import type { ExpenseCategory, ExpenseStatus } from './types';

export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  travel: 'Déplacement',
  meal: 'Repas',
  accommodation: 'Hébergement',
  supplies: 'Fournitures',
  other: 'Autre',
};

/**
 * Libellés du sujet xFINT1 : Créée, Validée, Refusée, Traitée. Les statuts
 * internes restent plus fins ; les deux étapes de validation partagent le
 * libellé « Validée » et se distinguent par la couleur du badge.
 */
export const STATUS_LABEL: Record<ExpenseStatus, string> = {
  draft: 'Créée',
  submitted: 'Créée',
  approved_manager: 'Validée',
  approved_accounting: 'Validée',
  rejected: 'Refusée',
  reimbursed: 'Traitée',
};

export const STATUS_COLOR: Record<ExpenseStatus, { bg: string; fg: string }> = {
  draft: { bg: '#eceff1', fg: '#455a64' },
  submitted: { bg: '#fff4e0', fg: '#b26a00' },
  approved_manager: { bg: '#e3f0ff', fg: '#0b5fff' },
  approved_accounting: { bg: '#e6f4ea', fg: '#1e7c3a' },
  rejected: { bg: '#fdecea', fg: '#b3261e' },
  reimbursed: { bg: '#e6f4ea', fg: '#14532d' },
};

/** Une note dans un état terminal ne peut plus être validée ni refusée. */
export function isFinalStatus(status: ExpenseStatus): boolean {
  return status === 'rejected' || status === 'reimbursed';
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  // Les DATE arrivent en 'YYYY-MM-DD', les TIMESTAMPTZ en ISO complet.
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('fr-FR');
}

export function formatAmount(amount: string, currency: string): string {
  const value = Number(amount);
  if (Number.isNaN(value)) return `${amount} ${currency}`;
  return value.toLocaleString('fr-FR', { style: 'currency', currency });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
