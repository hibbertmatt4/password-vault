'use strict';
const assert = require('assert');
const { mergeReminders } = require('../src/reminders-merge');

const t = (m) => new Date(Date.now() - m * 60000).toISOString();
const r = (id, text, updatedAt, extra = {}) => ({ id, text, at: t(-60), updatedAt, ...extra });

// a reminder made on each computer: both end up with both, whichever merges first
{
  const a = { list: { a1: r('a1', 'from A', t(5)) } };
  const b = { list: { b1: r('b1', 'from B', t(4)) } };
  const ab = mergeReminders(a, b);
  const ba = mergeReminders(b, a);
  assert.deepStrictEqual(Object.keys(ab.list), ['a1', 'b1']);
  assert.deepStrictEqual(ab, ba, 'merging is the same in either order');
}

// the newest edit wins
{
  const a = { list: { x: r('x', 'old text', t(10)) } };
  const b = { list: { x: r('x', 'new text', t(2)) } };
  assert.strictEqual(mergeReminders(a, b).list.x.text, 'new text');
  assert.strictEqual(mergeReminders(b, a).list.x.text, 'new text');
}

// cancelled on one computer: stays cancelled on the other (old copy), but an edit made after wins
{
  const kept = { list: { x: r('x', 'still here', t(10)) } };
  const cancelled = { gone: { x: t(5) } };
  assert.deepStrictEqual(Object.keys(mergeReminders(kept, cancelled).list), []);
  const editedAfter = { list: { x: r('x', 'edited later', t(1)) } };
  assert.deepStrictEqual(Object.keys(mergeReminders(editedAfter, cancelled).list), ['x']);
}

// a reminder sent on two computers shows once in "sent"; removing it from the list removes it everywhere
{
  const a = { history: { 'x@1': r('x@1', 'sent', t(3), { shownAt: t(3) }) } };
  const b = { history: { 'x@1': r('x@1', 'sent', t(3), { shownAt: t(3) }) }, hgone: { 'x@1': t(1) } };
  assert.deepStrictEqual(Object.keys(mergeReminders(a, {}).history), ['x@1']);
  assert.deepStrictEqual(Object.keys(mergeReminders(a, b).history), []);
}

// old deletions are forgotten after 60 days
{
  const old = new Date(Date.now() - 61 * 864e5).toISOString();
  assert.deepStrictEqual(mergeReminders({ gone: { x: old } }, {}).gone, {});
}

// junk in, sensible state out
assert.deepStrictEqual(mergeReminders(null, undefined), { list: {}, gone: {}, history: {}, hgone: {} });

console.log('All reminder-merge tests passed.');
