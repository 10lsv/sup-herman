import type { PublicUser, User } from '../types';

/**
 * Seule projection d'un utilisateur autorisée à sortir de l'API. Liste
 * blanche plutôt que retrait des champs sensibles : une colonne ajoutée plus
 * tard à `users` (hash, jeton…) reste privée tant qu'on ne l'ajoute pas ici.
 */
export function toPublicUser(row: User): PublicUser {
  return {
    id: row.id,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    role: row.role,
    manager_id: row.manager_id,
    is_active: row.is_active,
    created_at: row.created_at,
  };
}
