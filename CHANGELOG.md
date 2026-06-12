# Journal des modifications

Toutes les modifications notables de Magic Threads sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet adhère au [Versionnage Sémantique](https://semver.org/lang/fr/).

## [2.1.2] - 2026-06-12

Correctifs issus de la phase 1 du [plan d'action](PLAN_ACTION.md) (audit du 12 juin 2026).

### Corrigé
- **Poignée de redimensionnement absente en sidebar gauche** : la variable `pendingResizeHandle` était déclarée dans un bloc `if` et hors de portée au moment de l'insertion dans le Shadow DOM — la poignée n'était jamais ajoutée.
- **Conditions de course à l'affichage du fil** : le compteur de requêtes, global, est remplacé par un compteur **par onglet** ; les requêtes en vol sont invalidées lors du masquage du panneau (désélection, multi-sélection) ; plus aucun `await` entre le contrôle de fraîcheur et l'affichage (préférences chargées en parallèle de la requête Gloda via `Promise.all`).
- **Requête Gloda de conversation sans timeout** : `getConversationMessages` bénéficie du même délai maximal (10 s) que la requête initiale ; le timer est annulé en cas d'exception synchrone de Gloda.

### Sécurité
- Suppression du log de l'URI complète du message lors de la navigation (fuite de métadonnées dans la console globale).

### Qualité
- Lint ESLint au vert (0 erreur, 0 avertissement) : suppression des commentaires `/* global */` redondants, configuration dédiée pour `experiment-api/` (contexte chrome : `sourceType: script`, pas de `setTimeout`/`clearTimeout` globaux) ; correction d'une indentation trompeuse dans le handler de redimensionnement.

### Modifié
- **ID de l'extension** : `magicthreads-b@xulforum.org` → `magic-threads@mtfkarukera.net` (domaine `xulforum.org` non possédé ; l'ID est définitif après publication sur ATN). Thunderbird traitera cette version comme une nouvelle extension : désinstaller l'ancienne, les préférences repartent aux valeurs par défaut.
- **`strict_max_version: "151.*"`** ajouté au manifest : exigé par le validateur ATN pour les extensions utilisant des Experiment APIs. À relever à chaque version de Thunderbird validée (testé sur 140 ESR et 151).

### Ajouté
- **Icône de l'extension** (16/32/48/64/128 px, dossier `icons/`), déclarée dans le manifest — affichée dans le gestionnaire de modules et sur la fiche ATN.
- **LICENSE incluse dans le XPI** (exigence de distribution MPL-2.0 relevée par l'audit).

## [2.1.1] - 2026-06-12

### Corrigé
- **Nettoyage au déchargement de l'extension** : `cleanupSidebar3PaneContainer` était inaccessible depuis `onShutdown()` (portée limitée à `getAPI()`), empêchant la restauration des marges du `messageBrowser` à la désactivation/désinstallation. La fonction est déplacée au niveau du module.

### Modifié
- **Logs de démarrage** : la version affichée est lue dynamiquement depuis le manifest au lieu d'être codée en dur.

## [2.1.0] - 2026-06-12

### Ajouté
- **Internationalisation (i18n)** : support de 7 langues (fr, en, de, ja, es, pt, vi)
- **Fichiers de structure projet** : LICENSE, README, CHANGELOG, AGENTS.md, ARCHITECTURE.md, build.sh, .gitignore, .eslintrc.json
- **Position configurable en 3-pane** : choix entre panneau inférieur (bottom) et latéral (beside)
- **Poignée horizontale** pour redimensionner le panneau sidebar

## [2.0.0] - 2026-06-11

### Ajouté
- **Panneau bottom** dans la vue 3-pane : affichage du fil de discussion sous le message
- **Sidebar** en onglet message : affichage latéral du fil dans les onglets de message
- **Gloda thread retrieval** : récupération des fils de discussion via l'API Gloda (Experiment API XPCOM)
- **Shadow DOM** : isolation CSS complète du panneau injecté
- **Mode sombre** : adaptation automatique au thème de Thunderbird
- **Poignée de redimensionnement** : redimensionnement vertical du panneau bottom
- **Indicateur de pièces jointes** : icône 📎 pour les messages avec pièces jointes
- **Navigation intra-onglet** : clic sur un message du fil ouvre le message dans le même onglet
- **Métadonnées affichées** : expéditeur, date, snippet, dossier, pièces jointes
- **Page d'options** : configuration du mode de navigation et de la position du panneau
