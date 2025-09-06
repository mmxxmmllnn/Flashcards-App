/*
Purpose: Glue UI <-> db.js <-> scheduler.js. Minimal, readable.
This version matches the original index.html that has three views (Decks, Editor, Study)
and nav buttons with data-nav attributes. It adds a "Delete Note" button to the Study view
that removes the entire note (and its cards) after a confirmation prompt.

What changed from your working version:
- We programmatically add a red "Delete Note" button into the Study view's .buttons row.
- On click, it asks for confirmation and calls dbApi.deleteNote(currentNote.id).
- After deletion, it fetches the next due card (or shows "No due cards" message).
*/

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

/** View switching */
const views = {
  decks: $('#view-decks'),
  editor: $('#view-editor'),
  study: $('#view-study')
};
function showView(name) {
  for (const k in views) views[k].classList.toggle('hidden', k !== name);
  // Small refresh per view
  if (name === 'decks') renderDeckList();
  if (name === 'editor') refreshDeckDropdowns();
  if (name === 'study') {
    refreshDeckDropdowns();
    // Ensure the Delete Note button exists (idempotent)
    ensureStudyDeleteButton();
    // When entering Study, no card is loaded yet → disable delete button
    setDeleteButtonEnabled(false);
  }
}
$$('nav [data-nav]').forEach(btn => btn.addEventListener('click', e => showView(e.target.dataset.nav)));

/** Decks view logic */
const deckListEl = $('#deck-list');
$('#add-deck-btn').addEventListener('click', async () => {
  const name = $('#new-deck-name').value.trim();
  if (!name) return alert('Enter deck name');
  await dbApi.createDeck(name);
  $('#new-deck-name').value = '';
  renderDeckList();
});

async function deckStats(deckId) {
  const due = await dbApi.getDueCards(deckId, 9999);
  const notes = await dbApi.getNotesByDeck(deckId);
  return { due: due.length, notes: notes.length };
}

async function renderDeckList() {
  const decks = await dbApi.getDecks();
  deckListEl.innerHTML = '';
  for (const d of decks) {
    const stats = await deckStats(d.id);
    const li = document.createElement('li');
    li.innerHTML = `
      <div>
        <strong>${d.name}</strong>
        <small>— ${stats.notes} notes, ${stats.due} due</small>
      </div>
      <span>
        <button data-act="study" data-id="${d.id}">Study</button>
        <button data-act="rename" data-id="${d.id}">Rename</button>
        <button data-act="delete" data-id="${d.id}">Delete</button>
      </span>
    `;
    deckListEl.appendChild(li);
  }
  deckListEl.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const act = btn.dataset.act;
      if (act === 'study') {
        $('#study-deck').value = String(id);
        showView('study');
      } else if (act === 'rename') {
        const name = prompt('New name?');
        if (name) { await dbApi.renameDeck(id, name); renderDeckList(); }
      } else if (act === 'delete') {
        if (confirm('Delete deck, notes, and cards?')) { await dbApi.deleteDeck(id); renderDeckList(); }
      }
    });
  });
}

/** Populate deck dropdowns (Editor/Study) */
async function refreshDeckDropdowns() {
  const decks = await dbApi.getDecks();
  for (const sel of [$('#editor-deck'), $('#study-deck')]) {
    sel.innerHTML = '';
    for (const d of decks) {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name;
      sel.appendChild(opt);
    }
  }
  // Also refresh note list when in editor
  if (!views.editor.classList.contains('hidden')) renderNoteList();
}

/** Editor view: create note, list notes */
$('#save-note-btn').addEventListener('click', async () => {
  const deckId = Number($('#editor-deck').value);
  const front = $('#field-front').value.trim();
  const back = $('#field-back').value.trim();
  if (!deckId) return alert('Choose a deck first');
  if (!front && !back) return alert('Enter front/back');
  await dbApi.createNote(deckId, { front, back });
  $('#field-front').value = '';
  $('#field-back').value = '';
  renderNoteList();
});

const noteListEl = $('#note-list');
async function renderNoteList() {
  const deckId = Number($('#editor-deck').value);
  if (!deckId) { noteListEl.innerHTML = '<li>Select a deck</li>'; return; }
  const notes = await dbApi.getNotesByDeck(deckId);
  noteListEl.innerHTML = '';
  for (const n of notes) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div style="flex:1">
        <div><strong>${n.fields.front || '(empty front)'}</strong></div>
        <div><small>${n.fields.back || '(empty back)'}</small></div>
      </div>
      <span>
        <button data-act="edit" data-id="${n.id}">Edit</button>
        <button data-act="del" data-id="${n.id}">Delete</button>
      </span>
    `;
    noteListEl.appendChild(li);
  }
  noteListEl.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const act = btn.dataset.act;
      if (act === 'edit') {
        const note = (await dbApi.getNotesByDeck(Number($('#editor-deck').value))).find(x=>x.id===id);
        const nf = prompt('Edit FRONT:', note.fields.front ?? '');
        if (nf === null) return;
        const nb = prompt('Edit BACK:', note.fields.back ?? '');
        if (nb === null) return;
        await dbApi.updateNote(id, { front: nf, back: nb });
        renderNoteList();
      } else if (act === 'del') {
        if (confirm('Delete note and its card?')) {
          await dbApi.deleteNote(id);
          renderNoteList();
        }
      }
    });
  });
}

/** Study view */
let currentCard = null;
let currentNote = null;

// Ensure there's a Delete Note button in the Study view
function ensureStudyDeleteButton() {
  const container = $('#view-study .buttons');
  if (!container) return;
  if ($('#delete-note-btn')) return; // already added
  const del = document.createElement('button');
  del.id = 'delete-note-btn';
  del.textContent = 'Delete Note';
  del.style.color = 'red';
  del.title = 'Remove this note (and its cards) from the deck';
  // Click handler with confirmation
  del.addEventListener('click', async () => {
    if (!currentNote) return;
    const ok = confirm('Delete this NOTE and all its cards? This cannot be undone.');
    if (!ok) return;
    await dbApi.deleteNote(currentNote.id); // also deletes its cards
    setStatus('Note deleted.');
    currentCard = null;
    currentNote = null;
    setDeleteButtonEnabled(false);
    await getNextCard();
  });
  container.appendChild(del);
}
function setDeleteButtonEnabled(enabled) {
  const btn = $('#delete-note-btn');
  if (btn) btn.disabled = !enabled;
}

$('#start-study-btn').addEventListener('click', async () => {
  await getNextCard();
});

$('#reveal-btn').addEventListener('click', () => {
  $('#card-back').classList.remove('hidden');
  $('#reveal-btn').classList.add('hidden');
  $('#response-buttons').classList.remove('hidden');
});

$('#response-buttons').querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!currentCard) return;
    const grade = btn.dataset.grade; // again | hard | good | easy
    const updated = scheduler.schedule(currentCard, grade, new Date());
    await dbApi.updateCard(currentCard.id, {
      ease: updated.ease,
      interval: updated.interval,
      reps: updated.reps,
      lapses: updated.lapses,
      due: updated.due,
      state: updated.state
    });
    setStatus(`Saved: ${grade.toUpperCase()} → next in ${updated.interval} day(s).`);
    await getNextCard();
  });
});

async function getNextCard() {
  $('#card-front').textContent = '';
  $('#card-back').textContent = '';
  $('#card-back').classList.add('hidden');
  $('#reveal-btn').classList.remove('hidden');
  $('#response-buttons').classList.add('hidden');
  setDeleteButtonEnabled(false);

  const deckId = Number($('#study-deck').value);
  if (!deckId) { setStatus('Choose a deck'); currentCard=null; currentNote=null; return; }
  const card = await dbApi.getRandomDueCard(deckId);
  if (!card) { setStatus('No due cards. Add notes or come back later.'); currentCard=null; currentNote=null; return; }
  currentCard = card;
  // Load note fields to show text
  const note = (await dbApi.getNotesByDeck(deckId)).find(n=>n.id===card.noteId);
  currentNote = note;
  $('#card-front').textContent = note?.fields?.front ?? '';
  $('#card-back').textContent = note?.fields?.back ?? '';
  const dueIn = Math.max(0, Math.round((new Date(card.due).getTime() - Date.now())/86400000));
  setStatus(`Card #${card.id} | due in ${dueIn} day(s) | ease ${card.ease.toFixed(2)} | interval ${card.interval}d`);
  setDeleteButtonEnabled(true); // we have a note to delete now
}

function setStatus(msg) { $('#study-status').textContent = msg; }

/** Import/Export buttons */
$('#export-json-btn').addEventListener('click', async () => {
  const data = await dbApi.exportJSON();
  downloadText(JSON.stringify(data, null, 2), `pwa-cards-export-${Date.now()}.json`, 'application/json');
});

$('#export-csv-btn').addEventListener('click', async () => {
  const csv = await dbApi.exportCSV();
  downloadText(csv, `pwa-cards-export-${Date.now()}.csv`, 'text/csv');
});

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  try {
    if (file.name.endsWith('.json')) {
      await dbApi.importJSON(JSON.parse(text));
    } else if (file.name.endsWith('.csv')) {
      await dbApi.importCSV(text);
    } else {
      alert('Unsupported file type');
      return;
    }
    alert('Import complete.');
    renderDeckList();
    refreshDeckDropdowns();
  } catch (err) {
    alert('Import failed: ' + err.message);
  } finally {
    e.target.value = '';
  }
});

function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// Initial render
showView('decks');
