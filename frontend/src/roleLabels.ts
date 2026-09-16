// Libellés des rôles, partagés par la barre de navigation, le profil, le
// tableau de bord et l'écran RH.

import type { UserRole } from './types';

export const ROLE_LABEL: Record<UserRole, string> = {
  employee: 'Salarié',
  manager: 'Manager',
  accounting: 'Comptabilité',
  hr: 'RH',
  admin: 'Admin',
};
