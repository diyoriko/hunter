FROM node:22 AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc
RUN npm prune --omit=dev

FROM node:22-slim

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
COPY railway.toml ./
COPY agents/ ./agents/

CMD ["node", "dist/index.js"]
