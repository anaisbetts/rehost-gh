import { expect, test } from 'bun:test'
import { renderIndexPage } from '../src/index-page'
import type { Manifest } from '../src/publish'

const MANIFEST: Manifest = {
  repoName: 'rehost-gh',
  fingerprint: 'ABCDEF',
  publishedAt: '2026-10-24T00:00:00Z',
  arch: ['x86_64'],
  deb: ['amd64'],
  rpm: [],
  squirrel: [{ id: 'MyApp', arch: 'x64' }],
}

test('renders setup snippets for published repos only', () => {
  const html = renderIndexPage('https://pkgs.example', MANIFEST, [])

  expect(html).toContain('Server = https://pkgs.example/arch/$arch')
  expect(html).toContain('https://pkgs.example/deb stable main')
  expect(html).toContain('https://pkgs.example/squirrel/MyApp/x64')
  expect(html).not.toContain('Fedora')
})

test('escapes sync errors', () => {
  const html = renderIndexPage('https://pkgs.example', null, [
    {
      repo: 'a/b',
      packages: 0,
      status: { watch: 'a/b', lastSyncAt: 'now', lastSuccessAt: null, lastError: '<script>alert(1)</script>' },
    },
  ])

  expect(html).toContain('Nothing has been published yet')
  expect(html).toContain('&lt;script&gt;')
  expect(html).not.toContain('<script>')
})
