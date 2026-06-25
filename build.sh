#!/bin/bash
set -e

cd /data/huobao-drama
BUILD_HASH=unknown
echo "Building with BUILD_HASH="
docker compose build --build-arg BUILD_HASH=""
