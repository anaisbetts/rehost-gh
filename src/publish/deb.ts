import { mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { exec } from '../exec'
import { isArchIndependent } from '../package'
import type { StoredAsset } from '../state'
import { type PublishContext, placeAsset } from './common'

const SUITE = 'stable'
const COMPONENT = 'main'
const FALLBACK_ARCHES = ['amd64', 'arm64']

/**
 * Builds a single apt repo at `deb/` with one suite and one component. Pool files get canonical
 * `name_version_arch.deb` names because `apt-ftparchive --arch` selects packages by file name.
 */
export async function publishDeb(ctx: PublishContext, assets: StoredAsset[]): Promise<string[]> {
  const root = join(ctx.root, 'deb')
  const suiteDir = join(root, 'dists', SUITE)

  for (const asset of assets) {
    await placeAsset(ctx, asset, join(root, poolPath(asset)))
  }

  const specific = [...new Set(assets.filter((a) => !isArchIndependent(a.arch)).map((a) => a.arch))].sort()
  const arches = specific.length > 0 ? specific : FALLBACK_ARCHES

  for (const arch of arches) {
    const binaryDir = join(suiteDir, COMPONENT, `binary-${arch}`)
    await mkdir(binaryDir, { recursive: true })

    const packages = await exec(['apt-ftparchive', '--arch', arch, 'packages', 'pool'], { cwd: root })
    const packagesFile = join(binaryDir, 'Packages')
    await Bun.write(packagesFile, packages)
    await exec(['gzip', '-9kn', packagesFile])
    await exec(['xz', '-9k', packagesFile])
  }

  const release = await exec(
    [
      'apt-ftparchive',
      '-o',
      `APT::FTPArchive::Release::Origin=${ctx.repoName}`,
      '-o',
      `APT::FTPArchive::Release::Label=${ctx.repoName}`,
      '-o',
      `APT::FTPArchive::Release::Suite=${SUITE}`,
      '-o',
      `APT::FTPArchive::Release::Codename=${SUITE}`,
      '-o',
      `APT::FTPArchive::Release::Architectures=${arches.join(' ')}`,
      '-o',
      `APT::FTPArchive::Release::Components=${COMPONENT}`,
      'release',
      '.',
    ],
    { cwd: suiteDir }
  )

  // Written beside the suite and moved in afterwards, so the Release file never lists itself.
  const releaseTmp = join(root, 'dists', `${SUITE}.Release`)
  await Bun.write(releaseTmp, release)
  await rename(releaseTmp, join(suiteDir, 'Release'))

  await ctx.signer.clearSign(join(suiteDir, 'Release'), join(suiteDir, 'InRelease'))
  await ctx.signer.detachSign(join(suiteDir, 'Release'), join(suiteDir, 'Release.gpg'), true)

  return arches
}

function poolPath(asset: StoredAsset): string {
  const version = asset.version.replace(/^\d+:/, '')
  const prefix = asset.name.startsWith('lib') ? asset.name.slice(0, 4) : asset.name[0]!
  return join('pool', COMPONENT, prefix, asset.name, `${asset.name}_${version}_${asset.arch}.deb`)
}
