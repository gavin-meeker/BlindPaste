--liquibase formatted sql

--changeset blindpaste:0001-create-ping
--comment: Smoke-test table proving the stack is wired end to end — Liquibase reached
--         the database, applied a changeset, and the API can read a row back.
CREATE TABLE IF NOT EXISTS ping (
    id         SERIAL PRIMARY KEY,
    message    TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seeds only into an empty table. `ping` has no natural key to conflict on — its id is
-- a SERIAL — so a re-run cannot be caught by ON CONFLICT and this asks whether any row
-- is already there instead.
INSERT INTO ping (message)
SELECT 'pong'
WHERE NOT EXISTS (SELECT 1 FROM ping);
--rollback DROP TABLE ping;
