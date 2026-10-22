#!/bin/bash
# Nahraje službu Závady vozů na server a zapne časovače.  Použití:  server/deploy.sh root@2.31.44.49
# Na server jde jen tato složka (skript, časovače) a server/.env. Na jiné služby (chatbot) nesahá.
set -euo pipefail
SERVER="${1:?Zadej server, např. server/deploy.sh root@2.31.44.49}"
cd "$(dirname "$0")"
[ -f .env ] || { echo "Chybí server/.env – zkopírujte .env.example na .env a vyplňte ho."; exit 1; }

ssh "$SERVER" 'set -e
export DEBIAN_FRONTEND=noninteractive
if ! command -v pg_dump >/dev/null || ! python3 -c "import openpyxl" 2>/dev/null; then
  apt-get update -qq && apt-get install -y -qq postgresql-client python3-openpyxl >/dev/null
fi
id zavady >/dev/null 2>&1 || useradd --system --home /opt/zavady-server --shell /usr/sbin/nologin zavady
mkdir -p /opt/zavady-server /var/backups/zavady
chown zavady:zavady /var/backups/zavady && chmod 750 /var/backups/zavady'
scp -q zavady.py zavady-backup.service zavady-backup.timer zavady-exports.service zavady-exports.timer "$SERVER":/opt/zavady-server/
scp -q .env "$SERVER":/opt/zavady-server/.env
ssh "$SERVER" 'set -e
cd /opt/zavady-server
mv zavady-*.service zavady-*.timer /etc/systemd/system/
chown -R zavady:zavady /opt/zavady-server && chmod 600 .env
systemctl daemon-reload
systemctl enable --now zavady-backup.timer zavady-exports.timer >/dev/null
echo "── Kontrola spojení ──"
runuser -u zavady -- python3 zavady.py check
echo "── Časovače ──"
systemctl list-timers "zavady-*" --no-pager | head -4'
