#!/usr/bin/env python3
"""ITL2026 Unlock Tracker — Flask server with Playwright scraping.

Usage:
    python server.py              # local dev
    docker build -t itl2026 .     # build container
    docker run -p 8000:8000 itl2026
"""
import os
import queue
import time
from threading import Thread

from flask import Flask, jsonify, send_from_directory
from playwright.sync_api import sync_playwright

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
CACHE_TTL = 300  # seconds (5 minutes)
PORT = int(os.environ.get('PORT', 8000))

# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------
cache: dict[str, tuple[float, str]] = {}


def cache_get(entrant: str) -> str | None:
    entry = cache.get(entrant)
    if entry and (time.time() - entry[0]) < CACHE_TTL:
        return entry[1]
    return None


def cache_set(entrant: str, text: str):
    cache[entrant] = (time.time(), text)


# ---------------------------------------------------------------------------
# Playwright worker thread
# ---------------------------------------------------------------------------
# Playwright's sync API is bound to the thread that created it.
# Flask serves requests on different threads, so we run all Playwright
# operations on a single dedicated worker thread and communicate via queues.

work_queue: queue.Queue = queue.Queue()


def _do_scrape(browser, entrant_number: str) -> str:
    """Scrape cleared songs. Runs on the Playwright worker thread."""
    all_text: list[str] = []
    prev_first: str | None = None
    page_num = 1
    max_pages = 50

    ctx = browser.new_context()
    page = ctx.new_page()

    try:
        while page_num <= max_pages:
            url = (
                f'https://itl2026.groovestats.com/entrant/{entrant_number}'
                f'?page={page_num}&clearType=1'
            )
            print(f'  [scrape] page {page_num}: {url}', flush=True)
            page.goto(url)

            # Wait for table data to render
            try:
                page.wait_for_selector('table tr td', timeout=15000)
            except Exception:
                title = page.title()
                body_text = page.inner_text('body')[:500]
                print(f'  [scrape] page {page_num}: no table data after 15s.', flush=True)
                print(f'  [debug] title: {title!r}', flush=True)
                print(f'  [debug] body (first 500): {body_text!r}', flush=True)
                break

            page.wait_for_timeout(1000)

            page_texts: list[str] = []
            cells = page.query_selector_all('table tr td, table tr th')
            for cell in cells:
                t = (cell.inner_text() or '').strip()
                if t:
                    page_texts.append(t)

            if not page_texts:
                print(f'  [scrape] page {page_num}: table found but no text.', flush=True)
                break

            if prev_first is not None and page_texts[0] == prev_first:
                print(f'  [scrape] page {page_num}: same as previous, stopping.', flush=True)
                break

            all_text.extend(page_texts)
            preview = page_texts[:5]
            print(f'  [scrape] page {page_num}: {len(page_texts)} fragments, first 5: {preview}', flush=True)
            prev_first = page_texts[0]
            page_num += 1
    finally:
        ctx.close()

    return '\n'.join(all_text)


def playwright_worker():
    """Dedicated thread that owns the Playwright browser."""
    pw = sync_playwright().start()
    browser = pw.chromium.launch(headless=True)
    print('[worker] Playwright browser ready', flush=True)

    while True:
        item = work_queue.get()
        if item is None:  # shutdown signal
            break
        entrant, result_q = item
        try:
            text = _do_scrape(browser, entrant)
            result_q.put(('ok', text))
        except Exception as e:
            result_q.put(('error', str(e)))

    browser.close()
    pw.stop()
    print('[worker] Playwright closed', flush=True)


def scrape_entrant(entrant_number: str) -> str:
    """Called from Flask threads. Sends work to the Playwright thread."""
    result_q: queue.Queue = queue.Queue()
    work_queue.put((entrant_number, result_q))
    status, value = result_q.get(timeout=120)
    if status == 'error':
        raise Exception(value)
    return value


# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------
app = Flask(__name__, static_folder='.', static_url_path='')


@app.route('/')
def index():
    return send_from_directory('.', 'index.html')


@app.route('/health')
def health():
    return jsonify(status='ok')


@app.route('/api/cleared/<entrant>')
def cleared(entrant):
    if not entrant.isdigit():
        return jsonify(error='Entrant must be a number'), 400

    cached_text = cache_get(entrant)
    if cached_text is not None:
        print(f'[cache hit] entrant {entrant}', flush=True)
        return jsonify(text=cached_text, cached=True)

    print(f'[cache miss] scraping entrant {entrant}...', flush=True)
    try:
        text = scrape_entrant(entrant)
    except Exception as e:
        print(f'[error] scraping entrant {entrant}: {e}', flush=True)
        return jsonify(error=str(e)), 500

    cache_set(entrant, text)
    print(f'[done] entrant {entrant}: {len(text)} chars', flush=True)
    return jsonify(text=text, cached=False)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    worker = Thread(target=playwright_worker, daemon=True)
    worker.start()
    # Give the browser a moment to launch
    time.sleep(2)
    print(f'Starting server on http://0.0.0.0:{PORT}')
    app.run(host='0.0.0.0', port=PORT, threaded=True)
