# Instructions pour les agents IA

Ce document fournit les informations essentielles pour un agent IA travaillant sur le code source de **Magic Threads**, une extension Thunderbird (WebExtension + Experiment APIs).

## Vue d'ensemble

Magic Threads affiche les métadonnées du fil de discussion (expéditeur, date, snippet, dossier, pièces jointes) dans un panneau injecté dans l'interface de Thunderbird. L'extension fonctionne en trois modes :

- **Bottom panel** : panneau sous le message en vue 3-pane
- **Sidebar (3-pane)** : panneau latéral (gauche ou droite) en vue 3-pane
- **Sidebar (onglet message)** : panneau latéral (gauche ou droite) dans les onglets de message

## Construction et test

### Construire le XPI

```bash
bash build.sh
```

Produit `dist/magic-threads-VERSION.xpi` et un lien symbolique `dist/magic-threads.xpi`.

### Linter — OBLIGATOIRE en fin de sprint, avant tout commit

```bash
npx eslint background/ experiment-api/ options/   # doit être à 0 erreur, 0 warning
npx web-ext lint --source-dir . --ignore-files "dist/**" "*.md" "LICENSE" "build.sh" ".eslintrc.json"
```

**Lecture du résultat `web-ext lint`** : ce linter est basé sur celui de Firefox et ne connaît pas
Thunderbird. Le bruit attendu (à IGNORER) est :

- 1 erreur `MANIFEST_FIELD_PRIVILEGED` sur `/experiment_apis` (faux positif — le validateur
  d'addons.thunderbird.net utilise un fork qui accepte ce champ)
- des warnings `UNSUPPORTED_API` ("not implemented by Firefox") sur les APIs Thunderbird
  (`mailTabs.*`, `messageDisplay.*`, `messages.*`, `convGloda.*`, `magicThreadsWindow.*`)
- des warnings sur les permissions `messagesRead` / `accountsRead`

**Toute erreur ou warning AU-DELÀ de cette base de référence doit être corrigé avant commit.**
Rappel ATN : `strict_max_version` est **exigé** dans le manifest pour les extensions à
Experiment APIs (contrairement à la règle générale WebExtension) — le relever à chaque
version majeure de Thunderbird validée.

### Tester

1. Installer le XPI via Thunderbird : **Modules complémentaires** → ⚙️ → **Installer depuis un fichier…**
2. Sélectionner un message appartenant à un fil (conversation) existant
3. Vérifier que le panneau s'affiche avec les métadonnées correctes

> **Note** : il n'y a pas de tests automatisés. Le test fonctionnel se fait manuellement dans
> Thunderbird (idéalement sur les deux canaux : ESR et release).

## Architecture

### Contextes d'exécution

L'extension opère dans **deux contextes distincts** :

| Contexte | Fichiers | Accès |
|----------|----------|-------|
| **WebExtension (background)** | `background/*.js` | `browser.*` APIs, `browser.storage`, `browser.messageDisplay` |
| **Chrome/XPCOM (Experiment APIs)** | `experiment-api/*.js` | `Services.*`, `ChromeUtils`, DOM natif Thunderbird, Gloda |

### Flux de données

```
Utilisateur sélectionne un message
  → browser.messageDisplay.onMessageDisplayed
  → background.js
  → threadResolver.js (appelle browser.convGloda.getThreadMessages)
  → glodaApi.js (Experiment API, contexte chrome)
  → XPCOM/Gloda (requête GlodaMsgSearcher)
  → Résultats du fil
  → background.js (appelle browser.magicThreadsWindow.showBanner)
  → magicThreadsWindowApi.js (Experiment API, contexte chrome)
  → Injection Shadow DOM dans le document du message
```

### Fichiers clés

| Fichier | Rôle |
|---------|------|
| `background/background.js` | Point d'entrée, écouteurs d'événements, gestion de la navigation et des préférences |
| `background/threadResolver.js` | Proxy simple (DAL), délègue à l'API Gloda sans transformation |
| `experiment-api/glodaApi.js` | Experiment API : accède à Gloda via XPCOM pour récupérer les fils |
| `experiment-api/magicThreadsWindowApi.js` | Experiment API : injecte le panneau dans le DOM avec Shadow DOM |
| `options/options.html` + `options.js` | Page de configuration (mode navigation, position panneau) |

## Contraintes critiques

### 1. Contexte chrome vs WebExtension

Les fichiers dans `experiment-api/` s'exécutent dans le **contexte chrome** de Thunderbird :

- ❌ `browser.i18n.getMessage()` **n'est pas disponible**
- ❌ Les imports ES modules ne fonctionnent pas directement
- ✅ Utiliser `Services.locale` pour la langue
- ✅ Les traductions doivent être passées depuis le background via les paramètres des appels API

### 2. Shadow DOM et isolation CSS

Le panneau est injecté dans un **Shadow DOM** pour isoler les styles :

- Les styles CSS doivent être inclus **dans** le Shadow DOM (via `<style>` ou `adoptedStyleSheets`)
- Les sélecteurs CSS externes ne traversent pas le Shadow DOM
- Les événements du Shadow DOM ne remontent pas automatiquement (utiliser `composed: true` si nécessaire)

### 3. Problème de dates cross-compartment

Les objets `Date` provenant de Gloda (contexte XPCOM) ne sont **pas des instances de `Date`** du compartiment JavaScript courant :

- ❌ `date instanceof Date` retourne `false`
- ✅ Utiliser `new Date(date)` ou `Date.prototype.getTime.call(date)` pour normaliser
- ✅ Convertir les dates en timestamps (nombres) ou en chaînes ISO avant de les transmettre entre contextes

### 4. DOM de la vue 3-pane (about:3pane)

La vue 3-pane de Thunderbird 128+ est un **document HTML** (`about:3pane.xhtml`) avec un **CSS Grid layout** :

```
<body class="layout-classic">
  <div id="folderPane">...</div>
  <hr id="folderPaneSplitter" is="pane-splitter">
  <div id="threadPane">...</div>
  <hr id="messagePaneSplitter" is="pane-splitter">
  <message-pane id="messagePane">            ← custom element HTML
    <browser id="messageBrowser" src="about:message">  ← XUL browser
    <browser id="multiMessageBrowser">       ← XUL browser
  </message-pane>
</body>
```

**Points critiques :**

- `messagePane` est un **custom element HTML** (`<message-pane>`), en `display: flex; flex-direction: column; overflow: auto`
- `messageBrowser` est un `<xul:browser>` avec `flex: 1`
- `messagePane` est un **grid item** avec `grid-area: message` — **ne JAMAIS modifier** son `display` ou `flex-direction` car TB le réinitialise périodiquement
- Pour injecter un sidebar dans le 3-pane : utiliser **`position: absolute`** dans le `messagePane` + **`margin`** sur le `messageBrowser`
- **Ne PAS** utiliser `position: fixed` (coordonnées incorrectes) ni modifier le parent's flex (instable)

### 5. Onglets message vs vue 3-pane

Le comportement diffère selon le contexte :

| Aspect | Vue 3-pane | Onglet message |
|--------|-----------|----------------|
| Position du panneau | Bottom (sous le message) ou Sidebar (gauche/droite) | Sidebar (gauche/droite) |
| Document cible | `about:3pane` (HTML + custom elements) | `about:message` (HTML body) |
| Injection sidebar | `position: absolute` dans `messagePane` + `margin` sur `messageBrowser` | `position: fixed` + `padding` sur body |
| Détection | `mailTab: true` dans `messageDisplay` | `mailTab: false` |
| Redimensionnement | Poignée verticale (bottom) ou horizontale (sidebar) | Poignée horizontale |

### 6. Globals non disponibles en contexte chrome

Le contexte Experiment API (contexte chrome) **n'a PAS accès** aux globals web standard :

- ❌ `setTimeout`, `clearTimeout` → ✅ Importer depuis `Timer.sys.mjs` : `ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs")`
- ❌ `window`, `document` → ✅ Accéder via `context.extension.tabManager` et `chromeBrowser.contentWindow`
- ❌ `fetch` → ✅ Utiliser `Services.io` ou `XMLHttpRequest`

## Pièges courants

1. **Fuite mémoire** : toujours nettoyer les éléments DOM injectés quand le message change (via `onMessageDisplayed` ou `onMessagesDisplayOff`)
2. **Race conditions** : l'utilisateur peut changer de message avant que Gloda ait fini sa requête → vérifier que le message est toujours le message courant avant d'afficher le résultat
3. **Thème sombre** : utiliser les variables CSS de Thunderbird (`--lwt-*`, `--color-*`) plutôt que des couleurs en dur
4. **Encodage des snippets** : les snippets de Gloda peuvent contenir des entités HTML → les traiter comme du texte brut (`textContent`, jamais `innerHTML`)
5. **Messages sans fil** : un message peut ne pas avoir de fil Gloda (non indexé, ou fil d'un seul message) → gérer ce cas gracieusement

## Conventions de code

- **Langue du code** : anglais (noms de variables, fonctions, commentaires techniques)
- **Langue de l'UI** : via i18n (`_locales/`)
- **Style** : ESLint avec la configuration `.eslintrc.json` du projet
- **Modules** : le background utilise les ES modules (`"type": "module"` dans le manifest)
- **Pas de bundler** : le code est directement empaquété dans le XPI sans transformation
