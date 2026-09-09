-- ---------------------------------------------------------------------------
-- 003 — Justificatifs de congé + activation de compte
--
-- 1. leave_attachments : la table `attachments` est liée aux notes de frais
--    (expense_note_id NOT NULL), elle ne peut pas porter les justificatifs de
--    congé. Table jumelle, même convention (file_path = basename généré).
--
-- 2. Jeton d'activation : un compte créé par un manager n'a pas de mot de passe
--    et ne peut donc pas se connecter pour en choisir un. On stocke le HASH
--    d'un jeton à usage unique — jamais le jeton en clair, qui n'est montré
--    qu'une fois à la création. C'est ce qui permet à PATCH
--    /api/users/:id/password d'être appelé sans être connecté, sans pour autant
--    laisser n'importe qui écraser le mot de passe de n'importe quel compte.
--
-- Idempotent : rejouable à chaque démarrage.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leave_attachments (
    id                SERIAL PRIMARY KEY,
    leave_request_id  INTEGER      NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
    file_name         VARCHAR(255) NOT NULL,
    file_path         VARCHAR(500) NOT NULL,
    mime_type         VARCHAR(100) NOT NULL,
    file_size_bytes   INTEGER      NOT NULL CHECK (file_size_bytes > 0),
    uploaded_by       INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_attachments_request
    ON leave_attachments(leave_request_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_token_hash CHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_token_expires_at TIMESTAMPTZ;
