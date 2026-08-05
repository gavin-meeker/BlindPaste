--liquibase formatted sql

--changeset blindpaste:0001-create-ping
--comment: Smoke-test table proving the stack is wired end to end — Liquibase reached
--         the database, applied a changeset, and the API can read a row back.
CREATE TABLE ping (
    id         SERIAL PRIMARY KEY,
    message    TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO ping (message) VALUES ('pong');
--rollback DROP TABLE ping;
