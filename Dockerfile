FROM oven/bun:1-debian

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    apt-utils \
    ca-certificates \
    createrepo-c \
    dpkg \
    gnupg \
    libarchive-tools \
    makepkg \
    pacman-package-manager \
    rpm \
    xz-utils \
    zstd \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile
COPY src ./src

# The container usually runs as the host user's UID, which has no home directory in the image.
ENV HOME=/tmp \
  DATA_DIR=/data \
  PORT=8080 \
  DEBUG=rehost-gh:*,-rehost-gh:exec

EXPOSE 8080
VOLUME /data
CMD ["bun", "run", "src/index.ts"]
