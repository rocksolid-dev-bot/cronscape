#!/usr/bin/env bash
# Bounded, re-runnable deploy for the cronscape static app. Runs on the
# HOST, not the project container (POLICY §3 denies the container a Docker
# socket). Every docker command here that names a container uses the
# literal name `cronscape` and nothing else, so a re-run only ever touches
# this app's own container.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

docker build -t cronscape:latest .

docker rm -f cronscape 2>/dev/null || true

docker run -d --name cronscape --restart unless-stopped --memory 1g --cpus 1 --network proxy-network \
  --label traefik.enable=true \
  --label 'traefik.http.routers.cronscape.rule=Host(`cronscape.rs.m-noel.net`)' \
  --label traefik.http.routers.cronscape.entrypoints=https \
  --label traefik.http.routers.cronscape.tls.certresolver=letsencrypt \
  --label traefik.http.services.cronscape.loadbalancer.server.port=80 \
  cronscape:latest
