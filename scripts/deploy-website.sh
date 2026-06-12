#!/bin/bash
set -e

echo "Starting deployment for Rasalytics Website & API..."

# 1. Validate required tools
if ! command -v bun &> /dev/null; then
    echo "Error: bun is required but not installed."
    exit 1
fi

if ! command -v bunx &> /dev/null; then
    echo "Error: bunx is required."
    exit 1
fi

WRANGLER="/usr/bin/node node_modules/.bin/wrangler"

# 2. Check if logged in
if ! $WRANGLER whoami > /dev/null 2>&1; then
    echo "Error: Not logged into Cloudflare. Please run 'bunx wrangler login' first or set CLOUDFLARE_API_TOKEN."
    exit 1
fi

echo "Environment validation passed."

echo "Installing dependencies..."
bun install

echo "Deploying Cloudflare Worker (Backend API)..."
if [ -f .env ]; then
    echo "Found .env file, pushing secrets to Cloudflare Worker..."
    # Extract YOUTUBE_API_KEY from .env and push as secret
    YT_KEY=$(grep '^YOUTUBE_API_KEY=' .env | cut -d '=' -f2- | tr -d '"' | tr -d "'")
    if [ ! -z "$YT_KEY" ]; then
        echo "$YT_KEY" | $WRANGLER secret put YOUTUBE_API_KEY --name rasalytics-api
        echo "Secret YOUTUBE_API_KEY pushed to worker."
    fi
else
    echo "Warning: No .env file found. Make sure YOUTUBE_API_KEY is configured in the worker if using the Video API."
fi

$WRANGLER deploy src/worker.ts --name rasalytics-api

echo "Deploying Cloudflare Pages (Frontend)..."
bunx wrangler@3 pages deploy public --project-name rasalytics-web --branch master --commit-dirty=true

echo "Deployment complete!"
