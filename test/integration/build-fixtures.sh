#!/bin/bash
# Builds a tiny architecture-independent "rehost-fixture" package in every supported format, at two versions, into
# $1/v<version>/. Runs inside the rehost-gh image, which has dpkg-deb, rpmbuild, makepkg and bsdtar.
set -euo pipefail

root=$(realpath "$1")

build_version() {
  local version=$1
  local out="$root/v$version"
  local work
  work=$(mktemp -d)
  mkdir -p "$out"
  cd "$work"

  cat > rehost-fixture <<EOF
#!/bin/sh
echo "rehost fixture $version works"
EOF
  chmod 755 rehost-fixture

  mkdir -p deb/DEBIAN deb/usr/bin
  cp rehost-fixture deb/usr/bin/
  cat > deb/DEBIAN/control <<EOF
Package: rehost-fixture
Version: $version
Architecture: all
Maintainer: rehost-gh <rehost-gh@localhost>
Description: rehost-gh integration test fixture
EOF
  dpkg-deb --root-owner-group --build deb "$out/rehost-fixture_${version}_all.deb"

  mkdir -p rpm/SPECS rpm/SOURCES
  cp rehost-fixture rpm/SOURCES/
  cat > rpm/SPECS/rehost-fixture.spec <<EOF
Name: rehost-fixture
Version: $version
Release: 1
Summary: rehost-gh integration test fixture
License: MIT
BuildArch: noarch

%description
rehost-gh integration test fixture

%install
install -Dm755 %{_sourcedir}/rehost-fixture %{buildroot}/usr/bin/rehost-fixture

%files
/usr/bin/rehost-fixture
EOF
  rpmbuild --quiet --define "_topdir $work/rpm" -bb rpm/SPECS/rehost-fixture.spec
  cp rpm/RPMS/noarch/*.rpm "$out/"

  mkdir arch
  cp rehost-fixture arch/
  cat > arch/PKGBUILD <<EOF
pkgname=rehost-fixture
pkgver=$version
pkgrel=1
pkgdesc='rehost-gh integration test fixture'
arch=(any)
license=(MIT)
options=(!strip !debug)
source=(rehost-fixture)
sha256sums=(SKIP)

package() {
  install -Dm755 "\$srcdir/rehost-fixture" "\$pkgdir/usr/bin/rehost-fixture"
}
EOF
  (cd arch && PKGDEST="$out" PKGEXT=.pkg.tar.zst makepkg --nodeps --noconfirm >/dev/null)

  mkdir nupkg
  cat > nupkg/RehostFixture.nuspec <<EOF
<?xml version="1.0" encoding="utf-8"?>
<package>
  <metadata>
    <id>RehostFixture</id>
    <version>$version</version>
    <authors>rehost-gh</authors>
    <description>rehost-gh integration test fixture</description>
  </metadata>
</package>
EOF
  (cd nupkg && bsdtar --format zip -cf "$out/RehostFixture-$version-arm64-full.nupkg" RehostFixture.nuspec)
  printf 'fake setup %s\n' "$version" > "$out/Setup.exe"

  local version_code
  if [ "$version" = 0.9.0 ]; then version_code=9; else version_code=10; fi
  bun /src/test/integration/build-apk.ts \
    "$out/rehost-fixture-${version}.apk" \
    "$version" \
    "$version_code" \
    "dev.anais.rehostfixture" \
    arm64-v8a
}

build_version 0.9.0
build_version 1.0.0
ls -R "$root"
