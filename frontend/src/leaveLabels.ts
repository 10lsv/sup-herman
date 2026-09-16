// Libellés, couleurs et formatage partagés par les écrans xFINT2.
// Pendant de expenseLabels.ts pour les notes de frais.

import type { LeaveStatus, UserRole } from './types';

/**
 * Libellés du sujet xFINT2 : En attente, Validée, Refusée, Annulée. Les deux
 * étapes de validation s'affichent « Validée » et se distinguent par la couleur
 * du badge (bleu après le manager, vert après la RH) ; la modale de détail
 * précise l'étape atteinte.
 */
export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  draft: 'En attente',
  submitted: 'En attente',
  approved_manager: 'Validée',
  approved_hr: 'Validée',
  approved: 'Validée',
  rejected: 'Refusée',
  cancelled: 'Annulée',
};

export const LEAVE_STATUS_COLOR: Record<LeaveStatus, { bg: string; fg: string }> = {
  draft: { bg: '#eceff1', fg: '#455a64' },
  submitted: { bg: '#fff4e0', fg: '#b26a00' },
  approved_manager: { bg: '#e3f0ff', fg: '#0b5fff' },
  approved_hr: { bg: '#e6f4ea', fg: '#14532d' },
  approved: { bg: '#e6f4ea', fg: '#14532d' },
  rejected: { bg: '#fdecea', fg: '#b3261e' },
  cancelled: { bg: '#eceff1', fg: '#78787f' },
};

/** Couleur par code de type — sert au calendrier et aux pastilles de solde. */
export const LEAVE_TYPE_COLOR: Record<string, string> = {
  PAID: '#0b5fff',
  RTT: '#7b3fe4',
  SICK: '#b3261e',
  FAMILY: '#c2185b',
  UNPAID: '#78787f',
  TRAINING: '#1e7c3a',
};

export const DEFAULT_TYPE_COLOR = '#606066';

export function leaveTypeColor(code: string): string {
  return LEAVE_TYPE_COLOR[code] ?? DEFAULT_TYPE_COLOR;
}

/** Statuts qui immobilisent ou consomment du solde (miroir du back). */
export function isActiveLeave(status: LeaveStatus): boolean {
  return (
    status === 'submitted' ||
    status === 'approved_manager' ||
    status === 'approved_hr' ||
    status === 'approved'
  );
}

/**
 * Étape sur laquelle le rôle a une décision à rendre. Aligné sur
 * resolveStatus() côté back : le manager traite les `submitted`, la RH les
 * `approved_manager`.
 */
export const LEAVE_PENDING_BY_ROLE: Partial<Record<UserRole, LeaveStatus[]>> = {
  manager: ['submitted'],
  hr: ['approved_manager'],
  admin: ['submitted', 'approved_manager'],
};

/** Une demande close n'accepte plus aucune décision. */
export function isFinalLeaveStatus(status: LeaveStatus): boolean {
  return status === 'rejected' || status === 'cancelled';
}

/** Congé définitivement validé (étape RH franchie). */
export function isApprovedLeave(status: LeaveStatus): boolean {
  return status === 'approved_hr' || status === 'approved';
}

export function formatDays(days: string | number): string {
  const value = Number(days);
  if (Number.isNaN(value)) return String(days);
  // Les NUMERIC arrivent en '5.00' : on masque les décimales inutiles.
  const label = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `${label} j`;
}

export function formatLeaveDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('fr-FR');
}

/** 'YYYY-MM-DD' du jour, dans le fuseau local. */
export function todayISO(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}
