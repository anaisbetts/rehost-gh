export type PackageFormat = 'arch' | 'deb' | 'rpm' | 'squirrel' | 'android'

/** Metadata read out of a downloaded package file. */
export interface PackageInfo {
  format: PackageFormat
  name: string
  version: string
  /**
   * Architecture in the package manager's own vocabulary (`x86_64`, `amd64`, `arm64-v8a`, ...). Packages that work
   * everywhere keep their native marker: `any` (Arch / Android), `all` (deb), `noarch` (RPM).
   */
  arch: string
  /** Squirrel only: whether this is a delta package rather than a full one. */
  delta: boolean
}

const ARCH_INDEPENDENT = new Set(['any', 'all', 'noarch'])

export function isArchIndependent(arch: string): boolean {
  return ARCH_INDEPENDENT.has(arch)
}
