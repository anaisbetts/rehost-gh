import { describe, expect, test } from 'bun:test'
import type { WatchConfig } from '../src/config'
import type { Release } from '../src/github'
import type { StoredAsset } from '../src/state'
import { assetMatches, planRetention, selectReleases } from '../src/sync'

const WATCH: WatchConfig = {
  repo: 'owner/app',
  owner: 'owner',
  name: 'app',
  keep: 2,
  prereleases: false,
  include: [],
  exclude: [],
}

describe('assetMatches', () => {
  test('only accepts package formats', () => {
    expect(assetMatches('app_1.0_amd64.deb', WATCH)).toBe(true)
    expect(assetMatches('Setup.exe', WATCH)).toBe(true)
    expect(assetMatches('app-1.0.tar.gz', WATCH)).toBe(false)
    expect(assetMatches('app-1.0.src.rpm', WATCH)).toBe(false)
    expect(assetMatches('app-1.0-1-x86_64.pkg.tar.zst.sig', WATCH)).toBe(false)
  })

  test('applies include and exclude globs', () => {
    const watch = { ...WATCH, include: ['*.deb', '*.rpm'], exclude: ['*-musl*'] }

    expect(assetMatches('app_1.0_amd64.deb', watch)).toBe(true)
    expect(assetMatches('app-musl_1.0_amd64.deb', watch)).toBe(false)
    expect(assetMatches('app-1.0-full.nupkg', watch)).toBe(false)
  })
})

describe('selectReleases', () => {
  test('keeps the newest published releases with packages', () => {
    const releases = [
      release(1, '2026-01-01', ['app_1_amd64.deb']),
      release(2, '2026-03-01', ['app_2_amd64.deb']),
      release(3, '2026-04-01', ['notes.txt']),
      release(4, '2026-05-01', ['app_4_amd64.deb'], { draft: true }),
      release(5, '2026-06-01', ['app_5_amd64.deb'], { prerelease: true }),
      release(6, '2026-02-01', ['app_6_amd64.deb']),
    ]

    expect(selectReleases(releases, WATCH).map((r) => r.id)).toEqual([2, 6])
    expect(selectReleases(releases, { ...WATCH, prereleases: true }).map((r) => r.id)).toEqual([5, 2])
  })
})

describe('planRetention', () => {
  test('keeps the newest versions of each package and architecture', () => {
    const assets = [
      stored(1, 'app', '1.0', 'amd64', '2026-01-01'),
      stored(2, 'app', '2.0', 'amd64', '2026-02-01'),
      stored(3, 'app', '3.0', 'amd64', '2026-03-01'),
      stored(4, 'app', '1.0', 'arm64', '2026-01-01'),
      stored(5, 'other', '1.0', 'amd64', '2026-01-01'),
    ]

    expect(planRetention(assets, 2).map((a) => a.assetId)).toEqual([1])
    expect(planRetention(assets, 1).map((a) => a.assetId)).toEqual([2, 1])
  })

  test('keeps full and delta packages of the same version together', () => {
    const assets = [
      stored(1, 'App', '1.0', 'x64', '2026-01-01', 'squirrel'),
      stored(2, 'App', '2.0', 'x64', '2026-02-01', 'squirrel'),
      { ...stored(3, 'App', '2.0', 'x64', '2026-02-01', 'squirrel'), delta: true },
    ]

    expect(planRetention(assets, 1).map((a) => a.assetId)).toEqual([1])
  })
})

function release(id: number, date: string, assets: string[], extra: Partial<Release> = {}): Release {
  return {
    id,
    tag_name: `v${id}`,
    draft: false,
    prerelease: false,
    published_at: `${date}T00:00:00Z`,
    assets: assets.map((name, i) => ({ id: id * 100 + i, name, size: 1 })),
    ...extra,
  }
}

function stored(
  assetId: number,
  name: string,
  version: string,
  arch: string,
  date: string,
  format: StoredAsset['format'] = 'deb'
): StoredAsset {
  return {
    assetId,
    watch: WATCH.repo,
    tag: `v${version}`,
    publishedAt: `${date}T00:00:00Z`,
    fileName: `${name}_${version}_${arch}.deb`,
    path: `owner/app/v${version}/${name}_${version}_${arch}.deb`,
    size: 1,
    sha1: 'a',
    sha256: 'b',
    format,
    name,
    version,
    arch,
    delta: false,
  }
}
