#!/bin/bash
set -e

echo "Starting deployment for Rasalytics Website & API..."

# Detect directories
if [ -d apps/web ]; then
    ROOT_DIR="."
    WEB_DIR="apps/web"
    WORKER_DIR="apps/worker"
else
    ROOT_DIR="../.."
    WEB_DIR="."
    WORKER_DIR="../worker"
fi

# 1. Validate required tools
if ! command -v bun &> /dev/null; then
    echo "Error: bun is required but not installed."
    exit 1
fi

if ! command -v bunx &> /dev/null; then
    echo "Error: bunx is required."
    exit 1
fi

WRANGLER="bunx wrangler"

# 2. Check if logged in
if ! $WRANGLER whoami > /dev/null 2>&1; then
    echo "Error: Not logged into Cloudflare. Please run 'bunx wrangler login' first or set CLOUDFLARE_API_TOKEN."
    exit 1
fi

echo "Environment validation passed."

echo "Installing dependencies..."
bun install

echo "Deploying Cloudflare Worker (Backend API)..."
ENV_FILE="$ROOT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    echo "Found .env file, pushing secrets to Cloudflare Worker..."
    # Extract YOUTUBE_API_KEY from env and push as secret
    YT_KEY=$(grep '^YOUTUBE_API_KEY=' "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
    if [ ! -z "$YT_KEY" ]; then
        echo "$YT_KEY" | $WRANGLER secret put YOUTUBE_API_KEY --name rasalytics-api --config "$WORKER_DIR/wrangler.toml"
        echo "Secret YOUTUBE_API_KEY pushed to worker."
    fi
else
    echo "Warning: No .env file found. Make sure YOUTUBE_API_KEY is configured in the worker if using the Video API."
fi

$WRANGLER deploy "$WORKER_DIR/worker.ts" --config "$WORKER_DIR/wrangler.toml" --name rasalytics-api

echo "Deploying Cloudflare Pages (Frontend)..."
bunx wrangler@3 pages deploy "$WEB_DIR/public" --project-name rasalytics-web --branch master --commit-dirty=true

echo "Deployment complete!"
