# rehost-gh

Watches a list of GitHub repos, downloads the packages attached to their releases, and rehosts them as signed
repositories:

- Arch Linux (`.pkg.tar.zst` / `.pkg.tar.xz`), one combined pacman repo per architecture
- Debian / Ubuntu (`.deb`), one combined apt repo
- Fedora / RHEL (`.rpm`), one combined dnf repo per architecture
- Squirrel.Windows (`.nupkg`), one feed per app per architecture

Input is a list of repos, output is a set of URLs you add to your package managers.
