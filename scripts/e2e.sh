#!/usr/bin/env bash
# Runs the host end-to-end suite: every plugin installed into a throwaway
# sdkck home, then driven through this repo's built CLI against the live
# sandboxes — the shared Atlassian/Bitbucket/Sentry/Trello accounts and
# disposable Docker MySQL/PostgreSQL servers (fixtures vendored under
# test/e2e/docker/).
#
#   npm run test:e2e                            # everything, local plugin builds
#   E2E_PLUGINS="jira conni" npm run test:e2e   # a subset of plugins
#   E2E_PLUGIN_SOURCE=npm npm run test:e2e      # @hesed/<name>@latest from npm
#   npm run test:e2e -- --grep jira             # extra args go through to mocha
#   npm run test:e2e -- --keep                  # leave containers/home behind
#
# Plugins come from one of two sources (E2E_PLUGIN_SOURCE):
#   local (default) — build and npm pack the sibling repos (../jira, ../conni,
#     ../bb, ../sentry, ../trello, ../mysql, ../psql, ../api2cli; override the
#     parent dir with E2E_PLUGIN_ROOT) and install the tarballs: what a
#     developer iterating across repos wants.
#   npm — install @hesed/<name>@latest straight from the registry: what CI
#     runs, proving the host against the published releases users get. No
#     sibling checkouts needed.
#
# Secrets are loaded from .env at the repo root when it exists (bash sources
# it verbatim); the suite never touches the developer's real sdkck config —
# every subprocess gets SDKCK_CONFIG_DIR/SDKCK_DATA_DIR/SDKCK_CACHE_DIR
# redirected into throwaway directories.
#
# Requires Docker with the Compose plugin when mysql or psql is selected.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$PWD"

ALL_PLUGINS="jira conni bb sentry trello mysql psql api2cli"
if [ -n "${E2E_PLUGINS:-}" ]; then
  SELECTED="$E2E_PLUGINS"
else
  SELECTED="$ALL_PLUGINS"
fi

E2E_PLUGIN_SOURCE="${E2E_PLUGIN_SOURCE:-local}"
if [ "$E2E_PLUGIN_SOURCE" != "local" ] && [ "$E2E_PLUGIN_SOURCE" != "npm" ]; then
  echo "error: E2E_PLUGIN_SOURCE must be 'local' or 'npm', got '$E2E_PLUGIN_SOURCE'" >&2
  exit 1
fi

# Where the sibling plugin repos live (local source only); override when they
# are checked out elsewhere.
E2E_PLUGIN_ROOT="${E2E_PLUGIN_ROOT:-$(cd "$REPO_ROOT/.." && pwd)}"

# The vendored Docker fixtures the mysql/psql legs run against.
MYSQL_COMPOSE="$REPO_ROOT/test/e2e/docker/mysql/compose.yaml"
PSQL_COMPOSE="$REPO_ROOT/test/e2e/docker/psql/compose.yaml"

KEEP=0
MOCHA_ARGS=()
USER_GREP=0

for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    --grep|-g) USER_GREP=1; MOCHA_ARGS+=("$arg") ;;
    *) MOCHA_ARGS+=("$arg") ;;
  esac
done

# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------

if [ -f "$REPO_ROOT/.env" ]; then
  echo "==> Loading secrets from .env"
  set -a
  # shellcheck disable=SC1091
  . "$REPO_ROOT/.env"
  set +a
fi

# The .env at the repo root carries the Trello API key as RELLO_API_KEY; the
# trello plugin and the test helpers want TRELLO_API_KEY.
export TRELLO_API_KEY="${TRELLO_API_KEY:-${RELLO_API_KEY:-}}"

plugin_selected() {
  case " $SELECTED " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# The env vars each plugin's tests need, checked up front so the run fails in
# seconds — not after a full build — when a key is missing from .env.
required_env_for() {
  case "$1" in
    jira|conni) echo "ATLASSIAN_URL ATLASSIAN_EMAIL ATLASSIAN_API_TOKEN" ;;
    bb) echo "BITBUCKET_API_TOKEN BITBUCKET_EMAIL E2E_WORKSPACE" ;;
    sentry) echo "SENTRY_API_KEY" ;;
    trello) echo "TRELLO_API_KEY TRELLO_SECRET" ;;
    api2cli) echo "LINEAR_API_KEY VERCEL_API_KEY CONTEXT7_API_KEY" ;;
    *) echo "" ;;
  esac
}

missing_secrets=()
for plugin in $SELECTED; do
  for var in $(required_env_for "$plugin"); do
    if [ -z "${!var:-}" ]; then
      missing_secrets+=("$var (needed by $plugin)")
    fi
  done
done

if [ "${#missing_secrets[@]}" -gt 0 ]; then
  echo "error: missing credentials: ${missing_secrets[*]}" >&2
  echo "Add them to .env at the repo root, or narrow the run: E2E_PLUGINS=\"jira\" npm run test:e2e" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Docker fixtures (mysql/psql)
# ---------------------------------------------------------------------------

MYSQL_STARTED=0
PSQL_STARTED=0

if plugin_selected mysql || plugin_selected psql; then
  if ! docker compose version >/dev/null 2>&1; then
    echo "error: docker compose is required when mysql or psql is selected" >&2
    exit 1
  fi
fi

start_mysql() {
  export MQ_E2E_PROJECT="${MQ_E2E_PROJECT:-mq-e2e-sdkck-$$}"
  export MQ_E2E_PORT="${MQ_E2E_PORT:-0}"

  echo "==> Starting MySQL (project $MQ_E2E_PROJECT)"
  docker compose -f "$MYSQL_COMPOSE" up -d --build --wait

  if [ "$MQ_E2E_PORT" = "0" ]; then
    MQ_E2E_PORT="$(docker compose -f "$MYSQL_COMPOSE" port mysql 3306 | sed 's/.*://')"
    export MQ_E2E_PORT
  fi

  echo "==> MySQL is listening on port $MQ_E2E_PORT"
  MYSQL_STARTED=1
}

start_psql() {
  export PG_E2E_PROJECT="${PG_E2E_PROJECT:-pg-e2e-sdkck-$$}"
  export PG_E2E_PORT="${PG_E2E_PORT:-0}"

  echo "==> Starting PostgreSQL (project $PG_E2E_PROJECT)"
  docker compose -f "$PSQL_COMPOSE" up -d --build --wait

  if [ "$PG_E2E_PORT" = "0" ]; then
    PG_E2E_PORT="$(docker compose -f "$PSQL_COMPOSE" port postgres 5432 | sed 's/.*://')"
    export PG_E2E_PORT
  fi

  echo "==> PostgreSQL is listening on port $PG_E2E_PORT"
  PSQL_STARTED=1
}

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

# Deliberately NOT named SDKCK_HOME: an inherited SDKCK_HOME could point at
# the developer's real sdkck setup, and the EXIT trap must never rm -rf that.
# This variable only ever holds a path this script itself mktemp'd.
SDKCK_E2E_HOME=""

cleanup() {
  local status=$?

  # Packing-failure path (local source only): prepack may have rewritten a
  # plugin README after the backup was taken but before the inline restore
  # ran. Put every backup back before anything else; after a successful pack
  # they are already gone.
  if [ "$E2E_PLUGIN_SOURCE" = "local" ]; then
    for plugin in $ALL_PLUGINS; do
      if [ -f "$E2E_PLUGIN_ROOT/$plugin/README.md.e2e-bak" ]; then
        mv "$E2E_PLUGIN_ROOT/$plugin/README.md.e2e-bak" "$E2E_PLUGIN_ROOT/$plugin/README.md"
      fi
    done
  fi

  if [ "$KEEP" -ne 0 ]; then
    echo "==> Leaving fixtures in place (--keep); clean up later with: npm run e2e:sweep"
    if [ "$MYSQL_STARTED" -ne 0 ]; then
      echo "      Reuse MySQL with:  MQ_E2E_PROJECT=$MQ_E2E_PROJECT MQ_E2E_PORT=$MQ_E2E_PORT npm run e2e:mocha"
      echo "      Stop it with:      MQ_E2E_PROJECT=$MQ_E2E_PROJECT docker compose -f $MYSQL_COMPOSE down -v"
    fi
    if [ "$PSQL_STARTED" -ne 0 ]; then
      echo "      Reuse PostgreSQL with:  PG_E2E_PROJECT=$PG_E2E_PROJECT PG_E2E_PORT=$PG_E2E_PORT npm run e2e:mocha"
      echo "      Stop it with:           PG_E2E_PROJECT=$PG_E2E_PROJECT docker compose -f $PSQL_COMPOSE down -v"
    fi
    if [ -n "$SDKCK_E2E_HOME" ]; then
      echo "      Throwaway home kept at: $SDKCK_E2E_HOME"
    fi
    exit "$status"
  fi

  # Runs even after a failing mocha — this is the backstop for fixtures a
  # killed run never reclaimed, since E2E_RUN_ID pins this invocation's label.
  # A sweep failure leaves fixtures in the shared sandboxes, so it must not be
  # swallowed: it surfaces as a non-zero exit unless the tests already failed,
  # in which case that status is the more useful one to keep.
  echo "==> Sweeping any fixtures left behind"
  if ! npm run --silent e2e:sweep; then
    echo "error: sweeping fixtures failed; the sandboxes may still hold e2e fixtures" >&2
    if [ "$status" -eq 0 ]; then
      status=1
    fi
  fi

  if [ "$MYSQL_STARTED" -ne 0 ]; then
    echo "==> Stopping MySQL container"
    docker compose -f "$MYSQL_COMPOSE" down -v --remove-orphans >/dev/null 2>&1 || true
  fi

  if [ "$PSQL_STARTED" -ne 0 ]; then
    echo "==> Stopping PostgreSQL container"
    docker compose -f "$PSQL_COMPOSE" down -v --remove-orphans >/dev/null 2>&1 || true
  fi

  if [ -n "$SDKCK_E2E_HOME" ]; then
    rm -rf "$SDKCK_E2E_HOME"
  fi

  exit "$status"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Install every selected plugin
# ---------------------------------------------------------------------------

# `oclif readme` inside each plugin's prepack rewrites its tracked README.md
# with the current machine's usage string, so back it up and restore it after
# packing — an e2e run must never dirty a plugin repo's worktree or clobber
# uncommitted README edits. The backup lives next to the README (not in the
# throwaway home) so the EXIT trap can restore it even when packing itself
# fails partway through.
#
# Only the tarball path is written to stdout — the caller captures it with
# command substitution, so progress goes to stderr.
pack_plugin() {
  local dir="$1"
  local name
  name="$(basename "$dir")"

  echo "==> Building and packing $name" >&2
  if [ ! -d "$dir/node_modules" ]; then
    (cd "$dir" && npm ci --silent 1>&2)
  fi

  (cd "$dir" && npm run --silent build 1>&2)

  cp "$dir/README.md" "$dir/README.md.e2e-bak"
  local tgz
  tgz="$(cd "$dir" && npm pack --pack-destination "$SDKCK_E2E_HOME" | tail -n 1)"
  mv "$dir/README.md.e2e-bak" "$dir/README.md"

  echo "$SDKCK_E2E_HOME/$tgz"
}

# Installs an install spec — a `file:` URL to a packed tarball (local source)
# or an npm spec like `@hesed/jira@latest` — into the throwaway home.
install_plugin() {
  local spec="$1"
  local name="$2"

  echo "==> Installing $name into the throwaway home"
  # A tarball must be passed as a `file:` URL: sdkck resolves any bare path
  # containing a slash as a GitHub org/repo.
  SDKCK_CACHE_DIR="$SDKCK_E2E_HOME/cache" \
  SDKCK_CONFIG_DIR="$SDKCK_E2E_HOME/config" \
  SDKCK_DATA_DIR="$SDKCK_E2E_HOME/data" \
    node "$REPO_ROOT/bin/run.js" plugins install "$spec" >/dev/null
}

if plugin_selected mysql; then
  start_mysql
fi

if plugin_selected psql; then
  start_psql
fi

echo "==> Building sdkck"
npm run --silent build

SDKCK_E2E_HOME="$(mktemp -d)"
export E2E_SDKCK_HOME="$SDKCK_E2E_HOME"

for plugin in $SELECTED; do
  if [ "$E2E_PLUGIN_SOURCE" = "npm" ]; then
    # @latest matches what package.json's jitPlugins pins, and what a user
    # gets on first use. api2cli is additionally bundled as a package.json
    # dependency; installing latest shadows that pin for this run.
    install_plugin "@hesed/$plugin@latest" "@hesed/$plugin@latest"
    continue
  fi

  dir="$E2E_PLUGIN_ROOT/$plugin"
  if [ ! -d "$dir" ]; then
    echo "error: plugin repo not found: $dir (set E2E_PLUGIN_ROOT, or use E2E_PLUGIN_SOURCE=npm)" >&2
    exit 1
  fi

  tgz="$(pack_plugin "$dir")"
  install_plugin "file:$tgz" "@hesed/$plugin (local $dir)"
done

# ---------------------------------------------------------------------------
# Run the suite
# ---------------------------------------------------------------------------

# A plugin subset selects the matching describe blocks, so unselected legs
# never even open their config dirs. An explicit --grep from the caller wins.
if [ "$USER_GREP" -eq 0 ] && [ "$SELECTED" != "$ALL_PLUGINS" ]; then
  labels=""
  for plugin in $SELECTED; do
    case "$plugin" in
      api2cli) topic="api" ;;
      *) topic="$plugin" ;;
    esac
    if [ -n "$labels" ]; then
      labels="$labels|$topic"
    else
      labels="$topic"
    fi
  done
  MOCHA_ARGS+=(--grep "e2e: ($labels) plugin via sdkck")
fi

export E2E_RUN_ID="${E2E_RUN_ID:-local-$$}"
echo "==> Running end-to-end tests (run id $E2E_RUN_ID)"
# The +expansion guard keeps `set -u` happy with an empty array on bash 3.2.
npm run --silent e2e:mocha -- ${MOCHA_ARGS[@]+"${MOCHA_ARGS[@]}"}
