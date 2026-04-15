#!/usr/bin/env bash
set -euo pipefail

SITE_NAME="vivo-factory"
NGINX_PORT=4311         # external nginx port
APP_PORT=4310           # internal Node.js port
SITES_AVAILABLE="/etc/nginx/sites-available/$SITE_NAME"
SITES_ENABLED="/etc/nginx/sites-enabled/$SITE_NAME"

echo "Creating nginx site config for $SITE_NAME..."

sudo tee "$SITES_AVAILABLE" > /dev/null <<EOF
server {
    listen ${NGINX_PORT};
    server_name _;

    client_max_body_size 50m;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;

        proxy_set_header Host \$host;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

echo "Enabling site..."
sudo ln -sf "$SITES_AVAILABLE" "$SITES_ENABLED"

echo "Testing nginx config..."
sudo nginx -t

echo "Reloading nginx..."
sudo systemctl reload nginx

echo "Done. Vivo Factory dashboard is available on port ${NGINX_PORT}."
