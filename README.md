# Magic Threads

Extension Thunderbird qui affiche le fil chronologique des e-mails (métadonnées, snippets, indicateur de pièces jointes) dans un panneau intégré au-dessous ou à côté du message.

> **Thunderbird 128+** requis — utilise des Experiment APIs (Gloda + Window API personnalisée).

## Fonctionnalités

- 📋 **Fil de discussion** : affiche tous les messages du fil avec expéditeur, date, extrait (snippet) de texte, dossier et tri configurable (antichronologique par défaut)
- 📎 **Indicateur de pièces jointes** : signale visuellement les messages contenant des fichiers joints
- 🖥️ **Panneau bottom** : s'affiche sous le message dans la vue 3-pane
- 📑 **Sidebar** : s'affiche à côté du message dans les onglets de message
- 🔄 **Position configurable** : choix entre bottom et droite en vue 3-pane
- ↕️ **Redimensionnable** : poignée de redimensionnement pour ajuster la hauteur/largeur du panneau
- 🌙 **Mode sombre** : adaptation automatique au thème de Thunderbird
- 🔒 **Isolation CSS** : Shadow DOM pour éviter les conflits avec l'interface native
- 🌍 **Multilingue** : interface traduite en 7 langues
- 🧭 **Navigation intra-onglet** : clic sur un message ouvre celui-ci sans quitter l'onglet courant

## Installation

### Depuis un fichier XPI

1. Construire l'extension (voir [Développement](#développement))
2. Dans Thunderbird : **Modules complémentaires** → ⚙️ → **Installer depuis un fichier…**
3. Sélectionner le fichier `dist/magic-threads.xpi`

### Depuis les sources

```bash
git clone <url-du-dépôt>
cd magic-threads-b
bash build.sh
```

## Configuration

Accéder aux options via **Modules complémentaires** → **Magic Threads** → **Options** :

| Option | Description | Valeurs |
|--------|-------------|---------|
| Mode de navigation | Comportement au clic sur un message du fil | Intra-onglet / Nouvel onglet |
| Position du sidebar (onglet message) | Position du panneau latéral dans les onglets de message | Gauche / Droite |
| Position en vue principale (3-pane) | Position du panneau en vue 3-pane | Bottom / Droite |
| Ordre de tri | Sens d'affichage des messages du fil | Antichronologique (plus récent en haut) [Défaut] / Chronologique (plus ancien en haut) |

> [!NOTE]
> **Comportement des onglets ouverts :** Les onglets de message déjà ouverts conservent la disposition appliquée lors de leur ouverture. Un changement de préférence ne s'applique qu'aux nouveaux messages affichés. Pour appliquer immédiatement les nouvelles préférences, fermez et ré-ouvrez l'onglet.

## Langues supportées

| Code | Langue |
|------|--------|
| `fr` | Français |
| `en` | English |
| `de` | Deutsch |
| `ja` | 日本語 |
| `es` | Español |
| `pt` | Português |
| `vi` | Tiếng Việt |

## Architecture

L'extension utilise deux **Experiment APIs** pour accéder aux fonctionnalités internes de Thunderbird :

- **Gloda API** (`convGloda`) : interroge le moteur d'indexation Gloda via XPCOM pour récupérer les fils de discussion
- **Window API** (`magicThreadsWindow`) : injecte le panneau dans le DOM de Thunderbird via Shadow DOM

```
Sélection message → messageDisplay.onMessageDisplayed
    → background.js → ThreadResolver → Gloda API → XPCOM/Gloda
    → données du fil → showBanner → Window API → Shadow DOM
```

### Structure du projet

```
magic-threads-b/
├── manifest.json                          # Manifest v2, TB 128+
├── background/
│   ├── background.js                      # Événements, navigation, préférences
│   └── threadResolver.js                  # Couche d'accès aux données (Gloda)
├── experiment-api/
│   ├── glodaApi.js                        # Experiment API Gloda (XPCOM)
│   ├── glodaSchema.json                   # Schéma de l'API Gloda
│   ├── magicThreadsWindowApi.js           # Experiment API Window (DOM, Shadow DOM)
│   └── magicThreadsWindowSchema.json      # Schéma de l'API Window
├── options/
│   ├── options.html                       # Page de paramètres
│   └── options.js                         # Persistance des paramètres
├── _locales/                              # Fichiers de traduction i18n
├── LICENSE                                # Mozilla Public License 2.0
├── README.md                              # Ce fichier
├── CHANGELOG.md                           # Journal des modifications
├── ARCHITECTURE.md                        # Documentation d'architecture
├── build.sh                               # Script de construction du XPI
├── .eslintrc.json                         # Configuration ESLint
└── .gitignore                             # Fichiers ignorés par Git
```

## Développement

### Prérequis

- Thunderbird 128 ou supérieur
- `zip` (pour la construction du XPI)
- Node.js + ESLint (optionnel, pour le linting)

### Construction

```bash
bash build.sh
```

Le fichier XPI est généré dans `dist/magic-threads-VERSION.xpi` avec un lien symbolique `dist/magic-threads.xpi`.

### Linting

```bash
npx eslint background/ experiment-api/ options/
```

### Test

1. Construire le XPI : `bash build.sh`
2. Installer dans Thunderbird : **Modules complémentaires** → ⚙️ → **Installer depuis un fichier…**
3. Sélectionner un message faisant partie d'un fil de discussion
4. Vérifier l'apparition du panneau avec les métadonnées du fil

## Licence

Ce projet est sous licence [Mozilla Public License 2.0](LICENSE).
