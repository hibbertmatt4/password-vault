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
