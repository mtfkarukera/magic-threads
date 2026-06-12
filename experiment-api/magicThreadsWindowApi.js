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

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    let startPos = axis === "y" ? e.screenY : e.screenX;
    let startSize = axis === "y" ? hostEl.offsetHeight : hostEl.offsetWidth;
    handle.setPointerCapture(e.pointerId);

    function onPointerMove(ev) {
      if (axis === "y") {
        // Panneau bottom : glisser vers le haut = agrandir
        let delta = startPos - ev.screenY;
        let newHeight = Math.max(BOTTOM_MIN_HEIGHT, Math.min(startSize + delta, BOTTOM_MAX_HEIGHT));
        hostEl.style.height = newHeight + "px";
        return;
      }

      // Sidebar : le sens dépend du côté
      let delta = sidebarPosition === "right" ? startPos - ev.screenX : ev.screenX - startPos;
      let newWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(startSize + delta, SIDEBAR_MAX_WIDTH));
      hostEl.style.width = newWidth + "px";

      // Répercuter la largeur sur le document hôte (padding du body ou marge du messageBrowser)
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

    // Labels par défaut (fallback si non fournis)
    const DEFAULT_LABELS = {
      panelTitle: "🧵 Fil ($COUNT$)",
      modeCurrentTab: "Onglet courant 🔁",
      modeNewTab: "Nouvel onglet ↗️",
      tooltipCurrentTab: "Clic bascule le message dans l'onglet actif",
      tooltipNewTab: "Clic ouvre le message dans un nouvel onglet",
      tooltipToggleMode: "Changer le mode de navigation",
      tooltipCollapseExpand: "Réduire/Déplier le panneau",
      tooltipResize: "Glisser pour redimensionner",
      tooltipAttachment: "Pièce(s) jointe(s)",
      folderInbox: "Boîte de réception",
      folderSent: "Envoyés",
      folderArchive: "Archives",
      folderDrafts: "Brouillons",
      folderTrash: "Corbeille",
      unknownAuthor: "Inconnu"
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
    // CSS — Shared
    // =================================================================

    function getSharedCSS() {
      return `
        :host {
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
        }
        :host([hidden]) {
          display: none !important;
        }

        .threads-wrapper {
          --banner-bg: #f5f7f8;
          --banner-border: #e1e4e6;
          --card-bg: #ffffff;
          --card-hover-bg: #edf2f7;
          --text-main: #1a202c;
          --text-muted: #718096;
          --accent-border: #3182ce;
          --accent-bg: #ebf8ff;
          --folder-bg: #edf2f7;
          --folder-text: #4a5568;
          --inbox-bg: #ebf8ff;
          --inbox-text: #2b6cb0;
          --sent-bg: #f0fff4;
          --sent-text: #2f855a;
          --archive-bg: #fefcbf;
          --archive-text: #b7791f;

          background-color: var(--banner-bg);
          padding: 0 16px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          font-size: 13px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        @media (prefers-color-scheme: dark) {
          .threads-wrapper {
            --banner-bg: #1e222b;
            --banner-border: #3e4451;
            --card-bg: #282c34;
            --card-hover-bg: #353b45;
            --text-main: #abb2bf;
            --text-muted: #5c6370;
            --accent-border: #528bff;
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
    }

    // =================================================================
    // CSS — Bottom mode (3-pane) with vertical resize handle
    // =================================================================

    function getBottomCSS() {
      return `
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
    }

    // =================================================================
    // CSS — Sidebar mode (message tab + 3-pane sidebar)
    // with horizontal resize handle
    // =================================================================

    function getSidebarCSS() {
      return `
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
      let dateObj = new Date(timestamp);
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
     * Construit le DOM du panneau dans le Shadow DOM.
     * @param {string} layoutMode - "bottom" ou "sidebar"
     * @param {string} sidebarPosition - "left" ou "right"
     * @param {object} labels - Chaînes i18n
     */
    function buildBannerDOM(shadowRoot, threadData, currentMessageId, navigationMode, layoutMode, sidebarPosition, labels) {
      // Nettoyage DOM itératif (évite innerHTML dans le contexte chrome privilégié — flag AMO)
      while (shadowRoot.firstChild) {
        shadowRoot.firstChild.remove();
      }
      let doc = shadowRoot.ownerDocument;

      // Poignée de redimensionnement à insérer APRÈS le wrapper (cas sidebar gauche).
      // Déclarée au niveau de la fonction : une déclaration dans le bloc `if` ci-dessous
      // serait hors de portée au moment de l'insertion (bug corrigé en v2.1.2).
      let pendingResizeHandle = null;

      // Styles
      let style = doc.createElement("style");
      style.textContent = getSharedCSS() + (layoutMode === "sidebar" ? getSidebarCSS() : getBottomCSS());
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
      let titleText = labels.panelTitle || "\u{1F9F5} Fil ($COUNT$)";
      title.textContent = titleText.replace("$COUNT$", threadData.length);
      header.appendChild(title);

      let actionsDiv = doc.createElement("div");
      actionsDiv.className = "threads-actions";

      let modeIndicator = doc.createElement("span");
      modeIndicator.className = "threads-mode-indicator";
      updateModeIndicator(modeIndicator, navigationMode, labels);
      actionsDiv.appendChild(modeIndicator);

      let toggleBtn = doc.createElement("button");
      toggleBtn.className = "threads-toggle-btn";
      toggleBtn.title = labels.tooltipToggleMode;
      toggleBtn.textContent = "\u2699\uFE0F";
      actionsDiv.appendChild(toggleBtn);

      let collapseBtn = doc.createElement("button");
      collapseBtn.className = "threads-collapse-btn";
      collapseBtn.textContent = "\u25BC";
      collapseBtn.title = labels.tooltipCollapseExpand;
      actionsDiv.appendChild(collapseBtn);

      header.appendChild(actionsDiv);
      wrapper.appendChild(header);

      // Liste
      let list = doc.createElement("div");
      list.className = "threads-list";

      let currentNavMode = navigationMode;

      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        currentNavMode = currentNavMode === "currentTab" ? "newTab" : "currentTab";
        updateModeIndicator(modeIndicator, currentNavMode, labels);
      });

      collapseBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        let isCollapsed = list.classList.toggle("collapsed");
        collapseBtn.textContent = isCollapsed ? "\u25B6" : "\u25BC";

        // En mode bottom : ajuster la hauteur du conteneur
        if (layoutMode === "bottom") {
          let hostEl = shadowRoot.host;
          if (isCollapsed) {
            hostEl.dataset.expandedHeight = hostEl.style.height || hostEl.offsetHeight + "px";
            hostEl.style.height = "44px";
          } else {
            let savedHeight = hostEl.dataset.expandedHeight || "250px";
            hostEl.style.height = savedHeight;
          }
        }
      });

      for (let msg of threadData) {
        let item = doc.createElement("div");
        item.className = "thread-item";
        if (msg.id === currentMessageId) item.classList.add("current");
        if (!msg.isRead) item.classList.add("unread");

        let meta = doc.createElement("div");
        meta.className = "thread-meta";

        let author = doc.createElement("span");
        author.className = "thread-author";
        author.textContent = cleanAuthor(msg.author, labels);
        meta.appendChild(author);

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

        if (msg.id !== currentMessageId) {
          item.addEventListener("click", () => {
            if (itemClickFire) {
              itemClickFire.async(msg.id, currentNavMode);
            }
          });
        }

        list.appendChild(item);
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
        container.style.cssText = "width: 100%; flex-shrink: 0; height: 250px;";
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
        let sideWidth = 300;

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
          z-index: 100;
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
        let currentWidth = container.style.width || "300px";
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
        let sideCSS = `position: fixed; top: ${topOffset}px; width: 300px; height: calc(100% - ${topOffset}px); z-index: 100;`;
        if (sidebarPosition === "left") {
          sideCSS += " left: 0;";
          body.style.paddingLeft = "300px";
          body.style.boxSizing = "border-box";
        } else {
          sideCSS += " right: 0;";
          body.style.paddingRight = "300px";
          body.style.boxSizing = "border-box";
        }
        container.style.cssText = sideCSS;
        container.dataset.sidebarPosition = sidebarPosition;

        body.appendChild(container);
        container.attachShadow({ mode: "open" });
      }

      // S'assurer que le body a le padding correct par rapport à la taille actuelle du conteneur
      if (body) {
        let currentWidth = container.style.width || "300px";
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

            let contentDoc = tabInfo.contentWin.document;
            let container = contentDoc.getElementById("magic-threads-container");
            if (container) {
              container.style.display = "none";
              container.setAttribute("hidden", "");

              // Restaurer les paddings du body si c'était un sidebar onglet message
              if (container.dataset.layoutContext === "messageTab" && container.dataset.sidebarPosition) {
                let body = contentDoc.body || contentDoc.documentElement;
                if (container.dataset.sidebarPosition === "left") {
                  body.style.paddingLeft = "";
                } else {
                  body.style.paddingRight = "";
                }
              }

              // Restaurer les marges si c'était un sidebar 3-pane
              if (container.dataset.layoutMode === "sidebar3pane") {
                cleanupSidebar3PaneContainer(container, contentDoc);
              }
            }
          } catch (e) {
            // Ignorer silencieusement
          }
        },

        async navigateMessageTab(tabId, messageId) {
          try {
            let tabObject = context.extension.tabManager.get(tabId);
            if (!tabObject || !tabObject.nativeTab) {
              console.warn("Magic Threads: tab not found for navigateMessageTab:", tabId);
              return false;
            }

            let msgHdr = context.extension.messageManager.get(messageId);
            if (!msgHdr) {
              console.warn("Magic Threads: message not found:", messageId);
              return false;
            }

            let chromeBrowser = tabObject.nativeTab.chromeBrowser;
            if (!chromeBrowser) {
              console.warn("Magic Threads: no chromeBrowser.");
              return false;
            }

            let win = chromeBrowser.ownerGlobal;
            let tabmail = win.document.getElementById("tabmail");
            if (!tabmail) {
              console.warn("Magic Threads: tabmail not found.");
              return false;
            }

            let msgURI = msgHdr.folder.getUriForMsg(msgHdr);
            if (!msgURI) {
              console.warn("Magic Threads: invalid message URI");
              return false;
            }
            // Ouvrir AVANT de fermer : si openTab échoue, l'onglet de
            // l'utilisateur n'est pas perdu (l'exception déclenche le fallback).
            let nativeTab = tabObject.nativeTab;
            tabmail.openTab("mailMessageTab", {
              messageURI: msgURI,
              background: false
            });
            tabmail.closeTab(nativeTab);

            return true;
          } catch (e) {
            console.error("Magic Threads: navigateMessageTab error:", e);
            return false;
          }
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
