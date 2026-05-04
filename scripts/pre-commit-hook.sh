#!/usr/bin/env sh
# IMO Onyx Terminal — local pre-commit hook (optional)
#
# Catches the same bugs CI catches, but locally before the commit
# even hits GitHub. Saves a round-trip when you forget an import.
#
# To install:
#   ln -sf ../../scripts/pre-commit-hook.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit
#
# Or, if you don't want it (e.g. mid-WIP commits):
#   rm .git/hooks/pre-commit
#
# This is opt-in by design — no Husky dependency, no auto-install
# in node_modules postinstall scripts. You wire it up by symlink
# when you actually want the local guard.
#
# Runs in ~3-5 seconds for the typecheck. Tests are skipped here
# (use `npm run precommit` if you want them too).

set -e

# Skip typecheck on docs-only commits
if git diff --cached --name-only | grep -qE '\.(jsx?|ts|tsx|json|d\.ts)$'; then
  echo "→ running typecheck (default + missing-ref gate)..."
  npm run typecheck --silent
  npm run check:imports --silent
  echo "✓ pre-commit checks passed"
else
  echo "→ no JS/TS/JSON changes — skipping typecheck"
fi
