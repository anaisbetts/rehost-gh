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
  squirrel: [{ id: 'MyApp', arch: 'x64', setup: true }],
  android: [{ id: 'dev.anais.red', versionName: '1.12.34', versionCode: 3106, arch: 'arm64-v8a' }],
}

test('renders setup snippets for published repos only', () => {
  const html = renderIndexPage('https://pkgs.example', MANIFEST, [], [])

  expect(html).toContain('Server = https://pkgs.example/arch/$arch')
  expect(html).toContain('https://pkgs.example/deb stable main')
  expect(html).toContain('https://pkgs.example/squirrel/MyApp/x64')
  expect(html).toContain('https://pkgs.example/squirrel/MyApp/x64/Setup.exe')
  expect(html).toContain('https://pkgs.example/android/dev.anais.red/android-update.json')
  expect(html).toContain('https://pkgs.example/android/dev.anais.red/releases/dev.anais.red-1.12.34+3106-arm64-v8a.apk')
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

test('links Android packages to the hosted APK', () => {
  const html = renderIndexPage(
    'https://pkgs.example',
    MANIFEST,
    [],
    [
      asset({
        format: 'android',
        name: 'dev.anais.red',
        version: '1.12.34+3106',
        arch: 'arm64-v8a',
        tag: 'v1.12.34',
      }),
    ]
  )

  expect(html).toContain('<td>Android</td>')
  expect(html).toContain(
    'href="https://pkgs.example/android/dev.anais.red/releases/dev.anais.red-1.12.34+3106-arm64-v8a.apk">APK</a>'
  )
})

test('lists EXE installers separately from the Squirrel feed', () => {
  const html = renderIndexPage(
    'https://pkgs.example',
    MANIFEST,
    [],
    [
      asset({
        assetId: 3,
        format: 'squirrel',
        name: 'MyApp',
        version: '2.0',
        arch: 'x64',
        fileName: 'MyApp-2.0-Setup.exe',
        tag: 'v2.0',
      }),
      asset({
        assetId: 2,
        format: 'squirrel',
        name: 'MyApp',
        version: '2.0',
        arch: 'x64',
        fileName: 'MyApp-2.0-full.nupkg',
        tag: 'v2.0',
      }),
      asset({
        assetId: 1,
        format: 'squirrel',
        name: 'MyApp',
        version: '1.0',
        arch: 'x64',
        fileName: 'Setup.exe',
        tag: 'v1.0',
      }),
    ]
  )

  expect(html).toContain('<td>EXE</td>')
  expect(html).toContain('<td>Squirrel</td>')
  expect(html).toContain('href="https://pkgs.example/squirrel/MyApp/x64/Setup.exe">Setup.exe</a>')
  expect(html).toContain('href="#squirrel">feed URL</a>')
  expect(html).toContain('+1 older')
  expect(html).not.toContain('v1.0')
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
  expect(html).not.toContain('<script>alert(1)</script>')
})

test('offers a refresh button that re-polls every watched repo', () => {
  const html = renderIndexPage('https://pkgs.example', MANIFEST, [{ repo: 'a/b', packages: 0, status: null }], [])

  expect(html).toContain('<form method="post" action="/refresh"')
  expect(html).toContain('Refresh now')
  expect(html).toContain('Polling GitHub')
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
