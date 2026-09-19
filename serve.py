"""
本地预览服务器（开发用，替代 python -m http.server）。
与内置 http.server 的唯一区别：所有响应带 no-cache 头，
保证修改 js/css 后刷新页面立即生效（双击 index.html 的 file:// 方式不受缓存影响）。

用法：python serve.py [端口]    （默认 8642）
"""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8642


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), NoCacheHandler) as httpd:
        print(f"Serving on http://localhost:{PORT} (no-cache)")
        httpd.serve_forever()
