import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { exec } from '../../src/exec'
import type { Manifest } from '../../src/publish'

const RUN = Boolean(process.env.RUN_INTEGRATION_TESTS)
const ROOT = resolve(import.meta.dir, '../..')
const WORK = join(import.meta.dir, '.work')
const IMAGE = 'rehost-gh:integration'
const NAME = `rehost-it-${process.pid}`
const SETUP_TIMEOUT_MS = 10 * 60 * 1000
const CLIENT_TIMEOUT_MS = 5 * 60 * 1000
const PUBLISH_WAIT_MS = 2 * 60 * 1000
const USER = `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`
const LATEST_OUTPUT = 'rehost fixture 1.0.0 works'

const PACMAN_SCRIPT = (fingerprint: string) => `
set -euxo pipefail
pacman-key --init
pacman-key --add /key.asc
pacman-key --lsign-key ${fingerprint}
cat > /tmp/pacman.conf <<'EOF'
[options]
Architecture = auto
SigLevel = Required DatabaseRequired

[rehost-gh]
Server = http://rehost:8080/arch/$arch
EOF
pacman --config /tmp/pacman.conf -Sy --noconfirm rehost-fixture
rehost-fixture
`

const APT_SCRIPT = `
set -euxo pipefail
rm -f /etc/apt/sources.list /etc/apt/sources.list.d/*
install -d /etc/apt/keyrings
cp /key.asc /etc/apt/keyrings/rehost-gh.asc
echo "deb [signed-by=/etc/apt/keyrings/rehost-gh.asc] http://rehost:8080/deb stable main" > /etc/apt/sources.list.d/rehost-gh.list
apt-get update
apt-get install -y rehost-fixture
rehost-fixture
`

const DNF_SCRIPT = `
set -euxo pipefail
cat > /etc/yum.repos.d/rehost-gh.repo <<'EOF'
[rehost-gh]
name=rehost-gh
baseurl=http://rehost:8080/rpm/$basearch
enabled=1
gpgcheck=0
repo_gpgcheck=1
gpgkey=http://rehost:8080/key.asc
EOF
dnf -y --disablerepo='*' --enablerepo=rehost-gh install rehost-fixture
rehost-fixture
`

describe.skipIf(!RUN)('real package manager clients', () => {
  let baseUrl = ''
  let manifest: Manifest

  beforeAll(async () => {
    await rm(WORK, { recursive: true, force: true })
    await mkdir(join(WORK, 'fixtures'), { recursive: true })
    await mkdir(join(WORK, 'data'), { recursive: true })
    await Bun.write(join(WORK, 'data', 'rehost-gh.toml'), '[[watch]]\nrepo = "fixture/app"\n')

    await docker('build', '-q', '-t', IMAGE, ROOT)
    await docker(
      'run',
      '--rm',
      '--user',
      USER,
      '-e',
      'HOME=/tmp',
      '-v',
      `${ROOT}:/src:ro`,
      '-v',
      `${join(WORK, 'fixtures')}:/out`,
      IMAGE,
      'bash',
      '/src/test/integration/build-fixtures.sh',
      '/out'
    )

    await docker('network', 'create', NAME)
    await docker(
      'run',
      '-d',
      '--name',
      `${NAME}-github`,
      '--network',
      NAME,
      '--network-alias',
      'github',
      '-e',
      'PORT=3000',
      '-v',
      `${ROOT}:/src:ro`,
      '-v',
      `${join(WORK, 'fixtures')}:/fixtures:ro`,
      IMAGE,
      'bun',
      'run',
      '/src/test/integration/fake-github.ts'
    )
    await docker(
      'run',
      '-d',
      '--name',
      `${NAME}-rehost`,
      '--network',
      NAME,
      '--network-alias',
      'rehost',
      '--user',
      USER,
      '-e',
      'GITHUB_TOKEN=fake-token',
      '-e',
      'GITHUB_API_URL=http://github:3000',
      '-v',
      `${join(WORK, 'data')}:/data`,
      '-p',
      '127.0.0.1::8080',
      IMAGE
    )

    const port = (await docker('port', `${NAME}-rehost`, '8080')).trim().split('\n')[0]!.split(':').pop()
    baseUrl = `http://127.0.0.1:${port}`
    manifest = await waitForPublish(baseUrl)
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    if (process.env.KEEP_INTEGRATION_CONTAINERS) return
    await docker('rm', '-f', `${NAME}-github`, `${NAME}-rehost`).catch(() => {})
    await docker('network', 'rm', NAME).catch(() => {})
  })

  test('publishes every format', () => {
    expect(manifest.arch).toEqual(['x86_64', 'aarch64'])
    expect(manifest.deb).toEqual(['amd64', 'arm64'])
    expect(manifest.rpm).toEqual(['x86_64', 'aarch64'])
    expect(manifest.squirrel).toEqual([{ id: 'RehostFixture', arch: 'arm64', setup: true }])
  })

  test('generates the signing key from the token owner', async () => {
    const keys = await docker('exec', `${NAME}-rehost`, 'gpg', '--homedir', '/data/gnupg', '--list-keys')
    expect(keys).toContain('Fixture Bot <fixture@users.noreply.github.com>')
  })

  test(
    'pacman installs from the Arch repo',
    async () => {
      expect(await client('archlinux:latest', PACMAN_SCRIPT(manifest.fingerprint))).toContain(LATEST_OUTPUT)
    },
    CLIENT_TIMEOUT_MS
  )

  test(
    'apt installs from the Debian repo',
    async () => {
      expect(await client('debian:trixie', APT_SCRIPT)).toContain(LATEST_OUTPUT)
    },
    CLIENT_TIMEOUT_MS
  )

  test(
    'dnf installs from the RPM repo',
    async () => {
      expect(await client('fedora:latest', DNF_SCRIPT)).toContain(LATEST_OUTPUT)
    },
    CLIENT_TIMEOUT_MS
  )

  test('serves a Squirrel feed that matches its packages', async () => {
    const feed = `${baseUrl}/squirrel/RehostFixture/arm64`
    const entries = (await (await fetch(`${feed}/RELEASES`)).text())
      .trim()
      .split('\r\n')
      .map((line) => line.split(' '))

    expect(entries.map(([, fileName]) => fileName)).toEqual([
      'RehostFixture-0.9.0-full.nupkg',
      'RehostFixture-1.0.0-full.nupkg',
    ])
    for (const [sha1, fileName, size] of entries) {
      const body = await (await fetch(`${feed}/${fileName}`)).bytes()
      expect(body.length).toBe(Number(size))
      expect(new Bun.CryptoHasher('sha1').update(body).digest('hex').toUpperCase()).toBe(sha1!)
    }

    expect(await (await fetch(`${feed}/Setup.exe`)).text()).toBe('fake setup 1.0.0\n')
    expect(await (await fetch(`${feed}/RehostFixture-1.0.0-Setup.exe`)).text()).toBe('fake setup 1.0.0\n')
    expect(await (await fetch(`${feed}/RehostFixture-0.9.0-Setup.exe`)).text()).toBe('fake setup 0.9.0\n')
  })
})

async function client(image: string, script: string): Promise<string> {
  return docker(
    'run',
    '--rm',
    '--network',
    NAME,
    '-v',
    `${join(WORK, 'data', 'www', 'key.asc')}:/key.asc:ro`,
    image,
    'bash',
    '-c',
    script
  )
}

async function waitForPublish(baseUrl: string): Promise<Manifest> {
  const deadline = Date.now() + PUBLISH_WAIT_MS
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/repos.json`).catch(() => null)
    if (response?.ok) return (await response.json()) as Manifest
    await Bun.sleep(1000)
  }

  const logs = await exec(['sh', '-c', `docker logs ${NAME}-rehost 2>&1`]).catch((e) => (e as Error).message)
  throw new Error(`rehost-gh never published:\n${logs}`)
}

function docker(...args: string[]): Promise<string> {
  return exec(['docker', ...args])
}
