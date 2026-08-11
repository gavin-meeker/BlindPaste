# Built with the repo root as context (see docker-compose.yml and database/railway.json)
# so this and the api/web Dockerfiles share one build-context convention.
FROM liquibase/liquibase:5.0.3
# The 5.x images ship without a Postgres JDBC driver, so it is baked in at build time
# rather than fetched on every run.
RUN lpm add postgresql --global

# Baked into the image so the container is self-sufficient without a bind mount —
# docker-compose.yml's own volume mount still shadows this locally, letting a changeset
# edit take effect without a rebuild; Railway has no bind mount, so this COPY is what
# it actually runs.
COPY database/changelog /liquibase/changelog

# Shell form on purpose: $PG* only exist in the environment at container start —
# Railway injects them from the referenced Postgres service's variables (see
# database/railway.json) — so they have to be expanded then, not baked in at build time.
#
# docker-compose.yml overrides this CMD unconditionally with its own explicit
# --url/--username/--password args, so local dev is unaffected by anything here; this
# is what runs when the image is started standalone, which is what Railway does.
CMD liquibase \
    --search-path=/liquibase/changelog \
    --changelog-file=changelog-master.xml \
    --url=jdbc:postgresql://$PGHOST:$PGPORT/$PGDATABASE \
    --username=$PGUSER \
    --password=$PGPASSWORD \
    update
