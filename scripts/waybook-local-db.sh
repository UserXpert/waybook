#!/usr/bin/env bash
set -euo pipefail

# Starts an isolated, local-only PostgreSQL cluster for Waybook development.
# It creates one Control database and one operational database for each seed
# tenant. Data lives under .waybook/, which is intentionally gitignored.

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
data_dir="$project_root/.waybook/postgres"
port="${WAYBOOK_POSTGRES_PORT:-5440}"
user="waybook"

if ! command -v initdb >/dev/null || ! command -v pg_ctl >/dev/null || ! command -v createdb >/dev/null; then
  echo "PostgreSQL command-line tools are required (initdb, pg_ctl, createdb)." >&2
  exit 1
fi

if [ ! -f "$data_dir/PG_VERSION" ]; then
  mkdir -p "$data_dir"
  initdb --auth=trust --username="$user" --encoding=UTF8 --locale=C --pgdata="$data_dir" >/dev/null
fi

if ! pg_ctl --pgdata="$data_dir" status >/dev/null 2>&1; then
  pg_ctl --pgdata="$data_dir" --wait start --options="-p $port -h 127.0.0.1" >/dev/null
fi

for database in waybook_control waybook_nordic_studio waybook_copenhagen_physio; do
  if ! psql --host=127.0.0.1 --port="$port" --username="$user" --dbname=postgres --tuples-only --no-align \
    --command="SELECT 1 FROM pg_database WHERE datname = '$database'" | grep -qx '1'; then
    createdb --host=127.0.0.1 --port="$port" --username="$user" "$database"
  fi
done

echo "Waybook local PostgreSQL is ready on 127.0.0.1:$port"
echo "  Control:    waybook_control"
echo "  Tenant:     waybook_nordic_studio"
echo "  Tenant:     waybook_copenhagen_physio"
