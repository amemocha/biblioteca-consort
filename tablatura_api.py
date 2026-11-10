"""Optional PDF-to-MusicXML recognition server for Biblioteca Consorte.
Requires Audiveris installed on the host; set AUDIVERIS_BIN to its executable.
Run: python3 tablatura_api.py (default port 10000).
"""
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from xml.etree import ElementTree as ET

MAX_PDF_BYTES = 12 * 1024 * 1024
AUDIVERIS_BIN = os.environ.get("AUDIVERIS_BIN", "audiveris")

def recognize(pdf_bytes):
    if not pdf_bytes.startswith(b"%PDF-"):
        raise ValueError("El archivo no parece un PDF válido.")
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise ValueError("El PDF supera el límite de 12 MB.")
    with tempfile.TemporaryDirectory(prefix="consorte-omr-") as d:
        source = Path(d) / "partitura.pdf"
        out = Path(d) / "salida"
        out.mkdir()
        source.write_bytes(pdf_bytes)
        try:
            process = subprocess.run(
                [AUDIVERIS_BIN, "-batch", "-export", "-output", str(out), "--", str(source)],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=180, check=False,
            )
        except FileNotFoundError as exc:
            raise RuntimeError("El servidor no tiene Audiveris instalado.") from exc
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("El reconocimiento excedió el tiempo permitido.") from exc
        candidates = sorted(out.rglob("*.mxl"))
        if not candidates:
            raise RuntimeError("Audiveris no pudo reconocer esta partitura. Prueba un PDF más nítido.")
        # Each MXL is a zipped MusicXML container; choose the first movement.
        with zipfile.ZipFile(candidates[0]) as archive:
            paths = [n for n in archive.namelist() if n.lower().endswith(".xml") and not n.startswith("META-INF/")]
            if not paths:
                raise RuntimeError("La conversión no produjo MusicXML válido.")
            rootfile = paths[0]
            if "META-INF/container.xml" in archive.namelist():
                container = ET.fromstring(archive.read("META-INF/container.xml"))
                for node in container.iter():
                    if node.tag.endswith("rootfile") and node.get("full-path") in paths:
                        rootfile = node.get("full-path")
                        break
            xml = archive.read(rootfile).decode("utf-8-sig")
            if "<score-partwise" not in xml and "<score-timewise" not in xml:
                raise RuntimeError("Audiveris devolvió un documento musical no compatible.")
            return xml

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/api/transcribe-pdf":
            self.send_error(404)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > 17 * 1024 * 1024:
                raise ValueError("Archivo demasiado grande o vacío.")
            payload = json.loads(self.rfile.read(size))
            decoded = base64.b64decode(payload.get("pdfBase64", ""), validate=True)
            xml = recognize(decoded)
            self.respond(200, {"musicxml": xml, "warning": "Revisa notas, silencios y ritmo: el reconocimiento automático puede equivocarse."})
        except (ValueError, RuntimeError, json.JSONDecodeError) as error:
            self.respond(422, {"error": str(error)})
        except Exception:
            self.respond(500, {"error": "Error interno al reconocer la partitura."})

    def do_GET(self):
        if self.path == "/api/health":
            self.respond(200, {"status": "ok", "audiveris_bin": AUDIVERIS_BIN})
        else:
            self.send_error(404)

    def respond(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", os.environ.get("CORS_ORIGIN", "https://biblioteca-consorte.onrender.com"))
        self.end_headers()
        self.wfile.write(data)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "10000"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
