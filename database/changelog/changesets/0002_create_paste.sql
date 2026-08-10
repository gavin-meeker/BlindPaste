--liquibase formatted sql

--changeset blindpaste:0002-create-paste
--comment: The paste table. `payload` holds the opaque base64url token the browser
--         produces (version byte, salt, iv, ciphertext+tag) — the server stores it
--         and never parses it, so changing the crypto parameters stays a frontend
--         change. `id` is 128 bits of CSPRNG output, base64url-encoded to 22 chars;
--         it is the only thing gating retrieval, so it is generated server-side and
--         sized to be unguessable rather than merely unique.
CREATE TABLE IF NOT EXISTS paste (
  id                 TEXT        PRIMARY KEY,
  payload            TEXT        NOT NULL,
  burn_after_reading BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL
);

--comment: The sweeper deletes by expires_at on a timer and every read filters on it,
--         so this index serves both. Rows are only ever inserted and deleted, never
--         updated, which is what lets a reader trust a payload it has already read.
CREATE INDEX IF NOT EXISTS ix_paste_expires_at ON paste (expires_at);
--rollback DROP TABLE paste;
