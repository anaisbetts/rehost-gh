import { describe, expect, test } from 'bun:test'
import { newestPerPackage } from '../src/publish/arch'
import { groupByArch } from '../src/publish/common'
import { releasesFile, squirrelExeFileName, squirrelFileName } from '../src/publish/squirrel'
import type { StoredAsset } from '../src/state'

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
