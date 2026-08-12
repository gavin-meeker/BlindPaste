--liquibase formatted sql

--changeset blindpaste:0004-drop-ping
--comment: Removes the ping table. It was a smoke test proving Liquibase could reach
--         the database and the API could read a row back — useful once, dead weight
--         now that the api service has its own /health endpoint doing that job.
--         IF EXISTS makes this safe to run twice.
DROP TABLE IF EXISTS ping;
--rollback CREATE TABLE ping (id SERIAL PRIMARY KEY, message TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
