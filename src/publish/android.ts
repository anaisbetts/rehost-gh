import { join } from 'node:path'
import { androidFileName, parseAndroidVersion } from '../android-manifest'
import type { StoredAsset } from '../state'
import { type PublishContext, placeAsset } from './common'

const ANDROID_ARCH_RANK: Record<string, number> = {
  'arm64-v8a': 0,
  universal: 1,
  'armeabi-v7a': 2,
  x86_64: 3,
  x86: 4,
  any: 5,
}

export interface AndroidFeed {
  id: string
  versionName: string
  versionCode: number
  arch: string
}

/** Fields the mbfai Android client reads from `android-update.json`. */
export interface AndroidUpdateInfo {
  platform: 'android'
  versionName: string
  versionCode: number
  apkUrl: string
  sha256checksum: string
  publishedAt: string
}

/**
 * Builds one `android/<package>/` feed per application id. Every kept APK is hardlinked under `releases/`, and
 * `android-update.json` describes the newest (highest `versionCode`, preferring arm64).
 */
export async function publishAndroid(ctx: PublishContext, assets: StoredAsset[]): Promise<AndroidFeed[]> {
  const feeds = new Map<string, StoredAsset[]>()
  for (const asset of assets) {
    feeds.set(asset.name, [...(feeds.get(asset.name) ?? []), asset])
  }

  const result: AndroidFeed[] = []
  for (const packages of [...feeds.values()].sort((a, b) => a[0]!.name.localeCompare(b[0]!.name))) {
    const id = packages[0]!.name
    const dir = join(ctx.root, 'android', id)

    for (const asset of packages) {
      await placeAsset(ctx, asset, join(dir, 'releases', androidFileName(asset.name, asset.version, asset.arch)))
    }

    const latest = newestAndroidAsset(packages)
    const { versionName, versionCode } = parseAndroidVersion(latest.version)
    await Bun.write(join(dir, 'android-update.json'), `${JSON.stringify(androidUpdateMetadata(latest), null, 2)}\n`)
    result.push({ id, versionName, versionCode, arch: latest.arch })
  }

  return result
}

export function androidUpdateMetadata(asset: StoredAsset): AndroidUpdateInfo {
  const { versionName, versionCode } = parseAndroidVersion(asset.version)
  return {
    platform: 'android',
    versionName,
    versionCode,
    apkUrl: `releases/${androidFileName(asset.name, asset.version, asset.arch)}`,
    sha256checksum: asset.sha256,
    publishedAt: asset.publishedAt,
  }
}

/** Highest versionCode wins; arm64-v8a beats a fat or older ABI of the same build. */
export function newestAndroidAsset(assets: StoredAsset[]): StoredAsset {
  return [...assets].sort((a, b) => {
    const aCode = parseAndroidVersion(a.version).versionCode
    const bCode = parseAndroidVersion(b.version).versionCode
    if (aCode !== bCode) return bCode - aCode
    const aRank = ANDROID_ARCH_RANK[a.arch] ?? 99
    const bRank = ANDROID_ARCH_RANK[b.arch] ?? 99
    if (aRank !== bRank) return aRank - bRank
    return b.publishedAt.localeCompare(a.publishedAt) || b.assetId - a.assetId
  })[0]!
}
