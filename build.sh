#!/bin/bash
# Build script for huobao-drama
# Automatically injects git commit hash as BUILD_HASH

cd "$(dirname "$0")"

# Get git short hash
BUILD_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "dev")

echo "Building with BUILD_HASH=$BUILD_HASH"

docker compose build --build-arg BUILD_HASH="$BUILD_HASH" "$@"

echo "Build complete. BUILD_HASH=$BUILD_HASH"
