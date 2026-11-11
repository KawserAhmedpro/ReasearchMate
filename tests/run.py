import http.server
import socketserver
import threading
import subprocess
import time
import json
import sys
import tempfile
import shutil

results_received = None
done_event = threading.Event()

class TestServerHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        global results_received
        if self.path == '/report_test_results':
            length = int(self.headers.get('Content-Length', 0))
            data = self.rfile.read(length)
            results_received = json.loads(data.decode('utf-8'))
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'OK')
            done_event.set()
        else:
            self.send_response(404)
            self.end_headers()

PORT = 8128
httpd = socketserver.TCPServer(('127.0.0.1', PORT), TestServerHandler)
t = threading.Thread(target=httpd.serve_forever, daemon=True)
t.start()

chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
user_data_dir = tempfile.mkdtemp(prefix='rm_test_unit_')
chrome_proc = subprocess.Popen([
    chrome_path,
    '--headless=new',
    '--disable-gpu',
    f'--user-data-dir={user_data_dir}',
    f'http://127.0.0.1:{PORT}/tests/test_runner.html'
])

done = done_event.wait(timeout=30)
chrome_proc.terminate()
try:
    chrome_proc.wait(timeout=5)
except Exception:
    chrome_proc.kill()
httpd.shutdown()
shutil.rmtree(user_data_dir, ignore_errors=True)

if not done or not results_received:
    print('TIMEOUT: No test results received within 30 seconds.')
    sys.exit(1)

print('=== BROWSER TEST RESULTS ===')
print('Overall Status:', results_received.get('status'))
if results_received.get('error'):
    print('Fatal Error:', results_received.get('error'))
for item in results_received.get('results', []):
    st = item.get('status')
    msg = item.get('msg')
    print(f'[{st}] {msg}')

if results_received.get('status') != 'SUCCESS':
    sys.exit(1)
print('ALL TESTS PASSED!')

