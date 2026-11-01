#!/bin/bash
# Renders the site icons in apps/web/public from bar-chart.svg.
# bar-chart.svg is the Noto Emoji "bar chart" (U+1F4CA), the same glyph the old
# data-URI favicon drew with the system emoji font. Source:
# https://github.com/googlefonts/noto-emoji/blob/main/2D/svg/emoji_u1f4ca.svg
# (Apache License 2.0). Needs ImageMagick 7 (`magick`) with the librsvg delegate.
# Run from the repo root: bash apps/web/icons/build-icons.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/bar-chart.svg"
out="$here/../public"
magick -background none -density 384 "$src" -define icon:auto-resize=48,32,16 "$out/favicon.ico"
magick -background none -density 384 "$src" -resize 192x192 -strip -depth 8 "$out/icon-192.png"
magick -background white -density 384 "$src" -resize 180x180 -flatten -strip -depth 8 "$out/apple-touch-icon.png"
magick -background white -density 384 "$src" -resize 512x512 -flatten -strip -depth 8 "$out/logo-512.png"
