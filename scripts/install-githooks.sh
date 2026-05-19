#!/usr/bin/env bash
# Symlinks the tracked hooks in scripts/githooks/ into .git/hooks/.
# Run once after clone.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
src="$repo_root/scripts/githooks"
dst="$repo_root/.git/hooks"

for hook in "$src"/*; do
  name="$(basename "$hook")"
  ln -sf "../../scripts/githooks/$name" "$dst/$name"
  chmod +x "$src/$name"
  echo "installed $name"
done
