import assert from 'node:assert/strict'
import { createCipheriv, createHash } from 'node:crypto'
import test from 'node:test'

const importerPath = './browser-profile-importer.ts'
const loadImporter = () => import(importerPath) as Promise<typeof import('./browser-profile-importer')>

const key = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
const host = '.example.com'

test('decryptChromiumCookie validates and removes the v24 host digest', async () => {
  const { decryptChromiumCookie } = await loadImporter()
  const value = 'signed-in'
  const payload = Buffer.concat([createHash('sha256').update(host).digest(), Buffer.from(value)])

  assert.equal(decryptChromiumCookie(encrypt(payload), key, host, 24), value)
  assert.throws(() => decryptChromiumCookie(encrypt(payload), key, '.other.example', 24))
})

test('decryptChromiumCookie keeps legacy payloads unchanged before v24', async () => {
  const { decryptChromiumCookie } = await loadImporter()
  assert.equal(decryptChromiumCookie(encrypt(Buffer.from('legacy-value')), key, host, 23), 'legacy-value')
})

function encrypt(value: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
  return Buffer.concat([Buffer.from('v10'), cipher.update(value), cipher.final()])
}
