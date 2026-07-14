# Development image for Meguri (Electron + Vite).
# Goal: pin the toolchain (Node, build tools, Electron runtime libs) so the
# app builds and runs identically across machines. The GUI is shown on the
# host via the Wayland socket shared in docker-compose.yml.
FROM node:22-bookworm-slim

# --- Electron / Chromium runtime libraries + native build toolchain ---------
# build-essential + python3: node-gyp deps to rebuild better-sqlite3.
# The rest are shared libs Chromium dlopen()s at runtime (incl. Wayland/EGL).
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 ca-certificates \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libgbm1 libgtk-3-0 libasound2 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libxkbcommon0 libpango-1.0-0 libcairo2 libatspi2.0-0 \
    libx11-xcb1 libxcb-dri3-0 libglib2.0-0 libxshmfence1 libgl1 libegl1 \
    libwayland-client0 libwayland-cursor0 libwayland-egl1 \
    libgl1-mesa-dri mesa-va-drivers libvulkan1 mesa-vulkan-drivers \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps as a separate layer so source edits don't bust the cache.
# postinstall runs `electron-builder install-app-deps`, which rebuilds
# better-sqlite3 against Electron's ABI. Electron 42 exposes its downloader as
# a bin script rather than an npm lifecycle hook, so fetch the runtime explicitly.
COPY package.json package-lock.json ./
RUN npm ci \
  && ./node_modules/.bin/install-electron

# Pre-create the paths that compose mounts named volumes over, owned by node.
# Docker seeds an empty named volume from the image path (ownership included),
# so the node user can write build output (out/) and app data (.config/).
RUN mkdir -p /app/out /home/node/.config \
  && chown -R node:node /app/out /app/node_modules /home/node/.config

# The Electron SUID sandbox helper must be owned by root with the setuid bit.
# Apply this after the recursive node_modules chown above.
RUN test -f node_modules/electron/dist/chrome-sandbox \
  && chown root:root node_modules/electron/dist/chrome-sandbox \
  && chmod 4755 node_modules/electron/dist/chrome-sandbox

# Run as the unprivileged uid 1000 (matches the host user → shared sockets and
# bind-mounted files keep correct ownership).
USER node

# Tell Electron to use the Wayland Ozone backend (socket shared via compose).
ENV ELECTRON_OZONE_PLATFORM_HINT=wayland

CMD ["npm", "run", "dev"]
