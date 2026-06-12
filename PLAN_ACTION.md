# Plan d'action — Magic Threads

*Découlant du [rapport d'audit](RAPPORT_AUDIT.md) du 12 juin 2026. Quatre phases, par priorité décroissante. Chaque action est localisée et autoporteuse.*

---

## Phase 1 — Correctifs immédiats (bugs avérés) → v2.1.2 ✅ FAIT (12/06/2026)

*Effort estimé : ~1 journée. Aucun changement fonctionnel visible hormis les réparations.*

- [x] **1.1 Corriger la portée de `pendingResizeHandle`** — `magicThreadsWindowApi.js:582` : remonter la déclaration `let pendingResizeHandle = null` au niveau de `buildBannerDOM` (avant le `if (layoutMode === "sidebar")`). Répare le redimensionnement en sidebar gauche et 2 erreurs ESLint. *Test : sidebar gauche en onglet message → la poignée apparaît et fonctionne.*
- [x] **1.2 Compteur de requêtes par onglet** — `background.js:83` : remplacer `currentRequestId` global par une `Map<tabId, requestId>`. *Test : ouvrir un message en nouvel onglet puis changer vite la sélection 3-pane → les deux panneaux s'affichent.*
- [x] **1.3 Invalider les requêtes en vol au masquage** — `background.js:130-144` : incrémenter le compteur de l'onglet dans les branches `hideBanner` (désélection, multi-sélection). *Test : sélectionner un message puis désélectionner aussitôt → le panneau ne réapparaît pas.*
- [x] **1.4 Re-vérifier le requestId juste avant `showBanner`** — `background.js:118` : second contrôle après les lectures de préférences ; en profiter pour charger les 4 préférences en `Promise.all` avant la requête Gloda.
- [x] **1.5 Mettre le lint au vert** — supprimer les commentaires `/* global */` redondants (`glodaApi.js:5`, `magicThreadsWindowApi.js:5`), ajouter un override `sourceType: "script"` pour `experiment-api/` dans `.eslintrc.json`. *Vérification : `npx eslint background/ experiment-api/ options/` → 0 erreur.*
- [x] **1.6 Timeout sur la 2ᵉ requête Gloda** — `glodaApi.js:94-108` : appliquer le même timeout 10 s que `getGlodaMessages`; annuler le timer en cas d'exception synchrone (`glodaApi.js:73-91`).
- [x] **1.7 Supprimer le log d'URI de message** — `magicThreadsWindowApi.js:1042` (point sécurité : fuite de métadonnées en console).

## Phase 2 — Durcissement sécurité & nettoyage → v2.2.0

*Effort estimé : 1-2 journées. Priorité sécurité ; prérequis sérieux avant soumission ATN.*

- [ ] **2.1 Typer strictement les schémas Experiment** — `magicThreadsWindowSchema.json` : remplacer `threadDataJSON`/`labelsJSON` (chaînes JSON) par un `array` à `items` typés (`id: integer`, `author/snippet: string`…) et un `object` à propriétés énumérées, avec `additionalProperties: false` ; ajouter des `enum` sur `navigationMode`, `sidebarPosition`, `mainViewPosition`. Adapter `background.js:118-126` et `magicThreadsWindowApi.js:930-934` (plus de `JSON.parse`). **C'est la remarque la plus probable d'un relecteur Mozilla.**
- [ ] **2.2 Étendre `onShutdown`** — `magicThreadsWindowApi.js:1071` : énumérer aussi les fenêtres `mail:messageWindow` ; restaurer `messagePane.style.position` (posé en `:799-801`, jamais restauré).
- [ ] **2.3 Fiabiliser le drag de redimensionnement** — `magicThreadsWindowApi.js:490-579` : passer aux Pointer Events avec `setPointerCapture` (supprime les listeners orphelins sur le document, ajoute le support tactile).
- [ ] **2.4 Trancher l'option fantôme « left »** (3-pane). Recommandé : suppression complète — retirer le remap `background.js:35-37` au profit d'une **migration de la valeur stockée** (au chargement : `"left"` → `"right"` + `storage.set`, aussi dans `options.js:45-48`), supprimer le code mort (`magicThreadsWindowApi.js:952`), les clés `optMainViewLeft*` des 7 locales, et tracer dans le CHANGELOG.
- [ ] **2.5 Nettoyages divers** — supprimer le code mort `_resizeObserver` (`magicThreadsWindowApi.js:25-29`) ; remplacer `0x10000000` par `Ci.nsMsgMessageFlags.Attachment` (`glodaApi.js:140,160`) ; `normalizeDate` → `0` au lieu de `Date.now()` (`glodaApi.js:114`) ; recréer le conteneur si `sidebarPosition` change en onglet message (`magicThreadsWindowApi.js:867-913`, calquer sur `injectSide3Pane:782-786`) ; ouvrir avant de fermer dans `navigateMessageTab` (`:1036-1040`) ; réduire les `console.log` (garder warn/error), en anglais.

## Phase 3 — Accessibilité & i18n → v2.3.0

*Effort estimé : 2-3 journées. Lève le principal point noir UX.*

- [ ] **3.1 Navigation clavier du panneau** — `magicThreadsWindowApi.js:662-709` : `role="list"` sur la liste, items avec `tabindex="0"` + `role="button"` + handler Entrée/Espace, style `:focus-visible` dans le Shadow DOM. **Constat le plus sévère de l'audit UX.**
- [ ] **3.2 Contrastes WCAG AA** — `magicThreadsWindowApi.js:119-165` : ajuster `--text-muted` (≈ `#5a6675` clair / `#8a93a3` sombre) pour atteindre 4,5:1 ; idéalement basculer la palette sur les variables de thème TB (`--lwt-*`, `--color-*`) comme AGENTS.md le préconise déjà.
- [ ] **3.3 États accessibles** — `aria-expanded` sur le bouton réduire (`:623-660`) ; libellé « Non lu » (nouvelle clé i18n) au lieu du point rouge seul (`:264-269`) ; `role="separator"` + flèches clavier sur les poignées ; `role="status"` sur le feedback des options (`options.html:144`) ; `<fieldset>/<legend>` pour les groupes de radios ; couleurs des options compatibles thème sombre (`options.html:45,52`).
- [ ] **3.4 Corrections de traduction** — es/pt : « anticronológico » (coquille, `messages.json:161`) et « Archivados »/« Arquivados » (faux-sens, `:61`) ; vi : unifier « chuỗi », reformuler « thẻ gốc mới » ; passer `DEFAULT_LABELS` en anglais (`magicThreadsWindowApi.js:45-61`).
- [ ] **3.5 Feedback quand Gloda est indisponible** — détecter index désactivé/absent (`glodaApi.js:29-33`) et l'indiquer (message dans le panneau ou la page d'options) au lieu d'une extension silencieusement inerte.

## Phase 4 — Pérennité & publication (fond de roadmap)

- [ ] **4.1 Préparer l'après-Gloda (Panorama)** — concevoir un résolveur alternatif derrière `threadResolver.js` (parcours `References`/`In-Reply-To` via `messages.getFull` + `messages.query({headerMessageId})`), même en mode dégradé ; surveiller source-docs.thunderbird.net/panorama. **À ne pas découvrir le jour où une ESR retire Gloda.**
- [ ] **4.2 Avant toute soumission ATN** — ~~changer l'ID~~ (fait en 2.1.2 : `magic-threads@mtfkarukera.net`) ; ajouter `icons` au manifest ; inclure LICENSE dans le XPI (`build.sh:35-46`) ; rédiger la justification des deux Experiment APIs ; extraction de version robuste dans `build.sh:14`.
- [ ] **4.3 Mettre les docs à niveau** — ARCHITECTURE.md : `getMessageCollectionForHeaders` (pas `GlodaMsgSearcher`), les 3 chemins réels de navigation, les 2 écouteurs (`onSelectedMessagesChanged` + `onMessageDisplayed`), retirer « gauche » 3-pane ; AGENTS.md : idem + corriger `onMessagesDisplayOff` (inexistant) ; CHANGELOG : corriger « beside ».
- [ ] **4.4 Refactoring de `magicThreadsWindowApi.js`** (1 117 lignes) — extraire les CSS en constantes de module, `attachResizeBehavior()` factorisé, `buildThreadItem()` ; constantes nommées pour `300`, `150/600`, `10000`… Réduit le risque de récidive du bug 1.1.
- [ ] **4.5 Veille de compatibilité** — tester chaque beta/ESR de Thunderbird (DOM `about:3pane`, Gloda) ; anticiper MV3 (`onMessagesDisplayed`, event pages) et ESLint 9 (flat config). ⚠️ Correctif à la recommandation initiale de l'audit : le validateur ATN **exige** `strict_max_version` pour les extensions à Experiment APIs (ajouté en 2.1.2 : `151.*`) — à relever à chaque nouvelle version de TB validée.

---

## Récapitulatif

| Phase | Contenu | Effort | Version cible |
|---|---|---|---|
| 1 | Bugs avérés + lint au vert | ~1 j | 2.1.2 |
| 2 | Durcissement sécurité, option fantôme, nettoyages | 1-2 j | 2.2.0 |
| 3 | Accessibilité, contrastes, traductions | 2-3 j | 2.3.0 |
| 4 | Après-Gloda, publication ATN, docs, refactoring | continu | 3.x |

**Critères de sortie phase 1** : ESLint 0 erreur ; poignée visible en sidebar gauche ; pas de panneau périmé après changements rapides de sélection (test manuel multi-onglets).
