// Petit client HTTP partagé : base URL, en-tête Bearer, gestion d'erreur
// uniforme. Évite de dupliquer le fetch/localStorage dans chaque page.

import type { ApiError, CreatedUser, User } from './types';

export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

export function getToken(): string | null {
  return localStorage.getItem('token');
}

export function getSessionUser(): User | null {
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

/**
 * Lien d'activation d'un compte tout juste créé. Le back n'en garde que le
 * hash : il n'est plus jamais affichable ensuite.
 */
export function inviteLinkFor(user: CreatedUser): string {
  return `${window.location.origin}/set-password?user=${user.id}&token=${user.invite_token}`;
}

async function toError(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as ApiError | null;
  return new Error(body?.error ?? `Requête échouée (${res.status})`);
}

/** Requête JSON authentifiée. `body` est sérialisé automatiquement. */
export async function apiFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

/** Upload multipart — on laisse le navigateur poser le Content-Type/boundary. */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

/**
 * Télécharge un fichier protégé. Le endpoint exige l'en-tête Authorization,
 * donc on ne peut pas utiliser un simple <a href> : on passe par un blob.
 */
async function downloadFrom(path: string, fileName: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw await toError(res);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Justificatif d'une note de frais (xFINT1). */
export function downloadAttachment(
  expenseId: number,
  attachmentId: number,
  fileName: string,
): Promise<void> {
  return downloadFrom(
    `/api/expenses/${expenseId}/attachments/${attachmentId}`,
    fileName,
  );
}

/** Justificatif d'une demande de congé (xFINT2). */
export function downloadLeaveAttachment(
  leaveId: number,
  attachmentId: number,
  fileName: string,
): Promise<void> {
  return downloadFrom(`/api/leaves/${leaveId}/attachments/${attachmentId}`, fileName);
}

/** DELETE authentifié sans corps de réponse (204). */
export async function apiDelete(path: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw await toError(res);
}
