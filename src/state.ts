import { Database } from 'bun:sqlite'
import type { PackageFormat, PackageInfo } from './package'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS http_cache (
  url TEXT PRIMARY KEY,
  etag TEXT NOT NULL,
  body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  asset_id INTEGER PRIMARY KEY,
  watch TEXT NOT NULL,
  tag TEXT NOT NULL,
  published_at TEXT NOT NULL,
  file_name TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha1 TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  format TEXT NOT NULL,
  pkg_name TEXT NOT NULL,
  version TEXT NOT NULL,
  arch TEXT NOT NULL,
  delta INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS assets_by_watch ON assets (watch);

CREATE TABLE IF NOT EXISTS rejected_assets (
  asset_id INTEGER PRIMARY KEY,
  watch TEXT NOT NULL,
  reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watch_status (
  watch TEXT PRIMARY KEY,
  last_sync_at TEXT,
  last_success_at TEXT,
  last_error TEXT
);
`

export interface StoredAsset extends PackageInfo {
  /** GitHub's numeric release asset id, stable across renames. */
  assetId: number
  /** `owner/name` of the watched repo. */
  watch: string
  tag: string
  /** ISO timestamp of the release, used to order versions. */
  publishedAt: string
  fileName: string
  /** Path relative to the downloads directory. */
  path: string
  size: number
  sha1: string
  sha256: string
}

export interface WatchStatus {
  watch: string
  lastSyncAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
}

interface AssetRow {
  asset_id: number
  watch: string
  tag: string
  published_at: string
  file_name: string
  path: string
  size: number
  sha1: string
  sha256: string
  format: string
  pkg_name: string
  version: string
  arch: string
  delta: number
}

interface StatusRow {
  watch: string
  last_sync_at: string | null
  last_success_at: string | null
  last_error: string | null
}

export class State {
  private readonly db: Database

  constructor(path: string) {
    this.db = new Database(path, { create: true, strict: true })
    this.db.run('PRAGMA journal_mode = WAL')
    this.db.run(SCHEMA)
  }

  close() {
    this.db.close()
  }

  getCached(url: string): { etag: string; body: string } | null {
    return this.db
      .query<{ etag: string; body: string }, [string]>('SELECT etag, body FROM http_cache WHERE url = ?')
      .get(url)
  }

  putCached(url: string, etag: string, body: string) {
    this.db.query('INSERT OR REPLACE INTO http_cache (url, etag, body) VALUES (?, ?, ?)').run(url, etag, body)
  }

  isKnownAsset(assetId: number): boolean {
    const hit =
      this.db
        .query('SELECT 1 FROM assets WHERE asset_id = ?1 UNION SELECT 1 FROM rejected_assets WHERE asset_id = ?1')
        .get(assetId) !== null
    return hit
  }

  addAsset(asset: StoredAsset) {
    this.db
      .query(
        `INSERT OR REPLACE INTO assets
          (asset_id, watch, tag, published_at, file_name, path, size, sha1, sha256, format, pkg_name, version, arch, delta)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        asset.assetId,
        asset.watch,
        asset.tag,
        asset.publishedAt,
        asset.fileName,
        asset.path,
        asset.size,
        asset.sha1,
        asset.sha256,
        asset.format,
        asset.name,
        asset.version,
        asset.arch,
        asset.delta ? 1 : 0
      )
  }

  rejectAsset(assetId: number, watch: string, reason: string) {
    this.db
      .query('INSERT OR REPLACE INTO rejected_assets (asset_id, watch, reason) VALUES (?, ?, ?)')
      .run(assetId, watch, reason)
  }

  removeAsset(assetId: number) {
    this.db.query('DELETE FROM assets WHERE asset_id = ?').run(assetId)
  }

  assets(watch?: string): StoredAsset[] {
    const rows =
      watch === undefined
        ? this.db.query<AssetRow, []>('SELECT * FROM assets ORDER BY published_at DESC, asset_id DESC').all()
        : this.db
            .query<AssetRow, [string]>('SELECT * FROM assets WHERE watch = ? ORDER BY published_at DESC, asset_id DESC')
            .all(watch)
    return rows.map(rowToAsset)
  }

  /** Drops everything recorded for watches no longer in the config, returning the assets that were dropped. */
  forgetWatchesExcept(watches: string[]): StoredAsset[] {
    const keep = new Set(watches)
    const dropped = this.assets().filter((a) => !keep.has(a.watch))
    const all = this.db.query<{ watch: string }, []>('SELECT watch FROM watch_status').all()

    this.db.transaction(() => {
      for (const a of dropped) this.removeAsset(a.assetId)
      for (const { watch } of all) {
        if (keep.has(watch)) continue
        this.db.query('DELETE FROM watch_status WHERE watch = ?').run(watch)
        this.db.query('DELETE FROM rejected_assets WHERE watch = ?').run(watch)
      }
    })()

    return dropped
  }

  recordSync(watch: string, error: string | null) {
    const now = new Date().toISOString()
    this.db
      .query(
        `INSERT INTO watch_status (watch, last_sync_at, last_success_at, last_error) VALUES (?1, ?2, ?3, ?4)
          ON CONFLICT (watch) DO UPDATE SET
            last_sync_at = ?2,
            last_success_at = COALESCE(?3, last_success_at),
            last_error = ?4`
      )
      .run(watch, now, error === null ? now : null, error)
  }

  statuses(): WatchStatus[] {
    return this.db
      .query<StatusRow, []>('SELECT * FROM watch_status ORDER BY watch')
      .all()
      .map((r) => ({
        watch: r.watch,
        lastSyncAt: r.last_sync_at,
        lastSuccessAt: r.last_success_at,
        lastError: r.last_error,
      }))
  }
}

function rowToAsset(r: AssetRow): StoredAsset {
  return {
    assetId: r.asset_id,
    watch: r.watch,
    tag: r.tag,
    publishedAt: r.published_at,
    fileName: r.file_name,
    path: r.path,
    size: r.size,
    sha1: r.sha1,
    sha256: r.sha256,
    format: r.format as PackageFormat,
    name: r.pkg_name,
    version: r.version,
    arch: r.arch,
    delta: r.delta === 1,
  }
}
