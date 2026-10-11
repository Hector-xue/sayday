"""M0 静态服务：只绑 127.0.0.1；--coi 时加 COOP/COEP 头以启用 WASM 多线程。"""
import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class H(SimpleHTTPRequestHandler):
    coi = False

    def end_headers(self):
        if self.coi:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


H.extensions_map.update({".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm"})

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=5287)
ap.add_argument("--coi", action="store_true")
a = ap.parse_args()
H.coi = a.coi
ThreadingHTTPServer(("127.0.0.1", a.port), functools.partial(H, directory=str(Path(__file__).parent))).serve_forever()
