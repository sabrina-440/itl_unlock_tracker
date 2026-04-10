#!/usr/bin/env python3
"""ITL2026 Unlock Tracker — serves static files and proxies the GrooveStats API."""
import os
import requests as http_requests
from flask import Flask, jsonify, send_from_directory

PORT = int(os.environ.get('PORT', 8000))
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__)


@app.route('/gs/<entrant>')
def entrant_api(entrant):
    if not entrant.isdigit():
        return jsonify(error='Entrant must be a number'), 400
    resp = http_requests.get(
        f'https://itl2026.groovestats.com/api/entrant/{entrant}',
        headers={'Accept': 'application/json'},
        timeout=10,
    )
    return resp.json(), resp.status_code


@app.route('/health')
def health():
    return jsonify(status='ok')


@app.route('/')
def index():
    return send_from_directory(STATIC_DIR, 'index.html')


@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory(STATIC_DIR, filename)


if __name__ == '__main__':
    print(f'Starting on http://0.0.0.0:{PORT}')
    app.run(host='0.0.0.0', port=PORT, threaded=True)
