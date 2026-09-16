// Types partagés backend — miroir du schéma PostgreSQL.
// Les colonnes NUMERIC sont renvoyées par `pg` en `string` par défaut ;
// les TIMESTAMPTZ sont sérialisées en `string` (ISO 8601) côté API.

export type UserRole = 'employee' | 'manager' | 'accounting' | 'hr' | 'admin';

export type ExpenseCategory =
  | 'travel'
  | 'meal'
  | 'accommodation'
  | 'supplies'
  | 'other';

export type ExpenseStatus =
  | 'draft'
  | 'submitted'
  | 'approved_manager'
  | 'approved_accounting'
  | 'rejected'
  | 'reimbursed';

export type LeaveStatus =
  | 'draft'
  | 'submitted'
  | 'approved_manager'
  | 'approved_hr'
  /** @deprecated valeur historique, conservée en base, plus émise par le code. */
  | 'approved'
  | 'rejected'
  | 'cancelled';

// ---------------------------------------------------------------------------
// Entités (rangées PostgreSQL)
// ---------------------------------------------------------------------------

export interface User {
  id: number;
  email: string;
  /** NULL tant que l'utilisateur n'a pas défini son mot de passe (1re connexion). */
  password_hash: string | null;
  first_name: string;
  last_name: string;
  role: UserRole;
  manager_id: number | null;
  /** Manager à l'origine du compte (POST /api/users), NULL pour un compte seedé. */
  created_by: number | null;
  /** Hash SHA-256 du jeton d'activation à usage unique. Jamais exposé par l'API. */
  password_token_hash: string | null;
  password_token_expires_at: string | null;
  department: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExpenseNote {
  id: number;
  user_id: number;
  title: string;
  description: string | null;
  category: ExpenseCategory;
  amount: string;
  currency: string;
  expense_date: string;
  status: ExpenseStatus;
  manager_id: number | null;
  manager_comment: string | null;
  manager_action_at: string | null;
  accountant_id: number | null;
  accountant_comment: string | null;
  accountant_action_at: string | null;
  submitted_at: string | null;
  reimbursed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  id: number;
  expense_note_id: number;
  file_name: string;
  file_path: string;
  mime_type: string;
  file_size_bytes: number;
  uploaded_by: number | null;
  uploaded_at: string;
}

export interface LeaveType {
  id: number;
  code: string;
  label: string;
  default_annual_days: string;
  is_paid: boolean;
  requires_justification: boolean;
  is_active: boolean;
  created_at: string;
}

export interface LeaveRequest {
  id: number;
  user_id: number;
  leave_type_id: number;
  start_date: string;
  end_date: string;
  days_requested: string;
  reason: string | null;
  status: LeaveStatus;
  manager_id: number | null;
  manager_comment: string | null;
  manager_action_at: string | null;
  hr_id: number | null;
  hr_comment: string | null;
  hr_action_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Ligne de leave_requests enrichie du type de congé et de l'identité du salarié. */
export interface LeaveRequestDetail extends LeaveRequest {
  leave_type_code: string;
  leave_type_label: string;
  user_email: string;
  user_first_name: string;
  user_last_name: string;
}

export interface LeaveBalance {
  id: number;
  user_id: number;
  leave_type_id: number;
  year: number;
  allocated_days: string;
  used_days: string;
  pending_days: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// DTOs / JWT
// ---------------------------------------------------------------------------

/** Projection exposée par l'API, construite par `toPublicUser()` (lib/publicUser). */
export type PublicUser = Pick<
  User,
  'id' | 'email' | 'first_name' | 'last_name' | 'role' | 'manager_id' | 'is_active' | 'created_at'
>;

/** Pièce jointe d'une demande de congé (table leave_attachments). */
export interface LeaveAttachment {
  id: number;
  leave_request_id: number;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  uploaded_by: number | null;
  uploaded_at: string;
}

/** Ligne de GET /api/users : le compte, ses soldes et son état d'activation. */
export interface UserWithBalances extends PublicUser {
  /** Faux tant que l'utilisateur n'a pas choisi son mot de passe. */
  has_password: boolean;
  balances: LeaveBalanceSummary[];
}

export interface JwtPayload {
  id: number;
  email: string;
  role: UserRole;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: PublicUser;
}

// ---------------------------------------------------------------------------
// xFINT1 — Notes de frais
// ---------------------------------------------------------------------------

export interface CreateExpenseNoteRequest {
  title: string;
  description?: string;
  category: ExpenseCategory;
  amount: number;
  currency?: string;
  expense_date: string;
}

export type ExpenseNoteDecision = Extract<
  ExpenseStatus,
  'approved_manager' | 'approved_accounting' | 'rejected' | 'reimbursed'
>;

export interface UpdateExpenseNoteStatusRequest {
  status: ExpenseNoteDecision;
  comment?: string;
}

// ---------------------------------------------------------------------------
// xFINT2 — Congés
// ---------------------------------------------------------------------------

/**
 * Corps de POST /api/leaves. Le type se désigne par son id OU son code
 * ('PAID', 'RTT', …) ; `days_requested` n'est pas accepté, il est recalculé
 * côté serveur en jours ouvrés.
 */
export interface CreateLeaveRequestRequest {
  leave_type_id?: number;
  type?: string;
  date_start: string;
  date_end: string;
  comment?: string;
}

/** Décision envoyée à PATCH /api/leaves/:id/status. */
export type LeaveDecision = 'approved' | 'rejected' | 'cancelled';

export interface UpdateLeaveStatusRequest {
  status: LeaveDecision;
  comment?: string;
}

/** Ligne de GET /api/leaves/balance/:user_id — un solde par type de congé. */
export interface LeaveBalanceSummary {
  leave_type_id: number;
  code: string;
  label: string;
  year: number;
  allocated_days: number;
  used_days: number;
  pending_days: number;
  /** allocated - used - pending. Négatif impossible sur un type plafonné. */
  remaining_days: number;
  /** Faux pour les types sans dotation (maladie, sans solde, formation). */
  is_capped: boolean;
}

// ---------------------------------------------------------------------------
// Enveloppes API
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
  details?: unknown;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}
