// Types frontend — miroir simplifié des types backend.
// Les colonnes NUMERIC sont sérialisées en string (pg default), on garde le
// même contrat côté client.

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
  /** @deprecated valeur historique conservée en base, plus émise par l'API. */
  | 'approved'
  | 'rejected'
  | 'cancelled';

export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  manager_id: number | null;
  is_active: boolean;
  created_at: string;
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
  accountant_id: number | null;
  accountant_comment: string | null;
  submitted_at: string | null;
  reimbursed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  id: number;
  expense_note_id: number;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  uploaded_by: number | null;
  uploaded_at: string;
}

/** Ligne de GET /api/expenses/all : note enrichie de l'identité du salarié. */
export interface ExpenseNoteWithUser extends ExpenseNote {
  user_email: string;
  user_first_name: string;
  user_last_name: string;
}

/** Réponse de GET /api/expenses/:id. */
export interface ExpenseNoteDetail extends ExpenseNote {
  user_email: string | null;
  user_first_name: string | null;
  user_last_name: string | null;
  attachments: Attachment[];
}

/** Corps de POST /api/expenses. `comment` alimente la colonne description. */
export interface CreateExpenseRequest {
  title: string;
  comment?: string;
  category: ExpenseCategory;
  amount?: number;
  expense_date?: string;
}

/**
 * Corps de POST /api/users. Les rôles acceptés dépendent du créateur :
 * manager → employee/manager/accounting, hr → employee/manager/hr, admin → tous.
 */
export interface CreateUserRequest {
  email: string;
  role: UserRole;
  /** Manager responsable ; absent ou null = aucun. */
  manager_id?: number | null;
}

/** Décision envoyée à PATCH /api/expenses/:id/status. */
export type ExpenseDecision = 'approved' | 'rejected' | 'reimbursed';

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

/**
 * Ligne renvoyée par GET /api/leaves/mine, /all et /:id : la demande enrichie
 * du type de congé et de l'identité du salarié.
 */
export interface LeaveRequestDetail extends LeaveRequest {
  leave_type_code: string;
  leave_type_label: string;
  user_email: string;
  user_first_name: string;
  user_last_name: string;
}

/**
 * Ligne de GET /api/leaves/calendar : congé validé, projection réduite ouverte
 * à tous (ni motif, ni commentaire, ni justificatif, ni email).
 */
export interface CalendarLeave {
  id: number;
  user_id: number;
  user_first_name: string;
  user_last_name: string;
  /** Manager de rattachement du salarié — pas le valideur de la demande. */
  manager_id: number | null;
  leave_type: { code: string; label: string };
  date_start: string;
  date_end: string;
  days_requested: string;
  status: Extract<LeaveStatus, 'approved_manager' | 'approved_hr' | 'approved'>;
}

/** Ligne de GET /api/users/managers. */
export interface ManagerSummary {
  id: number;
  first_name: string;
  last_name: string;
}

/** Pièce jointe d'une demande de congé. */
export interface LeaveAttachment {
  id: number;
  leave_request_id: number;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  uploaded_by: number | null;
  uploaded_at: string;
}

/** Réponse de GET /api/leaves/:id : la demande, ses jointures et ses pièces. */
export interface LeaveRequestFullDetail extends LeaveRequestDetail {
  attachments: LeaveAttachment[];
}

/** Ligne de GET /api/users : le compte, son état d'activation et ses soldes. */
export interface UserWithBalances extends User {
  /** Faux tant que l'utilisateur n'a pas choisi son mot de passe. */
  has_password: boolean;
  balances: LeaveBalanceSummary[];
}

/**
 * Réponse de POST /api/users. `invite_token` n'est renvoyé qu'à la création :
 * la base n'en conserve que le hash, il n'est plus jamais relisible.
 */
export interface CreatedUser extends User {
  invite_token: string;
  invite_expires_at: string;
}

/** Corps de PATCH /api/users/:id/password — un seul des deux modes. */
export interface UpdatePasswordRequest {
  password: string;
  /** Activation d'un compte, sans être connecté. */
  token?: string;
  /** Changement par l'utilisateur lui-même. */
  current_password?: string;
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

/**
 * Ligne de GET /api/leaves/balance/:user_id. Contrairement aux lignes de
 * demande, l'API renvoie ici des nombres et non des NUMERIC sérialisés.
 */
export interface LeaveBalanceSummary {
  leave_type_id: number;
  code: string;
  label: string;
  year: number;
  allocated_days: number;
  used_days: number;
  pending_days: number;
  remaining_days: number;
  /** Faux pour les types sans dotation (maladie, sans solde, formation). */
  is_capped: boolean;
}

/**
 * Corps de POST /api/leaves. `days_requested` n'est pas accepté : le serveur
 * recalcule les jours ouvrés.
 */
export interface CreateLeaveRequest {
  type: string;
  date_start: string;
  date_end: string;
  comment?: string;
}

/** Décision envoyée à PATCH /api/leaves/:id/status. */
export type LeaveDecision = 'approved' | 'rejected' | 'cancelled';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
