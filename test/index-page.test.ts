import { expect, test } from 'bun:test'
import { renderIndexPage } from '../src/index-page'
import type { Manifest } from '../src/publish'
import type { StoredAsset } from '../src/state'

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
  const html = renderIndexPage('https://pkgs.example', MANIFEST, [], [])

  expect(html).toContain('Server = https://pkgs.example/arch/$arch')
  expect(html).toContain('https://pkgs.example/deb stable main')
  expect(html).toContain('https://pkgs.example/squirrel/MyApp/x64')
  expect(html).not.toContain('Fedora')
  expect(html).not.toContain('<h2>Packages</h2>')
})

test('lists the newest version of each package with its install command', () => {
  const html = renderIndexPage(
    'https://pkgs.example',
    MANIFEST,
    [],
    [
      asset({ assetId: 4, format: 'deb', name: 'tool', version: '2.0', arch: 'arm64', tag: 'v2.0' }),
      asset({ assetId: 3, format: 'deb', name: 'tool', version: '2.0', arch: 'amd64', tag: 'v2.0' }),
      asset({ assetId: 2, format: 'deb', name: 'tool', version: '1.0', arch: 'amd64', tag: 'v1.0' }),
      asset({ assetId: 1, format: 'squirrel', name: 'MyApp', version: '2.0', arch: 'x64', delta: true }),
    ]
  )

  expect(html).toContain('<code>sudo apt install tool</code>')
  expect(html).toContain('<code>amd64</code>, <code>arm64</code>')
  expect(html).toContain('+1 older')
  expect(html).toContain('https://github.com/a/b/releases/tag/v2.0')
  expect(html).not.toContain('v1.0')
  expect(html).not.toContain('href="#squirrel"')
})

test('escapes sync errors', () => {
  const html = renderIndexPage(
    'https://pkgs.example',
    null,
    [
      {
        repo: 'a/b',
        packages: 0,
        status: { watch: 'a/b', lastSyncAt: 'now', lastSuccessAt: null, lastError: '<script>alert(1)</script>' },
      },
    ],
    []
  )

  expect(html).toContain('Nothing has been published yet')
  expect(html).toContain('&lt;script&gt;')
  expect(html).not.toContain('<script>')
})

function asset(overrides: Partial<StoredAsset>): StoredAsset {
  return {
    assetId: 1,
    watch: 'a/b',
    tag: 'v1.0',
    publishedAt: '2026-10-24T00:00:00Z',
    fileName: 'pkg',
    path: 'pkg',
    size: 1,
    sha1: '',
    sha256: '',
    format: 'deb',
    name: 'pkg',
    version: '1.0',
    arch: 'amd64',
    delta: false,
    ...overrides,
  }
}
