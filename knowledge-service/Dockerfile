# node:22 required — vaultIndex.js uses glob from node:fs/promises (>=22)
# and config.js uses process.loadEnvFile (>=20.6).
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
EXPOSE 8787
USER node

CMD ["node", "src/server.js"]
