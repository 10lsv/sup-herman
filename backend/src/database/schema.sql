-- ============================================================================
-- sup-herman-projects — schéma unifié pour xFINT1 (notes de frais)
-- et xFINT2 (congés). Un seul jeu d'utilisateurs partagé.
-- Cible : PostgreSQL 15+.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Utilisateurs partagés (xFINT1 & xFINT2)
-- ---------------------------------------------------------------------------

CREATE TYPE user_role AS ENUM (
    'employee',
    'manager',
    'accounting',
    'hr',
    'admin'
);

CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    email           VARCHAR(255) UNIQUE NOT NULL,
    -- NULL tant que l'utilisateur n'a pas défini son mot de passe (compte créé
    -- par un manager via POST /api/users, cf. migrations/001_users_invite.sql).
    password_hash   VARCHAR(255),
    first_name      VARCHAR(100)        NOT NULL DEFAULT '',
    last_name       VARCHAR(100)        NOT NULL DEFAULT '',
    role            user_role           NOT NULL DEFAULT 'employee',
    manager_id      INTEGER             REFERENCES users(id) ON DELETE SET NULL,
    created_by      INTEGER             REFERENCES users(id) ON DELETE SET NULL,
    department      VARCHAR(100),
    is_active       BOOLEAN             NOT NULL DEFAULT TRUE,
    -- Jeton d'activation à usage unique (hash SHA-256), cf. migration 003.
    password_token_hash        CHAR(64),
    password_token_expires_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_users_not_self_manager CHECK (manager_id IS NULL OR manager_id <> id)
);

CREATE INDEX idx_users_email      ON users(email);
CREATE INDEX idx_users_manager    ON users(manager_id);
CREATE INDEX idx_users_role       ON users(role);
CREATE INDEX idx_users_created_by  ON users(created_by);

-- ===========================================================================
-- xFINT1 : Notes de frais
-- ===========================================================================

CREATE TYPE expense_category AS ENUM (
    'travel',
    'meal',
    'accommodation',
    'supplies',
    'other'
);

CREATE TYPE expense_status AS ENUM (
    'draft',
    'submitted',
    'approved_manager',
    'approved_accounting',
    'rejected',
    'reimbursed'
);

CREATE TABLE expense_notes (
    id                      SERIAL PRIMARY KEY,
    user_id                 INTEGER          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title                   VARCHAR(255)     NOT NULL,
    description             TEXT,
    category                expense_category NOT NULL,
    amount                  NUMERIC(10, 2)   NOT NULL CHECK (amount >= 0),
    currency                CHAR(3)          NOT NULL DEFAULT 'EUR',
    expense_date            DATE             NOT NULL,
    status                  expense_status   NOT NULL DEFAULT 'draft',
    manager_id              INTEGER          REFERENCES users(id) ON DELETE SET NULL,
    manager_comment         TEXT,
    manager_action_at       TIMESTAMPTZ,
    accountant_id           INTEGER          REFERENCES users(id) ON DELETE SET NULL,
    accountant_comment      TEXT,
    accountant_action_at    TIMESTAMPTZ,
    submitted_at            TIMESTAMPTZ,
    reimbursed_at           TIMESTAMPTZ,
    created_at              TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expense_notes_user    ON expense_notes(user_id);
CREATE INDEX idx_expense_notes_status  ON expense_notes(status);
CREATE INDEX idx_expense_notes_date    ON expense_notes(expense_date DESC);
CREATE INDEX idx_expense_notes_manager ON expense_notes(manager_id) WHERE manager_id IS NOT NULL;

CREATE TABLE attachments (
    id                SERIAL PRIMARY KEY,
    expense_note_id   INTEGER      NOT NULL REFERENCES expense_notes(id) ON DELETE CASCADE,
    file_name         VARCHAR(255) NOT NULL,
    file_path         VARCHAR(500) NOT NULL,
    mime_type         VARCHAR(100) NOT NULL,
    file_size_bytes   INTEGER      NOT NULL CHECK (file_size_bytes > 0),
    uploaded_by       INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_attachments_expense_note ON attachments(expense_note_id);

-- ===========================================================================
-- xFINT2 : Gestion des congés
-- ===========================================================================

CREATE TABLE leave_types (
    id                      SERIAL PRIMARY KEY,
    code                    VARCHAR(50)    UNIQUE NOT NULL,
    label                   VARCHAR(100)   NOT NULL,
    default_annual_days     NUMERIC(5, 2)  NOT NULL DEFAULT 0 CHECK (default_annual_days >= 0),
    is_paid                 BOOLEAN        NOT NULL DEFAULT TRUE,
    requires_justification  BOOLEAN        NOT NULL DEFAULT FALSE,
    is_active               BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE TYPE leave_status AS ENUM (
    'draft',
    'submitted',
    'approved_manager',
    'approved_hr',
    -- Conservé pour compatibilité ascendante, plus émis par le code.
    'approved',
    'rejected',
    'cancelled'
);

CREATE TABLE leave_requests (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_type_id       INTEGER        NOT NULL REFERENCES leave_types(id),
    start_date          DATE           NOT NULL,
    end_date            DATE           NOT NULL,
    days_requested      NUMERIC(5, 2)  NOT NULL CHECK (days_requested > 0),
    reason              TEXT,
    status              leave_status   NOT NULL DEFAULT 'draft',
    manager_id          INTEGER        REFERENCES users(id) ON DELETE SET NULL,
    manager_comment     TEXT,
    manager_action_at   TIMESTAMPTZ,
    hr_id               INTEGER        REFERENCES users(id) ON DELETE SET NULL,
    hr_comment          TEXT,
    hr_action_at        TIMESTAMPTZ,
    submitted_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_leave_dates CHECK (end_date >= start_date)
);

CREATE INDEX idx_leave_requests_user   ON leave_requests(user_id);
CREATE INDEX idx_leave_requests_status ON leave_requests(status);
CREATE INDEX idx_leave_requests_dates  ON leave_requests(start_date, end_date);

CREATE TABLE leave_balances (
    id                SERIAL PRIMARY KEY,
    user_id           INTEGER        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_type_id     INTEGER        NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
    year              INTEGER        NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    allocated_days    NUMERIC(5, 2)  NOT NULL DEFAULT 0 CHECK (allocated_days >= 0),
    used_days         NUMERIC(5, 2)  NOT NULL DEFAULT 0 CHECK (used_days >= 0),
    pending_days      NUMERIC(5, 2)  NOT NULL DEFAULT 0 CHECK (pending_days >= 0),
    created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_leave_balance_user_type_year UNIQUE (user_id, leave_type_id, year)
);

CREATE INDEX idx_leave_balances_user_year ON leave_balances(user_id, year);

CREATE TABLE leave_attachments (
    id                SERIAL PRIMARY KEY,
    leave_request_id  INTEGER      NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
    file_name         VARCHAR(255) NOT NULL,
    file_path         VARCHAR(500) NOT NULL,
    mime_type         VARCHAR(100) NOT NULL,
    file_size_bytes   INTEGER      NOT NULL CHECK (file_size_bytes > 0),
    uploaded_by       INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leave_attachments_request ON leave_attachments(leave_request_id);

-- ---------------------------------------------------------------------------
-- Trigger générique pour maintenir updated_at
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_expense_notes_updated_at
    BEFORE UPDATE ON expense_notes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_leave_requests_updated_at
    BEFORE UPDATE ON leave_requests
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_leave_balances_updated_at
    BEFORE UPDATE ON leave_balances
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Types de congés par défaut (France)
-- ---------------------------------------------------------------------------

INSERT INTO leave_types (code, label, default_annual_days, is_paid, requires_justification) VALUES
    ('PAID',   'Congés payés',       25, TRUE,  FALSE),
    ('RTT',    'RTT',                10, TRUE,  FALSE),
    ('SICK',   'Arrêt maladie',       0, TRUE,  TRUE),
    ('FAMILY', 'Événement familial',  0, TRUE,  TRUE),
    ('UNPAID',   'Congé sans solde',    0, FALSE, FALSE),
    ('TRAINING', 'Formation',           0, TRUE,  TRUE);

COMMIT;
