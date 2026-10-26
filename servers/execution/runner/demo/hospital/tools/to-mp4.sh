#!/usr/bin/env bash
# Converts hospital.cast into hospital.mp4: asciinema checks the cast and
# writes its plain-text transcript, agg renders it as a GIF, and ffmpeg
# encodes the GIF as H.264. Needs asciinema 3, agg and ffmpeg with libx264
# on the PATH, on Linux or in WSL; see README.md.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p run

asciinema convert --overwrite hospital.cast run/hospital.txt
agg --font-size 16 --theme asciinema --idle-time-limit 2 \
  hospital.cast run/hospital.gif
# yuv420p and even dimensions, so that every player can show the video;
# CRF 32 keeps the text sharp at about 4 MB
ffmpeg -y -loglevel error -i run/hospital.gif \
  -vf 'scale=trunc(iw/2)*2:trunc(ih/2)*2' \
  -c:v libx264 -preset slow -crf 32 -pix_fmt yuv420p -movflags +faststart \
  hospital.mp4
ls -l hospital.mp4
