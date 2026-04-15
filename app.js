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
    const topScores = data?.data?.topScores || [];
    const cleared = new Set();
    const unlocked = new Set();
    const played = new Set();
    for (const chart of topScores) {
        played.add(chart.hash);
    }
    
    for (const chart of charts) {
        if (chart.title && chart.unlockId !== -1) {
            if (played.has(chart.hash)) {
                cleared.add(chart.title.toLowerCase());
            } else {
                unlocked.add(chart.title.toLowerCase());
            }
        }
    }
    const entrantName = data?.data?.entrant?.name || num;
    return { cleared, unlocked, entrantName };
}

// --- Highlighting ---
function highlightCells(clearedSet, unlockedSet, entrantName) {
    unlockedSet = unlockedSet || new Set();

    // First pass: mark unlock cells — always green if matched
    document.querySelectorAll('.song-cell.unlock-col').forEach(cell => {
        const name = cell.dataset.song;
        if (!name) return;
        const lower = name.toLowerCase();
        cell.classList.remove('cleared', 'unlocked', 'not-cleared');
        if (clearedSet.has(lower) || unlockedSet.has(lower)) {
            cell.classList.add('cleared');
        } else {
            cell.classList.add('not-cleared');
        }
    });

    // Second pass: highlight requirement cells — green if cleared, purple if only unlocked
    let matched = 0, total = 0;
    document.querySelectorAll('tbody[data-group]').forEach(tbody => {
        const unlockCells = tbody.querySelectorAll('.unlock-col.song-cell');
        const hasAnyUnlock = [...unlockCells].some(c => c.classList.contains('cleared'));

        tbody.querySelectorAll('.req-col.song-cell').forEach(cell => {
            const name = cell.dataset.song;
            if (!name) return;
            const lower = name.toLowerCase();
            total++;
            cell.classList.remove('cleared', 'unlocked', 'not-cleared');
            if (hasAnyUnlock) {
                if (clearedSet.has(lower)) {
                    cell.classList.add('cleared');
                } else if (unlockedSet.has(lower)) {
                    cell.classList.add('unlocked');
                } else {
                    cell.classList.add('cleared');
                }
                matched++;
            } else {
                cell.classList.add('not-cleared');
            }
        });

        // Count unlock cells too
        unlockCells.forEach(cell => { if (cell.dataset.song) total++; });
        matched += [...unlockCells].filter(c => c.classList.contains('cleared')).length;
    });

    updateGroupCompletion();
    setStatus(`Matched for user ${entrantName || 'unknown'}: ${matched} / ${total} songs. green = unlocked`, 'success');
}

function updateGroupCompletion() {
    document.querySelectorAll('tbody[data-group]').forEach(tbody => {
        const reqCells = tbody.querySelectorAll('.req-col.song-cell');
        if (reqCells.length === 0) return;
        const allCleared = [...reqCells].some(c => c.classList.contains('cleared') || c.classList.contains('unlocked'));
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
        const { cleared, unlocked, entrantName } = await fetchEntrantData(num);
        highlightCells(cleared, unlocked, entrantName);
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
 
