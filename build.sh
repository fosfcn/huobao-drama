#!/bin/bash
set -e

cd /data/huobao-drama
BUILD_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
echo "$BUILD_HASH" > BUILD_HASH
echo "Building with BUILD_HASH=$BUILD_HASH"
docker compose build --build-arg BUILD_HASH="$BUILD_HASH"
docker compose up -d
