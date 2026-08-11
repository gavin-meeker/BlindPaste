# Built with the repo root as context — see web/railway.json's dockerfilePath.
#
# The whole point of this stage split: the browser only ever gets static files and
# Caddy. No Node, no npm, no source maps to a dev server — just the build output.

FROM node:24-alpine AS build
WORKDIR /repo/web

# package.json + lockfile only, so editing app code doesn't invalidate this layer.
COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
RUN npm run build

FROM caddy:2-alpine
WORKDIR /srv

COPY web/Caddyfile /etc/caddy/Caddyfile
RUN caddy fmt /etc/caddy/Caddyfile --overwrite

COPY --from=build /repo/web/dist ./

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
