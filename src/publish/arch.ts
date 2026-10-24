import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { exec } from '../exec'
import type { StoredAsset } from '../state'
import { groupByArch, type PublishContext, placeAsset, placeFile } from './common'

const FALLBACK_ARCHES = ['x86_64', 'aarch64']

/**
 * Builds `arch/<arch>/` pacman repos. Every package gets a detached signature (cached next to the download), since
 * pacman's default SigLevel requires one, and the database itself is signed by `repo-add`. A pacman database holds one
 * version per package, so only the newest goes in; older files stay alongside for `pacman -U` downgrades.
 */
export async function publishArch(ctx: PublishContext, assets: StoredAsset[]): Promise<string[]> {
  const groups = groupByArch(assets, FALLBACK_ARCHES)

  for (const [arch, packages] of groups) {
    const dir = join(ctx.root, 'arch', arch)

    for (const asset of packages) {
      const signature = await ensurePackageSignature(ctx, asset)
      const dest = join(dir, asset.fileName)
      await placeAsset(ctx, asset, dest)
      await placeFile(signature, `${dest}.sig`)
    }

    await exec(
      [
        'repo-add',
        '--quiet',
        '--sign',
        '--key',
        ctx.signer.fingerprint,
        join(dir, `${ctx.repoName}.db.tar.gz`),
        ...newestPerPackage(packages).map((a) => join(dir, a.fileName)),
      ],
      { env: ctx.signer.env }
    )
  }

  return [...groups.keys()]
}

export function newestPerPackage(assets: StoredAsset[]): StoredAsset[] {
  const newest = new Map<string, StoredAsset>()
  for (const asset of assets) {
    const current = newest.get(asset.name)
    if (!current || asset.publishedAt > current.publishedAt) newest.set(asset.name, asset)
  }
  return [...newest.values()]
}

async function ensurePackageSignature(ctx: PublishContext, asset: StoredAsset): Promise<string> {
  const source = join(ctx.downloadsDir, asset.path)
  const signature = `${source}.sig`

  const exists = await access(signature).then(
    () => true,
    () => false
  )
  if (!exists) await ctx.signer.detachSign(source, signature, false)

  return signature
}
