import { join } from 'node:path'
import { isSquirrelExe } from '../detect'
import type { StoredAsset } from '../state'
import { type PublishContext, placeAsset } from './common'

export interface SquirrelFeed {
  id: string
  arch: string
  setup: boolean
}

/**
 * Builds one `squirrel/<id>/<arch>/` feed per app and architecture. Files are renamed to `<id>-<version>-full.nupkg`
 * because Squirrel parses the version out of the file name, and extra tokens like `-x64` would confuse it. Installer
 * EXEs from the same releases land in the same directory, with the newest also published as `Setup.exe`.
 */
export async function publishSquirrel(ctx: PublishContext, assets: StoredAsset[]): Promise<SquirrelFeed[]> {
  const feeds = new Map<string, StoredAsset[]>()
  for (const asset of assets) {
    const key = `${asset.name}/${asset.arch}`
    feeds.set(key, [...(feeds.get(key) ?? []), asset])
  }

  const result: SquirrelFeed[] = []
  for (const packages of feeds.values()) {
    const { name: id, arch } = packages[0]!
    const dir = join(ctx.root, 'squirrel', id, arch)
    const nupkgs = packages.filter((a) => !isSquirrelExe(a.fileName))
    const exes = packages.filter((a) => isSquirrelExe(a.fileName))

    for (const asset of nupkgs) {
      await placeAsset(ctx, asset, join(dir, squirrelFileName(asset)))
    }
    if (nupkgs.length > 0) await Bun.write(join(dir, 'RELEASES'), releasesFile(nupkgs))

    for (const asset of exes) {
      await placeAsset(ctx, asset, join(dir, squirrelExeFileName(asset)))
    }
    const setup = newestAsset(exes)
    if (setup) await placeAsset(ctx, setup, join(dir, 'Setup.exe'))

    result.push({ id, arch, setup: setup !== undefined })
  }

  return result.sort((a, b) => a.id.localeCompare(b.id) || a.arch.localeCompare(b.arch))
}

/** Squirrel's RELEASES format: one `SHA1 filename size` line per package, oldest first. */
export function releasesFile(assets: StoredAsset[]): string {
  return `${[...assets]
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || Number(a.delta) - Number(b.delta))
    .map((a) => `${a.sha1.toUpperCase()} ${squirrelFileName(a)} ${a.size}`)
    .join('\r\n')}\r\n`
}

export function squirrelFileName(asset: StoredAsset): string {
  return `${asset.name}-${asset.version}-${asset.delta ? 'delta' : 'full'}.nupkg`
}

export function squirrelExeFileName(asset: StoredAsset): string {
  return `${asset.name}-${asset.version}-Setup.exe`
}

function newestAsset(assets: StoredAsset[]): StoredAsset | undefined {
  return [...assets].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.assetId - a.assetId)[0]
}
