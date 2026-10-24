import { copyFile, link, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isArchIndependent } from '../package'
import type { Signer } from '../signing'
import type { StoredAsset } from '../state'

export interface PublishContext {
  /** Root of the tree being built, which becomes the served directory once complete. */
  root: string
  downloadsDir: string
  signer: Signer
  repoName: string
}

/** Places a downloaded asset at `dest` inside the tree, hardlinking so nothing is stored twice. */
export async function placeAsset(ctx: PublishContext, asset: StoredAsset, dest: string) {
  await placeFile(join(ctx.downloadsDir, asset.path), dest)
}

export async function placeFile(source: string, dest: string) {
  await mkdir(dirname(dest), { recursive: true })
  await rm(dest, { force: true })
  try {
    await link(source, dest)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    await copyFile(source, dest)
  }
}

/**
 * Groups packages by architecture, adding architecture-independent ones to every group. When there are only
 * architecture-independent packages, they're published under `fallback`.
 */
export function groupByArch(assets: StoredAsset[], fallback: string[]): Map<string, StoredAsset[]> {
  const specific = [...new Set(assets.filter((a) => !isArchIndependent(a.arch)).map((a) => a.arch))].sort()
  const arches = specific.length > 0 ? specific : fallback
  const independent = assets.filter((a) => isArchIndependent(a.arch))

  return new Map(arches.map((arch) => [arch, [...assets.filter((a) => a.arch === arch), ...independent]]))
}
