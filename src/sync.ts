import { rm, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import debug from 'debug'
import type { Config, WatchConfig } from './config'
import { formatFromFileName, inspectPackage } from './detect'
import type { GitHubClient, Release, ReleaseAsset } from './github'
import type { State, StoredAsset } from './state'

const d = debug('rehost-gh:sync')

const POLL_JITTER = 0.25

/**
 * Polls every watched repo on a jittered timer, keeps the downloads directory in step with GitHub, and calls
 * `publish` whenever the set of stored packages changes. All work is serialized, so publishing never races a sync.
 */
export class Syncer {
  private config: Config | null = null
  private queue: Promise<void> = Promise.resolve()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly state: State,
    private readonly github: GitHubClient,
    private readonly downloadsDir: string,
    private readonly publish: (config: Config) => Promise<void>
  ) {}

  /** Applies a (new) config: forgets removed watches, syncs everything, publishes, then restarts the timers. */
  setConfig(config: Config): Promise<void> {
    this.config = config
    return this.syncAll()
  }

  /** Syncs every watch right now and always republishes. */
  syncAll(): Promise<void> {
    return this.enqueue(async () => {
      const config = this.requireConfig()
      this.clearTimers()

      const forgotten = this.state.forgetWatchesExcept(config.watches.map((w) => w.repo))
      await deleteDownloads(this.downloadsDir, forgotten)

      for (const watch of config.watches) await this.syncWatch(watch)
      await this.publishSafely(config)

      for (const watch of config.watches) this.schedule(watch)
    })
  }

  stop() {
    this.clearTimers()
  }

  private async syncWatch(watch: WatchConfig): Promise<boolean> {
    try {
      const changed = await syncWatch(watch, this.state, this.github, this.downloadsDir)
      this.state.recordSync(watch.repo, null)
      return changed
    } catch (e) {
      const message = (e as Error).message
      console.error(`Syncing ${watch.repo} failed: ${message}`)
      this.state.recordSync(watch.repo, message)
      return false
    }
  }

  private schedule(watch: WatchConfig) {
    const config = this.requireConfig()
    const delay = config.pollIntervalMs * (1 - POLL_JITTER + Math.random() * POLL_JITTER * 2)
    d('next poll of %s in %ds', watch.repo, Math.round(delay / 1000))

    this.timers.set(
      watch.repo,
      setTimeout(() => {
        this.enqueue(async () => {
          if (this.config !== config) return
          if (await this.syncWatch(watch)) await this.publishSafely(config)
          this.schedule(watch)
        })
      }, delay)
    )
  }

  private async publishSafely(config: Config) {
    try {
      await this.publish(config)
    } catch (e) {
      console.error(`Publishing failed: ${(e as Error).message}`)
    }
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(work, work)
    return this.queue
  }

  private clearTimers() {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  private requireConfig(): Config {
    if (!this.config) throw new Error('Syncer has no config yet')
    return this.config
  }
}

/** Downloads new packages for one watch and prunes old ones. Returns whether anything changed. */
export async function syncWatch(
  watch: WatchConfig,
  state: State,
  github: GitHubClient,
  downloadsDir: string
): Promise<boolean> {
  const releases = selectReleases(await github.listReleases(watch.owner, watch.name), watch)
  let changed = false

  for (const release of releases) {
    for (const asset of release.assets) {
      if (!assetMatches(asset.name, watch) || state.isKnownAsset(asset.id)) continue
      await fetchAsset(watch, release, asset, state, github, downloadsDir)
      changed = true
    }
  }

  const dropped = planRetention(state.assets(watch.repo), watch.keep)
  for (const asset of dropped) state.removeAsset(asset.assetId)
  await deleteDownloads(downloadsDir, dropped)

  if (dropped.length > 0) d('%s: pruned %d old assets', watch.repo, dropped.length)
  return changed || dropped.length > 0
}

/**
 * The newest `keep` published releases that have at least one matching asset. Older releases can't contribute a
 * version that survives retention, so they're never downloaded.
 */
export function selectReleases(releases: Release[], watch: WatchConfig): Release[] {
  return releases
    .filter((r) => !r.draft && r.published_at && (watch.prereleases || !r.prerelease))
    .filter((r) => r.assets.some((a) => assetMatches(a.name, watch)))
    .sort((a, b) => b.published_at!.localeCompare(a.published_at!))
    .slice(0, watch.keep)
}

export function assetMatches(fileName: string, watch: WatchConfig): boolean {
  if (!formatFromFileName(fileName)) return false
  if (watch.include.length > 0 && !watch.include.some((g) => new Bun.Glob(g).match(fileName))) return false
  return !watch.exclude.some((g) => new Bun.Glob(g).match(fileName))
}

/** Assets to drop so each package (format, name, architecture) keeps only its newest `keep` versions. */
export function planRetention(assets: StoredAsset[], keep: number): StoredAsset[] {
  const byPackage = new Map<string, StoredAsset[]>()
  for (const asset of assets) {
    const key = `${asset.format}\0${asset.name}\0${asset.arch}`
    byPackage.set(key, [...(byPackage.get(key) ?? []), asset])
  }

  const dropped: StoredAsset[] = []
  for (const group of byPackage.values()) {
    group.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.assetId - a.assetId)
    const kept = new Set([...new Set(group.map((a) => a.version))].slice(0, keep))
    dropped.push(...group.filter((a) => !kept.has(a.version)))
  }

  return dropped
}

async function fetchAsset(
  watch: WatchConfig,
  release: Release,
  asset: ReleaseAsset,
  state: State,
  github: GitHubClient,
  downloadsDir: string
) {
  const format = formatFromFileName(asset.name)!
  const path = join(watch.owner, watch.name, safeSegment(release.tag_name), safeSegment(asset.name))
  const fullPath = join(downloadsDir, path)

  console.log(`Downloading ${watch.repo} ${release.tag_name} ${asset.name}`)
  const download = await github.downloadAsset(watch.owner, watch.name, asset.id, fullPath)

  try {
    const info = await inspectPackage(fullPath, asset.name, format)
    state.addAsset({
      ...info,
      assetId: asset.id,
      watch: watch.repo,
      tag: release.tag_name,
      publishedAt: release.published_at!,
      fileName: asset.name,
      path,
      ...download,
    })
  } catch (e) {
    const reason = (e as Error).message
    console.error(`Skipping ${asset.name} from ${watch.repo}: ${reason}`)
    state.rejectAsset(asset.id, watch.repo, reason)
    await rm(fullPath, { force: true })
  }
}

async function deleteDownloads(downloadsDir: string, assets: StoredAsset[]) {
  for (const asset of assets) {
    const fullPath = join(downloadsDir, asset.path)
    await rm(fullPath, { force: true })
    await rm(`${fullPath}.sig`, { force: true })
    await rmdir(dirname(fullPath)).catch(() => {})
  }
}

function safeSegment(segment: string): string {
  const cleaned = segment.replace(/[/\\\0]/g, '_')
  return cleaned === '.' || cleaned === '..' ? `_${cleaned}` : cleaned
}
