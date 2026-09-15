# Journal des modifications

Toutes les modifications notables de Magic Threads sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet adhère au [Versionnage Sémantique](https://semver.org/lang/fr/).

## [2.5.11] - 2026-09-15

### Ajouté
- **Système d'auto-update autonome ([manifest.json](file:///Users/mtfkarukera/Scripts/magic-threads-b/manifest.json), [updates.json](file:///Users/mtfkarukera/Scripts/magic-threads-b/updates.json))** :
  - Déclaration de la clé `update_url` dans `browser_specific_settings.gecko` pointant vers le manifeste distant sur GitHub.
  - Création du manifeste Gecko `updates.json` avec intégrité cryptographique SHA256 (`update_hash`) et filtrage de compatibilité Thunderbird.
  - Prise en charge des mises à jour automatiques transparentes en tâche de fond par Thunderbird (ou via le bouton *Rechercher des mises à jour*).
- **Outillage de compilation et de release ([build.sh](file:///Users/mtfkarukera/Scripts/magic-threads-b/build.sh), [release.sh](file:///Users/mtfkarukera/Scripts/magic-threads-b/release.sh))** :
  - Calcul et affichage automatique de l'empreinte SHA256 du `.xpi` généré dans `build.sh`.
  - Automatisation dans `release.sh` du contrôle et de la mise à jour synchronisée de `updates.json` lors de chaque cycle de release.
- **Workflow GitHub Actions ([.github/workflows/release.yml](file:///Users/mtfkarukera/Scripts/magic-threads-b/.github/workflows/release.yml))** :
  - Pipeline automatisé déclenché sur push de tag `v*` pour valider le build, vérifier l'intégrité SHA256 et publier l'archive `.xpi` sur GitHub Releases.

## [2.5.10] - 2026-09-14

### Modifié
- **Suppression du plafond `strict_max_version` ([manifest.json](file:///Users/mtfkarukera/Scripts/magic-threads-b/manifest.json))** :
  - Suppression de la contrainte `strict_max_version: "154.*"` dans la configuration Gecko du manifest.
  - Résolution définitive des échecs d'installation et faux positifs d'incompatibilité sur les distributions Linux (Debian, Ubuntu LTS, Fedora, openSUSE) utilisant des paquets Thunderbird ESR spécifiques ou personnalisés.
  - Pérennisation des mises à jour majeures de Thunderbird sans désactivation intempestive de l'extension ni nécessité de livraisons cosmétiques intermédiaires.
  - Conservation exclusive de `strict_min_version: "128.0"` pour garantir les prérequis modernes de l'API (custom elements `about:3pane` et Gloda).

## [2.5.9] - 2026-09-04

### Optimisé
- **Transition ultra-rapide et tolérance de sélection différenciée ([background.js](file:///Users/mtfkarukera/Scripts/magic-threads-b/background/background.js))** :
  - Élimination des 10 tentatives de sélection successives (~800 ms de latence) lorsque le message cible se situe dans le même dossier : bascule instantanée (0 ms d'attente) vers le fallback direct si le message est masqué par le filtre rapide.
  - Resserrage de la boucle de retry lors d'un changement réel de dossier (6 tentatives de 30 ms = 180 ms max au lieu de 500 ms) pour une navigation réactive à 60 fps.
  - Temps de transition réduit de ~1 000 ms à ~200 ms lors de la navigation dans les fils filtrés.

## [2.5.8] - 2026-09-04

### Ajouté
- **Fallback d'affichage direct en cas de filtre rapide actif ([magicThreadsWindowApi.js](file:///Users/mtfkarukera/Scripts/magic-threads-b/experiment-api/magicThreadsWindowApi.js), [background.js](file:///Users/mtfkarukera/Scripts/magic-threads-b/background/background.js))** :
  - Détection automatique lorsqu'un message ciblé dans le fil ne peut pas être sélectionné dans la liste 3-pane en raison d'un filtre rapide actif de l'utilisateur (ex: recherche par expéditeur).
  - Invocation prioritaire de l'API de haut niveau `messagePane.displayMessage(msgURI)` de Thunderbird 128+ avec démasquage inconditionnel du visualiseur natif (`messageBrowser.hidden = false`) et masquage de la multi-sélection.
  - Préservation intégrale du filtre rapide de l'utilisateur sans remise à zéro intempestive ni désynchronisation visuelle.
  - Mise à jour immédiate du panneau Magic Threads pour synchroniser le fil de discussion sans écran noir ni interruption du travail en cours.

## [2.5.6] - 2026-08-19

### Corrigé
- **Éradication du panneau fantôme et nettoyage robuste des marges ([magicThreadsWindowApi.js](file:///Users/mtfkarukera/Scripts/magic-threads-b/experiment-api/magicThreadsWindowApi.js))** :
  - Sanctuarisation de `dataset.layoutMode` et utilisation des attributs dédiés `bannerLayout` et `bannerSide` pour le Shadow DOM, éliminant toute collision de métadonnées.
  - Nettoyage inconditionnel et immédiat des marges (`marginLeft`/`marginRight` du `messageBrowser`) et des paddings du `body` dans `hideBanner`. Les e-mails orphelins (sans fil) et les désélections réinitialisent instantanément l'affichage sur 100 % de la largeur sans laisser de couloir blanc vide.

## [2.5.5] - 2026-08-19

### Optimisé
- **Zéro scintillement & DOM Patching in-place ([magicThreadsWindowApi.js](file:///Users/mtfkarukera/Scripts/magic-threads-b/experiment-api/magicThreadsWindowApi.js))** : Implémentation de la fonction `tryUpdateBannerDOM` effectuant une mise à jour chirurgicale in-place des nœuds DOM du fil sans destruction du Shadow DOM lors de la navigation au sein d'une même conversation. Élimination totale des micro-flashs visuels et préservation des états de scroll.
- **Retour tactile instantané (Optimistic UI)** : Application immédiate de l'état sélectionné (`.current` / `aria-current`) dès l'événement `click`/`keydown` au sein du fil pour une réactivité instantanée à 60 fps.

## [2.5.4] - 2026-08-19

### Corrigé
- **Navigation intra-onglet (onglets de message)** : Remplacement de l'ancienne logique d'ouverture/fermeture d'onglets (`openTab`/`closeTab`) par l'appel direct à la fonction native `contentWin.displayMessage(msgURI)` dans `navigateMessageTab` ([magicThreadsWindowApi.js](file:///Users/mtfkarukera/Scripts/magic-threads-b/experiment-api/magicThreadsWindowApi.js)). La navigation au clic au sein d'un fil s'effectue désormais instantanément sur place sans duplication ni empilement d'onglets dans la barre supérieure.
- **Routage de navigation (background.js)** : Prise en compte prioritaire du mode `newTab` (configuré ou basculé à la volée via le bouton ⚙️) quel que soit le type d'onglet, avec repli de secours sécurisé en cas d'onglet inaccessible.

## [2.5.3] - 2026-07-31

### Modifié
- **Compatibilité Thunderbird 153+** : Relevé de `strict_max_version` de `152.*` à `154.*` dans `manifest.json` suite à la sortie de Thunderbird 153 (résolution du blocage d'installation sur Thunderbird 153.0.1).

## [2.5.2] - 2026-06-27

### Corrigé
- **Sélection intra-dossier robuste (background.js)** : Application systématique du délai de sécurité de 250 ms et de la boucle de retry de sélection pour les e-mails envoyés récents, y compris lorsque la navigation s'effectue au sein du même dossier (ex : clics successifs dans "Messages envoyés"), résolvant définitivement les cas de page blanche lors du premier clic.

### Modifié
- **Documentation** : Mise à jour de `README.md` (fonctionnalité de dédoublonnage intelligent) et de `ARCHITECTURE.md` (section Résilience de la sélection, dédoublonnage Gmail, correction des diagrammes Mermaid).
- **Dépôt** : Retrait de `JUSTIFICATION_ATN.md` du suivi Git (fichier conservé localement, ajouté au `.gitignore`).

## [2.5.1] - 2026-06-27

### Corrigé
- **Robustesse & Dédoublonnage Gmail** :
  - Dédoublonnage robuste : normalisation de la détection du dossier virtuel *Tous les messages* (Gmail All Mail) indépendamment de la casse, avec support étendu de plus de 20 langues (dont l'espagnol, l'allemand, l'italien, etc.) et traitement correct des paramètres de requête et slashs terminaux dans [glodaApi.js](file:///Users/mtfkarukera/Scripts/magic-threads-b/experiment-api/glodaApi.js).
  - Préservation du snippet : fiabilisation de la logique de fusion de messages de [glodaApi.js](file:///Users/mtfkarukera/Scripts/magic-threads-b/experiment-api/glodaApi.js) pour conserver le snippet indexé de l'email quelle que soit la copie analysée.
  - Sélection résiliente : implémentation d'une boucle de retry avec tolérance temporelle (jusqu'à 10 essais sur 500 ms) dans [background.js](file:///Users/mtfkarukera/Scripts/magic-threads-b/background/background.js) pour garantir la sélection effective du message après changement de dossier dans la vue 3-pane.
- **Accessibilité & Contraste WCAG AA** :
  - Rehausse du contraste de la couleur du dossier *Envoyé* (`--sent-text`) en mode clair (de `#2f855a` à `#276f4a` sur fond `#f0fff4`, atteignant un contraste conforme de 6,1:1).
  - Rehausse du contraste du texte secondaire (`--text-muted`) en mode sombre (de `#8a93a3` à `#8d98a9` sur fond `#282c34`, atteignant un contraste conforme de 4,7:1).
  - Rétablissement de la continuité de navigation au clavier : le message courant est désormais focusable (`tabIndex="0"`) et déclaré comme un bouton inactif (`role="button"`, `aria-disabled="true"`), supprimant la rupture de tabulation au sein de la liste.
  - Amélioration des options : ajout d'associations explicites `<label for="...">` pour tous les boutons radio de la page de préférences.
  - Sémantique du tri : association de la description globale de tri au groupe d'options (`aria-describedby` sur le `<fieldset>` parent).
  - Retour vocal sur l'en-tête du fil : ajout d'une zone `aria-live="polite"` sur l'indicateur de mode et liaison via `aria-describedby` sur le bouton de configuration ⚙️.
  - Ajout de la liaison `aria-controls` reliant le bouton de repli (▼) à la liste de discussion.

## [2.5.0] - 2026-06-27

### Ajouté
- **Accessibilité & Sémantique** :
  - Rehausse du contraste du badge Archive en mode clair (valeur `#8f5700` sur fond `#fefcbf` conforme WCAG AA à 5,1:1).
  - Ajout des rôles structurels de titre `role="heading"` et `aria-level="2"` au titre du fil de discussion.
  - Ajout d'attributs `aria-label` descriptifs sur les boutons emoji d'en-tête (Configuration et Réduction).
  - Intégration des attributs de séparation ARIA (`role="separator"`, `aria-orientation`, `aria-valuemin`, `aria-valuemax` et `aria-valuenow` dynamique) sur la poignée de redimensionnement pour l'accessibilité au clavier.
  - Liaison des boutons radio de configuration à leurs descriptions textuelles respectives via `aria-describedby` dans la page d'options.

### Corrigé
- **Discussions groupées (vue 3-pane)** : Élargissement de l'écouteur `messageDisplay.onMessageDisplayed` à tous les onglets pour résoudre l'absence d'affichage du panneau lors de l'expansion d'une discussion groupée dans la vue principale.
- **Robustesse & Dédoublonnage Gmail** :
  - Implémentation du dédoublonnage intelligent dans `glodaApi.js` : normalisation des Message-IDs (chevrons et espaces) et filtrage prioritaire des dossiers Gmail (les dossiers spécifiques comme *Envoyés* ou *Boîte de réception* priment sur le dossier virtuel global *Tous les messages*).
  - Protection contre la faille d'injection de sélecteurs CSS dans `options.js` par validation des préférences par rapport à une liste blanche (`ALLOWED_VALUES`).
  - Résolution de la race condition inter-dossiers (page blanche sous Linux ESR) : le délai de sécurité de 250 ms n'est désormais appliqué qu'aux e-mails envoyés de moins de 5 minutes.

## [2.4.1] - 2026-06-22

### Modifié
- **Compatibilité Thunderbird 152** : Relevé de `strict_max_version` de `151.*` à `152.*` dans `manifest.json` suite à la sortie de Thunderbird 152.

## [2.4.0] - 2026-06-13

Phase 4 du [plan d'action](PLAN_ACTION.md) (pérennité & publication). **Aucun changement de comportement utilisateur** : refactoring interne, outillage, documentation et préparation de soumission.

### Ajouté
- **Conception de l'après-Gloda** (`CONCEPTION_POST-GLODA.md`) : résolveur de fil à trois étages derrière `threadResolver.js` (Gloda → Experiment API sans Gloda via `nsIMsgThread`/`References` → filet 100 % WebExtension prêt MV3). Module de référence non câblé `background/threadResolverFallback.js`. Veille Panorama : pas de retrait imminent de Gloda.
- **Justification ATN** (`JUSTIFICATION_ATN.md`) : argumentaire des deux Experiment APIs pour le relecteur Mozilla (pourquoi elles ne sont pas remplaçables par le SDK standard), avec résumé anglais prêt à coller.
- **Veille de compatibilité** (`VEILLE_COMPATIBILITE.md`) : checklist par beta/ESR (points d'appui DOM, Gloda, 3 modes), anticipation MV3.
- **Config ESLint « flat »** (`eslint.config.js`) + `package.json` de dev (outillage uniquement, exclu du XPI) : prêt pour ESLint 9, coexiste avec `.eslintrc.json`.

### Modifié
- **Refactoring de `magicThreadsWindowApi.js`** : feuilles de style hissées en constantes de module (`SHARED_CSS`/`BOTTOM_CSS`/`SIDEBAR_CSS`), construction d'un item de fil factorisée en `buildThreadItem()`, magic numbers nommés (`SIDEBAR_DEFAULT_WIDTH`, `BOTTOM_DEFAULT_HEIGHT`, `PANEL_Z_INDEX`). Lisibilité accrue, risque de récidive du bug de portée réduit.
- **`build.sh`** : extraction de version robuste (parsing JSON via node, repli grep/sed ne confondant plus `version` et `manifest_version`).
- **Documentation alignée sur le code** : `ARCHITECTURE.md` (Gloda `getMessageCollectionForHeaders` au lieu de `GlodaMsgSearcher`, deux écouteurs réels, trois chemins de navigation, retrait de l'option « gauche » 3-pane), `AGENTS.md` (`onMessagesDisplayOff` inexistant corrigé), `CHANGELOG` (« beside » corrigé).

## [2.3.0] - 2026-06-13

Accessibilité et i18n issus de la phase 3 du [plan d'action](PLAN_ACTION.md).

### Ajouté
- **Navigation clavier du panneau** : les messages du fil sont focusables (Tab) et activables à Entrée/Espace (`role="list"`/`listitem`/`button`, `aria-current` sur le message affiché), anneau de focus visible (`:focus-visible`) sur les items, les boutons d'en-tête et la poignée — qui se pilote désormais aussi aux flèches du clavier (`role="separator"`, pas de 16 px).
- **Avertissement Gloda** : si la recherche globale est désactivée dans Thunderbird, la page d'options affiche un bandeau d'alerte (`role="alert"`, nouvelle fonction `convGloda.isGlodaAvailable`) au lieu de laisser l'extension silencieusement inerte.
- **État « non lu » accessible** : libellé annoncé aux lecteurs d'écran (clé i18n `unreadLabel`, 7 locales) en complément du point rouge ; `aria-expanded` sur le bouton réduire/déplier.

### Corrigé
- **Contrastes WCAG AA** : palette du panneau adossée aux variables de thème Thunderbird (`--layout-*`, `--color-accent-primary`) avec fallbacks relevés à ≥ 4,5:1 (`--text-muted` : `#5a6675` clair / `#8a93a3` sombre).
- **Traductions** : es/pt « anticroonológico » → « anticronológico », « Archivos »/« Arquivos » (faux-sens) → « Archivados »/« Arquivadas » ; vi : « luồng » unifié en « chuỗi », « thẻ gốc mới » reformulé ; libellés de secours (`DEFAULT_LABELS`) passés en anglais.
- **Page d'options** : groupes de radios en `<fieldset>`/`<legend>`, confirmation d'enregistrement annoncée (`role="status"`), couleurs codées en dur remplacées par les couleurs système (lisible en thème sombre).

### Modifié
- **Manifest** : déclaration `data_collection_permissions: ["none"]` (aucune collecte de données) requise par les linters récents.

## [2.2.2] - 2026-06-13

### Corrigé
- **Compteur de fil dépendant du point d'entrée** : les en-têtes `References` ne pointant que vers les ancêtres, la réunification 2.2.1 pouvait rester partielle selon le message cliqué (17 vs 63 sur le même fil, typiquement depuis un transfert dans Envoyés). Le fil local `nsIMsgThread` est désormais absorbé pour **chaque** message ramené — et non plus seulement pour le message cliqué — ce qui relie les branches dans les deux sens (ancêtres ET descendants). Passes d'expansion portées de 3 à 4.

## [2.2.1] - 2026-06-13

### Corrigé
- **Fil incomplet (conversations Gloda fragmentées)** : Gloda affecte la conversation à l'indexation et ne fusionne jamais rétroactivement — une même chaîne de réponses pouvait être éclatée en plusieurs conversations (indexation dans le désordre, reconstruction d'index), et le panneau n'affichait alors qu'un fragment variant selon le message cliqué (constaté en recette : 2/5/10/14 pour un fil de ~50). Le résolveur réunit désormais la conversation Gloda du message, le fil local du dossier (`nsIMsgThread`, soit exactement ce que la liste de messages affiche) et les conversations sœurs retrouvées en suivant les en-têtes `References` (requêtes Gloda `headerMessageID`), avec dédoublonnage par `Message-ID`. Expansion bornée (3 passes, 100 identifiants par requête, 500 messages max) pour préserver la réactivité.

## [2.2.0] - 2026-06-12

Durcissement sécurité et nettoyages issus de la phase 2 du [plan d'action](PLAN_ACTION.md).

### Sécurité
- **Schémas Experiment strictement typés** : `showBanner` reçoit désormais des structures validées par le schéma WebExtension (tableau de messages à propriétés typées, objet de libellés à clés énumérées, `additionalProperties: false`, `enum` sur les modes et positions) au lieu de chaînes JSON opaques (`JSON.parse` supprimé du contexte chrome). Défense en profondeur à la frontière privilégiée.

### Corrigé
- **Nettoyage à la désactivation** : `onShutdown` couvre désormais toutes les fenêtres, y compris les fenêtres message autonomes (`mail:messageWindow`), et restaure `position` sur le `messagePane` (style résiduel).
- **Changement de position du panneau en onglet message** : le panneau latéral est recréé du bon côté si la préférence change pendant que l'onglet est ouvert (avant : panneau d'un côté, marge de l'autre).
- **Navigation en onglet message** : le nouvel onglet est ouvert avant la fermeture de l'ancien — plus de perte d'onglet si l'ouverture échoue.
- **Message sans date** : classé en fin de fil (epoch) au lieu de prendre la première place avec la date courante.

### Modifié
- **Redimensionnement en Pointer Events** avec capture (`setPointerCapture`) : plus de listeners orphelins sur le document si le panneau est reconstruit pendant un glisser, relâchement hors fenêtre géré, support tactile (`touch-action: none`).
- **Option « panneau à gauche » en vue principale définitivement retirée** : la valeur stockée `left` est migrée vers `right` au démarrage (fin du remap silencieux qui rendait la page d'options mensongère), code mort et clés i18n `optMainViewLeft*` supprimés des 7 locales.
- **Logs** : suppression des `console.log` de routine ; les `warn`/`error` conservés sont en anglais.
- **Qualité** : flag pièce jointe via `Ci.nsMsgMessageFlags.Attachment` (au lieu de `0x10000000` en dur), bornes de redimensionnement en constantes nommées, snippet à 700 caractères pleins (off-by-one).

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
- **Position configurable en 3-pane** : choix entre panneau inférieur (bas) et panneau latéral (côté)
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
