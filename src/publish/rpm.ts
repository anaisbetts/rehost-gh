import { join } from 'node:path'
import { exec } from '../exec'
import type { StoredAsset } from '../state'
import { groupByArch, type PublishContext, placeAsset } from './common'

const FALLBACK_ARCHES = ['x86_64', 'aarch64']

/** Builds `rpm/<arch>/` repos with signed `repodata`. The RPMs themselves keep whatever signature upstream gave them. */
export async function publishRpm(ctx: PublishContext, assets: StoredAsset[]): Promise<string[]> {
  const groups = groupByArch(assets, FALLBACK_ARCHES)

  for (const [arch, packages] of groups) {
    const dir = join(ctx.root, 'rpm', arch)
    for (const asset of packages) {
      await placeAsset(ctx, asset, join(dir, 'Packages', asset.fileName))
    }

    await exec(['createrepo_c', '--quiet', '--no-database', dir])
    const repomd = join(dir, 'repodata', 'repomd.xml')
    await ctx.signer.detachSign(repomd, `${repomd}.asc`, true)
  }

  return [...groups.keys()]
}
