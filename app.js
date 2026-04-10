// --- CSV Parser (RFC 4180) ---
function parseCSV(text) {
    const rows = []; let row = []; let field = ''; let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (i + 1 < text.length && text[i + 1] === '"') { field += '"'; i++; }
                else { inQuotes = false; }
            } else { field += c; }
        } else {
            if (c === '"') { inQuotes = true; }
            else if (c === ',') { row.push(field); field = ''; }
            else if (c === '\n' || (c === '\r' && text[i + 1] === '\n')) {
                if (c === '\r') i++;
                row.push(field); field = '';
                rows.push(row); row = [];
            } else { field += c; }
        }
    }
    row.push(field);
    if (row.some(f => f !== '')) rows.push(row);
    return rows;
}

// --- Song name extraction ---
function extractSongName(cellText) {
    if (!cellText || !cellText.trim()) return null;
    const m = cellText.trim().match(/^(?:\[\d+\]\s*)+(.+)$/s);
    return m ? m[1].trim() : null;
}

// --- Group rows into unlock groups ---
function groupRows(rows) {
    const groups = [];
    let current = null;
    for (let i = 1; i < rows.length; i += 2) {
        const songRow = rows[i] || [];
        const prereqRow = rows[i + 1] || [];
        const name = (songRow[1] || '').trim();

        if (name) {
            current = { name, reqRows: [], unlockRows: [] };
            groups.push(current);
        }
        if (!current) continue;

        const reqSongs = [songRow[2] || '', songRow[3] || '', songRow[4] || ''];
        const reqPrereqs = [prereqRow[2] || '', prereqRow[3] || '', prereqRow[4] || ''];
        current.reqRows.push({ songs: reqSongs, prereqs: reqPrereqs });

        const unlSongs = [songRow[6] || '', songRow[7] || '', songRow[8] || ''];
        current.unlockRows.push({ songs: unlSongs });
    }
    return groups;
}

// --- Build table ---
function buildTable(groups) {
    const table = document.getElementById('unlock-table');
    table.innerHTML = '';

    const thead = document.createElement('thead');
    thead.innerHTML = `<tr>
        <th>UNLOCK NAME</th>
        <th colspan="3">REQUIREMENTS</th>
        <th class="divider" colspan="3">UNLOCKS</th>
    </tr>`;
    table.appendChild(thead);

    for (const group of groups) {
        const tbody = document.createElement('tbody');
        tbody.dataset.group = group.name;
        const totalRows = group.reqRows.length * 2;

        for (let r = 0; r < group.reqRows.length; r++) {
            const req = group.reqRows[r];
            const unl = group.unlockRows[r] || { songs: ['', '', ''] };

            // Song row
            const songTr = document.createElement('tr');
            songTr.className = 'song-row';
            if (r === 0) {
                const nameTd = document.createElement('td');
                nameTd.className = 'unlock-name';
                nameTd.rowSpan = totalRows;
                nameTd.textContent = group.name;
                songTr.appendChild(nameTd);
            }
            for (let c = 0; c < 3; c++) {
                const td = document.createElement('td');
                const val = (req.songs[c] || '').trim();
                if (val) {
                    const songName = extractSongName(val);
                    if (songName) {
                        td.className = 'song-cell req-col';
                        td.dataset.song = songName;
                    }
                    td.textContent = val;
                }
                songTr.appendChild(td);
            }
            for (let c = 0; c < 3; c++) {
                const td = document.createElement('td');
                if (c === 0) td.classList.add('divider');
                const val = (unl.songs[c] || '').trim();
                if (val) {
                    const songName = extractSongName(val);
                    if (songName) {
                        td.className = 'song-cell unlock-col' + (c === 0 ? ' divider' : '');
                        td.dataset.song = songName;
                    }
                    td.textContent = val;
                }
                songTr.appendChild(td);
            }
            tbody.appendChild(songTr);

            // Prereq row
            const prereqTr = document.createElement('tr');
            prereqTr.className = 'prereq-row';
            for (let c = 0; c < 3; c++) {
                const td = document.createElement('td');
                td.className = 'prereq';
                td.textContent = (req.prereqs[c] || '').trim();
                prereqTr.appendChild(td);
            }
            for (let c = 0; c < 3; c++) {
                const td = document.createElement('td');
                if (c === 0) td.classList.add('divider');
                prereqTr.appendChild(td);
            }
            tbody.appendChild(prereqTr);
        }
        table.appendChild(tbody);
    }
}

// --- Fetch entrant data via proxy ---
async function fetchEntrantData(num) {
    const resp = await fetch(`/gs/${num}`);
    if (resp.status === 404) throw new Error('Entrant not found');
    if (!resp.ok) throw new Error('API error: ' + resp.status);
    const data = await resp.json();
    // Build a set of lowercase song titles that are unlocked (unlockId !== -1)
    const charts = data?.data?.charts || [];
    const cleared = new Set();
    for (const chart of charts) {
        if (chart.title && chart.unlockId !== -1) {
            cleared.add(chart.title.toLowerCase());
        }
    }
    return cleared;
}

// --- Highlighting ---
function highlightCells(clearedSet) {
    // First pass: mark unlock cells that match
    document.querySelectorAll('.song-cell.unlock-col').forEach(cell => {
        const name = cell.dataset.song;
        if (!name) return;
        cell.classList.remove('cleared', 'not-cleared');
        if (clearedSet.has(name.toLowerCase())) { cell.classList.add('cleared'); }
        else { cell.classList.add('not-cleared'); }
    });

    // Second pass: highlight requirement cells only if any unlock in the same group is cleared
    let cleared = 0, total = 0;
    document.querySelectorAll('tbody[data-group]').forEach(tbody => {
        const unlockCells = tbody.querySelectorAll('.unlock-col.song-cell');
        const hasAnyUnlock = [...unlockCells].some(c => c.classList.contains('cleared'));

        tbody.querySelectorAll('.req-col.song-cell').forEach(cell => {
            const name = cell.dataset.song;
            if (!name) return;
            total++;
            cell.classList.remove('cleared', 'not-cleared');
            if (hasAnyUnlock) { cell.classList.add('cleared'); cleared++; }
            else { cell.classList.add('not-cleared'); }
        });

        // Count unlock cells too
        unlockCells.forEach(cell => { if (cell.dataset.song) total++; });
        cleared += [...unlockCells].filter(c => c.classList.contains('cleared')).length;
    });

    updateGroupCompletion();
    setStatus(`Matched ${cleared} / ${total} songs. green = unlocked (cannot track played :/)`, 'success');
}

function updateGroupCompletion() {
    document.querySelectorAll('tbody[data-group]').forEach(tbody => {
        const reqCells = tbody.querySelectorAll('.req-col.song-cell');
        if (reqCells.length === 0) return;
        const allCleared = [...reqCells].every(c => c.classList.contains('cleared'));
        const nameCell = tbody.querySelector('.unlock-name');
        if (nameCell) nameCell.classList.toggle('complete', allCleared);
    });
}

function setStatus(msg, cls) {
    const el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls || '';
}

// --- Main flow ---
async function loadEntrant() {
    const input = document.getElementById('entrant-input');
    const num = input.value.trim();
    if (!num) return;

    const btn = document.getElementById('load-btn');
    btn.disabled = true;
    document.getElementById('manual-fallback').style.display = 'none';
    setStatus('Fetching data from GrooveStats...', '');

    history.replaceState(null, '', `?entrant=${num}`);
    document.getElementById('gs-link').href = `https://itl2026.groovestats.com/entrant/${num}?clearType=1`;

    try {
        const clearedSet = await fetchEntrantData(num);
        highlightCells(clearedSet);
    } catch (e) {
        setStatus('Error: ' + e.message + '. Use manual paste below.', 'error');
        document.getElementById('manual-fallback').style.display = 'block';
    } finally {
        btn.disabled = false;
    }
}

// --- Init ---
const rows = parseCSV(CSV_RAW);
const groups = groupRows(rows);
buildTable(groups);

document.getElementById('entrant-form').addEventListener('submit', e => {
    e.preventDefault();
    loadEntrant();
});

document.getElementById('paste-btn').addEventListener('click', () => {
    const text = document.getElementById('paste-area').value;
    if (!text.trim()) return;
    // Build a set from pasted text — treat each line as a song title
    const lines = text.split('\n').map(l => l.trim().toLowerCase()).filter(Boolean);
    const pastedSet = new Set(lines);
    highlightCells(pastedSet);
    document.getElementById('manual-fallback').style.display = 'none';
});

// Auto-load from URL param
const urlParams = new URLSearchParams(location.search);
const autoEntrant = urlParams.get('entrant');
if (autoEntrant) {
    document.getElementById('entrant-input').value = autoEntrant;
    loadEntrant();
}
 