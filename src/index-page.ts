import { androidFileName } from './android-manifest'
import { isSquirrelExe } from './detect'
import type { PackageFormat } from './package'
import type { Manifest } from './publish'
import type { StoredAsset, WatchStatus } from './state'

const FORMAT_LABELS: Record<PackageFormat, string> = {
  arch: 'Arch',
  deb: 'Debian',
  rpm: 'RPM',
  squirrel: 'Squirrel',
  android: 'Android',
}

const STYLE = `
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; color: #222; }
  pre { background: #f4f4f4; padding: 0.75rem 1rem; overflow-x: auto; border-radius: 4px; }
  code { font: 13px ui-monospace, monospace; }
  a { color: #0969da; text-decoration: none; }
  a:hover { text-decoration: underline; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 0.3rem 0.6rem; border-bottom: 1px solid #ddd; vertical-align: top; }
  .error { color: #b00020; white-space: pre-wrap; }
  .muted { color: #777; }
  @media (prefers-color-scheme: dark) {
    body { background: #161616; color: #ddd; }
    pre { background: #222; }
    a { color: #6cb6ff; }
    th, td { border-color: #333; }
    .error { color: #ff6b81; }
  }
`

export interface WatchSummary {
  repo: string
  packages: number
  status: WatchStatus | null
}

interface PackageSummary {
  name: string
  format: PackageFormat
  installer: boolean
  version: string
  arches: string[]
  versionCount: number
  watch: string
  tag: string
}

/** Hosted packages, copy-paste setup for each published repository, and the status of every watched repo. */
export function renderIndexPage(
  origin: string,
  manifest: Manifest | null,
  watches: WatchSummary[],
  assets: StoredAsset[]
): string {
  const sections = manifest
    ? [
        packagesSection(origin, summarizePackages(assets)),
        keySection(origin, manifest),
        archSection(origin, manifest),
        debSection(origin, manifest),
        rpmSection(origin, manifest),
        squirrelSection(origin, manifest),
        androidSection(origin, manifest),
      ]
    : ['<p>Nothing has been published yet, the first sync is probably still running.</p>']

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(manifest?.repoName ?? 'rehost-gh')}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>${escapeHtml(manifest?.repoName ?? 'rehost-gh')}</h1>
${manifest ? `<p class="muted">Last published ${escapeHtml(manifest.publishedAt)}</p>` : ''}
${sections.join('\n')}
${statusSection(watches)}
</body>
</html>
`
}

function packagesSection(origin: string, packages: PackageSummary[]): string {
  if (packages.length === 0) return ''
  const rows = packages
    .map((p) => {
      const release = `https://github.com/${p.watch}/releases/tag/${encodeURIComponent(p.tag)}`
      const older = p.versionCount > 1 ? ` <span class="muted">+${p.versionCount - 1} older</span>` : ''
      return `<tr>
<td>${escapeHtml(p.name)}</td>
<td>${escapeHtml(formatLabel(p))}</td>
<td>${escapeHtml(p.version)}${older}</td>
<td>${codeList(p.arches)}</td>
<td><a href="${escapeHtml(release)}">${escapeHtml(p.watch)}@${escapeHtml(p.tag)}</a></td>
<td>${installCell(origin, p)}</td>
</tr>`
    })
    .join('\n')

  return `<h2>Packages</h2>
<p class="muted">Add the repository for your distro below first.</p>
<table><tr><th>Package</th><th>Format</th><th>Version</th><th>Arch</th><th>From</th><th>Install</th></tr>
${rows}
</table>`
}

function keySection(origin: string, manifest: Manifest): string {
  return `<h2>Signing key</h2>
<p>Everything is signed with <code>${escapeHtml(manifest.fingerprint)}</code>, available at
<a href="${escapeHtml(origin)}/key.asc">${escapeHtml(origin)}/key.asc</a>.</p>`
}

function archSection(origin: string, manifest: Manifest): string {
  if (manifest.arch.length === 0) return ''
  return `<h2>Arch Linux</h2>
<p>Architectures: ${codeList(manifest.arch)}</p>
${pre(`curl -fsSL ${origin}/key.asc | sudo pacman-key --add -
sudo pacman-key --lsign-key ${manifest.fingerprint}

# Add to /etc/pacman.conf
[${manifest.repoName}]
Server = ${origin}/arch/$arch`)}`
}

function debSection(origin: string, manifest: Manifest): string {
  if (manifest.deb.length === 0) return ''
  const keyring = `/etc/apt/keyrings/${manifest.repoName}.asc`
  return `<h2>Debian / Ubuntu</h2>
<p>Architectures: ${codeList(manifest.deb)}</p>
${pre(`sudo install -d /etc/apt/keyrings
curl -fsSL ${origin}/key.asc | sudo tee ${keyring} > /dev/null
echo "deb [signed-by=${keyring}] ${origin}/deb stable main" | sudo tee /etc/apt/sources.list.d/${manifest.repoName}.list
sudo apt update`)}`
}

function rpmSection(origin: string, manifest: Manifest): string {
  if (manifest.rpm.length === 0) return ''
  return `<h2>Fedora / RHEL</h2>
<p>Architectures: ${codeList(manifest.rpm)}. Package signatures are upstream's, so integrity comes from the signed
repository metadata (<code>repo_gpgcheck</code>) instead.</p>
${pre(`sudo tee /etc/yum.repos.d/${manifest.repoName}.repo > /dev/null <<'EOF'
[${manifest.repoName}]
name=${manifest.repoName}
baseurl=${origin}/rpm/$basearch
enabled=1
gpgcheck=0
repo_gpgcheck=1
gpgkey=${origin}/key.asc
EOF`)}`
}

function squirrelSection(origin: string, manifest: Manifest): string {
  if (manifest.squirrel.length === 0) return ''
  const rows = manifest.squirrel
    .map((f) => {
      const feed = `${origin}/squirrel/${f.id}/${f.arch}`
      const setup = f.setup
        ? `<a href="${escapeHtml(`${feed}/Setup.exe`)}"><code>${escapeHtml(`${feed}/Setup.exe`)}</code></a>`
        : ''
      return `<tr><td>${escapeHtml(f.id)}</td><td>${escapeHtml(f.arch)}</td><td><code>${escapeHtml(feed)}</code></td><td>${setup}</td></tr>`
    })
    .join('\n')
  return `<h2 id="squirrel">Squirrel.Windows</h2>
<p>Point <code>UpdateManager</code> at the feed URL. First-time installs download <code>Setup.exe</code> from the same directory.</p>
<table><tr><th>App</th><th>Arch</th><th>Feed URL</th><th>Installer</th></tr>
${rows}
</table>`
}

function androidSection(origin: string, manifest: Manifest): string {
  if (manifest.android.length === 0) return ''
  const rows = manifest.android
    .map((f) => {
      const feed = `${origin}/android/${f.id}`
      const metadata = `${feed}/android-update.json`
      const apk = `${feed}/releases/${androidFileName(f.id, `${f.versionName}+${f.versionCode}`, f.arch)}`
      return `<tr>
<td>${escapeHtml(f.id)}</td>
<td>${escapeHtml(f.versionName)}+${f.versionCode}</td>
<td>${escapeHtml(f.arch)}</td>
<td><code>${escapeHtml(metadata)}</code></td>
<td><a href="${escapeHtml(apk)}"><code>${escapeHtml(apk)}</code></a></td>
</tr>`
    })
    .join('\n')
  return `<h2 id="android">Android</h2>
<p>Point the app's <code>androidUpdateMetadataUrl</code> at the metadata URL. The client offers an install when
<code>versionCode</code> is greater than the installed build number.</p>
<table><tr><th>Package</th><th>Version</th><th>Arch</th><th>Metadata URL</th><th>APK</th></tr>
${rows}
</table>`
}

function statusSection(watches: WatchSummary[]): string {
  const rows = watches
    .map((w) => {
      const error = w.status?.lastError ? `<div class="error">${escapeHtml(w.status.lastError)}</div>` : ''
      return `<tr>
<td><a href="https://github.com/${escapeHtml(w.repo)}/releases">${escapeHtml(w.repo)}</a></td>
<td>${w.packages}</td>
<td>${escapeHtml(w.status?.lastSyncAt ?? 'never')}</td>
<td>${escapeHtml(w.status?.lastSuccessAt ?? 'never')}${error}</td>
</tr>`
    })
    .join('\n')

  return `<h2>Watched repos</h2>
<table><tr><th>Repo</th><th>Packages</th><th>Last sync</th><th>Last success</th></tr>
${rows}
</table>`
}

/** One row per package, describing its newest version. Expects assets newest first, as `State.assets()` returns them. */
function summarizePackages(assets: StoredAsset[]): PackageSummary[] {
  const groups = new Map<string, StoredAsset[]>()
  for (const asset of assets) {
    if (asset.delta) continue
    const key = `${asset.format}\0${asset.name}\0${isSquirrelExe(asset.fileName) ? 'exe' : 'pkg'}`
    groups.set(key, [...(groups.get(key) ?? []), asset])
  }

  return [...groups.values()]
    .map((group) => {
      const newest = group[0] as StoredAsset
      const arches = group.filter((a) => a.version === newest.version).map((a) => a.arch)
      return {
        name: newest.name,
        format: newest.format,
        installer: isSquirrelExe(newest.fileName),
        version: newest.version,
        arches: [...new Set(arches)].sort(),
        versionCount: new Set(group.map((a) => a.version)).size,
        watch: newest.watch,
        tag: newest.tag,
      }
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.format.localeCompare(b.format) || Number(a.installer) - Number(b.installer)
    )
}

function formatLabel(pkg: PackageSummary): string {
  if (pkg.installer) return 'EXE'
  return FORMAT_LABELS[pkg.format]
}

function installCell(origin: string, pkg: PackageSummary): string {
  if (pkg.installer) {
    return pkg.arches
      .map((arch) => {
        const href = `${origin}/squirrel/${pkg.name}/${arch}/Setup.exe`
        const label = pkg.arches.length > 1 ? `${arch} Setup.exe` : 'Setup.exe'
        return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
      })
      .join(', ')
  }
  if (pkg.format === 'android') {
    return pkg.arches
      .map((arch) => {
        const href = `${origin}/android/${pkg.name}/releases/${androidFileName(pkg.name, pkg.version, arch)}`
        const label = pkg.arches.length > 1 ? `${arch} APK` : 'APK'
        return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
      })
      .join(', ')
  }

  const install = installCommand(pkg)
  return install ? `<code>${escapeHtml(install)}</code>` : '<a href="#squirrel">feed URL</a>'
}

function installCommand(pkg: PackageSummary): string | null {
  switch (pkg.format) {
    case 'arch':
      return `sudo pacman -S ${pkg.name}`
    case 'deb':
      return `sudo apt install ${pkg.name}`
    case 'rpm':
      return `sudo dnf install ${pkg.name}`
    case 'squirrel':
      return null
    case 'android':
      return null
    default: {
      const unhandled: never = pkg.format
      throw new Error(`Unknown package format: ${unhandled}`)
    }
  }
}

function pre(text: string): string {
  return `<pre><code>${escapeHtml(text)}</code></pre>`
}

function codeList(items: string[]): string {
  return items.map((i) => `<code>${escapeHtml(i)}</code>`).join(', ')
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
