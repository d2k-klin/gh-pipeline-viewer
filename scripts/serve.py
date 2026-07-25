#!/usr/bin/env python3
"""Local dev server for the dashboard: static files, plus PUT /config.local.json
so the Save button can persist your selection to a git-ignored file.

    python3 scripts/serve.py [port]

ponytail: a 40-line subclass of the stdlib handler instead of a web framework.
Localhost only, and the one writable path is hard-coded.
"""
import json
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "config.local.json"
MAX_BODY = 256 * 1024


class Handler(SimpleHTTPRequestHandler):
    def do_PUT(self):
        if self.path.split("?")[0] != "/config.local.json":
            self.send_error(404, "only /config.local.json is writable")
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_error(400, "bad Content-Length")
            return
        if not 0 < length <= MAX_BODY:
            self.send_error(413, "body must be 1..%d bytes" % MAX_BODY)
            return

        raw = self.rfile.read(length)
        try:
            config = json.loads(raw)
        except json.JSONDecodeError as err:
            self.send_error(400, "not valid JSON: %s" % err)
            return
        if not isinstance(config, dict) or not isinstance(config.get("repos"), list):
            self.send_error(422, 'expected an object with a "repos" array')
            return

        TARGET.write_text(json.dumps(config, indent=2) + "\n")
        self.log_message("wrote %s (%d repos)", TARGET.name, len(config["repos"]))
        body = json.dumps({"saved": TARGET.name}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # status.json changes under the page; never let a stale copy be cached.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(Handler, directory=str(ROOT))
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        httpd.serve_forever()
