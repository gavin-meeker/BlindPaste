--liquibase formatted sql

--changeset blindpaste:0003-paste-expires-at-nullable
--comment: NULL now means "never expires"
ALTER TABLE paste ALTER COLUMN expires_at DROP NOT NULL;
--rollback ALTER TABLE paste ALTER COLUMN expires_at SET NOT NULL;
