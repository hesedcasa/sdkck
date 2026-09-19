# PostgreSQL server used by the end-to-end test suite (see scripts/e2e.sh).
#
# The seed schema in initdb/ is baked into the image so a fresh container is
# always a fresh, fully-populated `pg_e2e` database — no volume, no drift.
#
# Pinned to 17 deliberately: 18 relocated PGDATA to /var/lib/postgresql/18/docker,
# which would move the tmpfs mount in compose.yaml.
FROM postgres:17-alpine

# Credentials are fixtures for a throwaway local container, not secrets.
ENV POSTGRES_USER=postgres \
    POSTGRES_PASSWORD=pg_e2e_pw \
    POSTGRES_DB=pg_e2e

# Runs alphabetically on first boot, before the server accepts TCP connections.
COPY initdb/ /docker-entrypoint-initdb.d/

EXPOSE 5432

# The `-h` is load-bearing. The entrypoint's seeding phase runs a temporary
# server with listen_addresses='', reachable only over the Unix socket, so a
# TCP probe only succeeds once seeding is committed and the real server is up.
HEALTHCHECK --interval=3s --timeout=5s --start-period=5s --retries=30 \
  CMD pg_isready -h 127.0.0.1 -U postgres -d pg_e2e || exit 1
