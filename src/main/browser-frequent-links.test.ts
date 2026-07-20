import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BrowserFrequentLinks, normalizeFrequentLinkUrl } from './browser-frequent-links'

test('BrowserFrequentLinks sorts by open plus visit frequency', () => {
  const links = new BrowserFrequentLinks()

  links.recordOpen('https://example.com/a', 'A')
  links.recordVisit('https://example.com/a', 'A')
  links.recordVisit('https://example.com/a', 'A')
  links.recordOpen('https://example.com/b', 'B')
  links.recordVisit('https://example.com/c', 'C')

  const result = links.list()

  assert.deepEqual(
    result.map((item) => ({ url: item.url, score: item.score, openCount: item.openCount, visitCount: item.visitCount })),
    [
      { url: 'https://example.com/a', score: 3, openCount: 1, visitCount: 2 },
      { url: 'https://example.com/b', score: 1, openCount: 1, visitCount: 0 },
      { url: 'https://example.com/c', score: 1, openCount: 0, visitCount: 1 }
    ]
  )
})

test('normalizeFrequentLinkUrl ignores internal pages and removes hash', () => {
  assert.equal(normalizeFrequentLinkUrl('shell-manage://browser/newtab'), null)
  assert.equal(normalizeFrequentLinkUrl('file:///tmp/newtab.html'), null)
  assert.equal(normalizeFrequentLinkUrl('https://example.com/a#section'), 'https://example.com/a')
})

test('BrowserFrequentLinks persists records to json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shell-manage-browser-links-'))
  const file = join(dir, 'frequent-links.json')
  const first = new BrowserFrequentLinks(file)

  first.recordOpen('https://example.com/a', 'A')
  first.recordVisit('https://example.com/a', 'A')

  const second = new BrowserFrequentLinks(file)

  assert.deepEqual(
    second.list().map((item) => ({ url: item.url, score: item.score, openCount: item.openCount, visitCount: item.visitCount })),
    [{ url: 'https://example.com/a', score: 2, openCount: 1, visitCount: 1 }]
  )
})
