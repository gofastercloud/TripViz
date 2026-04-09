#!/usr/bin/env python3
"""Minimal stub backend for Tauri smoke testing.

Reads TRIPVIZ_HOST/TRIPVIZ_PORT from env and serves GET /api/health.
Handles SIGTERM cleanly.
"""
import os
import signal
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok","stub":true}')
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("stub: " + (fmt % args) + "\n")


def main():
    host = os.environ.get("TRIPVIZ_HOST", "127.0.0.1")
    port = int(os.environ.get("TRIPVIZ_PORT", "8000"))
    data_dir = os.environ.get("TRIPVIZ_DATA_DIR", "")
    api_only = os.environ.get("TRIPVIZ_API_ONLY", "")
    sys.stderr.write(
        f"stub: starting on {host}:{port} data_dir={data_dir} api_only={api_only}\n"
    )
    sys.stderr.flush()

    server = HTTPServer((host, port), Handler)

    def shutdown(_sig, _frm):
        sys.stderr.write("stub: SIGTERM — shutting down\n")
        sys.stderr.flush()
        server.shutdown()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
