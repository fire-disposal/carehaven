"""DeepSeek 官方 tokenizer 的小服务。

只做两件事：/health 报告词表大小，/tokenize 返回文本的 token 数。
模型文件来自 DeepSeek 官方分发的 deepseek_v3_tokenizer.zip（tokenizer.json）。
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from tokenizers import Tokenizer

MODEL_PATH = os.environ.get("TOKENIZER_MODEL", "/app/model/tokenizer.json")
PORT = int(os.environ.get("PORT", "8301"))
tokenizer = Tokenizer.from_file(MODEL_PATH)


class Handler(BaseHTTPRequestHandler):
    server_version = "carehaven-tokenizer/1"

    def _send(self, payload, code=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send({"ok": True, "vocab": tokenizer.get_vocab_size()})
            return
        self._send({"message": "not found"}, 404)

    def do_POST(self):
        if self.path != "/tokenize":
            self._send({"message": "not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length) or b"{}")
            texts = payload.get("texts") or []
            if not isinstance(texts, list):
                raise ValueError("texts must be an array")
            counts = [len(tokenizer.encode(str(text)).ids) for text in texts]
            self._send({"counts": counts, "tokenizer": "deepseek-official"})
        except Exception as err:  # noqa: BLE001 - 统一返回 400，便于上游降级
            self._send({"message": str(err)}, 400)

    def log_message(self, fmt, *args):  # 安静：由容器日志收集
        return


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
