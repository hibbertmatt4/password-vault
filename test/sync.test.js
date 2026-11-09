'use strict';
// Simulates two computers sharing one vault file through a cloud folder.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Vault, merge } = require('../src/vault');

const PW = 'correct horse battery';
const titles = (v) => v.list().map((e) => e.title).sort();
const tick = () => new Promise((r) => setTimeout(r, 5)); // make timestamps differ

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-sync-'));
  const cloud = path.join(dir, 'cloud', 'Password Vault', 'vault.json');
  try {
    // Computer A creates the vault in the cloud folder; computer B opens the same file.
    const A = new Vault(cloud, path.join(dir, 'backupsA'));
    await A.create(PW);
    A.upsert({ title: 'Gmail', password: 'g1' });
    const B = new Vault(cloud, path.join(dir, 'backupsB'));
    assert.strictEqual(await B.unlock(PW), true);
    assert.deepStrictEqual(titles(B), ['Gmail']);

    // Both add a login without seeing each other's change: neither is lost.
    A.upsert({ title: 'Amazon' });
    B.upsert({ title: 'Netflix' });
    assert.deepStrictEqual(titles(B), ['Amazon', 'Gmail', 'Netflix']);
    assert.strictEqual(A.syncFromDisk().changed, true);
    assert.deepStrictEqual(titles(A), ['Amazon', 'Gmail', 'Netflix']);

    // Newest edit of the same login wins.
    const gmail = A.list().find((e) => e.title === 'Gmail');
    A.upsert({ ...gmail, password: 'from-A' });
    await tick();
    B.syncFromDisk();
    B.upsert({ ...B.list().find((e) => e.id === gmail.id), password: 'from-B' });
    A.syncFromDisk();
    assert.strictEqual(A.list().find((e) => e.id === gmail.id).password, 'from-B');

    // A deletion on one computer reaches the other and isn't brought back by a stale copy.
    const netflix = A.list().find((e) => e.title === 'Netflix');
    await tick();
    A.remove(netflix.id);
    B.syncFromDisk();
    assert(!titles(B).includes('Netflix'), 'deletion should sync');
    B.upsert({ title: 'Spotify' });
    A.syncFromDisk();
    assert(!titles(A).includes('Netflix') && titles(A).includes('Spotify'));

    // No changes on disk -> nothing reported.
    assert.strictEqual(A.syncFromDisk().changed, false);

    // Cloud "conflicted copy" files get merged in and moved out of the synced folder.
    const copy = JSON.parse(fs.readFileSync(cloud, 'utf8'));
    const C = new Vault(path.join(dir, 'tmpC.json'), path.join(dir, 'backupsC'));
    fs.writeFileSync(C.filePath, JSON.stringify(copy));
    await C.unlock(PW);
    C.upsert({ title: 'Only-in-conflict-copy' });
    fs.copyFileSync(C.filePath, path.join(path.dirname(cloud), "vault (Matt's conflicted copy).json"));
    assert.strictEqual(A.mergeConflictCopies(), true);
    assert(titles(A).includes('Only-in-conflict-copy'));
    assert.deepStrictEqual(fs.readdirSync(path.dirname(cloud)).sort(), ['vault.json']);
    B.syncFromDisk();
    assert(titles(B).includes('Only-in-conflict-copy'));

    // Master password changed on A: B is locked and must use the new password.
    assert.strictEqual(await A.changeMasterPassword(PW, 'new master pw'), true);
    assert.deepStrictEqual(B.syncFromDisk(), { needsUnlock: true });
    assert.strictEqual(B.isUnlocked(), false);
    assert.strictEqual(await B.unlock(PW), false);
    assert.strictEqual(await B.unlock('new master pw'), true);
    assert(titles(B).includes('Spotify'));

    // Saving on B after A changed the password (before B noticed) refuses instead of overwriting.
    const B2 = new Vault(cloud, path.join(dir, 'backupsB2'));
    await B2.unlock('new master pw');
    await A.changeMasterPassword('new master pw', 'third pw 123');
    assert.throws(() => B2.upsert({ title: 'Lost?' }), (e) => e.code === 'PASSWORD_CHANGED_ELSEWHERE');
    const A2 = new Vault(cloud, path.join(dir, 'backupsA2'));
    assert.strictEqual(await A2.unlock('third pw 123'), true);

    // Old-format vaults (plain list of entries) still open.
    const old = merge({ entries: [{ id: '1', title: 'x', updatedAt: '2026-01-01' }], deleted: {} }, { entries: [], deleted: { 1: '2026-02-01' } });
    assert.strictEqual(old.entries.length, 0);

    // Nothing readable in the cloud file.
    const raw = fs.readFileSync(cloud, 'utf8');
    assert(!raw.includes('Gmail') && !raw.includes('Spotify'));

    console.log('All sync tests passed.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
