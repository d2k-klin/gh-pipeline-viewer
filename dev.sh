#!/usr/bin/env sh
# Run the dashboard privately on this machine: refresh status.json in the
# background, serve the page on localhost. Nothing is published anywhere.
#
#   ./dev.sh            # token from `gh auth token`, port 8000
#   GH_TOKEN=… ./dev.sh # explicit token (a fine-grained PAT is better)
#   PORT=9000 ./dev.sh
#
# ponytail: python's http.server instead of a node dev server — no deps, and
# every macOS/Linux box already has it.
set -eu

cd "$(dirname "$0")"
INTERVAL="${INTERVAL:-300}"

# A stray server on the default port shouldn't stop the dashboard: take the next
# free one. An explicit PORT is honoured as a hard requirement.
if [ -n "${PORT:-}" ]; then
  RANGE=1
else
  PORT=8000
  RANGE=20
fi
PORT=$(python3 -c '
import socket, sys
start, span = int(sys.argv[1]), int(sys.argv[2])
for port in range(start, start + span):
    try:
        socket.socket().bind(("127.0.0.1", port))
    except OSError:
        continue
    print(port)
    break
else:
    sys.exit(f"port {start} is in use — free it, or run with PORT=<other>")
' "$PORT" "$RANGE") || exit 1

# Fall back to the gh CLI's token so there is nothing to configure.
if [ -z "${GH_TOKEN:-}" ]; then
  GH_TOKEN="$(gh auth token 2>/dev/null || true)"
  export GH_TOKEN
  [ -n "$GH_TOKEN" ] && echo "using the gh CLI's token"
fi

node scripts/fetch-status.js

# Keep it fresh while the server runs.
( while sleep "$INTERVAL"; do node scripts/fetch-status.js || echo "refresh failed, keeping last status"; done ) &
REFRESHER=$!
trap 'kill "$REFRESHER" 2>/dev/null || true' EXIT INT TERM

echo "→ http://localhost:$PORT  (refreshing every ${INTERVAL}s, Ctrl-C to stop)"
# serve.py also accepts the dashboard's Save, writing config.local.json.
python3 scripts/serve.py "$PORT"
