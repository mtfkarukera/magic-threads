# Rapport d'audit — Magic Threads v2.1.1

*Audit réalisé le 12 juin 2026 par quatre revues spécialisées et complémentaires : sécurité, robustesse du code, compatibilité Thunderbird, i18n/UX/documentation. Ce rapport vulgarise les constats ; les références fichier:ligne permettent de retrouver chaque point dans le code.*

---

## L'essentiel en 30 secondes

**La sécurité est saine** : aucune vulnérabilité critique ou élevée. Pas d'injection possible depuis le contenu des e-mails, pas de communication réseau, permissions minimales, aucune primitive dangereuse (`eval`, etc.).

**Mais l'extension a trois vrais problèmes fonctionnels** : un bug de portée JavaScript qui casse silencieusement le redimensionnement en sidebar gauche, des conditions de course qui peuvent afficher le mauvais fil ou rien du tout, et un panneau totalement inutilisable au clavier.

**Et un risque stratégique** : l'extension repose sur Gloda, un composant interne de Thunderbird officiellement condamné (projet Panorama).

| Domaine | Verdict |
|---|---|
| 🔒 Sécurité | ✅ Sain — durcissement recommandé |
| ⚙️ Robustesse | ⚠️ 3 bugs sérieux, lint en échec |
| 🔌 Compatibilité | ⚠️ Solide aujourd'hui, fragile demain (Gloda, DOM interne) |
| 🌍 i18n / UX / Docs | ⚠️ i18n solide, accessibilité absente, docs en retard |

---

## 1. Sécurité — verdict : SAIN ✅

C'était le point d'attention prioritaire. L'enjeu : les Experiment APIs s'exécutent avec les **privilèges maximaux** de Thunderbird (équivalent code natif), et le panneau affiche du contenu **contrôlé par n'importe quel expéditeur d'e-mail** (sujets, extraits, noms). Un seul `innerHTML` mal placé et un e-mail piégé pourrait exécuter du code privilégié.

**Ce qui a été vérifié et est conforme :**

- Tout le contenu d'e-mail est rendu via `textContent` (texte brut, jamais interprété comme du HTML). Aucun `innerHTML`, `eval`, `new Function` ou import dynamique dans tout le projet.
- **Zéro communication réseau** : aucune donnée ne quitte la machine.
- Permissions minimales et justifiées (`messagesRead`, `accountsRead`, `storage`). Seules 4 préférences d'affichage sont stockées, jamais de contenu d'e-mail.
- Le nettoyage à la désinstallation (`onShutdown`) existe — rare et appréciable.

**Points de durcissement (aucun n'est exploitable en l'état) :**

| Sévérité | Constat | En clair |
|---|---|---|
| Moyenne | Données passées en JSON-chaîne entre le background et l'API privilégiée (`magicThreadsWindowSchema.json`) | Le « contrat » entre la partie non privilégiée et la partie privilégiée n'est pas vérifié par Thunderbird. Comme passer un colis scellé au lieu d'un colis inspecté à la douane : sans danger aujourd'hui, mais une défense en profondeur en moins. C'est LA remarque qu'un relecteur Mozilla ferait. |
| Faible | `onShutdown` ne nettoie que les fenêtres principales (`magicThreadsWindowApi.js:1071`) | Un panneau injecté dans une fenêtre message autonome survivrait à la désinstallation. |
| Faible | Un `console.log` trace l'URI complète d'un message (`magicThreadsWindowApi.js:1042`) | Des métadonnées (serveur, dossier) finissent dans la console globale, lisible par d'autres extensions. |
| Faible | Listeners de redimensionnement posés sur le document pendant un glisser (`:512`, `:577`) | Peuvent survivre brièvement à la destruction du panneau. |

---

## 2. Robustesse — 3 bugs sérieux ⚠️

### 2.1 Le bug de la variable fantôme (confirmé par 3 revues sur 4)

`magicThreadsWindowApi.js:582` vs `:716` — la variable `pendingResizeHandle` est déclarée **à l'intérieur** d'un bloc `if`, mais utilisée **après** ce bloc. En JavaScript, une variable `let` n'existe que dans son bloc : à la ligne 716, elle a disparu. Le garde-fou `typeof` masque l'erreur au lieu de la révéler.

**Conséquence concrète : la poignée de redimensionnement n'apparaît jamais en sidebar gauche.** La fonctionnalité est silencieusement cassée, alors que le README la promet. Le lint du projet (ESLint) détecte ce bug (`no-undef`) — il suffisait de le lancer.

### 2.2 Conditions de course (affichage du mauvais fil)

La récupération du fil est asynchrone (requête Gloda). Le code protège contre les résultats périmés avec un compteur de requêtes, mais ce mécanisme a trois failles (`background.js:83-144`) :

- **Le compteur est global** alors que les requêtes concernent des onglets différents : sélectionner un message dans la fenêtre principale peut annuler l'affichage du panneau d'un onglet qui vient de s'ouvrir.
- **Masquer le panneau n'annule pas les requêtes en vol** : désélectionner un message puis attendre peut faire réapparaître le panneau d'un message qui n'est plus affiché.
- **La vérification arrive trop tôt** : cinq opérations asynchrones s'exécutent encore après le contrôle, laissant une fenêtre pour qu'un résultat périmé écrase un résultat frais.

### 2.3 Divers

Requête Gloda secondaire sans timeout (`glodaApi.js:96` — la première en a un, pas la seconde) ; un message sans date est daté de « maintenant » et remonte en tête du fil (`glodaApi.js:114`) ; option « position du sidebar » ignorée si on la change pendant qu'un onglet message est ouvert (`magicThreadsWindowApi.js:867`) ; **lint en échec : 7 erreurs** ; fichier de 1 117 lignes difficile à maintenir, code mort (nettoyage d'un `ResizeObserver` jamais créé).

---

## 3. Compatibilité Thunderbird — solide aujourd'hui, fragile demain ⚠️

### 3.1 Gloda est condamné (sévérité élevée, échéance inconnue)

L'extension récupère les fils via **Gloda**, le moteur d'indexation historique de Thunderbird. Le projet officiel **Panorama** (nouvelle base de données) prévoit explicitement de le **supprimer**. Pas de date annoncée, mais c'est une certitude à moyen terme. Bonne nouvelle : l'architecture du projet (couche `threadResolver.js` isolée) est exactement ce qu'il faut pour brancher un résolveur alternatif (parcours des en-têtes `References`/`In-Reply-To` via les APIs WebExtension standard).

Par ailleurs, **si l'utilisateur a désactivé Gloda** dans ses préférences, l'extension devient inerte **sans aucun message** — l'utilisateur croit qu'elle est cassée.

### 3.2 Le DOM interne n'est pas un contrat

Le panneau s'injecte en repérant des éléments internes de l'interface (`messagePane`, `messageBrowser`, `about:3pane`). Ces éléments ont déjà changé entre les versions et changeront encore. Aucune alternative WebExtension pure n'existe pour ce placement : la mitigation est de **tester chaque version ESR et beta**. Les garde-fous présents (try/catch, fallbacks) sont bons.

### 3.3 Avant une publication sur addons.thunderbird.net

- **L'ID `magicthreads-b@xulforum.org` pose problème** : `xulforum.org` est le domaine de l'extension Thunderbird Conversations. L'ID étant **définitif après première publication**, à corriger avant toute soumission.
- Les Experiment APIs imposent une revue manuelle stricte : prévoir une justification écrite. Le code est en bonne position (non minifié, propre, permissions minimales).
- Pas d'icônes dans le manifest ; LICENSE absente du XPI ; ~15 `console.log` verbeux en français.
- Côté positif vérifié : versionnage cohérent partout, XPI identique octet à octet aux sources, manifest correct pour TB 128+, MV2 encore supporté sans date de fin.

### 3.4 L'option fantôme « gauche »

L'option « panneau à gauche » en vue principale a été retirée de la page d'options, mais ses vestiges traînent partout : `background.js:35-37` convertit silencieusement `"left"` en `"right"`, le code de gestion existe toujours, les clés de traduction subsistent dans les 7 langues, et ARCHITECTURE.md/AGENTS.md la documentent encore. Un utilisateur ayant choisi « gauche » avec une ancienne version voit une page d'options mensongère (radio « bottom » coché, comportement réel « droite »).

---

## 4. i18n, accessibilité, documentation ⚠️

### 4.1 i18n : socle solide, finitions à faire

Les 7 langues contiennent exactement les **mêmes 40 clés**, placeholders cohérents — vérification programmatique, parité parfaite. Tous les libellés du panneau passent par i18n. À corriger : coquille « antichro**o**nológico » en espagnol ET portugais (visible dans les options), faux-sens « Archivos/Arquivos » (= « fichiers », pas « archivés »), incohérences en vietnamien, et textes de secours codés en dur **en français** (un Allemand verrait du français en cas de pépin — l'anglais serait le bon choix).

### 4.2 Accessibilité : le point noir (sévérité élevée)

**Le panneau est inutilisable au clavier.** Les messages du fil sont de simples `<div>` cliquables : pas de focus, pas de rôle ARIA, pas de touche Entrée. Un utilisateur de lecteur d'écran ou navigant au clavier ne peut pas utiliser la fonction principale de l'extension. S'y ajoutent : contrastes insuffisants (dates et extraits sous les seuils WCAG, surtout en thème sombre : ratio 2,3:1 pour 4,5:1 requis), redimensionnement souris-seulement, état réduit/déplié non annoncé, indicateur « non lu » porté par la couleur seule.

### 4.3 Documentation : le README est juste, le reste a pris du retard

ARCHITECTURE.md et AGENTS.md décrivent une option « gauche » qui n'existe plus, un mécanisme Gloda (`GlodaMsgSearcher`) qui n'est pas celui utilisé, une logique de navigation inexacte, et omettent l'écouteur principal (`onSelectedMessagesChanged`). AGENTS.md édicte même une règle (« variables CSS de thème TB, pas de couleurs en dur ») que le code ne respecte pas — piégeux pour tout futur contributeur (humain ou IA). Le CHANGELOG mentionne une valeur « beside » qui n'a jamais existé.

---

## Tableau de synthèse

| # | Constat | Sévérité | Domaine |
|---|---|---|---|
| 1 | Panneau inutilisable au clavier | Élevée | Accessibilité |
| 2 | Bug de portée `pendingResizeHandle` → resize sidebar gauche cassé | Élevée | Robustesse |
| 3 | Conditions de course (compteur global, hideBanner, vérif. trop tôt) | Élevée | Robustesse |
| 4 | Dépendance Gloda condamnée (Panorama) | Élevée (terme) | Compatibilité |
| 5 | Dépendance au DOM interne sans contrat de stabilité | Élevée (terme) | Compatibilité |
| 6 | Schémas Experiment non typés (JSON-chaîne, pas d'enum) | Moyenne | Sécurité |
| 7 | Option fantôme « left » (remap silencieux, options mensongères, clés orphelines) | Moyenne | Cohérence |
| 8 | Gloda désactivé → extension inerte sans feedback | Moyenne | UX |
| 9 | Contrastes WCAG insuffisants | Moyenne | Accessibilité |
| 10 | Coquilles/faux-sens es, pt, vi | Moyenne | i18n |
| 11 | Docs ARCHITECTURE/AGENTS périmées | Moyenne | Docs |
| 12 | ID gecko `@xulforum.org`, icônes absentes, log URI, nettoyages incomplets, lint en échec, timeout manquant, etc. | Faible | Divers |

**Conclusion.** Le module est sain là où c'était le plus important — la sécurité — et bien architecturé (Shadow DOM, couche d'abstraction Gloda, onShutdown). Les corrections prioritaires sont peu nombreuses, bien localisées et détaillées dans le [plan d'action](PLAN_ACTION.md).
