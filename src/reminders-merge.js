'use strict';
// Merging reminders made on different computers.
//
// A reminders "state" is { list, gone, history, hgone }:
//   list     upcoming reminders, by id
//   gone     when each upcoming reminder was cancelled or used up, by id (so a deletion isn't undone by a computer
//            that still has the old copy)
//   history  reminders already sent (one entry per time one was sent), by id
//   hgone    when each sent entry was removed, by id
// Every record carries `updatedAt`; the newest copy of a record wins, and a record deleted after its last change
// stays deleted. Merging is the same whichever computer does it, in whichever order, so two computers always end up
// with the same reminders.

const KEEP_MS = 60 * 864e5; // deletions are remembered for 60 days

const when = (r) => (r && (r.updatedAt || r.createdAt || r.shownAt || r.at)) || '';
const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

function clean(s) {
  const o = s && typeof s === 'object' ? s : {};
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return { list: obj(o.list), gone: obj(o.gone), history: obj(o.history), hgone: obj(o.hgone) };
}

function newestRecords(a, b) {
  const out = { ...a };
  for (const [id, r] of Object.entries(b)) if (!out[id] || when(r) > when(out[id])) out[id] = r;
  return out;
}

function newestTimes(a, b) {
  const out = { ...a };
  for (const [id, t] of Object.entries(b)) if (!out[id] || t > out[id]) out[id] = t;
  return out;
}

function mergeReminders(a, b) {
  a = clean(a);
  b = clean(b);
  const list = newestRecords(a.list, b.list);
  const gone = newestTimes(a.gone, b.gone);
  const history = newestRecords(a.history, b.history);
  const hgone = newestTimes(a.hgone, b.hgone);
  for (const id of Object.keys(list)) if (gone[id] && gone[id] >= when(list[id])) delete list[id];
  for (const id of Object.keys(history)) if (hgone[id] && hgone[id] >= when(history[id])) delete history[id];
  const cutoff = new Date(Date.now() - KEEP_MS).toISOString();
  for (const m of [gone, hgone]) for (const id of Object.keys(m)) if (m[id] < cutoff) delete m[id];
  for (const id of Object.keys(history)) if (when(history[id]) < cutoff) delete history[id];
  return { list: sortKeys(list), gone: sortKeys(gone), history: sortKeys(history), hgone: sortKeys(hgone) };
}

module.exports = { mergeReminders, clean, when };
