import { exec } from './exec'
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

/** Picks the format from the asset name alone, so unrelated assets are never downloaded. */
export function formatFromFileName(fileName: string): PackageFormat | null {
  const name = fileName.toLowerCase()
  if (/\.pkg\.tar\.(zst|xz|gz)$/.test(name)) return 'arch'
  if (name.endsWith('.deb')) return 'deb'
  if (name.endsWith('.rpm') && !name.endsWith('.src.rpm')) return 'rpm'
  if (name.endsWith('.nupkg')) return 'squirrel'
  return null
}

/** Reads name, version and architecture out of a downloaded package. */
export async function inspectPackage(path: string, fileName: string, format: PackageFormat): Promise<PackageInfo> {
  switch (format) {
    case 'arch':
      return inspectArch(path)
    case 'deb':
      return inspectDeb(path)
    case 'rpm':
      return inspectRpm(path)
    case 'squirrel':
      return inspectSquirrel(path, fileName)
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

function requireField(value: string | undefined, field: string, where: string): string {
  if (!value?.trim()) throw new Error(`Missing ${field} in ${where}`)
  return value.trim()
}
