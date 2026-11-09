'use strict';
// Simulates two computers sharing one vault file through a cloud folder.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Vault, merge, notifyKeyFrom, readFeed, readShared } = require('../src/vault');

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

    // Folders: empty folders sync; renames move logins; deleting a folder keeps its logins.
    const A3 = new Vault(cloud, path.join(dir, 'bA3'));
    await A3.unlock('third pw 123');
    const B3 = new Vault(cloud, path.join(dir, 'bB3'));
    await B3.unlock('third pw 123');
    A3.addFolder('  Work   stuff ');
    B3.syncFromDisk();
    assert(B3.folders().includes('Work stuff'), 'empty folder should sync');
    const spot = B3.list().find((e) => e.title === 'Spotify');
    B3.moveToFolder(spot.id, 'Work stuff');
    A3.syncFromDisk();
    assert.strictEqual(A3.list().find((e) => e.id === spot.id).folder, 'Work stuff');
    await tick();
    A3.renameFolder('Work stuff', 'Music');
    B3.syncFromDisk();
    assert.deepStrictEqual(B3.folders().filter((f) => /Work|Music/.test(f)), ['Music']);
    assert.strictEqual(B3.list().find((e) => e.id === spot.id).folder, 'Music');
    await tick();
    B3.deleteFolder('Music');
    A3.syncFromDisk();
    assert(!A3.folders().includes('Music'));
    assert.strictEqual(A3.list().find((e) => e.id === spot.id).folder, '', 'login kept, moved out of the deleted folder');
    await tick();
    A3.addFolder('Music'); // re-creating a deleted folder works
    B3.syncFromDisk();
    assert(B3.folders().includes('Music'));
    A3.lock();
    B3.lock();

    // Old-format vaults (plain list of entries) still open.
    const old = merge({ entries: [{ id: '1', title: 'x', updatedAt: '2026-01-01' }], deleted: {} }, { entries: [], deleted: { 1: '2026-02-01' } });
    assert.strictEqual(old.entries.length, 0);

    // Notifications: the other computer's adds / edits / deletions are reported, your own are not.
    const A4 = new Vault(cloud, path.join(dir, 'backupsA4'));
    const B4 = new Vault(cloud, path.join(dir, 'backupsB4'));
    await A4.unlock('third pw 123');
    await B4.unlock('third pw 123');
    A4.takeRemoteChanges();
    B4.takeRemoteChanges();
    const own = A4.upsert({ title: 'Bank' });
    assert.deepStrictEqual(A4.takeRemoteChanges(), [], 'own edits are not "remote"');
    assert(own.changedOn, 'edits say which kind of computer made them');
    B4.syncFromDisk();
    let got = B4.takeRemoteChanges();
    assert.deepStrictEqual(got.map((c) => [c.kind, c.title]), [['added', 'Bank']]);
    assert.strictEqual(got[0].changedOn, own.changedOn);
    await tick();
    A4.upsert({ ...own, password: 'new' });
    A4.remove(A4.list().find((e) => e.title === 'Spotify').id);
    B4.syncFromDisk();
    got = B4.takeRemoteChanges().map((c) => `${c.kind}:${c.title}`).sort();
    assert.deepStrictEqual(got, ['deleted:Spotify', 'updated:Bank']);
    assert.deepStrictEqual(B4.takeRemoteChanges(), [], 'reported once');
    // While locked: the file hash still shows that something changed.
    B4.lock();
    const seen = B4.seenHash;
    assert(seen && seen === B4.fileHash());
    A4.upsert({ title: 'While locked' });
    assert.notStrictEqual(B4.fileHash(), seen);
    // ...and the change list (readable with the notify key, not the vault key) names it.
    const nkey = notifyKeyFrom(A4.keyInfo().key);
    const feed = readFeed(cloud, nkey);
    assert(Array.isArray(feed) && feed.length > 0);
    const last = feed[feed.length - 1];
    assert.strictEqual(last.title, 'While locked');
    assert.strictEqual(last.kind, 'added');
    assert(feed.some((f) => f.kind === 'deleted' && f.title === 'Spotify'));
    assert.strictEqual(readFeed(cloud, Buffer.alloc(32)), null, 'wrong key reads nothing');
    assert(!fs.readFileSync(cloud, 'utf8').includes('While locked'), 'change list is encrypted');

    // Shared settings: saved by one computer, readable by another (even locked), kept by later saves.
    A4.setShared({ notify: { added: false, updated: true, deleted: true, updates: false } });
    assert.strictEqual(readShared(cloud, nkey).notify.added, false);
    await B4.unlock('third pw 123');
    assert.strictEqual(B4.shared.notify.updates, false);
    B4.upsert({ title: 'Keeps settings' });
    assert.strictEqual(readShared(cloud, nkey).notify.added, false, 'a normal save keeps the shared settings');
    await tick();
    B4.setShared({ notify: { added: true, updated: true, deleted: true, updates: true } });
    A4.syncFromDisk();
    assert.strictEqual(A4.shared.notify.added, true, 'newest shared settings win');
    B4.lock();
    A4.lock();

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
