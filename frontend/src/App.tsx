import { BrowserRouter, Link, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './components/LoginPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { ExpenseListPage } from './pages/xfint1/ExpenseListPage';
import { ExpenseNewPage } from './pages/xfint1/ExpenseNewPage';
import { ExpenseApprovalsPage } from './pages/xfint1/ExpenseApprovalsPage';
import { ProfilePage } from './pages/xfint1/ProfilePage';
import { AdminUsersPage } from './pages/xfint1/AdminUsersPage';
import { LeaveDashboardPage } from './pages/xfint2/LeaveDashboardPage';
import { LeaveListPage } from './pages/xfint2/LeaveListPage';
import { LeaveNewPage } from './pages/xfint2/LeaveNewPage';
import { LeaveApprovalsPage } from './pages/xfint2/LeaveApprovalsPage';
import { LeaveCalendarPage } from './pages/xfint2/LeaveCalendarPage';
import { LeaveHRPage } from './pages/xfint2/LeaveHRPage';
import { SetPasswordPage } from './pages/xfint2/SetPasswordPage';
import type { UserRole } from './types';

function NotFound() {
  return (
    <section>
      <h1 style={{ marginTop: 0, fontSize: 22 }}>Page introuvable</h1>
      <p style={{ color: '#606066' }}>
        Cette page n'existe pas. <Link to="/dashboard">Retour à l'accueil</Link>.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Wrapper : ProtectedRoute + Layout + Outlet
// ---------------------------------------------------------------------------

interface AuthedShellProps {
  allowedRoles?: UserRole[];
}

function AuthedShell({ allowedRoles }: AuthedShellProps) {
  return (
    <ProtectedRoute allowedRoles={allowedRoles}>
      <Layout>
        <Outlet />
      </Layout>
    </ProtectedRoute>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* Activation d'un compte : l'utilisateur n'a pas encore de mot de
            passe, la page doit donc rester hors de ProtectedRoute. */}
        <Route path="/set-password" element={<SetPasswordPage />} />

        {/* Routes générales (tout utilisateur connecté) */}
        <Route element={<AuthedShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />

          {/* xFINT1 */}
          <Route path="/expenses" element={<ExpenseListPage />} />
          <Route path="/expenses/new" element={<ExpenseNewPage />} />

          <Route path="/profile" element={<ProfilePage />} />

          {/* xFINT2 */}
          <Route path="/leaves" element={<LeaveDashboardPage />} />
          <Route path="/leaves/list" element={<LeaveListPage />} />
          <Route path="/leaves/new" element={<LeaveNewPage />} />
          <Route path="/leaves/calendar" element={<LeaveCalendarPage />} />

          <Route path="*" element={<NotFound />} />
        </Route>

        {/* Validation des notes de frais : manager ET comptabilité (mêmes
            droits que GET /api/expenses/all côté back). L'alias /accounting
            pointe sur la même page, seules les actions proposées diffèrent. */}
        <Route element={<AuthedShell allowedRoles={['manager', 'accounting', 'admin']} />}>
          <Route path="/expenses/approvals" element={<ExpenseApprovalsPage />} />
          <Route path="/expenses/accounting" element={<ExpenseApprovalsPage />} />
        </Route>

        {/* Validation des congés : manager (1re étape) et RH (2e étape),
            mêmes droits que GET /api/leaves/all côté back. */}
        <Route element={<AuthedShell allowedRoles={['manager', 'hr', 'admin']} />}>
          <Route path="/leaves/approvals" element={<LeaveApprovalsPage />} />
        </Route>

        {/* Création de comptes : manager et RH, chacun avec ses rôles
            attribuables (contrôlés par POST /api/users). */}
        <Route element={<AuthedShell allowedRoles={['manager', 'hr', 'admin']} />}>
          <Route path="/admin/users" element={<AdminUsersPage />} />
        </Route>

        {/* Routes réservées RH */}
        <Route element={<AuthedShell allowedRoles={['hr', 'admin']} />}>
          <Route path="/leaves/hr" element={<LeaveHRPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
