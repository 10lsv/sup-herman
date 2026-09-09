-- ---------------------------------------------------------------------------
-- 002 — Workflow congés à deux étapes (xFINT2)
--
-- Le schéma initial n'avait qu'un statut `approved` terminal et une seule
-- colonne de décision (manager_*). La spec demande le même parcours que les
-- notes de frais :
--     submitted → approved_manager → approved_hr   (rejected/cancelled à tout moment)
-- d'où deux valeurs d'enum et un jeu de colonnes hr_* en plus.
--
-- `approved` reste dans l'enum pour ne pas casser d'éventuelles lignes
-- existantes ; le code ne l'émet plus.
--
-- Idempotent : rejouable à chaque démarrage.
-- ---------------------------------------------------------------------------

ALTER TYPE leave_status ADD VALUE IF NOT EXISTS 'approved_manager' AFTER 'submitted';
ALTER TYPE leave_status ADD VALUE IF NOT EXISTS 'approved_hr' AFTER 'approved_manager';

ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS hr_id        INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS hr_comment   TEXT;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS hr_action_at TIMESTAMPTZ;

-- « Formation » manquait parmi les types demandés (CP, RTT, Sans Solde,
-- Maladie, Formation).
INSERT INTO leave_types (code, label, default_annual_days, is_paid, requires_justification)
VALUES ('TRAINING', 'Formation', 0, TRUE, TRUE)
ON CONFLICT (code) DO NOTHING;
