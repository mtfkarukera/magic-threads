# Journal des modifications

Toutes les modifications notables de Magic Threads sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet adhère au [Versionnage Sémantique](https://semver.org/lang/fr/).

## [2.1.0] - 2026-06-12

### En cours

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
