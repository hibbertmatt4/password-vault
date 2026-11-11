'use strict';
// Plain Node tests for the encrypted vault (no Electron needed): `npm test`
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Vault, generatePassword } = require('../src/vault');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-test-'));
  const file = path.join(dir, 'vault.json');
  try {
    const v = new Vault(file);
    assert.strictEqual(v.exists(), false);
    await v.create('correct horse battery');
    const saved = v.upsert({ title: 'Gmail', username: 'me@example.com', password: 'S3cret!pw', url: 'gmail.com' });
    v.upsert({ id: saved.id, title: 'Gmail', username: 'me@example.com', password: 'Changed!pw' });
    v.lock();

    // File on disk must not contain plaintext.
    const raw = fs.readFileSync(file, 'utf8');
    assert(!raw.includes('Gmail') && !raw.includes('Changed!pw') && !raw.includes('me@example.com'), 'plaintext leaked');

    const v2 = new Vault(file);
    assert.strictEqual(await v2.unlock('wrong password'), false);
    assert.strictEqual(v2.isUnlocked(), false);
    assert.strictEqual(await v2.unlock('correct horse battery'), true);
    assert.strictEqual(v2.list().length, 1);
    assert.strictEqual(v2.list()[0].password, 'Changed!pw');

    // Tampering is detected.
    const tampered = JSON.parse(raw);
    const bytes = Buffer.from(tampered.vault.data, 'base64');
    bytes[0] ^= 1;
    tampered.vault.data = bytes.toString('base64');
    fs.writeFileSync(path.join(dir, 't.json'), JSON.stringify(tampered));
    assert.strictEqual(await new Vault(path.join(dir, 't.json')).unlock('correct horse battery'), false);

    // Change master password.
    assert.strictEqual(await v2.changeMasterPassword('nope', 'new master pw'), false);
    assert.strictEqual(await v2.changeMasterPassword('correct horse battery', 'new master pw'), true);
    v2.remove(v2.list()[0].id);
    v2.lock();
    const v3 = new Vault(file);
    assert.strictEqual(await v3.unlock('correct horse battery'), false);
    assert.strictEqual(await v3.unlock('new master pw'), true);
    assert.strictEqual(v3.list().length, 0);

    // Locked vault refuses access.
    v3.lock();
    assert.throws(() => v3.list(), /locked/);

    // Folders and icons are stored; unsafe icon values are rejected.
    const v4 = new Vault(path.join(dir, 'icons.json'));
    await v4.create('correct horse battery');
    const a = v4.upsert({ title: 'A', folder: '  Google accounts  ', icon: { type: 'brand', id: 'google' } });
    assert.strictEqual(a.folder, 'Google accounts');
    assert.deepStrictEqual(a.icon, { type: 'brand', id: 'google' });
    assert.deepStrictEqual(v4.upsert({ title: 'B', icon: { type: 'emoji', value: '🏦' } }).icon, { type: 'emoji', value: '🏦' });
    assert.deepStrictEqual(v4.upsert({ title: 'C', icon: { type: 'letter' } }).icon, { type: 'letter' });
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    assert.deepStrictEqual(v4.upsert({ title: 'D', icon: { type: 'image', data: png } }).icon, { type: 'image', data: png });
    assert.strictEqual(v4.upsert({ title: 'E', icon: { type: 'image', data: 'javascript:alert(1)' } }).icon, null);
    assert.strictEqual(v4.upsert({ title: 'F', icon: { type: 'brand', id: '"><script>' } }).icon, null);
    assert.strictEqual(v4.upsert({ title: 'G', icon: { type: 'image', data: 'data:image/png;base64,' + 'A'.repeat(300000) } }).icon, null);
    // Subsites: kept with their descriptions; empty rows dropped; left alone when an edit doesn't mention them.
    const s1 = v4.upsert({ title: 'Bank', url: 'bank.com', subsites: [{ url: ' bank.com/billing ', description: ' Billing ' }, { url: '   ', description: 'nothing' }, { url: 'bank.com/admin' }] });
    assert.strictEqual(s1.subsites.length, 2);
    assert.strictEqual(s1.subsites[0].url, 'bank.com/billing');
    assert.strictEqual(s1.subsites[0].description, 'Billing');
    assert.strictEqual(s1.subsites[1].description, '');
    assert(s1.subsites[0].id && s1.subsites[0].id !== s1.subsites[1].id);
    assert.strictEqual(v4.upsert({ id: s1.id, title: 'Bank renamed' }).subsites.length, 2);
    assert.strictEqual(v4.upsert({ id: s1.id, title: 'Bank renamed', subsites: [] }).subsites.length, 0);
    assert.strictEqual(v4.upsert({ title: 'Many', subsites: Array.from({ length: 50 }, (_, i) => ({ url: 'x.com/' + i })) }).subsites.length, 30);
    v4.lock();

    // Generator.
    const pw = generatePassword({ length: 32 });
    assert.strictEqual(pw.length, 32);
    assert(/[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^a-zA-Z0-9]/.test(pw));
    assert(/^[0-9]+$/.test(generatePassword({ length: 10, upper: false, lower: false, symbols: false })));

    console.log('All vault tests passed.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
