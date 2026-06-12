# Architecture de Magic Threads

Ce document décrit l'architecture technique de l'extension Magic Threads pour Thunderbird.

## Flux de données global

```mermaid
flowchart TD
    A["Utilisateur sélectionne un message"] --> B["messageDisplay.onMessageDisplayed"]
    B --> C["background.js"]
    C --> D["threadResolver.js"]
    D --> E["browser.convGloda.getThreadMessages()"]
    E --> F["glodaApi.js (Experiment API)"]
    F --> G["XPCOM / Gloda / GlodaMsgSearcher"]
    G --> H["Données du fil (JSON)"]
    H --> D
    D --> C
    C --> I["browser.magicThreadsWindow.showBanner()"]
    I --> J["magicThreadsWindowApi.js (Experiment API)"]
    J --> K["Injection Shadow DOM dans le document"]
    K --> L["Panneau affiché avec métadonnées"]

    style A fill:#4a9eff,color:#fff
    style G fill:#ff6b6b,color:#fff
    style L fill:#51cf66,color:#fff
```

## Composants

### 1. Background Scripts (contexte WebExtension)

#### `background/background.js`

Point d'entrée de l'extension. Responsabilités :

- **Écoute des événements** : `browser.messageDisplay.onMessageDisplayed` pour détecter la sélection d'un message
- **Coordination** : orchestre les appels entre le ThreadResolver et l'API Window
- **Préférences** : lit et applique les paramètres utilisateur via `browser.storage.sync` (avec fallback depuis `browser.storage.local`)
- **Navigation** : gère les clics sur les messages du fil (intra-onglet ou nouvel onglet)
- **Détection du contexte** : distingue la vue 3-pane des onglets message

#### `background/threadResolver.js`

Proxy simple (Data Access Layer) pour l'accès aux données :

- Appelle `browser.convGloda.getThreadMessages()` avec l'identifiant du message
- Délègue entièrement à l'Experiment API Gloda sans transformation ni formatage
- Retourne directement les résultats de l'API sans normalisation
- Gère les cas d'erreur (API non disponible, message non indexé)

### 2. Experiment APIs (contexte chrome)

#### `experiment-api/glodaApi.js`

Experiment API pour l'accès à Gloda :

```mermaid
flowchart LR
    A["background.js"] -->|"browser.convGloda.getThreadMessages(msgId)"| B["glodaApi.js"]
    B --> C["GlodaMsgSearcher"]
    C --> D["Base Gloda (SQLite)"]
    D --> C
    C --> B
    B -->|"JSON: messages du fil"| A

    style B fill:#ffa94d,color:#fff
    style D fill:#ff6b6b,color:#fff
```

- S'exécute dans le contexte chrome avec accès XPCOM complet
- Utilise `GlodaMsgSearcher` pour rechercher les messages par conversation
- Retourne un tableau JSON sérialisable de métadonnées de messages
- Schéma défini dans `glodaSchema.json`

#### `experiment-api/magicThreadsWindowApi.js`

Experiment API pour l'injection DOM :

- Accède au document de la fenêtre Thunderbird active
- Crée et injecte le panneau dans un **Shadow DOM**
- Gère les trois modes d'affichage (bottom panel en 3-pane / sidebar en 3-pane / sidebar en onglet message)
- Injecte les styles CSS dans le Shadow DOM
- Gère le nettoyage du DOM quand le message change
- Schéma défini dans `magicThreadsWindowSchema.json`

### 3. Options (contexte WebExtension)

#### `options/options.html` + `options.js`

Page de paramètres accessible depuis le gestionnaire de modules complémentaires :

- **Mode de navigation** : intra-onglet ou nouvel onglet
- **Position du sidebar** en onglet message : gauche ou droite
- **Position du panneau** en vue 3-pane : bottom, gauche ou droite
- Persistance via `browser.storage.sync` (avec fallback depuis `browser.storage.local`)

## Structure du Shadow DOM

Le panneau injecté utilise un Shadow DOM pour l'isolation CSS complète :

```mermaid
flowchart TD
    A["Document Thunderbird (XUL/HTML)"] --> B["Conteneur hôte (div/vbox)"]
    B --> C["Shadow Root (mode: open)"]
    C --> D["<style> — Styles du panneau"]
    C --> E["Conteneur principal"]
    E --> F["En-tête (titre, compteur)"]
    E --> G["Liste des messages"]
    G --> H["Message 1 : expéditeur, date, snippet, dossier, 📎"]
    G --> I["Message 2 : expéditeur, date, snippet, dossier"]
    G --> J["Message N : ..."]
    E --> K["Poignée de redimensionnement"]

    style C fill:#be4bdb,color:#fff
    style D fill:#ffa94d,color:#fff
```

### Pourquoi Shadow DOM ?

1. **Isolation CSS** : les styles du panneau ne peuvent pas affecter l'interface native de Thunderbird
2. **Protection contre les styles externes** : les styles de Thunderbird ne polluent pas le panneau
3. **Encapsulation** : le DOM interne n'est pas accessible par d'autres extensions ou scripts

## Architecture CSS

### Styles partagés

Les styles communs aux trois modes (bottom, sidebar 3-pane et sidebar onglet message) sont définis dans une base commune :

- Typographie et couleurs (variables CSS)
- Styles des éléments de message (expéditeur, date, snippet)
- Indicateur de pièces jointes
- Mise en surbrillance du message courant
- Adaptation au thème sombre via `prefers-color-scheme` et variables `--lwt-*`

### Styles spécifiques au mode

| Mode | Contexte | Disposition | Redimensionnement |
|------|----------|-------------|-------------------|
| **Bottom** | Vue 3-pane | Vertical, sous le message | Poignée verticale (hauteur) |
| **Sidebar (3-pane)** | Vue 3-pane | Horizontal, à côté du message | Poignée horizontale (largeur) |
| **Sidebar (onglet message)** | Onglet message | Horizontal, à côté du message | Poignée horizontale (largeur) |

## Logique de navigation

```mermaid
flowchart TD
    A["Événement messageDisplay.onMessageDisplayed"] --> B{"mailTab ?"}
     B -->|"Oui (vue 3-pane)"| C["Lire préférence mainViewPosition"]
     C --> D{"Position ?"}
     D -->|"bottom"| E["Injecter panneau bottom"]
     D -->|"left"| F1["Injecter sidebar gauche"]
     D -->|"right"| F2["Injecter sidebar droite"]
     B -->|"Non (onglet message)"| G["Lire préférence sidebarPosition"]
     G --> G1{"Position ?"}
     G1 -->|"left"| G2["Injecter sidebar gauche"]
     G1 -->|"right"| G3["Injecter sidebar droite"]

     E --> H["Poignée redimensionnement vertical"]
     F1 --> I["Poignée redimensionnement horizontal"]
     F2 --> I
     G2 --> I
     G3 --> I

    style B fill:#4a9eff,color:#fff
    style D fill:#ffa94d,color:#fff
```

### Clic sur un message du fil

Quand l'utilisateur clique sur un message dans le panneau :

1. Le background script reçoit l'événement (via message passé depuis l'Experiment API)
2. Selon le mode de navigation configuré :
   - **Intra-onglet** : `browser.messageDisplay.open()` dans le même onglet
   - **Nouvel onglet** : `browser.messageDisplay.open()` dans un nouvel onglet

## Contraintes et problèmes connus

### Contraintes techniques

| Contrainte | Impact | Solution |
|-----------|--------|----------|
| Experiment APIs en contexte chrome | Pas d'accès à `browser.i18n` | Passer les traductions depuis le background |
| Dates cross-compartment XPCOM | `instanceof Date` échoue | Convertir en timestamp avant transmission |
| DOM en vue 3-pane | `messagePane` est un custom element HTML dans un grid CSS, `messageBrowser` est un `<browser>` XUL | Sidebar 3-pane utilise `position:absolute` dans le `messagePane` + marge sur `messageBrowser` |
| Shadow DOM ouvert | Accès possible au DOM interne pour le debugging | Toute la logique DOM dans l'Experiment API |
| Timer.sys.mjs obligatoire | `setTimeout`/`clearTimeout` non disponibles dans le contexte chrome | Import explicite depuis `resource://gre/modules/Timer.sys.mjs` |

### Limitations actuelles

- **Pas de mise à jour en temps réel** : si un nouveau message arrive dans le fil pendant l'affichage, le panneau ne se met pas à jour automatiquement
- **Dépendance à Gloda** : les messages non indexés par Gloda n'apparaissent pas dans le fil
- **Experiment APIs** : nécessitent une mise à jour si les APIs internes de Thunderbird changent entre versions majeures

## Diagramme des dépendances

```mermaid
graph LR
    subgraph "WebExtension (background)"
        BG["background.js"]
        TR["threadResolver.js"]
    end

    subgraph "Experiment APIs (chrome)"
        GA["glodaApi.js"]
        WA["magicThreadsWindowApi.js"]
    end

    subgraph "Thunderbird Internals"
        GLODA["Gloda (XPCOM)"]
        DOM["DOM natif (XUL/HTML)"]
    end

    subgraph "Configuration"
        OPT["options.js"]
         STORAGE["browser.storage.sync (fallback .local)"]
    end

    BG --> TR
    TR --> GA
    GA --> GLODA
    BG --> WA
    WA --> DOM
    BG --> STORAGE
    OPT --> STORAGE

    style GLODA fill:#ff6b6b,color:#fff
    style DOM fill:#ff6b6b,color:#fff
    style STORAGE fill:#51cf66,color:#fff
```
