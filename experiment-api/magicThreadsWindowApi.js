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
const BOTTOM_DEFAULT_HEIGHT = 250;
const PANEL_Z_INDEX = 100;

// Feuilles de style du Shadow DOM, en constantes de module (aucune dépendance
// au contexte : hissées hors de getAPI pour alléger la fermeture).
const SHARED_CSS = `
        :host {
          display: flex;
          flex-direction: column;
          box-sizing: border-box;

          /* Palette adossée aux variables de thème Thunderbird (--layout-*, --color-*,
             --focus-outline-color) héritées du document hôte, avec fallbacks
             conformes WCAG AA (texte secondaire ≥ 4,5:1 sur les fonds utilisés).
             Déclarée sur :host pour être visible de tout le shadow tree
             (y compris la poignée de redimensionnement, hors .threads-wrapper). */
          --banner-bg: var(--layout-background-1, #f5f7f8);
          --banner-border: var(--layout-border-0, #e1e4e6);
          --card-bg: var(--layout-background-0, #ffffff);
          --card-hover-bg: var(--layout-background-2, #edf2f7);
          --text-main: var(--layout-color-1, #1a202c);
          --text-muted: var(--layout-color-2, #5a6675);
          --accent-border: var(--color-accent-primary, #3182ce);
          --accent-bg: #ebf8ff;
          --focus-color: var(--focus-outline-color, var(--accent-border));
          --folder-bg: #edf2f7;
          --folder-text: #4a5568;
          --inbox-bg: #ebf8ff;
          --inbox-text: #2b6cb0;
          --sent-bg: #f0fff4;
          --sent-text: #276f4a;
          --archive-bg: #fefcbf;
          --archive-text: #8f5700;
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
        }

        @media (prefers-color-scheme: dark) {
          :host {
            /* Mêmes variables de thème TB ; seuls les fallbacks changent
               (--text-muted relevé à #8a93a3 pour ≥ 4,5:1 sur --card-bg). */
            --banner-bg: var(--layout-background-1, #1e222b);
            --banner-border: var(--layout-border-0, #3e4451);
            --card-bg: var(--layout-background-0, #282c34);
            --card-hover-bg: var(--layout-background-2, #353b45);
            --text-main: var(--layout-color-1, #abb2bf);
            --text-muted: var(--layout-color-2, #8d98a9);
            --accent-border: var(--color-accent-primary, #528bff);
            --accent-bg: #223147;
            --folder-bg: #2d3139;
            --folder-text: #abb2bf;
            --inbox-bg: #1e3a5f;
            --inbox-text: #82aaff;
            --sent-bg: #1b4d3e;
            --sent-text: #a3e635;
            --archive-bg: #4d3d1b;
            --archive-text: #fbbf24;
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
          font-size: 13px;
        }

        .threads-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .threads-mode-indicator {
          font-size: 11px;
          color: var(--text-muted);
          background-color: var(--card-bg);
          border: 1px solid var(--banner-border);
          padding: 2px 8px;
          border-radius: 12px;
          transition: all 0.2s ease;
        }

        .threads-toggle-btn,
        .threads-collapse-btn {
          background: none;
          border: 1px solid var(--banner-border);
          color: var(--text-main);
          cursor: pointer;
          padding: 2px 6px;
          border-radius: 4px;
          background-color: var(--card-bg);
          font-size: 12px;
          transition: background-color 0.2s;
        }

        .threads-toggle-btn:hover,
        .threads-collapse-btn:hover {
          background-color: var(--card-hover-bg);
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
        .threads-toggle-btn:focus-visible,
        .threads-collapse-btn:focus-visible,
        .resize-handle:focus-visible {
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
          font-size: 10px;
        }

        .thread-date {
          color: var(--text-muted);
          font-size: 11px;
        }

        .thread-folder {
          font-size: 10px;
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
          font-size: 12px;
          line-height: 1.4;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .thread-item.unread .thread-snippet {
          color: var(--text-main);
          font-weight: 500;
        }

        .thread-attachment {
          display: inline-block;
          font-size: 11px;
          color: var(--text-muted);
          margin-left: 4px;
          vertical-align: middle;
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
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='4'%3E%3Ccircle cx='4' cy='2' r='1.2' fill='%23999'/%3E%3Ccircle cx='10' cy='2' r='1.2' fill='%23999'/%3E%3Ccircle cx='16' cy='2' r='1.2' fill='%23999'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: center;
          opacity: 0.7;
          transition: opacity 0.2s, background-color 0.2s;
        }
        .resize-handle {
          touch-action: none;
        }
        .resize-handle:hover {
          opacity: 1;
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
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='20'%3E%3Ccircle cx='2' cy='4' r='1.2' fill='%23999'/%3E%3Ccircle cx='2' cy='10' r='1.2' fill='%23999'/%3E%3Ccircle cx='2' cy='16' r='1.2' fill='%23999'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: center;
          opacity: 0.7;
          transition: opacity 0.2s, background-color 0.2s;
        }
        .resize-handle {
          touch-action: none;
        }
        .resize-handle:hover {
          opacity: 1;
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
        .threads-title {
          font-size: 12px;
        }
        .thread-meta {
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
        }
        .thread-folder {
          margin-left: 0;
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

    function onPointerMove(ev) {
      let delta;
      if (axis === "y") {
        // Panneau bottom : glisser vers le haut = agrandir
        delta = startPos - ev.screenY;
      } else {
        // Sidebar : le sens dépend du côté
        delta = sidebarPosition === "right" ? startPos - ev.screenX : ev.screenX - startPos;
      }
      applySize(startSize + delta);
    }

    function onPointerEnd(ev) {
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerEnd);
      handle.removeEventListener("pointercancel", onPointerEnd);
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

    // Labels par défaut (fallback en anglais si non fournis, alignés sur _locales/en)
    const DEFAULT_LABELS = {
      panelTitle: "🧵 Thread ($COUNT$)",
      modeCurrentTab: "Current tab 🔁",
      modeNewTab: "New tab ↗️",
      tooltipCurrentTab: "Click switches the message in the active tab",
      tooltipNewTab: "Click opens the message in a new tab",
      tooltipToggleMode: "Change navigation mode",
      tooltipCollapseExpand: "Collapse/Expand panel",
      tooltipResize: "Drag to resize",
      tooltipAttachment: "Attachment(s)",
      folderInbox: "Inbox",
      folderSent: "Sent",
      folderArchive: "Archives",
      folderDrafts: "Drafts",
      folderTrash: "Trash",
      unknownAuthor: "Unknown",
      unreadLabel: "Unread"
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

    function updateModeIndicator(elem, mode, labels) {
      if (mode === "currentTab") {
        elem.textContent = labels.modeCurrentTab;
        elem.title = labels.tooltipCurrentTab;
      } else {
        elem.textContent = labels.modeNewTab;
        elem.title = labels.tooltipNewTab;
      }
    }

    // =================================================================
    // DOM Builder (i18n-aware)
    // =================================================================

    /**
     * Construit un élément de fil (listitem > item cliquable) pour un message.
     * Le mode de navigation est lu via navState au moment du clic.
     * @returns {Element} le wrapper listitem prêt à insérer dans la liste
     */
    function buildThreadItem(doc, msg, currentMessageId, labels, navState) {
      // Wrapper listitem : conserve la sémantique de liste, car l'item
      // cliquable porte lui-même role="button" (un élément = un seul rôle)
      let listItem = doc.createElement("div");
      listItem.setAttribute("role", "listitem");

      let item = doc.createElement("div");
      item.className = "thread-item";
      item.dataset.messageId = String(msg.id);
      // Each item in the list represents a button for keyboard navigability and screen readers.
      // For the current message, it is a disabled button (aria-disabled="true") representing the current state (aria-current="true").
      item.setAttribute("role", "button");
      item.tabIndex = 0;

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

      if (msg.hasAttachments) {
        let clip = doc.createElement("span");
        clip.className = "thread-attachment";
        clip.textContent = "\uD83D\uDCCE";
        clip.title = labels.tooltipAttachment;
        meta.appendChild(clip);
      }

      item.appendChild(meta);

      let snippet = doc.createElement("div");
      snippet.className = "thread-snippet";
      snippet.textContent = msg.snippet;
      item.appendChild(snippet);

      let activate = () => {
        // Retour visuel immédiat (Optimistic UI) uniquement en navigation intra-onglet
        if (navState.mode === "currentTab") {
          let root = item.closest("#threads-list");
          if (root) {
            let allItems = root.querySelectorAll(".thread-item");
            for (let it of allItems) {
              it.classList.remove("current");
              it.removeAttribute("aria-current");
              it.removeAttribute("aria-disabled");
            }
          }
          item.classList.add("current");
          item.setAttribute("aria-current", "true");
          item.setAttribute("aria-disabled", "true");
        }

        if (itemClickFire) {
          itemClickFire.async(msg.id, navState.mode);
        }
      };

      item.addEventListener("click", () => {
        if (item.classList.contains("current")) return;
        activate();
      });
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          // Espace : empêcher le défilement de la liste
          e.preventDefault();
          if (item.classList.contains("current")) return;
          activate();
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
    function tryUpdateBannerDOM(shadowRoot, threadData, currentMessageId, navigationMode, layoutMode, sidebarPosition, labels) {
      let hostEl = shadowRoot.host;
      if (!hostEl) return false;

      let wrapper = shadowRoot.querySelector(".threads-wrapper");
      let list = shadowRoot.querySelector("#threads-list");
      if (!wrapper || !list) return false;

      // Vérifier si la disposition et l'orientation ont changé
      if (hostEl.dataset.bannerLayout !== layoutMode || hostEl.dataset.bannerSide !== sidebarPosition) {
        return false;
      }

      // Vérifier si la composition du fil a changé (signature basée sur les IDs ordonnés)
      let newSignature = threadData.map(m => m.id).join(",");
      if (hostEl.dataset.threadSignature !== newSignature) {
        return false;
      }

      // Mise à jour in-place des éléments du fil
      let items = list.querySelectorAll(".thread-item");
      for (let item of items) {
        let msgId = Number(item.dataset.messageId);
        let msgData = threadData.find(m => m.id === msgId);
        let isCurrent = msgId === currentMessageId;

        if (isCurrent) {
          item.classList.add("current");
          item.setAttribute("aria-current", "true");
          item.setAttribute("aria-disabled", "true");
        } else {
          item.classList.remove("current");
          item.removeAttribute("aria-current");
          item.removeAttribute("aria-disabled");
        }

        // Mise à jour de l'état non-lu si le message est passé de non-lu à lu
        if (msgData) {
          if (msgData.isRead) {
            item.classList.remove("unread");
            let hiddenUnread = item.querySelector(".visually-hidden");
            if (hiddenUnread) hiddenUnread.remove();
          } else if (!item.classList.contains("unread")) {
            item.classList.add("unread");
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
      let modeIndicator = shadowRoot.querySelector("#threads-mode-indicator");
      if (modeIndicator) {
        updateModeIndicator(modeIndicator, navigationMode, labels);
      }

      // Scroll doux vers l'élément sélectionné si nécessaire
      let currentItem = list.querySelector(".thread-item.current");
      if (currentItem && currentItem.ownerDocument?.defaultView) {
        currentItem.ownerDocument.defaultView.requestAnimationFrame(() => {
          currentItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
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
    function buildBannerDOM(shadowRoot, threadData, currentMessageId, navigationMode, layoutMode, sidebarPosition, labels) {
      if (tryUpdateBannerDOM(shadowRoot, threadData, currentMessageId, navigationMode, layoutMode, sidebarPosition, labels)) {
        return;
      }

      // Nettoyage DOM itératif (évite innerHTML dans le contexte chrome privilégié — flag AMO)
      while (shadowRoot.firstChild) {
        shadowRoot.firstChild.remove();
      }
      let doc = shadowRoot.ownerDocument;
      let hostEl = shadowRoot.host;
      if (hostEl) {
        hostEl.dataset.bannerLayout = layoutMode;
        hostEl.dataset.bannerSide = sidebarPosition;
        hostEl.dataset.threadSignature = threadData.map(m => m.id).join(",");
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
        attachResizeBehavior(resizeHandle, "y", shadowRoot, sidebarPosition);
        shadowRoot.appendChild(resizeHandle);
      }

      if (layoutMode === "sidebar") {
        // Horizontal resize handle (edge of sidebar)
        let resizeHandle = doc.createElement("div");
        resizeHandle.className = "resize-handle";
        resizeHandle.title = labels.tooltipResize;
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

      // Wrapper
      let wrapper = doc.createElement("div");
      wrapper.className = "threads-wrapper";
      if (layoutMode === "sidebar") {
        wrapper.classList.add(sidebarPosition === "left" ? "sidebar-left" : "sidebar-right");
      }

      // Header
      let header = doc.createElement("div");
      header.className = "threads-header";

      let title = doc.createElement("span");
      title.className = "threads-title";
      title.setAttribute("role", "heading");
      title.setAttribute("aria-level", "2");
      let titleText = labels.panelTitle || "\u{1F9F5} Thread ($COUNT$)";
      title.textContent = titleText.replace("$COUNT$", threadData.length);
      header.appendChild(title);

      let actionsDiv = doc.createElement("div");
      actionsDiv.className = "threads-actions";

      let modeIndicator = doc.createElement("span");
      modeIndicator.id = "threads-mode-indicator";
      modeIndicator.className = "threads-mode-indicator";
      modeIndicator.setAttribute("aria-live", "polite");
      updateModeIndicator(modeIndicator, navigationMode, labels);
      actionsDiv.appendChild(modeIndicator);

      let toggleBtn = doc.createElement("button");
      toggleBtn.className = "threads-toggle-btn";
      toggleBtn.title = labels.tooltipToggleMode;
      toggleBtn.setAttribute("aria-label", labels.tooltipToggleMode);
      toggleBtn.setAttribute("aria-describedby", "threads-mode-indicator");
      toggleBtn.textContent = "\u2699\uFE0F";
      actionsDiv.appendChild(toggleBtn);

      let collapseBtn = doc.createElement("button");
      collapseBtn.className = "threads-collapse-btn";
      collapseBtn.textContent = "\u25BC";
      collapseBtn.title = labels.tooltipCollapseExpand;
      collapseBtn.setAttribute("aria-label", labels.tooltipCollapseExpand);
      collapseBtn.setAttribute("aria-controls", "threads-list");
      // État déplié annoncé aux technologies d'assistance, tenu à jour à chaque bascule
      collapseBtn.setAttribute("aria-expanded", "true");
      actionsDiv.appendChild(collapseBtn);

      header.appendChild(actionsDiv);
      wrapper.appendChild(header);

      // Liste (sémantique ARIA : list > listitem, voir construction des items)
      let list = doc.createElement("div");
      list.id = "threads-list";
      list.className = "threads-list";
      list.setAttribute("role", "list");

      // Mode de navigation courant porté par un objet : buildThreadItem en lit
      // la valeur AU MOMENT du clic (liaison vivante après bascule du bouton).
      let navState = { mode: navigationMode };

      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        navState.mode = navState.mode === "currentTab" ? "newTab" : "currentTab";
        updateModeIndicator(modeIndicator, navState.mode, labels);
      });

      collapseBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        let isCollapsed = list.classList.toggle("collapsed");
        collapseBtn.textContent = isCollapsed ? "\u25B6" : "\u25BC";
        collapseBtn.setAttribute("aria-expanded", String(!isCollapsed));

        // En mode bottom : ajuster la hauteur du conteneur
        if (layoutMode === "bottom") {
          let hostEl = shadowRoot.host;
          if (isCollapsed) {
            hostEl.dataset.expandedHeight = hostEl.style.height || hostEl.offsetHeight + "px";
            hostEl.style.height = BOTTOM_MIN_HEIGHT + "px";
          } else {
            let savedHeight = hostEl.dataset.expandedHeight || (BOTTOM_DEFAULT_HEIGHT + "px");
            hostEl.style.height = savedHeight;
          }
        }
      });

      for (let msg of threadData) {
        list.appendChild(buildThreadItem(doc, msg, currentMessageId, labels, navState));
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
        currentItem.ownerDocument.defaultView.requestAnimationFrame(() => {
          currentItem.scrollIntoView({ block: "center", behavior: "smooth" });
        });
      }
    }

    // =================================================================
    // Injection : mode BOTTOM (3-pane, panneau en bas)
    // =================================================================

    function injectBottom(contentDoc, threadData, currentMessageId, navigationMode, labels) {
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
      container.style.display = "flex";
      container.removeAttribute("hidden");
      buildBannerDOM(container.shadowRoot, threadData, currentMessageId, navigationMode, "bottom", "right", labels);
      return true;
    }

    // =================================================================
    // Injection : mode SIDEBAR dans le 3-pane
    // Position absolue dans le <message-pane> + marge sur le messageBrowser
    // =================================================================

    function injectSide3Pane(contentDoc, threadData, currentMessageId, navigationMode, sidePosition, labels) {
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

      container.style.display = "flex";
      container.removeAttribute("hidden");
      buildBannerDOM(container.shadowRoot, threadData, currentMessageId, navigationMode, "sidebar", sidePosition, labels);
      return true;
    }

    // =================================================================
    // Injection : mode SIDEBAR (onglet message)
    // Utilise position fixe + padding sur le body, sans reparenter le DOM
    // =================================================================

    function injectSidebar(contentDoc, threadData, currentMessageId, navigationMode, sidebarPosition, labels) {
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

      container.style.display = "flex";
      container.removeAttribute("hidden");
      buildBannerDOM(container.shadowRoot, threadData, currentMessageId, navigationMode, "sidebar", sidebarPosition, labels);
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
        async showBanner(tabId, threadData, currentMessageId, navigationMode, sidebarPosition, mainViewPosition, labels) {
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
              success = injectSidebar(contentDoc, threadData, currentMessageId, navigationMode, sidebarPosition || "right", labels);
            } else {
              // 3-pane → selon mainViewPosition (le schéma garantit "bottom" ou "right")
              let mvp = mainViewPosition || "bottom";
              if (mvp === "right") {
                success = injectSide3Pane(contentDoc, threadData, currentMessageId, navigationMode, mvp, labels);
              } else {
                success = injectBottom(contentDoc, threadData, currentMessageId, navigationMode, labels);
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
