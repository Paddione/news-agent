# dna-client-browser hub: builds the Vue app, then serves it + proxies /api.
FROM node:24-bookworm-slim AS build

WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/dna-cli/package.json apps/dna-cli/
COPY apps/dna-client-browser/package.json apps/dna-client-browser/
COPY apps/dna-client-tui/package.json apps/dna-client-tui/
COPY apps/dna-server-api/package.json apps/dna-server-api/
COPY apps/dna-server-cron/package.json apps/dna-server-cron/
COPY apps/shared/packages/dna-sdk/package.json apps/shared/packages/dna-sdk/
COPY apps/shared/packages/durable-agent/package.json apps/shared/packages/durable-agent/
COPY apps/shared/packages/jev/package.json apps/shared/packages/jev/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build --workspace=dna-client-browser

FROM node:24-bookworm-slim

WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/dna-cli/package.json apps/dna-cli/
COPY apps/dna-client-browser/package.json apps/dna-client-browser/
COPY apps/dna-client-tui/package.json apps/dna-client-tui/
COPY apps/dna-server-api/package.json apps/dna-server-api/
COPY apps/dna-server-cron/package.json apps/dna-server-cron/
COPY apps/shared/packages/dna-sdk/package.json apps/shared/packages/dna-sdk/
COPY apps/shared/packages/durable-agent/package.json apps/shared/packages/durable-agent/
COPY apps/shared/packages/jev/package.json apps/shared/packages/jev/
RUN npm ci --omit=dev --no-audit --no-fund

COPY apps ./apps
COPY shared-app-configuration ./shared-app-configuration
COPY --from=build /src/apps/dna-client-browser/fe/dist ./apps/dna-client-browser/fe/dist

RUN chown -R node:node /src
USER node
ENV NODE_NO_WARNINGS=1 DNA_ENV_FILE=none

EXPOSE 4851
CMD ["node", "--import", "tsx", "apps/dna-client-browser/hub/src/main.ts"]
