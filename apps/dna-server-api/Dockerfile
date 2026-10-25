# dna-server-api (+ cron tick): runs TypeScript directly via tsx.
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

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

RUN chown -R node:node /src
USER node
ENV NODE_NO_WARNINGS=1 DNA_ENV_FILE=none

EXPOSE 4850
CMD ["node", "--import", "tsx", "apps/dna-server-api/src/main.ts"]
