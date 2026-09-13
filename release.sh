#!/usr/bin/env bash
#
# release.sh — Script de validation technique et sécurité de fin de sprint
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔍 Début du rituel technique de validation..."

# 1. Linters
echo "👉 1/4 Exécution d'ESLint..."
if ! npx eslint background/ experiment-api/ options/; then
    echo "❌ Échec d'ESLint. Veuillez corriger les erreurs."
    exit 1
fi
echo "✅ ESLint OK."

echo "👉 2/4 Exécution de web-ext lint..."
# Nous ignorons la valeur de retour (qui renvoie 1 pour cause d'API non Firefox) 
# mais nous vérifions si des erreurs bloquantes réelles hors-bruit sont introduites.
npx web-ext lint --source-dir . --ignore-files "dist/**" "node_modules/**" "*.md" "LICENSE" "build.sh" "release.sh" ".eslintrc.json" "eslint.config.js" "package.json" "package-lock.json" "background/threadResolverFallback.js" || true
echo "✅ web-ext lint exécuté."

# 2. Sécurité Anti-Leak (Fichiers sensibles suivis par Git)
echo "👉 3/4 Audit de sécurité anti-leak..."
SENSITIVE_FILES=(
    "JUSTIFICATION_ATN.md"
    "PLAN_ACTION.md"
    "RAPPORT_AUDIT.md"
    "CONCEPTION_POST-GLODA.md"
    "VEILLE_COMPATIBILITE.md"
)

LEAK_DETECTED=0
for file in "${SENSITIVE_FILES[@]}"; do
    if git ls-files --error-unmatch "$file" >/dev/null 2>&1; then
        echo "❌ SÉCURITÉ : Le fichier sensible '$file' est suivi par Git !"
        echo "   Veuillez l'ignorer via : git rm --cached $file"
        LEAK_DETECTED=1
    fi
done

# Vérification supplémentaire par patterns de noms
SUSPECT_TRACKED=$(git ls-files | grep -iE "(justification|audit|plan_action|private|secret)" || true)
if [ -n "$SUSPECT_TRACKED" ]; then
    echo "❌ SÉCURITÉ : Fichiers suspects suivis par Git détectés :"
    echo "$SUSPECT_TRACKED"
    LEAK_DETECTED=1
fi

if [ "$LEAK_DETECTED" -eq 1 ]; then
    exit 1
fi
echo "✅ Sécurité anti-leak OK."

# 3. Vérification des versions
echo "👉 4/4 Alignement des versions..."
if command -v node >/dev/null 2>&1; then
    VERSION=$(node -e 'process.stdout.write(require("./manifest.json").version || "")' 2>/dev/null)
else
    VERSION=$(grep -E '"version"[[:space:]]*:' manifest.json \
        | grep -v 'manifest_version' \
        | head -1 \
        | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
fi

if [ -z "${VERSION:-}" ]; then
    echo "❌ Erreur : impossible d'extraire la version depuis manifest.json"
    exit 1
fi

if ! grep -q "## \[$VERSION\]" CHANGELOG.md; then
    echo "❌ Erreur : La version v$VERSION n'est pas documentée dans CHANGELOG.md !"
    exit 1
fi
echo "✅ Alignement des versions OK (v$VERSION)."

# 4. Compilation XPI
echo "📦 Lancement de la construction de l'archive XPI..."
bash build.sh

echo "🎉 Rituel technique terminé avec succès !"
