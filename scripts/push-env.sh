#!/usr/bin/env bash
# Push the admin environment variables to Vercel Production.
#
#   vercel login          # once — opens a browser
#   ./scripts/push-env.sh
#
# Values are piped over stdin, so they never land in shell history or in the
# process list. This script prints variable NAMES only, never values.
set -euo pipefail

ENV_FILE="${1:-.env.production.admin}"
TARGET="production"
# these two are secrets: store them write-only so they can't be read back out
SENSITIVE="ADMIN_PASSWORD_HASH SESSION_SECRET"

cd "$(dirname "$0")/.."

if [ ! -f "$ENV_FILE" ]; then
  echo "error: $ENV_FILE not found" >&2
  exit 1
fi

if ! vercel whoami >/dev/null 2>&1; then
  echo "Not signed in to Vercel. Run:  vercel login" >&2
  exit 1
fi

echo "Pushing to $TARGET…"
pushed=0

while IFS= read -r line || [ -n "$line" ]; do
  # skip blanks and comments
  case "$line" in ''|'#'*) continue ;; esac
  key=${line%%=*}
  value=${line#*=}
  [ -z "$key" ] && continue

  flags="--force --yes"
  case " $SENSITIVE " in
    *" $key "*) flags="$flags --sensitive" ;;
  esac

  # value over stdin, never as an argument
  if printf '%s' "$value" | vercel env add "$key" "$TARGET" $flags >/dev/null 2>&1; then
    echo "  set  $key"
    pushed=$((pushed + 1))
  else
    echo "  FAILED  $key" >&2
  fi
done < "$ENV_FILE"

echo
echo "$pushed variable(s) set on $TARGET."
echo "Environment variables are bound at build time — redeploy for them to take effect:"
echo "  git commit --allow-empty -m 'Redeploy for env vars' && git push"
