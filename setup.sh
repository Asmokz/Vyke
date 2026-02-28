#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# VYKE IDE – Script d'installation
# ═══════════════════════════════════════════════════════════════════
set -e

BLUE='\033[0;34m'; CYAN='\033[0;36m'; GREEN='\033[0;32m'
YELLOW='\033[1;33m'; RED='\033[0;31m'; DIM='\033[2m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
PROJECTS_DIR="$SCRIPT_DIR/projects"
ENV_FILE="$SCRIPT_DIR/.env"

# ── Banner ────────────────────────────────────────────────────────────────────
echo -e "${CYAN}"
echo "  ██╗   ██╗██╗   ██╗██╗  ██╗███████╗"
echo "  ██║   ██║╚██╗ ██╔╝██║ ██╔╝██╔════╝"
echo "  ██║   ██║ ╚████╔╝ █████╔╝ █████╗  "
echo "  ╚██╗ ██╔╝  ╚██╔╝  ██╔═██╗ ██╔══╝  "
echo "   ╚████╔╝    ██║   ██║  ██╗███████╗"
echo "    ╚═══╝     ╚═╝   ╚═╝  ╚═╝╚══════╝"
echo -e "${NC}"
echo -e "${YELLOW}  Installation de Vyke IDE${NC}"
echo -e "${DIM}  ────────────────────────────────────────${NC}\n"

# ── Helper : tester si un port est libre ─────────────────────────────────────
port_is_free() {
    python3 - <<PYEOF 2>/dev/null
import socket
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind(('', $1))
    s.close()
    exit(0)
except OSError:
    exit(1)
PYEOF
}

# ── 1. Prérequis ──────────────────────────────────────────────────────────────
echo -e "${BLUE}▸ Vérification des prérequis${NC}"

if ! command -v python3 &>/dev/null; then
    echo -e "  ${RED}[✗] Python3 introuvable.${NC} Installe-le d'abord (apt install python3)."
    exit 1
fi
PY_VER=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
echo -e "  ${GREEN}[✓]${NC} Python ${PY_VER}"

if ! command -v curl &>/dev/null; then
    echo -e "  ${YELLOW}[!]${NC} curl manquant — la détection Ollama sera limitée"
fi

# ── 2. Détection Ollama (URL par défaut, peut changer plus tard) ──────────────
OLLAMA_PROBE="http://localhost:11434"
OLLAMA_OK=false
AVAILABLE_MODELS=""

if curl -sf "$OLLAMA_PROBE/api/tags" &>/dev/null; then
    OLLAMA_OK=true
    AVAILABLE_MODELS=$(curl -s "$OLLAMA_PROBE/api/tags" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('\n'.join(m['name'] for m in d.get('models', [])))
" 2>/dev/null)
    MODEL_COUNT=$(echo "$AVAILABLE_MODELS" | grep -c . || echo 0)
    echo -e "  ${GREEN}[✓]${NC} Ollama détecté — ${MODEL_COUNT} modèle(s)"
else
    echo -e "  ${YELLOW}[!]${NC} Ollama non joignable sur localhost:11434"
fi

# ── 3. Configuration ──────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}▸ Configuration${NC}"

# Charger les valeurs existantes si .env présent
PREV_PORT=""; PREV_OLLAMA=""; PREV_CHAT=""; PREV_CODE=""
SKIP_CONFIG=false

if [ -f "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    PREV_PORT="$VYKE_PORT"
    PREV_OLLAMA="$VYKE_OLLAMA_URL"
    PREV_CHAT="$VYKE_CHAT_MODEL"
    PREV_CODE="$VYKE_CODE_MODEL"
    echo -e "  ${YELLOW}[!]${NC} Configuration existante détectée :"
    echo -e "      Port ${CYAN}${PREV_PORT}${NC}  ·  Chat ${CYAN}${PREV_CHAT%%:*}${NC}  ·  Code ${CYAN}${PREV_CODE%%:*}${NC}"
    echo ""
    read -rp "  Reconfigurer ? [o/N] : " RECONFIG
    if [[ ! "$RECONFIG" =~ ^[oOyY]$ ]]; then
        SKIP_CONFIG=true
        echo -e "  ${GREEN}[✓]${NC} Configuration conservée"
    fi
fi

if [ "$SKIP_CONFIG" = false ]; then

    # ── Port ──────────────────────────────────────────────────────────────────
    echo ""
    DEFAULT_PORT="${PREV_PORT:-4242}"
    while true; do
        read -rp "  Port d'écoute [${DEFAULT_PORT}] : " RAW_PORT
        CFG_PORT="${RAW_PORT:-$DEFAULT_PORT}"

        # Validation numérique
        if ! [[ "$CFG_PORT" =~ ^[0-9]+$ ]] || \
           [ "$CFG_PORT" -lt 1024 ] || [ "$CFG_PORT" -gt 65535 ]; then
            echo -e "  ${RED}[✗]${NC} Port invalide — choisis entre 1024 et 65535"
            continue
        fi

        # Vérifier disponibilité
        if port_is_free "$CFG_PORT"; then
            echo -e "  ${GREEN}[✓]${NC} Port ${CFG_PORT} disponible"
            break
        else
            echo -e "  ${YELLOW}[!]${NC} Port ${CFG_PORT} déjà utilisé sur cette machine"
            read -rp "      Forcer quand même ? [o/N] : " FORCE_PORT
            if [[ "$FORCE_PORT" =~ ^[oOyY]$ ]]; then
                echo -e "  ${YELLOW}[!]${NC} Port ${CFG_PORT} forcé (assure-toi qu'il sera libre au lancement)"
                break
            fi
            # Proposer un port alternatif libre
            for TRY in 4243 4244 5000 5001 7777 8080 8888 9090; do
                if port_is_free "$TRY"; then
                    echo -e "  ${DIM}Suggestion : port ${TRY} est libre${NC}"
                    DEFAULT_PORT="$TRY"
                    break
                fi
            done
        fi
    done

    # ── URL Ollama ────────────────────────────────────────────────────────────
    DEFAULT_OLLAMA="${PREV_OLLAMA:-http://localhost:11434}"
    read -rp "  URL Ollama [${DEFAULT_OLLAMA}] : " RAW_OLLAMA
    CFG_OLLAMA="${RAW_OLLAMA:-$DEFAULT_OLLAMA}"

    # Re-sonder Ollama avec la nouvelle URL si différente
    if [ "$CFG_OLLAMA" != "$OLLAMA_PROBE" ] && curl -sf "$CFG_OLLAMA/api/tags" &>/dev/null; then
        AVAILABLE_MODELS=$(curl -s "$CFG_OLLAMA/api/tags" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('\n'.join(m['name'] for m in d.get('models', [])))
" 2>/dev/null)
        OLLAMA_OK=true
    fi

    # ── Modèles ───────────────────────────────────────────────────────────────
    echo ""
    if [ "$OLLAMA_OK" = true ] && [ -n "$AVAILABLE_MODELS" ]; then
        echo -e "  ${CYAN}Modèles Ollama disponibles :${NC}"
        i=1
        while IFS= read -r M; do
            printf "    ${DIM}[%2d]${NC}  %s\n" "$i" "$M"
            i=$((i+1))
        done <<< "$AVAILABLE_MODELS"
        echo ""
        echo -e "  ${DIM}(copie-colle le nom exact ou laisse vide pour la valeur par défaut)${NC}"
    else
        echo -e "  ${YELLOW}[!]${NC} Ollama non disponible — saisis les noms manuellement"
    fi

    DEFAULT_CHAT="${PREV_CHAT:-mistral-small3.2:24b}"
    DEFAULT_CODE="${PREV_CODE:-qwen2.5-coder:7b}"

    read -rp "  Modèle CHAT  [${DEFAULT_CHAT}] : " RAW_CHAT
    CFG_CHAT="${RAW_CHAT:-$DEFAULT_CHAT}"

    read -rp "  Modèle CODE  [${DEFAULT_CODE}] : " RAW_CODE
    CFG_CODE="${RAW_CODE:-$DEFAULT_CODE}"

    # ── Écriture du .env ──────────────────────────────────────────────────────
    cat > "$ENV_FILE" << EOF
# ╔══════════════════════════════════════════════════╗
# ║           Vyke IDE – Configuration               ║
# ║  Généré le $(date '+%Y-%m-%d %H:%M:%S')                  ║
# ╚══════════════════════════════════════════════════╝
#
# Modifie ce fichier puis relance ./start.sh
# ou relance ./setup.sh pour reconfigurer.

# Port d'écoute du serveur (défaut : 4242)
VYKE_PORT=${CFG_PORT}

# URL de l'API Ollama
VYKE_OLLAMA_URL=${CFG_OLLAMA}

# Modèle utilisé pour le chat (questions, explications)
VYKE_CHAT_MODEL=${CFG_CHAT}

# Modèle utilisé pour la complétion de code
VYKE_CODE_MODEL=${CFG_CODE}
EOF

    echo -e "\n  ${GREEN}[✓]${NC} Configuration sauvegardée dans ${CYAN}.env${NC}"

    # Recharger pour la suite du script
    # shellcheck disable=SC1090
    source "$ENV_FILE"
fi

# ── 4. Environnement virtuel ──────────────────────────────────────────────────
echo ""
echo -e "${BLUE}▸ Environnement Python${NC}"
cd "$BACKEND_DIR"

if [ -d "venv" ]; then
    echo -e "  ${DIM}[→] venv existant détecté, mise à jour...${NC}"
else
    python3 -m venv venv
fi
echo -e "  ${GREEN}[✓]${NC} venv prêt"

# ── 5. Dépendances ────────────────────────────────────────────────────────────
echo -e "  ${DIM}[→] Installation des dépendances Python...${NC}"
# shellcheck disable=SC1091
source venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt -q
deactivate
echo -e "  ${GREEN}[✓]${NC} Dépendances installées"

# ── 6. Dossier projects ───────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}▸ Structure des données${NC}"
mkdir -p "$PROJECTS_DIR"
echo -e "  ${GREEN}[✓]${NC} Dossier projects/"

if [ ! -f "$PROJECTS_DIR/hello_vyke.py" ]; then
cat > "$PROJECTS_DIR/hello_vyke.py" << 'PYEOF'
# Hello depuis VYKE IDE !
# Propulsé par Monaco Editor + Ollama

def fibonacci(n: int) -> list[int]:
    """Génère la suite de Fibonacci jusqu'à n termes."""
    if n <= 0:
        return []
    seq = [0, 1]
    while len(seq) < n:
        seq.append(seq[-1] + seq[-2])
    return seq[:n]


if __name__ == "__main__":
    result = fibonacci(10)
    print(f"Fibonacci(10) = {result}")
    print(f"Somme = {sum(result)}")
PYEOF
    echo -e "  ${GREEN}[✓]${NC} Fichier exemple créé"
fi

# ── Résumé ────────────────────────────────────────────────────────────────────
FINAL_PORT="${VYKE_PORT:-4242}"
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
echo -e "${CYAN}  ══════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✓  Installation terminée !${NC}"
echo -e "${CYAN}  ══════════════════════════════════════════${NC}"
echo ""
echo -e "  Lancer Vyke    : ${YELLOW}./start.sh${NC}"
echo -e "  Reconfigurer   : ${YELLOW}./setup.sh${NC}  ${DIM}(relance le wizard)${NC}"
echo -e "  Config rapide  : ${YELLOW}nano .env${NC}"
echo ""
echo -e "  Accès local    : ${CYAN}http://localhost:${FINAL_PORT}${NC}"
echo -e "  Accès réseau   : ${CYAN}http://${LOCAL_IP}:${FINAL_PORT}${NC}"
echo ""
