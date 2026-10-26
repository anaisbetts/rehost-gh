# rehost-gh

<img width="2067" height="1372" alt="image" src="https://github.com/user-attachments/assets/1fdb8cea-ddc4-47e4-bc80-3eff8ce2eda3" />

--- 


Watches a list of GitHub repos, downloads the packages attached to their releases, and rehosts them as signed
repositories:

- Arch Linux (`.pkg.tar.zst` / `.pkg.tar.xz`), one combined pacman repo per architecture
- Debian / Ubuntu (`.deb`), one combined apt repo
- Fedora / RHEL (`.rpm`), one combined dnf repo per architecture
- Squirrel.Windows (`.nupkg` and installer `.exe` names containing Setup or Install), one feed per app per architecture
- Android (`.apk`), one update feed per application id. See [docs/android-updater.md](docs/android-updater.md) for the JSON format and a Flutter client.

Input is a list of repos, output is a set of URLs you add to your package managers. Packages are passed through as-is;
nothing is converted between formats, and assets in other formats are ignored.

## Running it

```sh
cp .env.example .env              # then fill in GITHUB_TOKEN
mkdir data
cp rehost-gh.example.toml data/rehost-gh.toml   # then list the repos to watch
docker compose up -d
```

The image is `ghcr.io/anaisbetts/rehost-gh` (`linux/amd64`): `latest` tracks published releases, `main` tracks the main
branch.

Open `http://localhost:8080/` for a list of every hosted package with its install command, copy-paste setup
instructions for every published repository, and the sync status of each watched repo. `rehost-gh` only speaks plain HTTP; put TLS in front of it (for example `tailscale serve`).

Edits to `data/rehost-gh.toml` are picked up automatically. "Refresh now" on the index page forces a resync, as does
`docker compose kill -s HUP rehost-gh`.

## The data folder

Everything lives in the one bind-mounted folder, owned by the `UID`/`GID` from `.env`:

| Path             | What                                                                       |
| ---------------- | -------------------------------------------------------------------------- |
| `rehost-gh.toml` | Config, the only file you write                                            |
| `gnupg/`         | Signing key, generated on first start from the token owner's name and email |
| `state.db`       | Releases seen, HTTP cache, downloaded assets                               |
| `downloads/`     | Original release assets                                                    |
| `www`            | Symlink to the currently served `www.<timestamp>/` tree                    |

Back up `gnupg/`: clients trust that key, and losing it means re-trusting a new one everywhere.

## URLs

| Package manager  | URL                                                    |
| ---------------- | ------------------------------------------------------ |
| pacman           | `Server = https://host/arch/$arch`                     |
| apt              | `deb [signed-by=...] https://host/deb stable main`     |
| dnf              | `baseurl=https://host/rpm/$basearch`                   |
| Squirrel.Windows | `https://host/squirrel/<nuspec id>/<x64, arm64 or x86>` (`Setup.exe` lives there too) |
| Android          | `https://host/android/<application id>/android-update.json` (APKs live under `releases/`) |
| Signing key      | `https://host/key.asc`                                 |

Arch packages are signed individually with the rehost-gh key, so pacman's default `SigLevel` works once the key is
trusted. RPMs keep upstream's signatures, so the dnf config uses `repo_gpgcheck=1` with `gpgcheck=0`. Android
`android-update.json` names the newest APK by `versionCode`. Point the Flutter client at that file; [docs/android-updater.md](docs/android-updater.md) has the field list and install flow.

## Development

Needs Bun plus the repository tools. On Arch: `sudo pacman -S --needed apt dpkg createrepo_c rpm-tools`.

```sh
bun install
bun run check              # biome + tsc
bun test                   # unit tests
bun run test:integration   # builds the image and installs packages with real pacman, apt and dnf clients
DATA_DIR=./data GITHUB_TOKEN=$(gh auth token) bun run dev
```
