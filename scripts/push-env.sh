#!/usr/bin/env bash
# Push the admin environment variables to Vercel Production.
#
#   vercel login          # once - opens a browser
#   ./scripts/push-env.sh
#
# Values are piped over stdin, so they never land in shell history or in the
# process list. This script prints variable NAMES only, never values.
#
# ASCII only, deliberately: this machine runs LC_CTYPE=C, and a multibyte
# character sitting next to a "$VAR" expansion gets partly absorbed into the
# variable name, which under `set -u` fails as an unbound variable.
set -euo pipefail

ENV_FILE="${1:-.env.production.admin}"
TARGET="production"
# these two are secrets: store them write-only so they cannot be read back out
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

echo "Pushing to ${TARGET}..."
pushed=0
failed=0

while IFS= read -r line || [ -n "$line" ]; do
  # strip a trailing CR in case the file ever picks up CRLF endings
  line=${line%$'\r'}
  # skip blanks and comments
  case "$line" in ''|'#'*) continue ;; esac
  # must contain an '='
  case "$line" in *=*) ;; *) continue ;; esac

  key=${line%%=*}
  value=${line#*=}
  # trim surrounding spaces from the key only; values are taken verbatim
  key=$(printf '%s' "$key" | tr -d '[:space:]')
  [ -z "$key" ] && continue

  flags="--force --yes"
  case " ${SENSITIVE} " in
    *" ${key} "*) flags="${flags} --sensitive" ;;
  esac

  # value over stdin, never as an argument. stderr is kept so a real failure is
  # visible - the value is not on stderr, only on stdin, so this leaks nothing.
  if err=$(printf '%s' "$value" | vercel env add "$key" "$TARGET" $flags 2>&1 >/dev/null); then
    echo "  set     ${key}"
    pushed=$((pushed + 1))
  else
    echo "  FAILED  ${key}" >&2
    printf '          %s\n' "$err" >&2
    failed=$((failed + 1))
  fi
done < "$ENV_FILE"

echo
echo "${pushed} set, ${failed} failed on ${TARGET}."
if [ "$failed" -gt 0 ]; then exit 1; fi

echo "Env vars are bound at build time - redeploy for them to take effect:"
echo "  git commit --allow-empty -m 'Redeploy for env vars' && git push"
