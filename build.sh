#!/usr/bin/env bash
#
# build.sh — Construit le fichier XPI de Magic Threads
#
# Usage : bash build.sh
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Extraire la version depuis manifest.json
VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

if [ -z "$VERSION" ]; then
    echo "❌ Erreur : impossible d'extraire la version depuis manifest.json"
    exit 1
fi

XPI_NAME="magic-threads-${VERSION}.xpi"
XPI_LATEST="magic-threads.xpi"
DIST_DIR="dist"

echo "🔧 Construction de Magic Threads v${VERSION}..."

# Créer le répertoire dist/
mkdir -p "$DIST_DIR"

# Supprimer les anciens fichiers
rm -f "${DIST_DIR}/${XPI_NAME}"
rm -f "${DIST_DIR}/${XPI_LATEST}"

# Créer le XPI (archive ZIP)
zip -r -q "${DIST_DIR}/${XPI_NAME}" \
    manifest.json \
    background/ \
    experiment-api/ \
    options/ \
    _locales/ \
    -x "*.git*" \
    -x "*.swp" \
    -x "*~" \
    -x "*/node_modules/*" \
    -x "*/dist/*" \
    -x "*/.DS_Store"

# Créer un lien symbolique de commodité
ln -sf "$XPI_NAME" "${DIST_DIR}/${XPI_LATEST}"

# Afficher le résultat
FILE_SIZE=$(du -h "${DIST_DIR}/${XPI_NAME}" | cut -f1)
echo "✅ ${DIST_DIR}/${XPI_NAME} (${FILE_SIZE})"
echo "🔗 ${DIST_DIR}/${XPI_LATEST} → ${XPI_NAME}"
echo ""
echo "📦 Pour installer : Thunderbird → Modules complémentaires → ⚙️ → Installer depuis un fichier…"
