import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { androidUpdateMetadata, newestAndroidAsset, publishAndroid } from '../src/publish/android'
import { newestPerPackage } from '../src/publish/arch'
import { groupByArch } from '../src/publish/common'
import { releasesFile, squirrelExeFileName, squirrelFileName } from '../src/publish/squirrel'
import type { Signer } from '../src/signing'
import type { StoredAsset } from '../src/state'
import { writeMinimalApk } from './apk'

describe('groupByArch', () => {
  test('adds architecture-independent packages to every architecture', () => {
    const groups = groupByArch([asset(1, 'x86_64'), asset(2, 'any'), asset(3, 'aarch64')], ['fallback'])

    expect([...groups.keys()]).toEqual(['aarch64', 'x86_64'])
    expect(groups.get('x86_64')!.map((a) => a.assetId)).toEqual([1, 2])
    expect(groups.get('aarch64')!.map((a) => a.assetId)).toEqual([3, 2])
  })

  test('uses the fallback architectures when everything is independent', () => {
    const groups = groupByArch([asset(1, 'noarch')], ['x86_64', 'aarch64'])
    expect([...groups.keys()]).toEqual(['x86_64', 'aarch64'])
  })
})

describe('newestPerPackage', () => {
  test('keeps only the most recently published version of each package', () => {
    const newest = newestPerPackage([
      { ...asset(1, 'x86_64'), name: 'app', publishedAt: '2026-03-01' },
      { ...asset(2, 'x86_64'), name: 'app', publishedAt: '2026-01-01' },
      { ...asset(3, 'x86_64'), name: 'app', publishedAt: '2026-02-01' },
      { ...asset(4, 'any'), name: 'other', publishedAt: '2026-01-01' },
    ])

    expect(newest.map((a) => a.assetId)).toEqual([1, 4])
  })
})

describe('Android feeds', () => {
  test('writes mbfai android-update metadata for the newest APK', () => {
    const latest = {
      ...asset(3, 'arm64-v8a'),
      format: 'android' as const,
      name: 'dev.anais.red',
      version: '1.12.34+3106',
      sha256: 'a'.repeat(64),
      publishedAt: '2026-05-13T20:35:00.000Z',
    }

    expect(androidUpdateMetadata(latest)).toEqual({
      platform: 'android',
      versionName: '1.12.34',
      versionCode: 3106,
      apkUrl: 'releases/dev.anais.red-1.12.34+3106-arm64-v8a.apk',
      sha256checksum: 'a'.repeat(64),
      publishedAt: '2026-05-13T20:35:00.000Z',
    })
  })

  test('picks the highest versionCode, preferring arm64', () => {
    const assets = [
      { ...asset(1, 'x86_64'), format: 'android' as const, version: '1.0.0+10' },
      { ...asset(2, 'arm64-v8a'), format: 'android' as const, version: '1.0.0+10' },
      { ...asset(3, 'arm64-v8a'), format: 'android' as const, version: '0.9.0+9', publishedAt: '2026-06-01' },
    ]

    expect(newestAndroidAsset(assets).assetId).toBe(2)
  })

  test('publishes APKs and android-update.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rehost-android-'))
    try {
      const downloadsDir = join(dir, 'downloads')
      await mkdir(downloadsDir)
      const path = 'app.apk'
      await writeMinimalApk(join(downloadsDir, path), {
        package: 'dev.anais.red',
        versionName: '1.0.0',
        versionCode: 10,
      })
      const bytes = await Bun.file(join(downloadsDir, path)).bytes()
      const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
      const published = {
        ...asset(1, 'arm64-v8a'),
        format: 'android' as const,
        name: 'dev.anais.red',
        version: '1.0.0+10',
        fileName: 'app.apk',
        path,
        size: bytes.byteLength,
        sha256,
        publishedAt: '2026-05-13T20:35:00.000Z',
      }

      const feeds = await publishAndroid(
        { root: join(dir, 'www'), downloadsDir, signer: {} as Signer, repoName: 'rehost-gh' },
        [published]
      )
      const metadata = await Bun.file(join(dir, 'www/android/dev.anais.red/android-update.json')).json()

      expect(feeds).toEqual([{ id: 'dev.anais.red', versionName: '1.0.0', versionCode: 10, arch: 'arm64-v8a' }])
      expect(metadata).toEqual(androidUpdateMetadata(published))
      expect(await Bun.file(join(dir, 'www/android/dev.anais.red', metadata.apkUrl)).exists()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('Squirrel feeds', () => {
  test('renames files the way Squirrel expects', () => {
    expect(squirrelFileName({ ...asset(1, 'arm64'), name: 'MyApp', version: '1.2.3' })).toBe('MyApp-1.2.3-full.nupkg')
    expect(squirrelFileName({ ...asset(1, 'arm64'), name: 'MyApp', version: '1.2.3', delta: true })).toBe(
      'MyApp-1.2.3-delta.nupkg'
    )
    expect(squirrelExeFileName({ ...asset(1, 'arm64'), name: 'MyApp', version: '1.2.3' })).toBe('MyApp-1.2.3-Setup.exe')
  })

  test('lists packages oldest first with uppercase SHA1s', () => {
    const v2 = { ...asset(2, 'x64'), name: 'App', version: '2.0.0', publishedAt: '2026-02-01', sha1: 'bb', size: 20 }
    const v2delta = { ...v2, assetId: 3, delta: true, sha1: 'cc', size: 5 }
    const v1 = { ...asset(1, 'x64'), name: 'App', version: '1.0.0', publishedAt: '2026-01-01', sha1: 'aa', size: 10 }

    expect(releasesFile([v2delta, v2, v1])).toBe(
      'AA App-1.0.0-full.nupkg 10\r\nBB App-2.0.0-full.nupkg 20\r\nCC App-2.0.0-delta.nupkg 5\r\n'
    )
  })
})

function asset(assetId: number, arch: string): StoredAsset {
  return {
    assetId,
    watch: 'owner/app',
    tag: 'v1',
    publishedAt: '2026-01-01',
    fileName: `app-${assetId}`,
    path: `owner/app/v1/app-${assetId}`,
    size: 1,
    sha1: 'a',
    sha256: 'b',
    format: 'squirrel',
    name: 'app',
    version: '1',
    arch,
    delta: false,
  }
}
