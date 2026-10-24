import { mkdir, readdir, rename, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import debug from 'debug'
import type { Config } from '../config'
import type { PackageFormat } from '../package'
import type { Signer } from '../signing'
import type { State, StoredAsset } from '../state'
import { publishArch } from './arch'
import type { PublishContext } from './common'
import { publishDeb } from './deb'
import { publishRpm } from './rpm'
import { publishSquirrel, type SquirrelFeed } from './squirrel'

const d = debug('rehost-gh:publish')

export const WWW_LINK = 'www'
export const MANIFEST_FILE = 'repos.json'
export const KEY_FILE = 'key.asc'
const WWW_PREFIX = 'www.'

/** What got published, read back by the index page. */
export interface Manifest {
  repoName: string
  fingerprint: string
  publishedAt: string
  arch: string[]
  deb: string[]
  rpm: string[]
  squirrel: SquirrelFeed[]
}

/**
 * Rebuilds the whole served tree from the stored assets into a fresh `www.<timestamp>` directory, then atomically
 * repoints the `www` symlink at it and deletes older trees.
 */
export async function publish(dataDir: string, config: Config, state: State, signer: Signer): Promise<Manifest> {
  const name = `${WWW_PREFIX}${Date.now()}`
  const ctx: PublishContext = {
    root: join(dataDir, name),
    downloadsDir: join(dataDir, 'downloads'),
    signer,
    repoName: config.repoName,
  }
  await mkdir(ctx.root, { recursive: true })

  try {
    const byFormat = groupByFormat(state.assets())
    const manifest: Manifest = {
      repoName: config.repoName,
      fingerprint: signer.fingerprint,
      publishedAt: new Date().toISOString(),
      arch: byFormat.arch.length > 0 ? await publishArch(ctx, byFormat.arch) : [],
      deb: byFormat.deb.length > 0 ? await publishDeb(ctx, byFormat.deb) : [],
      rpm: byFormat.rpm.length > 0 ? await publishRpm(ctx, byFormat.rpm) : [],
      squirrel: byFormat.squirrel.length > 0 ? await publishSquirrel(ctx, byFormat.squirrel) : [],
    }

    await Bun.write(join(ctx.root, KEY_FILE), await signer.exportPublicKey())
    await Bun.write(join(ctx.root, MANIFEST_FILE), JSON.stringify(manifest, null, 2))

    await swapLink(dataDir, name)
    console.log(`Published ${state.assets().length} packages to ${name}`)
    return manifest
  } catch (e) {
    await rm(ctx.root, { recursive: true, force: true })
    throw e
  }
}

function groupByFormat(assets: StoredAsset[]): Record<PackageFormat, StoredAsset[]> {
  const groups: Record<PackageFormat, StoredAsset[]> = { arch: [], deb: [], rpm: [], squirrel: [] }
  for (const asset of assets) groups[asset.format].push(asset)
  return groups
}

async function swapLink(dataDir: string, name: string) {
  const tmpLink = join(dataDir, `${WWW_LINK}.next`)
  await rm(tmpLink, { force: true })
  await symlink(name, tmpLink)
  await rename(tmpLink, join(dataDir, WWW_LINK))

  for (const entry of await readdir(dataDir)) {
    if (entry.startsWith(WWW_PREFIX) && entry !== name && entry !== `${WWW_LINK}.next`) {
      d('removing old tree %s', entry)
      await rm(join(dataDir, entry), { recursive: true, force: true })
    }
  }
}
