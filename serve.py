"""Dev server for the turf console.

Same as `python -m http.server`, except every response carries no-store. The
default server sends Last-Modified and lets the browser heuristically cache,
which repeatedly served a stale app.js/styles.css after an edit and made
finished work look broken. Serves the directory this file sits in, so it does
not matter what the working directory is.

    python serve.py [port]        # defaults to 5174
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # the request log is noise while iterating


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5174
    handler = partial(NoCacheHandler, directory=ROOT)
    with ThreadingHTTPServer(("0.0.0.0", port), handler) as httpd:
        print(f"turf-erp on http://localhost:{port}  (no-store, serving {ROOT})", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
