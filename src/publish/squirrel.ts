import { join } from 'node:path'
import type { StoredAsset } from '../state'
import { type PublishContext, placeAsset } from './common'

export interface SquirrelFeed {
  id: string
  arch: string
}

/**
 * Builds one `squirrel/<id>/<arch>/` feed per app and architecture. Files are renamed to `<id>-<version>-full.nupkg`
 * because Squirrel parses the version out of the file name, and extra tokens like `-x64` would confuse it.
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

    for (const asset of packages) {
      await placeAsset(ctx, asset, join(dir, squirrelFileName(asset)))
    }
    await Bun.write(join(dir, 'RELEASES'), releasesFile(packages))

    result.push({ id, arch })
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
