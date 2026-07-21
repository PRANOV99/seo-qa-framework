# syntax=docker/dockerfile:1

# ──────────────────────────────────────────────────────────────────────────
# Stage 1: build — type-check and compile TypeScript to dist/.
# A plain Node image is enough here; no browser is ever launched at build
# time, so this stage doesn't need Playwright's browsers or OS deps at all.
# ──────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ──────────────────────────────────────────────────────────────────────────
# Stage 2: runtime — Microsoft's official Playwright image.
#
# This is the actual fix for the Render deploy failure. Chromium, Firefox,
# WebKit, and every OS-level shared library they need (libnss3, libatk,
# fonts, etc.) are already installed in this image at /ms-playwright. There
# is no `npx playwright install` / `--with-deps` step to run at all:
#   - nothing needs apt/root at deploy time (that's what caused the
#     "Authentication failure" when --with-deps was tried on Render Free)
#   - nothing can go missing between the build step and the running
#     container (that's what caused "Executable doesn't exist" before)
#
# IMPORTANT: keep this tag's version in lockstep with the `playwright` /
# `@playwright/test` versions pinned in package.json. A mismatch between
# the npm package and this image is the documented #1 cause of
# "Executable doesn't exist" errors with this approach. If you bump one,
# bump the other to match, e.g.:
#   npm install --save-exact playwright@1.62.0 @playwright/test@1.62.0
#   FROM mcr.microsoft.com/playwright:v1.62.0-noble
# ──────────────────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app
ENV NODE_ENV=production

# The base image already ships browsers at /ms-playwright and already
# points PLAYWRIGHT_BROWSERS_PATH there itself. Do NOT set or override
# PLAYWRIGHT_BROWSERS_PATH here or in render.yaml — doing so tells
# Playwright to look somewhere else and reintroduces this exact bug.
#
# Skip the `playwright`/`@playwright/test` postinstall browser download:
# the browsers are already in this image, so downloading them again would
# only waste build time and bandwidth for nothing.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3001
CMD ["node", "dist/api/server.js"]
