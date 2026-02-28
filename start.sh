#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# VYKE IDE – Script de lancement
#
# Priorité du port (du plus fort au plus faible) :
#   1. Argument CLI :   ./start.sh 9999
#   2. Variable env :   VYKE_PORT=9999 ./start.sh
#   3. Fichier .env :   VYKE_PORT=4242  (généré par setup.sh)
#   4. Défaut codé :    4242
# ═══════════════════════════════════════════════════════════════════
set -e

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; DIM='\033[2m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
ENV_FILE="$SCRIPT_DIR/.env"

# ── Charger .env (si présent) ─────────────────────────────────────────────────
if [ -f "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
else
    echo -e "${YELLOW}[!]${NC} Aucun fichier .env trouvé — utilisation des valeurs par défaut"
    echo -e "    Lance ${YELLOW}./setup.sh${NC} pour configurer Vyke proprement."
fi

# ── Résolution du port (priorité CLI > env courant > .env > défaut) ────────────
#   $1           = argument CLI
#   $VYKE_PORT   = lu depuis .env (ou déjà exporté dans le shell)
PORT="${1:-${VYKE_PORT:-4242}}"

# Exporter les variables pour que uvicorn/main.py y ait accès
export VYKE_OLLAMA_URL="${VYKE_OLLAMA_URL:-http://localhost:11434}"
export VYKE_CHAT_MODEL="${VYKE_CHAT_MODEL:-mistral-small3.2:24b}"
export VYKE_CODE_MODEL="${VYKE_CODE_MODEL:-qwen2.5-coder:7b}"
export VYKE_WORKSPACE="${VYKE_WORKSPACE:-$HOME}"

# ── Vérifications ─────────────────────────────────────────────────────────────
if [ ! -f "$BACKEND_DIR/venv/bin/activate" ]; then
    echo -e "${RED}[✗]${NC} Environnement virtuel manquant."
    echo -e "    Lance d'abord : ${YELLOW}./setup.sh${NC}"
    exit 1
fi

# Vérifier Ollama avec l'URL configurée
if ! curl -sf "$VYKE_OLLAMA_URL/api/tags" &>/dev/null; then
    echo -e "${YELLOW}[!]${NC} Ollama non joignable sur ${VYKE_OLLAMA_URL}"
    echo -e "    ${DIM}Les fonctions IA seront indisponibles tant qu'Ollama ne tourne pas.${NC}"
fi

# ── Afficher la config ────────────────────────────────────────────────────────
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
echo -e "${CYAN}  [VYKE IDE]${NC}"
echo -e "  ${DIM}─────────────────────────────────────${NC}"
echo -e "  Port        ${CYAN}${PORT}${NC}"
echo -e "  Ollama      ${DIM}${VYKE_OLLAMA_URL}${NC}"
echo -e "  Chat        ${DIM}${VYKE_CHAT_MODEL}${NC}"
echo -e "  Code        ${DIM}${VYKE_CODE_MODEL}${NC}"
echo -e "  ${DIM}─────────────────────────────────────${NC}"
echo -e "  ${GREEN}http://localhost:${PORT}${NC}"
echo -e "  ${GREEN}http://${LOCAL_IP}:${PORT}${NC}"
echo ""
echo -e "  ${DIM}Ctrl+C pour arrêter  ·  ./setup.sh pour reconfigurer${NC}"
echo ""

# ── Lancement ─────────────────────────────────────────────────────────────────
cd "$BACKEND_DIR"
# shellcheck disable=SC1091
source venv/bin/activate
exec uvicorn main:app \
    --host 0.0.0.0 \
    --port "$PORT" \
    --reload \
    --log-level warning
