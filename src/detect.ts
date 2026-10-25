import { androidArchFromListing, formatAndroidVersion, parseAndroidManifest } from './android-manifest'
import { exec, execBuffer } from './exec'
import type { PackageFormat, PackageInfo } from './package'

const SQUIRREL_ARCH_TOKENS: Record<string, string> = {
  x64: 'x64',
  amd64: 'x64',
  win64: 'x64',
  arm64: 'arm64',
  aarch64: 'arm64',
  x86: 'x86',
  ia32: 'x86',
  win32: 'x86',
}
const DEFAULT_SQUIRREL_ARCH = 'x64'
const EXE_SKIP_TOKENS = new Set(['setup', 'installer', 'install', 'win', 'windows', 'standalone', 'portable'])
const EXE_VERSION = /^\d+(?:\.\d+){1,3}$/

type SquirrelIdentity = Pick<PackageInfo, 'name' | 'version' | 'arch'>

interface ParsedExeName {
  name: string | undefined
  version: string | undefined
  arch: string
  explicitArch: boolean
}

/** Picks the format from the asset name alone, so unrelated assets are never downloaded. */
export function formatFromFileName(fileName: string): PackageFormat | null {
  const name = fileName.toLowerCase()
  if (/\.pkg\.tar\.(zst|xz|gz)$/.test(name)) return 'arch'
  if (name.endsWith('.deb')) return 'deb'
  if (name.endsWith('.rpm') && !name.endsWith('.src.rpm')) return 'rpm'
  if (name.endsWith('.nupkg') || isSquirrelExe(fileName)) return 'squirrel'
  if (name.endsWith('.apk')) return 'android'
  return null
}

/** Reads name, version and architecture out of a downloaded package. */
export async function inspectPackage(
  path: string,
  fileName: string,
  format: PackageFormat,
  siblings: SquirrelIdentity[] = []
): Promise<PackageInfo> {
  switch (format) {
    case 'arch':
      return inspectArch(path)
    case 'deb':
      return inspectDeb(path)
    case 'rpm':
      return inspectRpm(path)
    case 'squirrel':
      return isSquirrelExe(fileName) ? inspectSquirrelExe(fileName, siblings) : inspectSquirrel(path, fileName)
    case 'android':
      return inspectAndroid(path)
    default: {
      const unreachable: never = format
      throw new Error(`Unknown package format ${unreachable}`)
    }
  }
}

/** Squirrel packages don't record an architecture, so guess from tokens like `x64` or `arm64` in the file name. */
export function squirrelArchFromFileName(fileName: string): string {
  const tokens = fileName
    .toLowerCase()
    .replace(/\.nupkg$/, '')
    .split(/[-_.\s]+/)
  for (const token of tokens) {
    const arch = SQUIRREL_ARCH_TOKENS[token]
    if (arch) return arch
  }
  return DEFAULT_SQUIRREL_ARCH
}

export function isSquirrelExe(fileName: string): boolean {
  const name = fileName.toLowerCase()
  return name.endsWith('.exe') && (name.includes('setup') || name.includes('install'))
}

/**
 * Reads id, version and architecture from an installer file name. Bare names like `Setup.exe` borrow the missing
 * fields from nupkgs in the same GitHub release, so the EXE lands in the same feed as its packages.
 */
export function inspectSquirrelExe(fileName: string, siblings: SquirrelIdentity[] = []): PackageInfo {
  const parsed = parseExeFileName(fileName)
  const names = unique(siblings.map((s) => s.name))
  const versions = unique(siblings.map((s) => s.version))
  const arches = unique(siblings.map((s) => s.arch))

  const name = (names.length === 1 ? names[0] : undefined) ?? parsed.name
  const version = (versions.length === 1 ? versions[0] : undefined) ?? parsed.version
  const arch = parsed.explicitArch ? parsed.arch : arches.length === 1 ? arches[0]! : parsed.arch

  if (!name || !version) throw new Error(`Cannot determine app id and version from ${fileName}`)
  return { format: 'squirrel', name, version, arch, delta: false }
}

export function parsePkgInfo(text: string): { name: string; version: string; arch: string } {
  const fields = new Map<string, string>()
  for (const line of text.split('\n')) {
    const match = line.match(/^(\w+)\s*=\s*(.*)$/)
    if (match && !fields.has(match[1]!)) fields.set(match[1]!, match[2]!.trim())
  }

  return {
    name: requireField(fields.get('pkgname'), 'pkgname', '.PKGINFO'),
    version: requireField(fields.get('pkgver'), 'pkgver', '.PKGINFO'),
    arch: requireField(fields.get('arch'), 'arch', '.PKGINFO'),
  }
}

export function parseNuspec(xml: string): { id: string; version: string } {
  const id = xml.match(/<id>\s*([^<]+?)\s*<\/id>/)?.[1]
  const version = xml.match(/<version>\s*([^<]+?)\s*<\/version>/)?.[1]
  return { id: requireField(id, 'id', 'nuspec'), version: requireField(version, 'version', 'nuspec') }
}

async function inspectArch(path: string): Promise<PackageInfo> {
  const info = parsePkgInfo(await exec(['bsdtar', '-xOf', path, '.PKGINFO']))
  return { format: 'arch', ...info, delta: false }
}

async function inspectDeb(path: string): Promise<PackageInfo> {
  const out = await exec(['dpkg-deb', '--field', path, 'Package', 'Version', 'Architecture'])
  const fields = new Map(
    out
      .split('\n')
      .map((line) => line.match(/^([\w-]+):\s*(.*)$/))
      .filter((m) => m !== null)
      .map((m) => [m[1]!, m[2]!] as const)
  )
  return {
    format: 'deb',
    name: requireField(fields.get('Package'), 'Package', 'control'),
    version: requireField(fields.get('Version'), 'Version', 'control'),
    arch: requireField(fields.get('Architecture'), 'Architecture', 'control'),
    delta: false,
  }
}

async function inspectRpm(path: string): Promise<PackageInfo> {
  const out = await exec(['rpm', '-qp', '--nosignature', '--qf', '%{NAME}\\n%{EVR}\\n%{ARCH}\\n', path])
  const [name, version, arch] = out.split('\n')
  return {
    format: 'rpm',
    name: requireField(name, 'NAME', 'RPM header'),
    version: requireField(version, 'EVR', 'RPM header'),
    arch: requireField(arch, 'ARCH', 'RPM header'),
    delta: false,
  }
}

async function inspectSquirrel(path: string, fileName: string): Promise<PackageInfo> {
  const { id, version } = parseNuspec(await exec(['bsdtar', '-xOf', path, '*.nuspec']))
  return {
    format: 'squirrel',
    name: id,
    version,
    arch: squirrelArchFromFileName(fileName),
    delta: /-delta\.nupkg$/i.test(fileName),
  }
}

async function inspectAndroid(path: string): Promise<PackageInfo> {
  const info = parseAndroidManifest(await execBuffer(['bsdtar', '-xOf', path, 'AndroidManifest.xml']))
  return {
    format: 'android',
    name: info.package,
    version: formatAndroidVersion(info.versionName, info.versionCode),
    arch: androidArchFromListing(await exec(['bsdtar', '-tf', path])),
    delta: false,
  }
}

function requireField(value: string | undefined, field: string, where: string): string {
  if (!value?.trim()) throw new Error(`Missing ${field} in ${where}`)
  return value.trim()
}

function parseExeFileName(fileName: string): ParsedExeName {
  const tokens = fileName
    .replace(/\.exe$/i, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
  let name: string | undefined
  let version: string | undefined
  let arch = DEFAULT_SQUIRREL_ARCH
  let explicitArch = false
  const nameTokens: string[] = []

  for (const token of tokens) {
    const lower = token.toLowerCase()
    if (!version && EXE_VERSION.test(token)) {
      version = token
      continue
    }
    const mapped = SQUIRREL_ARCH_TOKENS[lower]
    if (mapped) {
      arch = mapped
      explicitArch = true
      continue
    }
    if (!version && !EXE_SKIP_TOKENS.has(lower)) nameTokens.push(token)
  }

  if (nameTokens.length > 0) name = nameTokens.join('-')
  return { name, version, arch, explicitArch }
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}
