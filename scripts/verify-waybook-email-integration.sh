#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PGHOST=127.0.0.1 PGPORT=5440 PGUSER=waybook
tenant_db="waybook_lifecycle_$$"
control_db="waybook_lifecycle_control_$$"
server_pid=''
tenant_created=false
control_created=false
cleanup() {
  if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
  if "$tenant_created"; then dropdb --if-exists --force "$tenant_db" >/dev/null 2>&1 || true; fi
  if "$control_created"; then dropdb --if-exists --force "$control_db" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
if lsof -nP -iTCP:3336 -sTCP:LISTEN >/dev/null 2>&1; then echo 'Port 3336 is in use.' >&2; exit 1; fi
createdb "$tenant_db"
tenant_created=true
createdb "$control_db"
control_created=true
export WAYBOOK_NORDIC_STUDIO_DATABASE_URL="postgresql://waybook@127.0.0.1:5440/$tenant_db"
export WAYBOOK_CONTROL_DATABASE_URL="postgresql://waybook@127.0.0.1:5440/$control_db"
export WAYBOOK_EMAIL_INTEGRATION_TEST_DATABASE_URL="$WAYBOOK_NORDIC_STUDIO_DATABASE_URL"
node --import tsx --input-type=module -e 'import {migrateWaybookDatabase} from "./database/waybook/migrate.ts"; await migrateWaybookDatabase(process.env.WAYBOOK_CONTROL_DATABASE_URL,"control"); await migrateWaybookDatabase(process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL,"tenant");'
psql -q -v ON_ERROR_STOP=1 -d "$control_db" <<'SQL'
INSERT INTO tenants (id,slug,name,plan,lifecycle_status,database_env_key) VALUES ('459cd62f-caa8-406d-9b15-58c69feb95ec','nordic-studio','Test Studio','growth','active','WAYBOOK_NORDIC_STUDIO_DATABASE_URL');
INSERT INTO tenant_domains (tenant_id,hostname) VALUES ('459cd62f-caa8-406d-9b15-58c69feb95ec','nordic.localhost');
INSERT INTO tenant_feature_states (tenant_id,feature_key,is_enabled) SELECT '459cd62f-caa8-406d-9b15-58c69feb95ec',feature_key,is_enabled FROM plan_feature_defaults WHERE plan='growth';
SQL
psql -q -v ON_ERROR_STOP=1 -d "$tenant_db" -f scripts/fixtures/email-booking.sql
node --import tsx scripts/verify-waybook-email-booking-integration.ts seed
WAYBOOK_EMAIL_DELIVERY_ENABLED=false ./node_modules/.bin/next start apps/demo --hostname localhost --port 3336 >/dev/null 2>&1 &
server_pid=$!
for attempt in {1..40}; do
  if curl -s -o /dev/null http://localhost:3336/nordic/book; then break; fi
  if ! kill -0 "$server_pid" 2>/dev/null; then echo 'Test server failed to start. Build apps/demo first.' >&2; exit 1; fi
  sleep .5
done
node scripts/verify-waybook-email-booking-api.cjs
node --import tsx scripts/verify-waybook-email-booking-integration.ts verify
