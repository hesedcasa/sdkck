# check=skip=SecretsUsedInArgOrEnv
# MySQL server used by the end-to-end test suite (see scripts/e2e.sh).
#
# The seed schema in initdb/ is baked into the image so a fresh container is
# always a fresh, fully-populated `mq_e2e` database — no volume, no drift.
FROM mysql:8.4

# Credentials are fixtures for a throwaway local container, not secrets.
ENV MYSQL_ROOT_PASSWORD=mq_root_pw \
    MYSQL_DATABASE=mq_e2e \
    MYSQL_USER=mq_user \
    MYSQL_PASSWORD=mq_user_pw

# Runs alphabetically on first boot, before the server accepts TCP connections.
COPY initdb/ /docker-entrypoint-initdb.d/

# Small footprint: this server holds a few hundred fixture rows, nothing more.
CMD ["mysqld", "--innodb-buffer-pool-size=64M", "--performance-schema=OFF"]

EXPOSE 3306

# The entrypoint's init phase runs with --skip-networking, so a TCP ping only
# succeeds once the real server is up and the seed data is committed.
HEALTHCHECK --interval=3s --timeout=5s --start-period=5s --retries=30 \
  CMD mysqladmin ping --protocol=tcp -h 127.0.0.1 -u root -p"$MYSQL_ROOT_PASSWORD" --silent || exit 1
