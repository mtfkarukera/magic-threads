/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Magic Threads Window Experiment API
 * 
 * Injecte un panneau de fil de discussion directement dans le DOM chrome
 * de Thunderbird. Trois modes :
 * - 3-pane bottom : panneau en bas du message (avec poignée verticale)
 * - 3-pane sidebar : panneau latéral dans le 3-pane (avec poignée horizontale)
 * - Onglet message : sidebar latéral en position fixe (avec poignée horizontale)
 * 
 * Utilise le Shadow DOM pour l'isolation CSS.
 * Toutes les chaînes d'interface passent par le paramètre `labels` (i18n).
 */

// Bornes de redimensionnement du panneau
const BOTTOM_MIN_HEIGHT = 44;
const BOTTOM_MAX_HEIGHT = 600;
const SIDEBAR_MIN_WIDTH = 150;
const SIDEBAR_MAX_WIDTH = 600;
// Pas de redimensionnement au clavier (flèches sur la poignée)
const KEYBOARD_RESIZE_STEP = 16;
// Tailles par défaut des panneaux (px) et z-index d'empilement.
const SIDEBAR_DEFAULT_WIDTH = 300;
const SIDEBAR_COLLAPSED_WIDTH = 36;
const BOTTOM_DEFAULT_HEIGHT = 250;
const PANEL_Z_INDEX = 100;

// Feuilles de style du Shadow DOM, en constantes de module (aucune dépendance
// au contexte : hissées hors de getAPI pour alléger la fermeture).
const SHARED_CSS = `
        :host {
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
          color-scheme: light dark;

          /* Palette moderne adossée aux tokens Thunderbird Supernova (--layout-*, --color-*)
             avec fonctions standard light-dark() et color-mix() conformes WCAG 2.1 AA.
             Déclarée sur :host pour être visible de tout le shadow tree. */
          --banner-bg: var(--layout-background-1, light-dark(#f5f7f8, #1e222b));
          --banner-border: var(--layout-border-0, light-dark(#e1e4e6, #3e4451));
          --card-bg: var(--layout-background-0, light-dark(#ffffff, #282c34));
          --card-hover-bg: var(--layout-background-2, light-dark(#edf2f7, #353b45));
          --text-main: var(--layout-color-1, light-dark(#1a202c, #abb2bf));
          --text-muted: var(--layout-color-2, light-dark(#5a6675, #9fa8b7));
          --accent-border: var(--color-accent-primary, light-dark(#3182ce, #528bff));
          --accent-bg: light-dark(color-mix(in srgb, var(--accent-border) 10%, #ffffff), color-mix(in srgb, var(--accent-border) 18%, #1e222b));
          --accent-text: light-dark(#2b6cb0, #82aaff);
          --focus-color: var(--focus-outline-color, var(--accent-border));
          --folder-bg: light-dark(#edf2f7, #2d3139);
          --folder-text: light-dark(#4a5568, #abb2bf);
          --inbox-bg: light-dark(#ebf8ff, #1e3a5f);
          --inbox-text: light-dark(#2b6cb0, #82aaff);
          --sent-bg: light-dark(#f0fff4, #1b4d3e);
          --sent-text: light-dark(#276f4a, #a3e635);
          --archive-bg: light-dark(#fefcbf, #4d3d1b);
          --archive-text: light-dark(#8f5700, #fbbf24);
        }
        :host([hidden]) {
          display: none !important;
        }

        .threads-wrapper {
          background-color: var(--banner-bg);
          padding: 0 16px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          font-size: 13px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          container-type: inline-size;
          container-name: threadspanel;
        }

        /* Responsivité du volet étroit (<260px) via Container Queries native */
        @container threadspanel (max-width: 260px) {
          .threads-header {
            flex-wrap: wrap;
            gap: 4px;
          }
          .threads-nav-mode-btn .threads-nav-mode-label {
            display: none !important;
          }
          .threads-nav-mode-btn {
            padding: 2px 6px;
            border-radius: 4px;
          }
          .threads-title {
            font-size: 0.875em;
          }
          .thread-meta {
            flex-wrap: wrap;
            gap: 2px 4px;
          }
        }

        .threads-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
          flex-shrink: 0;
          user-select: none;
        }

        .threads-title {
          font-weight: 600;
          color: var(--text-main);
          font-size: 1em;
        }

        .threads-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .threads-nav-mode-btn,
        .threads-collapse-btn {
          background: none;
          border: 1px solid var(--banner-border);
          color: var(--text-main);
          cursor: pointer;
          border-radius: 4px;
          background-color: var(--card-bg);
          font-size: 0.85em;
          transition: background-color 0.2s, border-color 0.2s, color 0.2s;
        }

        .threads-nav-mode-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 2px 8px;
          border-radius: 12px;
          color: var(--text-muted);
        }

        .threads-nav-mode-btn svg {
          flex-shrink: 0;
          pointer-events: none;
        }

        .threads-nav-mode-btn:hover,
        .threads-collapse-btn:hover {
          background-color: var(--card-hover-bg);
          color: var(--text-main);
        }

        .threads-nav-mode-btn:hover {
          border-color: var(--accent-border);
        }

        .threads-collapse-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 2px 6px;
        }

        .threads-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding-bottom: 8px;
        }

        .threads-list.collapsed {
          display: none;
        }

        .thread-item {
          position: relative;
          background-color: var(--card-bg);
          border: 1px solid var(--banner-border);
          border-radius: 6px;
          padding: 8px 12px;
          cursor: pointer;
          transition: border-color 0.2s, background-color 0.2s, box-shadow 0.2s;
        }

        .thread-item:hover {
          background-color: var(--card-hover-bg);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        }

        .thread-item.current {
          border-color: var(--accent-border);
          background-color: var(--accent-bg);
          cursor: default;
          box-shadow: none;
        }

        /* Focus clavier nettement visible (items du fil, boutons, poignée).
           Offset négatif : l'anneau reste visible dans la liste défilante. */
        .thread-item:focus-visible,
        .threads-nav-mode-btn:focus-visible,
        .threads-collapse-btn:focus-visible,
        .resize-handle:focus-visible,
        .thread-detach-btn:focus-visible,
        .staging-btn:focus-visible {
          outline: 2px solid var(--focus-color);
          outline-offset: -2px;
        }

        /* Texte masqué visuellement mais annoncé par les lecteurs d'écran
           (technique de rognage, équivalent .sr-only) */
        .visually-hidden {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          padding: 0;
          border: 0;
          clip-path: inset(50%);
          overflow: hidden;
          white-space: nowrap;
        }

        .thread-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;
          flex-wrap: wrap;
        }

        .thread-author {
          font-weight: 600;
          color: var(--text-main);
        }

        .thread-item.unread .thread-author::after {
          content: " ●";
          color: #ff3b30;
          font-weight: bold;
          font-size: 0.75em;
        }

        .thread-date {
          color: var(--text-muted);
          font-size: 0.85em;
        }

        .thread-folder {
          font-size: 0.77em;
          font-weight: 500;
          padding: 1px 6px;
          border-radius: 4px;
          text-transform: uppercase;
          background-color: var(--folder-bg);
          color: var(--folder-text);
          margin-left: auto;
        }

        .thread-folder.inbox {
          background-color: var(--inbox-bg);
          color: var(--inbox-text);
        }

        .thread-folder.sent {
          background-color: var(--sent-bg);
          color: var(--sent-text);
        }

        .thread-folder.archive {
          background-color: var(--archive-bg);
          color: var(--archive-text);
        }

        .thread-snippet {
          color: var(--text-muted);
          font-size: 0.92em;
          line-height: 1.4;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .thread-item.unread .thread-snippet {
          color: var(--text-main);
          font-weight: 500;
        }

        .thread-indicators {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
        }

        .thread-attachment {
          display: inline-flex;
          align-items: center;
          color: var(--text-muted);
          line-height: 1;
        }

        .thread-badge-manual {
          display: inline-flex;
          align-items: center;
          color: var(--accent-text);
          line-height: 1;
        }

        .thread-detach-btn {
          position: absolute;
          right: 6px;
          bottom: 5px;
          width: 22px;
          height: 22px;
          padding: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          font-size: 1.1em;
          line-height: 1;
          border-radius: 4px;
          transition: color 0.15s ease, background-color 0.15s ease;
        }

        .thread-detach-btn:hover {
          color: #ff3b30;
          background-color: rgba(255, 59, 48, 0.12);
        }

        .thread-item.has-manual-link .thread-snippet {
          padding-right: 24px;
        }

        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            transition-duration: 0.01ms !important;
            scroll-behavior: auto !important;
          }
        }

        .staging-banner {
          background-color: var(--accent-bg);
          border: 1px solid var(--accent-border);
          border-radius: 6px;
          padding: 8px 10px;
          margin: 6px 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 0.92em;
        }

        .staging-title {
          font-weight: 600;
          color: var(--text-main);
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .staging-source-desc {
          color: var(--text-muted);
          font-size: 0.85em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .staging-options {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin: 2px 0;
        }

        .staging-option-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.85em;
          color: var(--text-main);
          cursor: pointer;
        }

        .staging-actions {
          display: flex;
          gap: 8px;
          margin-top: 4px;
        }

        .staging-btn {
          padding: 4px 10px;
          font-size: 0.85em;
          font-weight: 500;
          border-radius: 4px;
          cursor: pointer;
          border: 1px solid transparent;
        }

        .staging-btn-confirm {
          background-color: var(--accent-border);
          color: #ffffff;
        }

        @media (prefers-color-scheme: dark) {
          .staging-btn-confirm {
            color: #1e222b;
            font-weight: 600;
          }
        }

        .staging-btn-confirm:hover {
          filter: brightness(1.1);
        }

        .staging-btn-cancel {
          background-color: var(--card-bg);
          color: var(--text-main);
          border-color: var(--banner-border);
        }

        .staging-btn-cancel:hover {
          background-color: var(--card-hover-bg);
        }
      `;

const BOTTOM_CSS = `
        :host {
          width: 100%;
          overflow: hidden;
        }

        .resize-handle {
          height: 8px;
          flex-shrink: 0;
          cursor: ns-resize;
          background-color: var(--banner-border);
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='4'%3E%3Ccircle cx='4' cy='2' r='1.2' fill='%23666666'/%3E%3Ccircle cx='10' cy='2' r='1.2' fill='%23666666'/%3E%3Ccircle cx='16' cy='2' r='1.2' fill='%23666666'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: center;
          transition: background-color 0.2s;
          touch-action: none;
        }
        @media (prefers-color-scheme: dark) {
          .resize-handle {
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='4'%3E%3Ccircle cx='4' cy='2' r='1.2' fill='%23aaaaaa'/%3E%3Ccircle cx='10' cy='2' r='1.2' fill='%23aaaaaa'/%3E%3Ccircle cx='16' cy='2' r='1.2' fill='%23aaaaaa'/%3E%3C/svg%3E");
          }
        }
        .resize-handle:hover {
          background-color: var(--card-hover-bg);
        }

        .threads-wrapper {
          border-top: none;
          flex: 1;
          min-height: 0;
        }
      `;

const SIDEBAR_CSS = `
        :host {
          height: 100%;
          overflow: hidden;
          flex-direction: row;
        }
        .resize-handle {
          width: 8px;
          flex-shrink: 0;
          cursor: ew-resize;
          background-color: var(--banner-border);
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='20'%3E%3Ccircle cx='2' cy='4' r='1.2' fill='%23666666'/%3E%3Ccircle cx='2' cy='10' r='1.2' fill='%23666666'/%3E%3Ccircle cx='2' cy='16' r='1.2' fill='%23666666'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: center;
          transition: background-color 0.2s;
          touch-action: none;
        }
        @media (prefers-color-scheme: dark) {
          .resize-handle {
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='20'%3E%3Ccircle cx='2' cy='4' r='1.2' fill='%23aaaaaa'/%3E%3Ccircle cx='2' cy='10' r='1.2' fill='%23aaaaaa'/%3E%3Ccircle cx='2' cy='16' r='1.2' fill='%23aaaaaa'/%3E%3C/svg%3E");
          }
        }
        .resize-handle:hover {
          background-color: var(--card-hover-bg);
        }
        .threads-wrapper {
          height: 100%;
          max-height: none;
          border-top: none;
          flex: 1;
          min-height: 0;
        }
        .threads-wrapper.sidebar-left {
          border-right: none;
        }
        .threads-wrapper.sidebar-right {
          border-left: none;
        }
        .threads-wrapper.collapsed {
          padding: 0 4px;
        }
        .threads-wrapper.collapsed .threads-title,
        .threads-wrapper.collapsed .threads-nav-mode-btn {
          display: none;
        }
        .threads-wrapper.collapsed .threads-header {
          justify-content: center;
          padding: 6px 0;
        }
        .threads-wrapper.collapsed .threads-actions {
          gap: 0;
        }
        .threads-title {
          font-size: 12px;
        }
        /* Cartes compactes en mode Sidebar : disposition en grille structurée */
        .thread-meta {
          display: grid;
          grid-template-columns: 1fr auto;
          grid-template-rows: auto auto;
          align-items: center;
          column-gap: 6px;
          row-gap: 2px;
        }
        .thread-author {
          grid-column: 1;
          grid-row: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .thread-indicators {
          grid-column: 2;
          grid-row: 1;
          justify-self: end;
          margin-left: 0;
        }
        .thread-date {
          grid-column: 1;
          grid-row: 2;
        }
        .thread-folder {
          grid-column: 2;
          grid-row: 2;
          justify-self: end;
          margin-left: 0;
          max-width: 110px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `;

/**
 * Nettoie les styles appliqués par injectSide3Pane (position:absolute + margin).
 * Cette fonction est au niveau du module pour être accessible par getAPI() et onShutdown().
 */
function cleanupSidebar3PaneContainer(container, contentDoc) {
  // Restaurer les marges du messageBrowser
  let msgBrowserId = container.dataset.msgBrowserId;
  let msgBrowser = msgBrowserId ? contentDoc.getElementById(msgBrowserId) : contentDoc.getElementById("messageBrowser");
  if (msgBrowser) {
    msgBrowser.style.marginLeft = "";
    msgBrowser.style.marginRight = "";
  }
}

/**
 * Retire le conteneur Magic Threads d'un document de contenu (about:3pane ou
 * about:message) et restaure tous les styles natifs modifiés.
 * Utilisé par onShutdown pour tous les types de fenêtres.
 */
function cleanupInjectedDoc(contentDoc) {
  let container = contentDoc.getElementById("magic-threads-container");
  if (!container) return;
  // Sidebar onglet message : restaurer les paddings du body
  if (container.dataset.layoutContext === "messageTab") {
    let body = contentDoc.body || contentDoc.documentElement;
    if (body) {
      body.style.paddingLeft = "";
      body.style.paddingRight = "";
      body.style.boxSizing = "";
    }
  }
  // Sidebar 3-pane : restaurer marges du messageBrowser et position du messagePane
  if (container.dataset.layoutMode === "sidebar3pane") {
    cleanupSidebar3PaneContainer(container, contentDoc);
    let messagePane = contentDoc.getElementById("messagePane");
    if (messagePane) {
      messagePane.style.position = "";
    }
  }
  container.remove();
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Crée un élément SVG standard sécurisé via createElementNS.
 */
function createSvg(doc, width, height, viewBox) {
  let svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.style.display = "inline-block";
  svg.style.verticalAlign = "middle";
  return svg;
}

/**
 * Crée une icône commutation / onglet courant SVG monochrome (14x14).
 * Représente la bascule intra-onglet (flèches opposées en boucle).
 */
function createCurrentTabIcon(doc) {
  let svg = createSvg(doc, 14, 14, "0 0 16 16");
  let path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("fill-rule", "evenodd");
  path.setAttribute("d", "M5.22 1.47a.75.75 0 0 1 1.06 0l2.25 2.25a.75.75 0 0 1 0 1.06l-2.25 2.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L6.44 4.75H2.75a.75.75 0 0 1 0-1.5h3.69L5.22 2.53a.75.75 0 0 1 0-1.06zm5.56 8a.75.75 0 0 1 0 1.06l-1.22 1.22h3.69a.75.75 0 0 1 0 1.5h-3.69l1.22 1.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215l-2.25-2.25a.75.75 0 0 1 0-1.06l2.25-2.25a.75.75 0 0 1 1.06 0z");
  svg.appendChild(path);
  return svg;
}

/**
 * Crée une icône nouvel onglet / flèche externe SVG monochrome (14x14).
 */
function createNewTabIcon(doc) {
  let svg = createSvg(doc, 14, 14, "0 0 16 16");
  let path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("fill-rule", "evenodd");
  path.setAttribute("d", "M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2zm6.88-1a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V3.31l-5.47 5.47a.75.75 0 0 1-1.06-1.06l5.47-5.47H11.38a.75.75 0 0 1-.75-.75z");
  svg.appendChild(path);
  return svg;
}

/**
 * Met à jour le bouton de mode de navigation avec l'icône SVG et le libellé textuel.
 */
function updateNavModeButton(btn, mode, labels, doc) {
  while (btn.firstChild) {
    btn.firstChild.remove();
  }
  let isCurrent = mode === "currentTab";
  let labelText = isCurrent ? (labels.modeCurrentTab || "Current tab") : (labels.modeNewTab || "New tab");
  let tooltipText = isCurrent ? (labels.tooltipCurrentTab || "Click switches the message in the active tab") : (labels.tooltipNewTab || "Click opens the message in a new tab");

  let icon = isCurrent ? createCurrentTabIcon(doc) : createNewTabIcon(doc);
  btn.appendChild(icon);

  let labelSpan = doc.createElement("span");
  labelSpan.className = "threads-nav-mode-label";
  labelSpan.textContent = labelText;
  btn.appendChild(labelSpan);

  btn.title = tooltipText;
  // WCAG 2.5.3 (Label in Name) : le nom accessible commence par le libellé visible
  btn.setAttribute("aria-label", labelText + " \u2014 " + tooltipText);
  btn.dataset.mode = mode;
}

/**
 * Crée une icône chevron directionnelle SVG monochrome (14x14).
 * @param {Document} doc
 * @param {"up"|"down"|"left"|"right"} direction
 */
function createChevronIcon(doc, direction) {
  let svg = createSvg(doc, 14, 14, "0 0 16 16");
  let path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("fill-rule", "evenodd");
  let d = "";
  if (direction === "up") {
    d = "M3.2 10.3a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 1 1-1.06 1.06L8 6.56l-3.72 3.74a.75.75 0 0 1-1.08 0z";
  } else if (direction === "down") {
    d = "M3.2 5.7a.75.75 0 0 0 0 1.06l4.25 4.25a.75.75 0 0 0 1.06 0l4.25-4.25a.75.75 0 1 0-1.06-1.06L8 9.44 4.28 5.7a.75.75 0 0 0-1.08 0z";
  } else if (direction === "left") {
    d = "M10.3 12.8a.75.75 0 0 1-1.06 0l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 1.06L6.56 8l3.74 3.72a.75.75 0 0 1 0 1.08z";
  } else {
    d = "M5.7 3.2a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 1 1-1.06-1.06L9.44 8 5.7 4.28a.75.75 0 0 1 0-1.08z";
  }
  path.setAttribute("d", d);
  svg.appendChild(path);
  return svg;
}

/**
 * Crée une icône trombone (pièce jointe) SVG monochrome (12x12).
 */
function createPaperclipIcon(doc) {
  let svg = createSvg(doc, 12, 12, "0 0 16 16");
  let path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("fill-rule", "evenodd");
  path.setAttribute("d", "M4.5 3a2.5 2.5 0 0 1 5 0v7a1.5 1.5 0 0 1-3 0V4a.5.5 0 0 1 1 0v6a.5.5 0 0 0 1 0V3a1.5 1.5 0 1 0-3 0v7.5a2.5 2.5 0 0 0 5 0V4a.5.5 0 0 1 1 0v6.5a3.5 3.5 0 1 1-7 0V3z");
  svg.appendChild(path);
  return svg;
}

/**
 * Crée une icône lien (maillon) SVG monochrome (12x12).
 */
function createLinkIcon(doc) {
  let svg = createSvg(doc, 12, 12, "0 0 16 16");
  let path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("fill-rule", "evenodd");
  path.setAttribute("d", "M7.775 3.275a.75.75 0 0 0 1.06 1.06l1.25-1.25a2 2 0 1 1 2.83 2.83l-2.5 2.5a2 2 0 0 1-2.83 0 .75.75 0 0 0-1.06 1.06 3.5 3.5 0 0 0 4.95 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95l-1.25 1.25zm-1.55 4.95a.75.75 0 0 0-1.06-1.06l-1.25 1.25a2 2 0 0 0 2.83 2.83l2.5-2.5a2 2 0 0 0 0-2.83.75.75 0 0 0-1.06-1.06 3.5 3.5 0 0 1 0 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95-4.95l1.25-1.25z");
  svg.appendChild(path);
  return svg;
}

/**
 * Met à jour le bouton de repli avec l'icône chevron directionnelle adaptée.
 */
function updateCollapseButton(btn, isCollapsed, layout, side, doc) {
  while (btn.firstChild) {
    btn.firstChild.remove();
  }
  let direction;
  if (layout === "bottom") {
    direction = isCollapsed ? "up" : "down";
  } else if (side === "left") {
    direction = isCollapsed ? "right" : "left";
  } else {
    direction = isCollapsed ? "left" : "right";
  }
  btn.appendChild(createChevronIcon(doc, direction));
}

/**
 * Retourne le comportement de défilement adapté à prefers-reduced-motion.
 */
function getScrollBehavior(doc) {
  try {
    if (doc?.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      return "auto";
    }
  } catch (e) {
    // Ignorer
  }
  return "smooth";
}

/**
 * Calcule la signature structurelle d'un fil (IDs + état de liaison manuelle).
 */
function computeThreadSignature(threadData) {
  return threadData.map(m => `${m.id}:${m.isManualLink ? 1 : 0}:${m.manualLinkId || ""}`).join(",");
}

/**
 * Attache le comportement de redimensionnement à une poignée, en Pointer Events
 * avec capture : les événements suivent la poignée même hors de la fenêtre, et
 * aucun listener n'est posé sur le document (pas de listener orphelin si le
 * panneau est reconstruit pendant un glisser).
 * @param {Element} handle - La poignée de redimensionnement.
 * @param {string} axis - "y" (panneau bottom) ou "x" (sidebar).
 * @param {ShadowRoot} shadowRoot - Le shadow root du panneau.
 * @param {string} sidebarPosition - "left" ou "right" (axe x uniquement).
 */
function attachResizeBehavior(handle, axis, shadowRoot, sidebarPosition) {
  let hostEl = shadowRoot.host;

  /**
   * Applique une taille bornée au panneau et répercute la largeur sur le
   * document hôte (padding du body ou marge du messageBrowser).
   * Partagé entre le glisser (pointer) et le clavier (flèches).
   */
  function applySize(size) {
    let boundedSize;
    if (axis === "y") {
      let newHeight = Math.max(BOTTOM_MIN_HEIGHT, Math.min(size, BOTTOM_MAX_HEIGHT));
      hostEl.style.height = newHeight + "px";
      boundedSize = newHeight;
      handle.setAttribute("aria-valuenow", boundedSize);
      return;
    }

    let newWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(size, SIDEBAR_MAX_WIDTH));
    hostEl.style.width = newWidth + "px";
    boundedSize = newWidth;
    handle.setAttribute("aria-valuenow", boundedSize);

    let contentDoc = hostEl.ownerDocument;
    if (hostEl.dataset.layoutContext === "messageTab") {
      let body = contentDoc.body || contentDoc.documentElement;
      if (sidebarPosition === "left") {
        body.style.paddingLeft = newWidth + "px";
      } else {
        body.style.paddingRight = newWidth + "px";
      }
    } else if (hostEl.dataset.layoutMode === "sidebar3pane") {
      let msgBrowserId = hostEl.dataset.msgBrowserId;
      let msgBrowser = msgBrowserId ? contentDoc.getElementById(msgBrowserId) : null;
      if (msgBrowser) {
        if (sidebarPosition === "left") {
          msgBrowser.style.marginLeft = newWidth + "px";
        } else {
          msgBrowser.style.marginRight = newWidth + "px";
        }
      }
    }
  }

  // Accessibilité : poignée focusable et pilotable aux flèches du clavier
  handle.tabIndex = 0;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", axis === "y" ? "horizontal" : "vertical");
  handle.setAttribute("aria-valuemin", axis === "y" ? BOTTOM_MIN_HEIGHT : SIDEBAR_MIN_WIDTH);
  handle.setAttribute("aria-valuemax", axis === "y" ? BOTTOM_MAX_HEIGHT : SIDEBAR_MAX_WIDTH);
  let initialSize = axis === "y" ? BOTTOM_DEFAULT_HEIGHT : SIDEBAR_DEFAULT_WIDTH;
  handle.setAttribute("aria-valuenow", initialSize);
  handle.addEventListener("keydown", (e) => {
    let delta = 0;
    if (axis === "y") {
      // Panneau bottom : flèche haut = agrandir
      if (e.key === "ArrowUp") delta = KEYBOARD_RESIZE_STEP;
      else if (e.key === "ArrowDown") delta = -KEYBOARD_RESIZE_STEP;
      if (delta) {
        e.preventDefault();
        applySize(hostEl.offsetHeight + delta);
      }
    } else {
      // Sidebar : la flèche qui « pousse » vers le message agrandit
      let growKey = sidebarPosition === "right" ? "ArrowLeft" : "ArrowRight";
      let shrinkKey = sidebarPosition === "right" ? "ArrowRight" : "ArrowLeft";
      if (e.key === growKey) delta = KEYBOARD_RESIZE_STEP;
      else if (e.key === shrinkKey) delta = -KEYBOARD_RESIZE_STEP;
      if (delta) {
        e.preventDefault();
        applySize(hostEl.offsetWidth + delta);
      }
    }
  });

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    let startPos = axis === "y" ? e.screenY : e.screenX;
    let startSize = axis === "y" ? hostEl.offsetHeight : hostEl.offsetWidth;
    handle.setPointerCapture(e.pointerId);

    let latestTargetSize = null;
    let rafId = null;
    const win = handle.ownerDocument ? handle.ownerDocument.defaultView : null;

    function onPointerMove(ev) {
      let delta;
      if (axis === "y") {
        // Panneau bottom : glisser vers le haut = agrandir
        delta = startPos - ev.screenY;
      } else {
        // Sidebar : le sens dépend du côté
        delta = sidebarPosition === "right" ? startPos - ev.screenX : ev.screenX - startPos;
      }
      latestTargetSize = startSize + delta;

      // Cadencement 60/120 fps : regrouper les reflows dans une animation frame
      if (!rafId && win && typeof win.requestAnimationFrame === "function") {
        rafId = win.requestAnimationFrame(() => {
          rafId = null;
          if (latestTargetSize !== null) {
            applySize(latestTargetSize);
          }
        });
      } else if (!win || typeof win.requestAnimationFrame !== "function") {
        applySize(latestTargetSize);
      }
    }

    function onPointerEnd(ev) {
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerEnd);
      handle.removeEventListener("pointercancel", onPointerEnd);

      if (rafId && win && typeof win.cancelAnimationFrame === "function") {
        win.cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (latestTargetSize !== null) {
        applySize(latestTargetSize);
      }

      try {
        handle.releasePointerCapture(ev.pointerId);
      } catch (err) {
        // Capture déjà relâchée (ex. poignée retirée du DOM pendant le glisser)
      }
    }

    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerEnd);
    handle.addEventListener("pointercancel", onPointerEnd);
  });
}

/* exported magicThreadsWindow */
var magicThreadsWindow = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    let itemClickFire = null;
    let confirmManualLinkFire = null;
    let cancelManualLinkFire = null;
    let detachManualLinkFire = null;
    let toggleNavigationModeFire = null;

    // Labels par défaut (fallback en anglais si non fournis, alignés sur _locales/en)
    const DEFAULT_LABELS = {
      panelTitle: "🧵 Thread ($COUNT$)",
      modeCurrentTab: "Current tab",
      modeNewTab: "New tab",
      tooltipCurrentTab: "Click switches the message in the active tab",
      tooltipNewTab: "Click opens the message in a new tab",
      tooltipCollapseExpand: "Collapse/Expand panel",
      tooltipResize: "Drag to resize",
      tooltipAttachment: "Attachment(s)",
      folderInbox: "Inbox",
      folderSent: "Sent",
      folderArchive: "Archives",
      folderDrafts: "Drafts",
      folderTrash: "Trash",
      unknownAuthor: "Unknown",
      unreadLabel: "Unread",
      stagingBannerTitle: "Thread association in progress",
      stagingBannerPromptSingle: "Link this message to the conversation below?",
      stagingBannerPromptThread: "Link this conversation ({count} messages) to the thread below?",
      stagingSourceLabel: "Source:",
      stagingOptionMergeThreads: "Merge entire threads together (Recommended)",
      stagingOptionSingleMsg: "Attach only this specific message",
      btnConfirmLink: "Confirm association",
      btnCancelLink: "Cancel",
      badgeManualLink: "Manually linked message",
      btnDetachLink: "Detach from thread",
      optManualLinksDeletedFeedback: "Manual link deleted successfully.",
      messageRoleDescription: "Message"
    };

    // =================================================================
    // Tab Info
    // =================================================================

    function getTabInfo(tabId) {
      try {
        let tabObject = context.extension.tabManager.get(tabId);
        if (!tabObject || !tabObject.nativeTab) return null;
        let modeName = tabObject.nativeTab.mode?.name || "";
        let chromeBrowser = tabObject.nativeTab.chromeBrowser;
        if (!chromeBrowser || !chromeBrowser.contentWindow) return null;
        return {
          contentWin: chromeBrowser.contentWindow,
          isMessageTab: modeName === "mailMessageTab",
          is3PaneTab: modeName === "mail3PaneTab",
          modeName
        };
      } catch (e) {
        console.error("Magic Threads: getTabInfo error:", e);
        return null;
      }
    }

    // =================================================================
    // DOM Helpers
    // =================================================================

    function findMessagePaneParent(contentDoc) {
      // TB 128+ : messagePane est un custom element <message-pane>
      let messagePane = contentDoc.getElementById("messagePane");
      if (messagePane) return messagePane;
      // Fallback : chercher le parent du messageBrowser
      let messageBrowser = contentDoc.getElementById("messageBrowser");
      if (messageBrowser && messageBrowser.parentElement) return messageBrowser.parentElement;
      let multiMsgBrowser = contentDoc.getElementById("multiMessageBrowser");
      if (multiMsgBrowser && multiMsgBrowser.parentElement) return multiMsgBrowser.parentElement;
      return null;
    }




    // =================================================================
    // Helpers (i18n-aware)
    // =================================================================

    function cleanAuthor(authorStr, labels) {
      if (!authorStr) return labels.unknownAuthor || "?";
      let match = authorStr.match(/^([^<]+)/);
      return match ? match[1].trim() : authorStr;
    }

    function formatDate(timestamp) {
      if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
      let dateObj = new Date(timestamp);
      if (isNaN(dateObj.getTime())) return "";
      let now = new Date();
      if (dateObj.toDateString() === now.toDateString()) {
        return dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }
      return dateObj.toLocaleDateString([], { day: "numeric", month: "short", year: "2-digit" }) +
        " " + dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function getFolderLabel(folder, labels) {
      if (folder.type === "inbox") return labels.folderInbox;
      if (folder.type === "sent") return labels.folderSent;
      if (folder.type === "archive") return labels.folderArchive;
      if (folder.type === "drafts") return labels.folderDrafts;
      if (folder.type === "trash") return labels.folderTrash;
      let parts = folder.path.split("/");
      return parts[parts.length - 1] || folder.path;
    }


    // =================================================================
    // DOM Builder (i18n-aware)
    // =================================================================

    /**
     * Construit un élément de fil (listitem > item cliquable) pour un message.
     * Le mode de navigation est lu via navState au moment du clic.
     * @returns {Element} le wrapper listitem prêt à insérer dans la liste
     */
    function buildThreadItem(doc, msg, currentMessageId, labels, navState, isInitiallyFocusable, announceLive) {
      // Wrapper listitem : conserve la sémantique de liste
      let listItem = doc.createElement("div");
      listItem.setAttribute("role", "listitem");

      let item = doc.createElement("div");
      item.className = "thread-item";
      item.dataset.messageId = String(msg.id);
      // Élimination du contrôle interactif imbriqué (WCAG 4.1.2) :
      // On utilise role="article" avec un descriptif de message au lieu de role="button"
      // car l'élément peut contenir un second bouton d'action (.thread-detach-btn).
      item.setAttribute("role", "article");
      item.setAttribute("aria-roledescription", labels.messageRoleDescription || "Message");
      item.tabIndex = isInitiallyFocusable ? 0 : -1;

      if (msg.id === currentMessageId) {
        item.classList.add("current");
        item.setAttribute("aria-current", "true");
        item.setAttribute("aria-disabled", "true");
      }
      if (!msg.isRead) item.classList.add("unread");

      let meta = doc.createElement("div");
      meta.className = "thread-meta";

      let author = doc.createElement("span");
      author.className = "thread-author";
      author.textContent = cleanAuthor(msg.author, labels);
      meta.appendChild(author);

      if (!msg.isRead) {
        // Libellé « non lu » masqué visuellement : le point rouge (CSS ::after)
        // n'est plus la seule information pour les lecteurs d'écran
        let unread = doc.createElement("span");
        unread.className = "visually-hidden";
        unread.textContent = labels.unreadLabel;
        meta.appendChild(unread);
      }

      let date = doc.createElement("span");
      date.className = "thread-date";
      date.textContent = formatDate(msg.date);
      meta.appendChild(date);

      let folderBadge = doc.createElement("span");
      folderBadge.className = "thread-folder " + (msg.folder.type || "normal");
      folderBadge.textContent = getFolderLabel(msg.folder, labels);
      meta.appendChild(folderBadge);

      let indicators = null;
      let ensureIndicators = () => {
        if (!indicators) {
          indicators = doc.createElement("span");
          indicators.className = "thread-indicators";
        }
        return indicators;
      };

      if (msg.hasAttachments) {
        let clip = doc.createElement("span");
        clip.className = "thread-attachment";
        clip.setAttribute("role", "img");
        clip.title = labels.tooltipAttachment || "Attachment(s)";
        clip.setAttribute("aria-label", labels.tooltipAttachment || "Attachment(s)");
        clip.appendChild(createPaperclipIcon(doc));
        ensureIndicators().appendChild(clip);
      }

      if (msg.isManualLink) {
        let linkBadge = doc.createElement("span");
        linkBadge.className = "thread-badge-manual";
        linkBadge.setAttribute("role", "img");
        linkBadge.title = labels.badgeManualLink || "Message rattaché manuellement";
        linkBadge.setAttribute("aria-label", labels.badgeManualLink || "Message rattaché manuellement");
        linkBadge.appendChild(createLinkIcon(doc));
        ensureIndicators().appendChild(linkBadge);
      }

      if (indicators) {
        meta.appendChild(indicators);
      }

      item.appendChild(meta);

      let snippet = doc.createElement("div");
      snippet.className = "thread-snippet";
      snippet.textContent = msg.snippet;
      item.appendChild(snippet);

      if (msg.isManualLink) {
        item.classList.add("has-manual-link");
        if (msg.manualLinkId) {
          let detachBtn = doc.createElement("button");
          detachBtn.className = "thread-detach-btn";
          detachBtn.textContent = "\u00D7";
          detachBtn.title = labels.btnDetachLink || "Détacher du fil";
          detachBtn.setAttribute("aria-label", labels.btnDetachLink || "Détacher du fil");
          // Roving tabindex étanche : seul le bouton de la carte active est dans le cycle Tab
          detachBtn.tabIndex = isInitiallyFocusable ? 0 : -1;
          detachBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (announceLive) {
              announceLive(labels.optManualLinksDeletedFeedback || "Message détaché");
            }
            if (detachManualLinkFire) {
              detachManualLinkFire.async(msg.manualLinkId, msg.id, msg.headerMessageId);
            }
          });
          item.appendChild(detachBtn);
        }
      }

      let activate = () => {
        let root = item.closest("#threads-list");
        if (root) {
          let allItems = root.querySelectorAll(".thread-item");
          for (let it of allItems) {
            it.tabIndex = -1;
            let d = it.querySelector(".thread-detach-btn");
            if (d) d.tabIndex = -1;
            if (navState.mode === "currentTab") {
              it.classList.remove("current");
              it.removeAttribute("aria-current");
              it.removeAttribute("aria-disabled");
            }
          }
        }
        item.tabIndex = 0;
        let itemDetach = item.querySelector(".thread-detach-btn");
        if (itemDetach) itemDetach.tabIndex = 0;

        // Retour visuel immédiat (Optimistic UI) uniquement en navigation intra-onglet
        if (navState.mode === "currentTab") {
          item.classList.add("current");
          item.setAttribute("aria-current", "true");
          item.setAttribute("aria-disabled", "true");
        }

        if (itemClickFire) {
          itemClickFire.async(msg.id, navState.mode);
        }
      };

      item.addEventListener("click", (e) => {
        if (e.target && e.target.classList.contains("thread-detach-btn")) return;
        let root = item.closest("#threads-list");
        if (root) {
          let allItems = root.querySelectorAll(".thread-item");
          for (let it of allItems) {
            it.tabIndex = -1;
            let d = it.querySelector(".thread-detach-btn");
            if (d) d.tabIndex = -1;
          }
        }
        item.tabIndex = 0;
        let itemDetach = item.querySelector(".thread-detach-btn");
        if (itemDetach) itemDetach.tabIndex = 0;
        if (item.classList.contains("current")) return;
        activate();
      });
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          // Si le focus est sur le bouton de détachement, laisser son handler natif click s'exécuter
          if (e.target && e.target.classList.contains("thread-detach-btn")) return;
          // Espace ou Entrée : activer l'item
          e.preventDefault();
          if (item.classList.contains("current")) return;
          activate();
        } else if (e.key === "Delete" || e.key === "Backspace") {
          // Raccourci clavier de détachement direct sans obligation de tabuler
          if (msg.isManualLink && msg.manualLinkId && detachManualLinkFire) {
            e.preventDefault();
            if (announceLive) {
              announceLive(labels.optManualLinksDeletedFeedback || "Message détaché");
            }
            detachManualLinkFire.async(msg.manualLinkId, msg.id, msg.headerMessageId);
          }
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
          // Navigation au clavier WCAG AA par touches directionnelles (Roving Tabindex)
          e.preventDefault();
          let root = item.closest("#threads-list");
          if (!root) return;
          let allItems = Array.from(root.querySelectorAll(".thread-item"));
          let currentIndex = allItems.indexOf(item);
          if (currentIndex === -1) return;
          let targetIndex = currentIndex;
          if (e.key === "ArrowDown") {
            targetIndex = Math.min(currentIndex + 1, allItems.length - 1);
          } else if (e.key === "ArrowUp") {
            targetIndex = Math.max(currentIndex - 1, 0);
          } else if (e.key === "Home") {
            targetIndex = 0;
          } else if (e.key === "End") {
            targetIndex = allItems.length - 1;
          }
          if (targetIndex !== currentIndex) {
            item.tabIndex = -1;
            let currentDetach = item.querySelector(".thread-detach-btn");
            if (currentDetach) currentDetach.tabIndex = -1;

            let targetItem = allItems[targetIndex];
            targetItem.tabIndex = 0;
            let targetDetach = targetItem.querySelector(".thread-detach-btn");
            if (targetDetach) targetDetach.tabIndex = 0;

            targetItem.focus();
            targetItem.scrollIntoView({ block: "nearest", behavior: getScrollBehavior(doc) });
          }
        }
      });

      listItem.appendChild(item);

      return listItem;
    }

    /**
     * Tente une mise à jour chirurgicale in-place du Shadow DOM sans destruction.
     * Évite le scintillement (flash) lorsque le fil affiché est identique.
     * @returns {boolean} true si le DOM a été mis à jour in-place, false si une reconstruction est requise.
     */
    function tryUpdateBannerDOM(shadowRoot, threadData, currentMessageId, navigationMode, layoutMode, sidebarPosition, labels, stagingData) {
      let hostEl = shadowRoot.host;
      if (!hostEl) return false;

      // En présence de staging ou d'une ancienne bannière de staging, reconstruire
      if (stagingData || shadowRoot.querySelector(".staging-banner")) {
        return false;
      }

      let wrapper = shadowRoot.querySelector(".threads-wrapper");
      let list = shadowRoot.querySelector("#threads-list");
      if (!wrapper || !list) return false;

      // Vérifier si la disposition et l'orientation ont changé
      if (hostEl.dataset.bannerLayout !== layoutMode || hostEl.dataset.bannerSide !== sidebarPosition) {
        return false;
      }

      // Vérifier si la composition ou l'état de liaison manuelle du fil a changé
      let newSignature = computeThreadSignature(threadData);
      if (hostEl.dataset.threadSignature !== newSignature) {
        return false;
      }

      // Mise à jour in-place des éléments du fil
      let hasCurrentInThread = threadData.some(m => m.id === currentMessageId);
      let items = list.querySelectorAll(".thread-item");
      for (let i = 0; i < items.length; i++) {
        let item = items[i];
        let msgId = Number(item.dataset.messageId);
        let msgData = threadData.find(m => m.id === msgId);
        let isCurrent = msgId === currentMessageId;

        let isFocusable = isCurrent || (!hasCurrentInThread && i === 0);
        if (isCurrent) {
          item.classList.add("current");
          item.setAttribute("aria-current", "true");
          item.setAttribute("aria-disabled", "true");
          item.tabIndex = 0;
        } else {
          item.classList.remove("current");
          item.removeAttribute("aria-current");
          item.removeAttribute("aria-disabled");
          item.tabIndex = isFocusable ? 0 : -1;
        }

        let detachBtn = item.querySelector(".thread-detach-btn");
        if (detachBtn) {
          detachBtn.tabIndex = isFocusable ? 0 : -1;
        }

        // Mise à jour de l'état non-lu si le message est passé de non-lu à lu (ou réapparition du non-lu)
        if (msgData) {
          if (msgData.isRead) {
            item.classList.remove("unread");
            let hiddenUnread = item.querySelector(".visually-hidden");
            if (hiddenUnread) hiddenUnread.remove();
          } else if (!item.classList.contains("unread")) {
            item.classList.add("unread");
            let meta = item.querySelector(".thread-meta");
            if (meta && !meta.querySelector(".visually-hidden")) {
              let unread = meta.ownerDocument.createElement("span");
              unread.className = "visually-hidden";
              unread.textContent = labels.unreadLabel || "Unread";
              let author = meta.querySelector(".thread-author");
              if (author && author.nextSibling) {
                meta.insertBefore(unread, author.nextSibling);
              } else {
                meta.appendChild(unread);
              }
            }
          }
        }
      }

      // Mise à jour du titre
      let title = shadowRoot.querySelector(".threads-title");
      if (title) {
        let titleText = labels.panelTitle || "\u{1F9F5} Thread ($COUNT$)";
        title.textContent = titleText.replace("$COUNT$", threadData.length);
      }

      // Mise à jour du mode
      let navModeBtn = shadowRoot.querySelector(".threads-nav-mode-btn");
      if (navModeBtn) {
        let doc = shadowRoot.ownerDocument || hostEl.ownerDocument;
        updateNavModeButton(navModeBtn, navigationMode, labels, doc);
        if (hostEl._magicThreadsNavState) {
          hostEl._magicThreadsNavState.mode = navigationMode;
        }
      }

      // Scroll doux vers l'élément sélectionné si nécessaire
      let currentItem = list.querySelector(".thread-item.current");
      if (currentItem && currentItem.ownerDocument?.defaultView) {
        let itemDoc = currentItem.ownerDocument;
        itemDoc.defaultView.requestAnimationFrame(() => {
          currentItem.scrollIntoView({ block: "nearest", behavior: getScrollBehavior(itemDoc) });
        });
      }

      return true;
    }

    /**
     * Construit le DOM du panneau dans le Shadow DOM.
     * @param {string} layoutMode - "bottom" ou "sidebar"
     * @param {string} sidebarPosition - "left" ou "right"
     * @param {object} labels - Chaînes i18n
     */
    function buildBannerDOM(shadowRoot, threadData, currentMessageId, navigationMode, layoutMode, sidebarPosition, labels, stagingData) {
      if (tryUpdateBannerDOM(shadowRoot, threadData, currentMessageId, navigationMode, layoutMode, sidebarPosition, labels, stagingData)) {
        return;
      }

      let doc = shadowRoot.ownerDocument;
      let hostEl = shadowRoot.host;

      // Préserver la région aria-live existante pour éviter d'interrompre une annonce vocale en cours
      let existingLiveRegion = shadowRoot.getElementById ? shadowRoot.getElementById("threads-live-region") : shadowRoot.querySelector("#threads-live-region");
      if (existingLiveRegion) {
        existingLiveRegion.remove();
      }

      // Nettoyage DOM itératif (évite innerHTML dans le contexte chrome privilégié — flag AMO)
      while (shadowRoot.firstChild) {
        shadowRoot.firstChild.remove();
      }

      if (hostEl) {
        // Si le panneau était replié avant la reconstruction, restaurer ses dimensions dépliées
        if (hostEl.dataset.collapsed === "true") {
          delete hostEl.dataset.collapsed;
          let contentDoc = hostEl.ownerDocument;
          let sidePos = sidebarPosition || "right";
          if (layoutMode === "bottom") {
            let savedHeight = hostEl.dataset.expandedHeight || (BOTTOM_DEFAULT_HEIGHT + "px");
            hostEl.style.height = savedHeight;
          } else {
            let savedWidth = parseInt(hostEl.dataset.expandedWidth, 10) || SIDEBAR_DEFAULT_WIDTH;
            hostEl.style.width = savedWidth + "px";
            if (hostEl.dataset.layoutContext === "messageTab" && contentDoc) {
              let body = contentDoc.body || contentDoc.documentElement;
              if (body) {
                if (sidePos === "left") {
                  body.style.paddingLeft = savedWidth + "px";
                } else {
                  body.style.paddingRight = savedWidth + "px";
                }
              }
            } else if (hostEl.dataset.layoutMode === "sidebar3pane" && contentDoc) {
              let msgBrowserId = hostEl.dataset.msgBrowserId;
              let msgBrowser = msgBrowserId ? contentDoc.getElementById(msgBrowserId) : contentDoc.getElementById("messageBrowser");
              if (msgBrowser) {
                if (sidePos === "left") {
                  msgBrowser.style.marginLeft = savedWidth + "px";
                } else {
                  msgBrowser.style.marginRight = savedWidth + "px";
                }
              }
            }
          }
        }
        hostEl.dataset.bannerLayout = layoutMode;
        hostEl.dataset.bannerSide = sidebarPosition;
        hostEl.dataset.threadSignature = computeThreadSignature(threadData);
      }

      // Poignée de redimensionnement à insérer APRÈS le wrapper (cas sidebar gauche).
      // Déclarée au niveau de la fonction : une déclaration dans le bloc `if` ci-dessous
      // serait hors de portée au moment de l'insertion (bug corrigé en v2.1.2).
      let pendingResizeHandle = null;

      // Styles
      let style = doc.createElement("style");
      style.textContent = SHARED_CSS + (layoutMode === "sidebar" ? SIDEBAR_CSS : BOTTOM_CSS);
      shadowRoot.appendChild(style);

      // Resize handle
      if (layoutMode === "bottom") {
        // Vertical resize handle (top of panel)
        let resizeHandle = doc.createElement("div");
        resizeHandle.className = "resize-handle";
        resizeHandle.title = labels.tooltipResize;
        resizeHandle.setAttribute("aria-label", labels.tooltipResize || "Drag to resize");
        attachResizeBehavior(resizeHandle, "y", shadowRoot, sidebarPosition);
        shadowRoot.appendChild(resizeHandle);
      }

      if (layoutMode === "sidebar") {
        // Horizontal resize handle (edge of sidebar)
        let resizeHandle = doc.createElement("div");
        resizeHandle.className = "resize-handle";
        resizeHandle.title = labels.tooltipResize;
        resizeHandle.setAttribute("aria-label", labels.tooltipResize || "Drag to resize");
        attachResizeBehavior(resizeHandle, "x", shadowRoot, sidebarPosition);

        // La poignée est placée du côté intérieur du sidebar
        if (sidebarPosition === "left") {
          // Sidebar à gauche : poignée à droite (après le wrapper)
          pendingResizeHandle = resizeHandle;
        } else {
          // Sidebar à droite : poignée à gauche (avant le wrapper)
          shadowRoot.appendChild(resizeHandle);
        }
      }

      // Wrapper (repère landmark WCAG 1.3.1)
      let wrapper = doc.createElement("div");
      wrapper.className = "threads-wrapper";
      wrapper.setAttribute("role", "complementary");
      let panelTitleAccessible = labels.panelTitle ? labels.panelTitle.replace("$COUNT$", threadData.length) : "Fil de discussion";
      wrapper.setAttribute("aria-label", panelTitleAccessible);
      if (layoutMode === "sidebar") {
        wrapper.classList.add(sidebarPosition === "left" ? "sidebar-left" : "sidebar-right");
      }

      // Région live pour annonces vocales accessibles (détachement, staging, etc.)
      let liveRegion = existingLiveRegion;
      if (!liveRegion) {
        liveRegion = doc.createElement("div");
        liveRegion.id = "threads-live-region";
        liveRegion.className = "visually-hidden";
        liveRegion.setAttribute("role", "status");
        liveRegion.setAttribute("aria-live", "polite");
        liveRegion.setAttribute("aria-atomic", "true");
      }
      wrapper.appendChild(liveRegion);

      let announceLive = (text) => {
        if (!liveRegion) return;
        liveRegion.textContent = "";
        liveRegion.textContent = text;
      };

      // Header
      let header = doc.createElement("div");
      header.className = "threads-header";

      let title = doc.createElement("span");
      title.id = "threads-panel-title";
      title.className = "threads-title";
      title.setAttribute("role", "heading");
      title.setAttribute("aria-level", "2");
      let titleText = labels.panelTitle || "\u{1F9F5} Thread ($COUNT$)";
      title.textContent = titleText.replace("$COUNT$", threadData.length);
      header.appendChild(title);

      let actionsDiv = doc.createElement("div");
      actionsDiv.className = "threads-actions";

      let navModeBtn = doc.createElement("button");
      navModeBtn.className = "threads-nav-mode-btn";
      updateNavModeButton(navModeBtn, navigationMode, labels, doc);
      actionsDiv.appendChild(navModeBtn);

      let collapseBtn = doc.createElement("button");
      collapseBtn.className = "threads-collapse-btn";
      updateCollapseButton(collapseBtn, false, layoutMode, sidebarPosition, doc);
      collapseBtn.title = labels.tooltipCollapseExpand;
      collapseBtn.setAttribute("aria-label", labels.tooltipCollapseExpand);
      collapseBtn.setAttribute("aria-controls", "threads-list");
      // État déplié annoncé aux technologies d'assistance, tenu à jour à chaque bascule
      collapseBtn.setAttribute("aria-expanded", "true");
      actionsDiv.appendChild(collapseBtn);

      header.appendChild(actionsDiv);
      wrapper.appendChild(header);

      // Bannière d'association manuelle (Mode staging en attente de confirmation)
      if (stagingData) {
        let stagingDiv = doc.createElement("div");
        stagingDiv.className = "staging-banner";
        stagingDiv.setAttribute("role", "region");
        stagingDiv.setAttribute("aria-label", labels.stagingBannerTitle || "Association de fil en cours");

        let stagingTitle = doc.createElement("div");
        stagingTitle.className = "staging-title";
        let isThread = !!stagingData.isSourceInThread;
        let count = Math.max(1, Number(stagingData.sourceThreadCount) || Number(stagingData.sourceCount) || 1);
        let promptTemplate = labels.stagingBannerPromptThread || "Rattacher cette conversation ({count} messages) au fil ci-dessous ?";
        let promptText = isThread && count > 1
          ? promptTemplate.replace("{count}", String(count)).replace("$COUNT$", String(count))
          : (labels.stagingBannerPromptSingle || "Rattacher ce message à la conversation ci-dessous ?");
        stagingTitle.appendChild(createLinkIcon(doc));
        let promptSpan = doc.createElement("span");
        promptSpan.style.marginInlineStart = "6px";
        promptSpan.textContent = promptText;
        stagingTitle.appendChild(promptSpan);
        stagingDiv.appendChild(stagingTitle);

        if (stagingData.sourceSubject) {
          let sourceDesc = doc.createElement("div");
          sourceDesc.className = "staging-source-desc";
          let authorPart = stagingData.sourceAuthor ? " (" + cleanAuthor(stagingData.sourceAuthor, labels) + ")" : "";
          sourceDesc.textContent = (labels.stagingSourceLabel || "Source : ") + " « " + stagingData.sourceSubject + " »" + authorPart;
          stagingDiv.appendChild(sourceDesc);
        }

        let selectedScope = "entire_thread";

        if (isThread && count > 1) {
          let optionsDiv = doc.createElement("div");
          optionsDiv.className = "staging-options";
          optionsDiv.setAttribute("role", "radiogroup");
          optionsDiv.setAttribute("aria-label", labels.stagingBannerTitle || "Portée de l'association");

          // Option 1 : Fusion complète
          let optMergeLabel = doc.createElement("label");
          optMergeLabel.className = "staging-option-label";
          let optMergeRadio = doc.createElement("input");
          optMergeRadio.type = "radio";
          optMergeRadio.name = "stagingScope";
          optMergeRadio.value = "entire_thread";
          optMergeRadio.checked = true;
          optMergeRadio.addEventListener("change", () => { selectedScope = "entire_thread"; });
          optMergeLabel.appendChild(optMergeRadio);
          optMergeLabel.appendChild(doc.createTextNode(labels.stagingOptionMergeThreads || "Fusionner les deux fils complets (Recommandé)"));
          optionsDiv.appendChild(optMergeLabel);

          // Option 2 : Message unique
          let optSingleLabel = doc.createElement("label");
          optSingleLabel.className = "staging-option-label";
          let optSingleRadio = doc.createElement("input");
          optSingleRadio.type = "radio";
          optSingleRadio.name = "stagingScope";
          optSingleRadio.value = "single_message";
          optSingleRadio.addEventListener("change", () => { selectedScope = "single_message"; });
          optSingleLabel.appendChild(optSingleRadio);
          optSingleLabel.appendChild(doc.createTextNode(labels.stagingOptionSingleMsg || "Rattacher uniquement ce message précis"));
          optionsDiv.appendChild(optSingleLabel);

          stagingDiv.appendChild(optionsDiv);
        }

        let stagingActions = doc.createElement("div");
        stagingActions.className = "staging-actions";

        let confirmBtn = doc.createElement("button");
        confirmBtn.className = "staging-btn staging-btn-confirm";
        confirmBtn.textContent = labels.btnConfirmLink || "Confirmer l'association";
        confirmBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          announceLive(labels.btnConfirmLink || "Association confirmée");
          if (confirmManualLinkFire) {
            let currentMsg = threadData.find(m => m.id === currentMessageId) || threadData[0];
            let tid = hostEl?.dataset?.tabId ? Number(hostEl.dataset.tabId) : undefined;
            let targetContext = {
              tabId: tid,
              targetMessageId: currentMessageId,
              targetHeaderId: currentMsg?.headerMessageId || "",
              targetThreadHeaderIds: threadData.map(m => m.headerMessageId).filter(Boolean),
              targetSubject: currentMsg?.subject || "",
              targetAuthor: currentMsg?.author || ""
            };
            confirmManualLinkFire.async(selectedScope, targetContext);
          }
        });
        stagingActions.appendChild(confirmBtn);

        let cancelBtn = doc.createElement("button");
        cancelBtn.className = "staging-btn staging-btn-cancel";
        cancelBtn.textContent = labels.btnCancelLink || "Annuler";
        cancelBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          announceLive(labels.btnCancelLink || "Association annulée");
          if (cancelManualLinkFire) {
            cancelManualLinkFire.async();
          }
        });
        stagingActions.appendChild(cancelBtn);

        stagingDiv.appendChild(stagingActions);
        wrapper.appendChild(stagingDiv);
      }

      // Liste (sémantique ARIA : list > listitem, voir construction des items)
      let list = doc.createElement("div");
      list.id = "threads-list";
      list.className = "threads-list";
      list.setAttribute("role", "list");
      list.setAttribute("aria-labelledby", "threads-panel-title");

      let navState = { mode: navigationMode };
      if (shadowRoot.host) {
        shadowRoot.host._magicThreadsNavState = navState;
      }

      navModeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        navState.mode = navState.mode === "currentTab" ? "newTab" : "currentTab";
        updateNavModeButton(navModeBtn, navState.mode, labels, doc);
        if (announceLive) {
          announceLive(navState.mode === "currentTab" ? (labels.modeCurrentTab || "Onglet courant") : (labels.modeNewTab || "Nouvel onglet"));
        }
        if (toggleNavigationModeFire) {
          toggleNavigationModeFire.async(navState.mode);
        }
      });

      collapseBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        let isCollapsed = list.classList.toggle("collapsed");
        wrapper.classList.toggle("collapsed", isCollapsed);
        let sidePos = sidebarPosition || "right";
        updateCollapseButton(collapseBtn, isCollapsed, layoutMode, sidePos, doc);
        collapseBtn.setAttribute("aria-expanded", String(!isCollapsed));

        let hostEl = shadowRoot.host;
        hostEl.dataset.collapsed = isCollapsed ? "true" : "false";
        let contentDoc = hostEl.ownerDocument;

        // En mode bottom : ajuster la hauteur du conteneur
        if (layoutMode === "bottom") {
          if (isCollapsed) {
            hostEl.dataset.expandedHeight = hostEl.style.height || hostEl.offsetHeight + "px";
            hostEl.style.height = BOTTOM_MIN_HEIGHT + "px";
          } else {
            let savedHeight = hostEl.dataset.expandedHeight || (BOTTOM_DEFAULT_HEIGHT + "px");
            hostEl.style.height = savedHeight;
          }
        } else {
          // En mode sidebar (3-pane ou onglet message) : ajuster la largeur et restituer l'espace
          if (isCollapsed) {
            hostEl.dataset.expandedWidth = hostEl.style.width || (hostEl.offsetWidth + "px");
            hostEl.style.width = SIDEBAR_COLLAPSED_WIDTH + "px";
            if (hostEl.dataset.layoutContext === "messageTab") {
              let body = contentDoc.body || contentDoc.documentElement;
              if (sidePos === "left") {
                body.style.paddingLeft = SIDEBAR_COLLAPSED_WIDTH + "px";
              } else {
                body.style.paddingRight = SIDEBAR_COLLAPSED_WIDTH + "px";
              }
            } else if (hostEl.dataset.layoutMode === "sidebar3pane") {
              let msgBrowserId = hostEl.dataset.msgBrowserId;
              let msgBrowser = msgBrowserId ? contentDoc.getElementById(msgBrowserId) : contentDoc.getElementById("messageBrowser");
              if (msgBrowser) {
                if (sidePos === "left") {
                  msgBrowser.style.marginLeft = SIDEBAR_COLLAPSED_WIDTH + "px";
                } else {
                  msgBrowser.style.marginRight = SIDEBAR_COLLAPSED_WIDTH + "px";
                }
              }
            }
          } else {
            let savedWidth = parseInt(hostEl.dataset.expandedWidth, 10) || SIDEBAR_DEFAULT_WIDTH;
            hostEl.style.width = savedWidth + "px";
            if (hostEl.dataset.layoutContext === "messageTab") {
              let body = contentDoc.body || contentDoc.documentElement;
              if (sidePos === "left") {
                body.style.paddingLeft = savedWidth + "px";
              } else {
                body.style.paddingRight = savedWidth + "px";
              }
            } else if (hostEl.dataset.layoutMode === "sidebar3pane") {
              let msgBrowserId = hostEl.dataset.msgBrowserId;
              let msgBrowser = msgBrowserId ? contentDoc.getElementById(msgBrowserId) : contentDoc.getElementById("messageBrowser");
              if (msgBrowser) {
                if (sidePos === "left") {
                  msgBrowser.style.marginLeft = savedWidth + "px";
                } else {
                  msgBrowser.style.marginRight = savedWidth + "px";
                }
              }
            }
          }
        }
      });

      let hasCurrentInThread = threadData.some(m => m.id === currentMessageId);
      for (let i = 0; i < threadData.length; i++) {
        let msg = threadData[i];
        let isInitiallyFocusable = hasCurrentInThread ? (msg.id === currentMessageId) : (i === 0);
        list.appendChild(buildThreadItem(doc, msg, currentMessageId, labels, navState, isInitiallyFocusable, announceLive));
      }

      wrapper.appendChild(list);
      shadowRoot.appendChild(wrapper);

      // Ajouter la poignée après le wrapper si sidebar-left
      if (pendingResizeHandle) {
        shadowRoot.appendChild(pendingResizeHandle);
      }

      // Auto-scroll vers le message courant pour qu'il soit visible
      let currentItem = list.querySelector(".thread-item.current");
      if (currentItem) {
        // Utiliser un micro-delay pour que le layout soit calculé avant le scroll
        let itemDoc = currentItem.ownerDocument;
        itemDoc.defaultView.requestAnimationFrame(() => {
          currentItem.scrollIntoView({ block: "center", behavior: getScrollBehavior(itemDoc) });
        });
      }
    }

    // =================================================================
    // Injection : mode BOTTOM (3-pane, panneau en bas)
    // =================================================================

    function injectBottom(contentDoc, threadData, currentMessageId, navigationMode, labels, stagingData, tabId) {
      let container = contentDoc.getElementById("magic-threads-container");

      // Si un ancien conteneur d'un autre mode existe : restaurer les styles natifs et retirer
      if (container && container.dataset.layoutMode !== "bottom") {
        cleanupInjectedDoc(contentDoc);
        container = null;
      }

      if (!container) {
        let parent = findMessagePaneParent(contentDoc);
        if (!parent) {
          console.error("Magic Threads: no parent container found in about:3pane");
          return false;
        }
        container = contentDoc.createElement("div");
        container.id = "magic-threads-container";
        container.style.cssText = `width: 100%; flex-shrink: 0; height: ${BOTTOM_DEFAULT_HEIGHT}px;`;
        container.dataset.layoutMode = "bottom";
        parent.appendChild(container);
        container.attachShadow({ mode: "open" });
      }
      if (typeof tabId !== "undefined") {
        container.dataset.tabId = String(tabId);
      }
      container.style.display = "flex";
      container.removeAttribute("hidden");
      buildBannerDOM(container.shadowRoot, threadData, currentMessageId, navigationMode, "bottom", "right", labels, stagingData);
      return true;
    }

    // =================================================================
    // Injection : mode SIDEBAR dans le 3-pane
    // Position absolue dans le <message-pane> + marge sur le messageBrowser
    // =================================================================

    function injectSide3Pane(contentDoc, threadData, currentMessageId, navigationMode, sidePosition, labels, stagingData, tabId) {
      let container = contentDoc.getElementById("magic-threads-container");

      // Ancien conteneur d'un autre mode, ou position changée : nettoyer et recréer
      if (container && (container.dataset.layoutMode !== "sidebar3pane" ||
                        container.dataset.sidebarPosition !== sidePosition)) {
        cleanupInjectedDoc(contentDoc);
        container = null;
      }

      // Le messagePane est un custom element <message-pane> en display:flex flex-direction:column
      // avec overflow:auto et grid-area:message. C'est un containing block.
      let messagePane = contentDoc.getElementById("messagePane");
      if (!messagePane) {
        console.error("Magic Threads: messagePane not found in about:3pane");
        return false;
      }

      // S'assurer que messagePane est un containing block pour position:absolute.
      // Ré-affirmé à chaque affichage : TB peut réinitialiser les styles, et le
      // nettoyage (onShutdown/cleanupInjectedDoc) restaure position à "".
      if (!messagePane.style.position) {
        messagePane.style.position = "relative";
      }

      if (!container) {
        let sideWidth = SIDEBAR_DEFAULT_WIDTH;

        container = contentDoc.createElement("div");
        container.id = "magic-threads-container";
        container.dataset.layoutMode = "sidebar3pane";
        container.dataset.sidebarPosition = sidePosition;

        // Position absolue dans le messagePane
        let sideCSS = `
          position: absolute;
          top: 0;
          width: ${sideWidth}px;
          height: 100%;
          overflow: hidden;
          display: flex;
          flex-direction: row;
          z-index: ${PANEL_Z_INDEX};
          box-sizing: border-box;
        `;

        // Trouver le messageBrowser pour ajuster sa marge
        let msgBrowser = contentDoc.getElementById("messageBrowser");

        if (sidePosition === "left") {
          sideCSS += " left: 0;";
          if (msgBrowser) msgBrowser.style.marginLeft = sideWidth + "px";
        } else {
          sideCSS += " right: 0;";
          if (msgBrowser) msgBrowser.style.marginRight = sideWidth + "px";
        }
        container.style.cssText = sideCSS;
        container.dataset.msgBrowserId = msgBrowser ? msgBrowser.id : "";

        messagePane.appendChild(container);
        container.attachShadow({ mode: "open" });
      }

      // S'assurer que le messageBrowser a la marge correcte par rapport à la taille actuelle du conteneur,
      // car Thunderbird peut réinitialiser les styles du messageBrowser lors du chargement de nouveaux messages.
      let msgBrowser = contentDoc.getElementById("messageBrowser");
      if (msgBrowser) {
        let currentWidth = container.style.width || (SIDEBAR_DEFAULT_WIDTH + "px");
        if (sidePosition === "left") {
          msgBrowser.style.marginLeft = currentWidth;
          msgBrowser.style.marginRight = "";
        } else {
          msgBrowser.style.marginRight = currentWidth;
          msgBrowser.style.marginLeft = "";
        }
        container.dataset.msgBrowserId = msgBrowser.id;
      }

      if (typeof tabId !== "undefined") {
        container.dataset.tabId = String(tabId);
      }
      container.style.display = "flex";
      container.removeAttribute("hidden");
      buildBannerDOM(container.shadowRoot, threadData, currentMessageId, navigationMode, "sidebar", sidePosition, labels, stagingData);
      return true;
    }

    // =================================================================
    // Injection : mode SIDEBAR (onglet message)
    // Utilise position fixe + padding sur le body, sans reparenter le DOM
    // =================================================================

    function injectSidebar(contentDoc, threadData, currentMessageId, navigationMode, sidebarPosition, labels, stagingData, tabId) {
      let container = contentDoc.getElementById("magic-threads-container");
      let body = contentDoc.body || contentDoc.documentElement;

      // Si la préférence de position a changé pendant que l'onglet est ouvert :
      // restaurer le padding de l'ancien côté et recréer le conteneur
      if (container && container.dataset.sidebarPosition !== sidebarPosition) {
        cleanupInjectedDoc(contentDoc);
        container = null;
      }

      if (!container) {
        container = contentDoc.createElement("div");
        container.id = "magic-threads-container";
        container.dataset.layoutMode = "messageTab";
        container.dataset.layoutContext = "messageTab";

        let topOffset = 0;
        let sideCSS = `position: fixed; top: ${topOffset}px; width: ${SIDEBAR_DEFAULT_WIDTH}px; height: calc(100% - ${topOffset}px); z-index: ${PANEL_Z_INDEX};`;
        if (sidebarPosition === "left") {
          sideCSS += " left: 0;";
          body.style.paddingLeft = SIDEBAR_DEFAULT_WIDTH + "px";
          body.style.boxSizing = "border-box";
        } else {
          sideCSS += " right: 0;";
          body.style.paddingRight = SIDEBAR_DEFAULT_WIDTH + "px";
          body.style.boxSizing = "border-box";
        }
        container.style.cssText = sideCSS;
        container.dataset.sidebarPosition = sidebarPosition;

        body.appendChild(container);
        container.attachShadow({ mode: "open" });
      }

      // S'assurer que le body a le padding correct par rapport à la taille actuelle du conteneur
      if (body) {
        let currentWidth = container.style.width || (SIDEBAR_DEFAULT_WIDTH + "px");
        if (sidebarPosition === "left") {
          body.style.paddingLeft = currentWidth;
          body.style.paddingRight = "";
        } else {
          body.style.paddingRight = currentWidth;
          body.style.paddingLeft = "";
        }
        body.style.boxSizing = "border-box";
      }

      if (typeof tabId !== "undefined") {
        container.dataset.tabId = String(tabId);
      }
      container.style.display = "flex";
      container.removeAttribute("hidden");
      buildBannerDOM(container.shadowRoot, threadData, currentMessageId, navigationMode, "sidebar", sidebarPosition, labels, stagingData);
      return true;
    }

    // =================================================================
    // Navigation directe intra-onglet & Fallback 3-pane
    // =================================================================

    function displayMessageInTab(tabId, messageId) {
      try {
        let tabInfo = getTabInfo(tabId);
        if (!tabInfo) return false;

        let msgHdr = context.extension.messageManager.get(messageId);
        if (!msgHdr) {
          console.warn("Magic Threads: message not found:", messageId);
          return false;
        }

        let msgURI = msgHdr.folder?.getUriForMsg(msgHdr);
        if (!msgURI) {
          console.warn("Magic Threads: invalid message URI for messageId:", messageId);
          return false;
        }

        let contentWin = tabInfo.contentWin;
        if (!contentWin) return false;

        // Cas 1 : Onglet de message (about:message directement hébergé dans chromeBrowser)
        if (typeof contentWin.displayMessage === "function") {
          contentWin.displayMessage(msgURI);
          return true;
        }

        // Cas 2 : Vue 3-pane (about:3pane.xhtml héberge le visualiseur <browser id="messageBrowser">)
        let contentDoc = contentWin.document;
        if (contentDoc) {
          let messagePane = contentDoc.getElementById("messagePane") || contentWin.messagePane;
          let msgBrowser = contentDoc.getElementById("messageBrowser");
          let multiBrowser = contentDoc.getElementById("multiMessageBrowser");

          // S'assurer que le conteneur messagePane n'est ni masqué ni replié
          if (messagePane) {
            if (messagePane.hidden) {
              messagePane.hidden = false;
              messagePane.removeAttribute("hidden");
            }
            if (messagePane.collapsed) {
              messagePane.collapsed = false;
              messagePane.removeAttribute("collapsed");
            }
          }

          // 1. Tenter via le composant de haut niveau <message-pane> de Thunderbird 128+
          if (messagePane && typeof messagePane.displayMessage === "function") {
            try {
              messagePane.displayMessage(msgURI);
            } catch (e) {
              console.warn("Magic Threads: messagePane.displayMessage failed:", e);
            }
          }

          // 2. Vérification / Fallback direct : si aboutMessage n'a pas chargé l'URI, appeler directement displayMessage
          if (msgBrowser && msgBrowser.contentWindow && typeof msgBrowser.contentWindow.displayMessage === "function") {
            try {
              if (msgBrowser.contentWindow.gMessageURI !== msgURI) {
                msgBrowser.contentWindow.displayMessage(msgURI);
              }
            } catch (e) {
              try {
                msgBrowser.contentWindow.displayMessage(msgURI);
              } catch (err) {
                console.warn("Magic Threads: msgBrowser.contentWindow.displayMessage failed:", err);
              }
            }
          }

          // 3. CRITIQUE : Restaurer la visibilité du visualiseur et masquer la multi-sélection.
          // Quand la vue 3-pane est filtrée sans résultat, Thunderbird passe messageBrowser en hidden = true.
          if (msgBrowser) {
            msgBrowser.hidden = false;
            msgBrowser.removeAttribute("hidden");
            msgBrowser.style.display = "";
          }
          if (multiBrowser) {
            multiBrowser.hidden = true;
            multiBrowser.setAttribute("hidden", "true");
          }

          return true;
        }

        console.warn("Magic Threads: displayMessage not available for tabId:", tabId);
        return false;
      } catch (e) {
        console.error("Magic Threads: displayMessageInTab error:", e);
        return false;
      }
    }

    // =================================================================
    // API publique
    // =================================================================

    return {
      magicThreadsWindow: {
        async showBanner(tabId, threadData, currentMessageId, navigationMode, sidebarPosition, mainViewPosition, labels, stagingData) {
          try {
            let tabInfo = getTabInfo(tabId);
            if (!tabInfo) {
              console.warn("Magic Threads: contentWindow unavailable for tab:", tabId);
              return;
            }

            let contentDoc = tabInfo.contentWin.document;
            // Les types et formes sont garantis par le schéma (magicThreadsWindowSchema.json)
            if (!Array.isArray(threadData) || threadData.length === 0) return;
            // Fusionner avec les valeurs par défaut pour les clés manquantes
            labels = Object.assign({}, DEFAULT_LABELS, labels || {});

            let success = false;

            if (tabInfo.isMessageTab) {
              // Onglet message → sidebar avec position fixe
              success = injectSidebar(contentDoc, threadData, currentMessageId, navigationMode, sidebarPosition || "right", labels, stagingData, tabId);
            } else {
              // 3-pane → selon mainViewPosition (le schéma garantit "bottom" ou "right")
              let mvp = mainViewPosition || "bottom";
              if (mvp === "right") {
                success = injectSide3Pane(contentDoc, threadData, currentMessageId, navigationMode, mvp, labels, stagingData, tabId);
              } else {
                success = injectBottom(contentDoc, threadData, currentMessageId, navigationMode, labels, stagingData, tabId);
              }
            }

            if (!success) {
              console.error("Magic Threads: injection failed for tab:", tabId, "mode:", tabInfo.modeName);
            }
          } catch (e) {
            console.error("Magic Threads: showBanner error:", e);
          }
        },

        async hideBanner(tabId) {
          try {
            let tabInfo = getTabInfo(tabId);
            if (!tabInfo) return;

            let contentDoc = tabInfo.contentWin?.document;
            if (!contentDoc) return;

            let container = contentDoc.getElementById("magic-threads-container");
            if (container) {
              container.style.display = "none";
              container.setAttribute("hidden", "");
            }

            // Nettoyage inconditionnel des paddings (onglet de message)
            let body = contentDoc.body || contentDoc.documentElement;
            if (body) {
              body.style.paddingLeft = "";
              body.style.paddingRight = "";
              body.style.boxSizing = "";
            }

            // Nettoyage inconditionnel des marges (vue 3-pane)
            let msgBrowser = contentDoc.getElementById("messageBrowser");
            if (msgBrowser) {
              msgBrowser.style.marginLeft = "";
              msgBrowser.style.marginRight = "";
            }
          } catch (e) {
            // Ignorer silencieusement
          }
        },

        async displayMessageDirectly(tabId, messageId) {
          return displayMessageInTab(tabId, messageId);
        },

        async navigateMessageTab(tabId, messageId) {
          return displayMessageInTab(tabId, messageId);
        },

        onBannerItemClicked: new ExtensionCommon.EventManager({
          context,
          name: "magicThreadsWindow.onBannerItemClicked",
          register(fire) {
            itemClickFire = fire;
            return function () {
              itemClickFire = null;
            };
          },
        }).api(),

        onConfirmManualLink: new ExtensionCommon.EventManager({
          context,
          name: "magicThreadsWindow.onConfirmManualLink",
          register(fire) {
            confirmManualLinkFire = fire;
            return function () {
              confirmManualLinkFire = null;
            };
          },
        }).api(),

        onCancelManualLink: new ExtensionCommon.EventManager({
          context,
          name: "magicThreadsWindow.onCancelManualLink",
          register(fire) {
            cancelManualLinkFire = fire;
            return function () {
              cancelManualLinkFire = null;
            };
          },
        }).api(),

        onDetachManualLink: new ExtensionCommon.EventManager({
          context,
          name: "magicThreadsWindow.onDetachManualLink",
          register(fire) {
            detachManualLinkFire = fire;
            return function () {
              detachManualLinkFire = null;
            };
          },
        }).api(),

        onNavigationModeChanged: new ExtensionCommon.EventManager({
          context,
          name: "magicThreadsWindow.onNavigationModeChanged",
          register(fire) {
            toggleNavigationModeFire = fire;
            return function () {
              toggleNavigationModeFire = null;
            };
          },
        }).api(),
      },
    };
  }

  /**
   * Nettoyage du DOM lors de la désactivation/désinstallation de l'extension.
   * Supprime tous les conteneurs Magic Threads injectés dans les fenêtres ouvertes.
   */
  onShutdown(isAppShutdown) {
    if (isAppShutdown) return;
    try {
      // Énumérer TOUTES les fenêtres (3-pane ET fenêtres message autonomes mail:messageWindow)
      for (let window of Services.wm.getEnumerator(null)) {
        try {
          let doc = window.document;
          let contentDocs = [];

          // Fenêtres principales : parcourir les onglets de tabmail
          // (couvre about:3pane et les onglets message about:message)
          let tabmail = doc.getElementById("tabmail");
          if (tabmail) {
            for (let tab of tabmail.tabInfo) {
              let chromeBrowser = tab.chromeBrowser;
              if (chromeBrowser && chromeBrowser.contentDocument) {
                contentDocs.push(chromeBrowser.contentDocument);
              }
            }
          }

          // Fenêtres message autonomes : le browser héberge directement about:message
          let msgBrowser = doc.getElementById("messageBrowser");
          if (msgBrowser && msgBrowser.contentDocument) {
            contentDocs.push(msgBrowser.contentDocument);
          }

          // Défense en profondeur : le document de la fenêtre elle-même
          contentDocs.push(doc);

          for (let contentDoc of contentDocs) {
            try {
              cleanupInjectedDoc(contentDoc);
            } catch (e) {
              // Ignorer les erreurs par document
            }
          }
        } catch (e) {
          // Ignorer les erreurs par fenêtre
        }
      }
    } catch (e) {
      console.error("Magic Threads: onShutdown cleanup error:", e);
    }
  }
};
