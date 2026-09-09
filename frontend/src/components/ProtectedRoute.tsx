import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { User, UserRole } from '../types';

interface ProtectedRouteProps {
  children: ReactNode;
  /** Si fourni, l'utilisateur doit avoir l'un de ces rôles pour accéder. */
  allowedRoles?: UserRole[];
}

function getSessionUser(): User | null {
  const raw = localStorage.getItem('user');
  const token = localStorage.getItem('token');
  if (!raw || !token) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const location = useLocation();
  const user = getSessionUser();

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default ProtectedRoute;
