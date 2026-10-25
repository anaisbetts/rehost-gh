import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AndroidManifestInfo, encodeAndroidManifest } from '../src/android-manifest'
import { exec } from '../src/exec'

/** Writes a tiny zip APK with a binary manifest and optional `lib/<abi>/` stubs. */
export async function writeMinimalApk(
  path: string,
  info: AndroidManifestInfo,
  abis: string[] = ['arm64-v8a']
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'rehost-apk-'))
  try {
    await Bun.write(join(dir, 'AndroidManifest.xml'), encodeAndroidManifest(info))
    const members = ['AndroidManifest.xml']
    for (const abi of abis) {
      await mkdir(join(dir, 'lib', abi), { recursive: true })
      await Bun.write(join(dir, 'lib', abi, 'libdummy.so'), 'x')
      members.push(`lib/${abi}/libdummy.so`)
    }
    await exec(['bsdtar', '--format', 'zip', '-cf', path, ...members], { cwd: dir })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
