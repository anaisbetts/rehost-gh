import type { Manifest } from './publish'
import type { WatchStatus } from './state'

const STYLE = `
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; color: #222; }
  pre { background: #f4f4f4; padding: 0.75rem 1rem; overflow-x: auto; border-radius: 4px; }
  code { font: 13px ui-monospace, monospace; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 0.3rem 0.6rem; border-bottom: 1px solid #ddd; vertical-align: top; }
  .error { color: #b00020; white-space: pre-wrap; }
  .muted { color: #777; }
  @media (prefers-color-scheme: dark) {
    body { background: #161616; color: #ddd; }
    pre { background: #222; }
    th, td { border-color: #333; }
    .error { color: #ff6b81; }
  }
`

export interface WatchSummary {
  repo: string
  packages: number
  status: WatchStatus | null
}

/** Status of every watched repo, plus copy-paste setup for each published repository. */
export function renderIndexPage(origin: string, manifest: Manifest | null, watches: WatchSummary[]): string {
  const sections = manifest
    ? [
        keySection(origin, manifest),
        archSection(origin, manifest),
        debSection(origin, manifest),
        rpmSection(origin, manifest),
        squirrelSection(origin, manifest),
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
    .map(
      (f) =>
        `<tr><td>${escapeHtml(f.id)}</td><td>${escapeHtml(f.arch)}</td><td><code>${escapeHtml(`${origin}/squirrel/${f.id}/${f.arch}`)}</code></td></tr>`
    )
    .join('\n')
  return `<h2>Squirrel.Windows</h2>
<p>Point <code>UpdateManager</code> at the feed URL.</p>
<table><tr><th>App</th><th>Arch</th><th>Feed URL</th></tr>
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

function pre(text: string): string {
  return `<pre><code>${escapeHtml(text)}</code></pre>`
}

function codeList(items: string[]): string {
  return items.map((i) => `<code>${escapeHtml(i)}</code>`).join(', ')
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
