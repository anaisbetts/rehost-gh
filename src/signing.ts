import { chmod, mkdir } from 'node:fs/promises'
import debug from 'debug'
import { exec } from './exec'
import type { Identity } from './github'

const d = debug('rehost-gh:signing')

/** Wraps a dedicated, passphrase-less gpg home holding the one key every repository is signed with. */
export class Signer {
  private constructor(
    readonly gnupgHome: string,
    readonly fingerprint: string
  ) {}

  /** Opens the gpg home, generating an Ed25519 signing key the first time. */
  static async open(gnupgHome: string, identity: () => Promise<Identity>): Promise<Signer> {
    await mkdir(gnupgHome, { recursive: true })
    await chmod(gnupgHome, 0o700)

    let fingerprint = await findSecretKey(gnupgHome)
    if (!fingerprint) {
      const { name, email } = await identity()
      const uid = `${name} <${email}>`
      console.log(`Generating signing key for ${uid}`)

      await gpg(gnupgHome, ['--passphrase', '', '--quick-gen-key', uid, 'ed25519', 'sign', 'never'])
      fingerprint = await findSecretKey(gnupgHome)
      if (!fingerprint) throw new Error('gpg did not create a key')
    }

    d('signing with %s', fingerprint)
    return new Signer(gnupgHome, fingerprint)
  }

  /** Environment for tools like `repo-add --sign` that call gpg themselves. */
  get env(): Record<string, string> {
    return { GNUPGHOME: this.gnupgHome, GPGKEY: this.fingerprint }
  }

  async exportPublicKey(): Promise<string> {
    return gpg(this.gnupgHome, ['--armor', '--export', this.fingerprint])
  }

  async detachSign(file: string, output: string, armor: boolean) {
    await gpg(this.gnupgHome, [
      '--local-user',
      this.fingerprint,
      armor ? '--armor' : '--no-armor',
      '--output',
      output,
      '--detach-sign',
      file,
    ])
  }

  async clearSign(file: string, output: string) {
    await gpg(this.gnupgHome, ['--local-user', this.fingerprint, '--output', output, '--clearsign', file])
  }
}

async function findSecretKey(gnupgHome: string): Promise<string | null> {
  const out = await gpg(gnupgHome, ['--with-colons', '--list-secret-keys'])
  const fpr = out.split('\n').find((line) => line.startsWith('fpr:'))
  return fpr?.split(':')[9] || null
}

function gpg(gnupgHome: string, args: string[]): Promise<string> {
  return exec(['gpg', '--batch', '--yes', '--pinentry-mode', 'loopback', ...args], { env: { GNUPGHOME: gnupgHome } })
}
