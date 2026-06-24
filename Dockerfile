# Stage 1: Build frontend
FROM node:20-slim AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run generate

# Stage 2: Build backend native modules
FROM node:20-slim AS backend-build

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# Stage 3: Production image
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/* && npm i -g tsx

WORKDIR /app

# Inject build hash from git (passed via ARG during docker compose build)
ARG BUILD_HASH=unknown
RUN echo "${BUILD_HASH}" > BUILD_HASH

COPY --from=backend-build /app/backend/node_modules ./backend/node_modules
COPY backend/package.json backend/package-lock.json ./backend/

COPY backend/src ./backend/src
COPY backend/tsconfig.json ./backend/

COPY --from=frontend-build /app/frontend/.output/public ./frontend/dist

COPY skills/ ./backend/skills/

COPY configs/config.example.yaml ./configs/config.yaml

RUN mkdir -p data/static

ENV NODE_ENV=production
ENV PORT=5679

EXPOSE 5679
VOLUME ["/app/data"]

CMD ["tsx", "backend/src/index.ts"]
