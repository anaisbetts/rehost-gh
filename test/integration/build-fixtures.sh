#!/bin/bash
# Builds a tiny architecture-independent "rehost-fixture" package in every supported format into $1.
# Runs inside the rehost-gh image, which has dpkg-deb, rpmbuild, makepkg and bsdtar.
set -euo pipefail

out=$(realpath "$1")
work=$(mktemp -d)
cd "$work"

cat > rehost-fixture <<'EOF'
#!/bin/sh
echo "rehost fixture works"
EOF
chmod 755 rehost-fixture

mkdir -p deb/DEBIAN deb/usr/bin
cp rehost-fixture deb/usr/bin/
cat > deb/DEBIAN/control <<'EOF'
Package: rehost-fixture
Version: 1.0.0
Architecture: all
Maintainer: rehost-gh <rehost-gh@localhost>
Description: rehost-gh integration test fixture
EOF
dpkg-deb --root-owner-group --build deb "$out/rehost-fixture_1.0.0_all.deb"

mkdir -p rpm/SPECS rpm/SOURCES
cp rehost-fixture rpm/SOURCES/
cat > rpm/SPECS/rehost-fixture.spec <<'EOF'
Name: rehost-fixture
Version: 1.0.0
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
cat > arch/PKGBUILD <<'EOF'
pkgname=rehost-fixture
pkgver=1.0.0
pkgrel=1
pkgdesc='rehost-gh integration test fixture'
arch=(any)
license=(MIT)
options=(!strip !debug)
source=(rehost-fixture)
sha256sums=(SKIP)

package() {
  install -Dm755 "$srcdir/rehost-fixture" "$pkgdir/usr/bin/rehost-fixture"
}
EOF
(cd arch && PKGDEST="$out" PKGEXT=.pkg.tar.zst makepkg --nodeps --noconfirm >/dev/null)

mkdir nupkg
cat > nupkg/RehostFixture.nuspec <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<package>
  <metadata>
    <id>RehostFixture</id>
    <version>1.0.0</version>
    <authors>rehost-gh</authors>
    <description>rehost-gh integration test fixture</description>
  </metadata>
</package>
EOF
(cd nupkg && bsdtar --format zip -cf "$out/RehostFixture-1.0.0-arm64-full.nupkg" RehostFixture.nuspec)

ls "$out"
