/*
Purpose: Define Dexie (IndexedDB) schema and CRUD helpers.
Notes:
- "Deck" groups notes/cards.
- "Note" holds fields (front/back). We auto-create a single card per note.
- "Card" stores scheduling data (due date, ease, interval, etc).
*/

const db = new Dexie('pwa_cards_db');
db.version(1).stores({
  decks: '++id, name, createdAt',
  notes: '++id, deckId, createdAt, updatedAt',
  cards: '++id, deckId, noteId, due, interval, ease, reps, lapses, state'
});
// state: 'new' | 'review' | 'suspended'

/** Utility: now as Date and ms */
function now() { return new Date(); }

/** DECKS */
async function createDeck(name) {
  const id = await db.decks.add({ name, createdAt: now() });
  return id;
}
async function getDecks() { return db.decks.toArray(); }
async function renameDeck(id, name) { return db.decks.update(id, { name }); }
async function deleteDeck(id) {
  // delete child notes/cards
  await db.transaction('rw', db.notes, db.cards, db.decks, async () => {
    await db.cards.where('deckId').equals(id).delete();
    await db.notes.where('deckId').equals(id).delete();
    await db.decks.delete(id);
  });
}

/** NOTES + CARDS */
async function createNote(deckId, fields = { front: '', back: '' }) {
  const createdAt = now();
  const noteId = await db.notes.add({ deckId, fields, createdAt, updatedAt: createdAt });
  // Auto-create one card per note
  const card = {
    deckId,
    noteId,
    due: createdAt,     // new cards are due now (simple)
    interval: 0,        // days
    ease: 2.5,          // SM-2 default ease
    reps: 0,
    lapses: 0,
    state: 'new'
  };
  const cardId = await db.cards.add(card);
  return { noteId, cardId };
}

async function updateNote(noteId, fields) {
  return db.transaction('rw', db.notes, db.cards, async () => {
    await db.notes.update(noteId, { fields, updatedAt: now() });
    // Keep card fronts/backs in sync conceptually; we store full text in note only.
    // Cards reference the noteId; rendering pulls from note.fields.
  });
}

async function deleteNote(noteId) {
  return db.transaction('rw', db.notes, db.cards, async () => {
    await db.cards.where('noteId').equals(noteId).delete();
    await db.notes.delete(noteId);
  });
}

async function getNotesByDeck(deckId) {
  return db.notes.where('deckId').equals(deckId).reverse().toArray();
}

/** CARDS (queries and updates) */
async function getDueCards(deckId, limit = 50) {
  const nowMs = Date.now();
  return db.cards
    .where('deckId').equals(deckId)
    .and(c => new Date(c.due).getTime() <= nowMs && c.state !== 'suspended')
    .limit(limit)
    .toArray();
}

async function getRandomDueCard(deckId) {
  const due = await getDueCards(deckId, 100);
  if (due.length === 0) return null;
  return due[Math.floor(Math.random() * due.length)];
}

async function updateCard(cardId, patch) {
  return db.cards.update(cardId, patch);
}

/** Export / Import */
async function exportJSON() {
  // small, simple export (not streaming)
  const decks = await db.decks.toArray();
  const notes = await db.notes.toArray();
  const cards = await db.cards.toArray();
  return { meta: { app: 'pwa-cards', version: 1, exportedAt: new Date().toISOString() }, decks, notes, cards };
}

async function importJSON(obj) {
  if (!obj || !obj.decks || !obj.notes || !obj.cards) throw new Error('Invalid JSON format');
  // To avoid id collisions, we ignore incoming ids and insert fresh ones; we map old->new.
  const deckIdMap = new Map();
  const noteIdMap = new Map();
  await db.transaction('rw', db.decks, db.notes, db.cards, async () => {
    for (const d of obj.decks) {
      const newId = await db.decks.add({ name: d.name, createdAt: d.createdAt ? new Date(d.createdAt) : now() });
      deckIdMap.set(d.id, newId);
    }
    for (const n of obj.notes) {
      const newId = await db.notes.add({
        deckId: deckIdMap.get(n.deckId),
        fields: n.fields,
        createdAt: n.createdAt ? new Date(n.createdAt) : now(),
        updatedAt: n.updatedAt ? new Date(n.updatedAt) : now()
      });
      noteIdMap.set(n.id, newId);
    }
    for (const c of obj.cards) {
      await db.cards.add({
        deckId: deckIdMap.get(c.deckId),
        noteId: noteIdMap.get(c.noteId),
        due: c.due ? new Date(c.due) : now(),
        interval: c.interval ?? 0,
        ease: c.ease ?? 2.5,
        reps: c.reps ?? 0,
        lapses: c.lapses ?? 0,
        state: c.state ?? 'new'
      });
    }
  });
}

/** CSV: very simple schema: deckName,front,back */
function objectsToCSV(rows) {
  const header = ['deckName','front','back'];
  const escape = v => `"${String(v ?? '').replaceAll('"','""')}"`;
  const lines = [header.join(',')];
  for (const r of rows) lines.push([r.deckName, r.front, r.back].map(escape).join(','));
  return lines.join('\n');
}

async function exportCSV() {
  const decks = await db.decks.toArray();
  const deckById = new Map(decks.map(d => [d.id, d]));
  const notes = await db.notes.toArray();
  const rows = notes.map(n => ({
    deckName: deckById.get(n.deckId)?.name ?? 'Unknown',
    front: n.fields?.front ?? '',
    back: n.fields?.back ?? ''
  }));
  return objectsToCSV(rows);
}

async function importCSV(text) {
  // extremely small CSV parser for 3 columns
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.shift();
  if (!header || !/^deckName,?front,?back/i.test(header.replaceAll('"','').toLowerCase())) {
    throw new Error('CSV header must be: deckName,front,back');
  }
  const parseCell = (s) => {
    s = s.trim();
    if (s.startsWith('"') && s.endsWith('"')) return s.slice(1,-1).replaceAll('""','"');
    return s;
  };
  const getOrCreateDeckId = async (name) => {
    const existing = await db.decks.where('name').equals(name).first();
    if (existing) return existing.id;
    return createDeck(name);
  };
  for (const line of lines) {
    const parts = [];
    // naive split that respects quoted commas:
    let cur = '', inQ = false;
    for (let i=0;i<line.length;i++){
      const ch = line[i];
      if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur);
    const [deckName, front, back] = parts.map(parseCell);
    const deckId = await getOrCreateDeckId(deckName || 'Imported');
    await createNote(deckId, { front: front || '', back: back || '' });
  }
}

// Expose for app.js and console demos
window.dbApi = {
  createDeck, getDecks, renameDeck, deleteDeck,
  createNote, updateNote, deleteNote, getNotesByDeck,
  getDueCards, getRandomDueCard, updateCard,
  exportJSON, importJSON, exportCSV, importCSV
};