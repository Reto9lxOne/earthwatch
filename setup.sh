#!/bin/bash
# ═══════════════════════════════════════════════════════════
# EARTHWATCH — VM Setup Script
# Run once on a fresh Ubuntu 24.04 VM at 10.75.40.13
# Usage: chmod +x setup.sh && ./setup.sh
# ═══════════════════════════════════════════════════════════
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo ""
echo "  🌍 EARTHWATCH Setup"
echo "  ────────────────────────────────────────"
echo ""

# ── Check root ──────────────────────────────────────────
[ "$EUID" -ne 0 ] && err "Please run as root: sudo ./setup.sh"

# ── System update ───────────────────────────────────────
log "Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq

# ── Install Docker ──────────────────────────────────────
if ! command -v docker &> /dev/null; then
  log "Installing Docker..."
  apt-get install -y -qq ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable docker
  log "Docker installed"
else
  log "Docker already installed"
fi

# ── Install Git ─────────────────────────────────────────
if ! command -v git &> /dev/null; then
  apt-get install -y -qq git
fi

# ── Create app user ─────────────────────────────────────
if ! id "earthwatch" &>/dev/null; then
  useradd -m -s /bin/bash earthwatch
  usermod -aG docker earthwatch
  log "Created user 'earthwatch'"
fi

# ── Setup directories ───────────────────────────────────
APP_DIR="/opt/earthwatch"
mkdir -p "$APP_DIR"
chown earthwatch:earthwatch "$APP_DIR"

# ── SSL Certificates ────────────────────────────────────
SSL_DIR="$APP_DIR/nginx/ssl"
mkdir -p "$SSL_DIR"

warn "SSL Certificate setup:"
warn "Place your wildcard cert files in $SSL_DIR/"
warn "  fullchain.pem  (certificate + chain)"
warn "  privkey.pem    (private key)"
echo ""
warn "For *.9lx.ch wildcard cert, copy from your cert provider or existing server:"
warn "  scp user@certserver:/path/to/fullchain.pem $SSL_DIR/"
warn "  scp user@certserver:/path/to/privkey.pem   $SSL_DIR/"
echo ""

# ── Static IP ───────────────────────────────────────────
log "Configuring static IP 10.75.40.13..."
cat > /etc/netplan/01-earthwatch.yaml << 'EOF'
network:
  version: 2
  ethernets:
    eth0:
      addresses:
        - 10.75.40.13/24
      routes:
        - to: default
          via: 10.75.40.1
      nameservers:
        addresses: [10.75.40.1, 1.1.1.1]
EOF
chmod 600 /etc/netplan/01-earthwatch.yaml
netplan apply 2>/dev/null || warn "Netplan apply failed — check network interface name (may not be eth0)"

# ── Firewall ────────────────────────────────────────────
if command -v ufw &> /dev/null; then
  log "Configuring firewall..."
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow from 10.75.0.0/16 to any port 22    comment "SSH from internal"
  ufw allow 80/tcp   comment "HTTP"
  ufw allow 443/tcp  comment "HTTPS"
  ufw --force enable
  log "Firewall configured"
fi

# ── Clone / update repo ─────────────────────────────────
echo ""
warn "Next steps:"
echo ""
echo "  1. Clone your repo to $APP_DIR:"
echo "     cd $APP_DIR"
echo "     git clone https://github.com/YOUR_USERNAME/earthwatch ."
echo ""
echo "  2. Create .env from template:"
echo "     cp .env.example .env"
echo "     nano .env   # fill in passwords + Telegram tokens"
echo ""
echo "  3. Copy SSL certs to nginx/ssl/"
echo ""
echo "  4. Start the stack:"
echo "     docker compose up -d"
echo ""
echo "  5. Check logs:"
echo "     docker compose logs -f"
echo ""
echo "  Dashboard: https://earthwatch.9lx.ch"
echo "  Grafana:   https://grafana.9lx.ch"
echo ""
log "Setup complete! Follow steps above to finish."
