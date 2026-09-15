#!/usr/bin/env bash
#
# build.sh — Construit le fichier XPI de Magic Threads
#
# Usage : bash build.sh
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Extraire la version depuis manifest.json.
# Parsing JSON via node (robuste : insensible à l'ordre des clés et au formatage,
# ne confond pas "version" avec "manifest_version") ; repli grep/sed si node absent.
if command -v node >/dev/null 2>&1; then
    VERSION=$(node -e 'process.stdout.write(require("./manifest.json").version || "")' 2>/dev/null)
fi
if [ -z "${VERSION:-}" ]; then
    VERSION=$(grep -E '"version"[[:space:]]*:' manifest.json \
        | grep -v 'manifest_version' \
        | head -1 \
        | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
fi

if [ -z "${VERSION:-}" ]; then
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
    icons/ \
    LICENSE \
    -x "*.git*" \
    -x "*.swp" \
    -x "*~" \
    -x "*/node_modules/*" \
    -x "*/dist/*" \
    -x "*/.DS_Store" \
    -x "background/threadResolverFallback.js"
# threadResolverFallback.js est un module de CONCEPTION (résolveur après-Gloda,
# action 4.1) : conservé dans le dépôt mais NON câblé et NON expédié — l'embarquer
# n'ajouterait que du code mort et des faux positifs UNSUPPORTED_API au validateur.

# Créer un lien symbolique de commodité
ln -sf "$XPI_NAME" "${DIST_DIR}/${XPI_LATEST}"

# Afficher le résultat
FILE_SIZE=$(du -h "${DIST_DIR}/${XPI_NAME}" | cut -f1)

if command -v shasum >/dev/null 2>&1; then
    SHA256_HASH=$(shasum -a 256 "${DIST_DIR}/${XPI_NAME}" | cut -d' ' -f1)
elif command -v sha256sum >/dev/null 2>&1; then
    SHA256_HASH=$(sha256sum "${DIST_DIR}/${XPI_NAME}" | cut -d' ' -f1)
else
    SHA256_HASH="indisponible"
fi

echo "✅ ${DIST_DIR}/${XPI_NAME} (${FILE_SIZE})"
echo "🔒 SHA256: ${SHA256_HASH}"
echo "🔗 ${DIST_DIR}/${XPI_LATEST} → ${XPI_NAME}"
echo ""
echo "📦 Pour installer : Thunderbird → Modules complémentaires → ⚙️ → Installer depuis un fichier…"
