-- ---------------------------------------------------------------------------
-- 001 — Comptes créés par un manager (POST /api/users)
--
-- Le compte est provisionné sans mot de passe : l'utilisateur le définit à sa
-- première connexion (spec xFINT1 page 1). Deux conséquences sur `users` :
--   * password_hash devient NULLABLE (NULL = mot de passe pas encore défini) ;
--   * created_by trace le manager à l'origine du compte.
-- first_name / last_name restent NOT NULL mais prennent un DEFAULT '' : ils
-- sont renseignés au même moment que le mot de passe, et garder le type
-- `string` évite de propager un `| null` dans tout le front.
--
-- Idempotent : rejouable sans effet de bord à chaque démarrage.
-- ---------------------------------------------------------------------------

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ALTER COLUMN first_name SET DEFAULT '';
ALTER TABLE users ALTER COLUMN last_name  SET DEFAULT '';

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_created_by ON users(created_by);
