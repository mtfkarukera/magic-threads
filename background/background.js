/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ThreadResolver } from "./threadResolver.js";

// ---- Préférences utilisateur ----
const storage = browser.storage.sync || browser.storage.local;

async function getNavigationMode() {
  try {
    let prefs = await storage.get({ navigationMode: "currentTab" });
    return prefs.navigationMode;
  } catch (e) {
    return "currentTab";
  }
}

async function getSidebarPosition() {
  try {
    let prefs = await storage.get({ sidebarPosition: "right" });
    return prefs.sidebarPosition;
  } catch (e) {
    return "right";
  }
}

async function getMainViewPosition() {
  try {
    let prefs = await storage.get({ mainViewPosition: "bottom" });
    return prefs.mainViewPosition;
  } catch (e) {
    return "bottom";
  }
}

// Migration (v2.2.0) : la position « left » en vue principale a été retirée.
// La valeur stockée est convertie une fois pour toutes — fin du remap silencieux.
const prefsMigrated = (async () => {
  try {
    let prefs = await storage.get({ mainViewPosition: "bottom" });
    if (prefs.mainViewPosition === "left") {
      await storage.set({ mainViewPosition: "right" });
    }
  } catch (e) {
    // storage indisponible : rien à migrer
  }
})();

async function getThreadOrder() {
  try {
    let prefs = await storage.get({ threadOrder: "antichronological" });
    return prefs.threadOrder;
  } catch (e) {
    return "antichronological";
  }
}

// ---- Chaînes i18n pour l'Experiment API ----
function getLabels(count) {
  const keys = [
    "panelTitle",
    "modeCurrentTab", "modeNewTab",
    "tooltipCurrentTab", "tooltipNewTab",
    "tooltipToggleMode", "tooltipCollapseExpand",
    "tooltipResize", "tooltipAttachment",
    "folderInbox", "folderSent", "folderArchive",
    "folderDrafts", "folderTrash",
    "unknownAuthor", "unreadLabel"
  ];
  let labels = {};
  for (let key of keys) {
    let msg;
    if (key === "panelTitle" && typeof count !== "undefined") {
      msg = browser.i18n.getMessage(key, [String(count)]);
    } else {
      msg = browser.i18n.getMessage(key);
    }
    if (msg) {
      labels[key] = msg;
    }
    // Si getMessage retourne "", on n'ajoute pas la clé,
    // ce qui permet au DEFAULT_LABELS de l'Experiment API de prendre le relais.
  }
  return labels;
}

// ---- Logique commune d'affichage du fil ----
// Compteur de requêtes PAR ONGLET : une requête n'est invalidée que par une
// requête plus récente (ou un masquage) concernant le même onglet.
const tabRequestIds = new Map();
const tabLastMessageId = new Map();

function nextRequestId(tabId) {
  const id = (tabRequestIds.get(tabId) || 0) + 1;
  tabRequestIds.set(tabId, id);
  return id;
}

// Invalide les requêtes en vol pour un onglet (appelé avant tout masquage).
function invalidateRequests(tabId) {
  nextRequestId(tabId);
}

// Éviter que les Maps ne grossissent indéfiniment
browser.tabs.onRemoved.addListener((tabId) => {
  tabRequestIds.delete(tabId);
  tabLastMessageId.delete(tabId);
});

async function showThreadForMessage(tab, message) {
  // Éviter les requêtes redondantes pour le même message
  if (tabLastMessageId.get(tab.id) === message.id) {
    return;
  }
  tabLastMessageId.set(tab.id, message.id);

  // S'assurer que la migration des préférences est terminée avant toute lecture
  // (le schéma de showBanner n'accepte plus la valeur héritée "left").
  await prefsMigrated;
  const requestId = nextRequestId(tab.id);

  // Requête Gloda et lecture des préférences en parallèle :
  // plus aucun await entre le contrôle de fraîcheur et showBanner.
  const [threadData, order, navMode, sidebarPos, mainViewPos] = await Promise.all([
    ThreadResolver.getThreadMessages(message.id),
    getThreadOrder(),
    getNavigationMode(),
    getSidebarPosition(),
    getMainViewPosition()
  ]);

  // Vérifier que la requête est toujours d'actualité pour CET onglet
  // (pas de clic rapide ni de masquage entre-temps)
  if (requestId !== tabRequestIds.get(tab.id)) {
    return;
  }

  // Message orphelin → masquer
  if (!threadData || threadData.length <= 1) {
    await browser.magicThreadsWindow.hideBanner(tab.id).catch(() => {});
    return;
  }

  // Trier les messages selon l'ordre défini dans les préférences
  if (order === "antichronological") {
    threadData.sort((a, b) => b.date - a.date);
  } else {
    threadData.sort((a, b) => a.date - b.date);
  }

  let labels = getLabels(threadData.length);

  await browser.magicThreadsWindow.showBanner(
    tab.id,
    threadData,
    message.id,
    navMode,
    sidebarPos,
    mainViewPos,
    labels
  );
}

// ---- Écouteur 3-pane : changement de sélection de messages ----
browser.mailTabs.onSelectedMessagesChanged.addListener(async (tab, messageList) => {
  try {
    if (!messageList || !messageList.messages || messageList.messages.length === 0) {
      // Invalider les requêtes en vol : sinon un fil parti avant la
      // désélection pourrait réafficher le panneau après le masquage.
      invalidateRequests(tab.id);
      tabLastMessageId.delete(tab.id);
      await browser.magicThreadsWindow.hideBanner(tab.id).catch(() => {});
      return;
    }
    if (messageList.messages.length > 1) {
      invalidateRequests(tab.id);
      tabLastMessageId.delete(tab.id);
      await browser.magicThreadsWindow.hideBanner(tab.id).catch(() => {});
      return;
    }
    await showThreadForMessage(tab, messageList.messages[0]);
  } catch (e) {
    console.error("Magic Threads: error in onSelectedMessagesChanged:", e);
  }
});

// ---- Écouteur onglet message : message affiché dans un onglet dédié ----
browser.messageDisplay.onMessageDisplayed.addListener(async (tab, message) => {
  try {
    await showThreadForMessage(tab, message);
  } catch (e) {
    console.error("Magic Threads: error in onMessageDisplayed:", e);
  }
});

// ---- Écouteur de clics sur les éléments du fil ----
browser.magicThreadsWindow.onBannerItemClicked.addListener(async (messageId, mode) => {
  try {
    await handleOpenMessage(messageId, mode);
  } catch (e) {
    console.error("Magic Threads: navigation error:", e);
  }
});

// ---- Navigation vers un message ----
async function handleOpenMessage(messageId, mode) {
  // Détecter si on est dans un onglet message (pas un 3-pane)
  let [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  let isInMessageTab = activeTab && !activeTab.mailTab;

  // Dans un onglet message : utiliser l'API Experiment pour naviguer dans le même onglet
  if (isInMessageTab) {
    try {
      let success = await browser.magicThreadsWindow.navigateMessageTab(activeTab.id, messageId);
      if (success) return;
    } catch (e) {
      console.warn("Magic Threads: falling back to a new tab:", e);
    }
    // Fallback
    await browser.messageDisplay.open({ messageId, active: true });
    return;
  }

  if (mode === "newTab") {
    await browser.messageDisplay.open({ messageId, active: true });
    return;
  }

  // Mode "currentTab" : naviguer dans le 3-pane
  let mailTabs = await browser.mailTabs.query({ currentWindow: true });
  if (!mailTabs || mailTabs.length === 0) {
    await browser.messageDisplay.open({ messageId, active: true });
    return;
  }

  let mailTab = mailTabs[0];
  let targetMsg = await browser.messages.get(messageId);
  if (!targetMsg) {
    throw new Error("Target message not found.");
  }

  let currentFolderId = mailTab.displayedFolder.id || mailTab.displayedFolder;
  let folderId = targetMsg.folder.id || targetMsg.folder;

  // Détection d'un message envoyé de moins de 5 minutes
  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  let msgDate = new Date(targetMsg.date).getTime();
  let isRecentSent = targetMsg.folder && 
                     targetMsg.folder.type === "sent" && 
                     (Date.now() - msgDate) < FIVE_MINUTES_MS;

  if (currentFolderId === folderId) {
    // Même dossier : sélection directe et instantanée
    await browser.mailTabs.setSelectedMessages(mailTab.id, [messageId]);
  } else {
    // Dossier différent : changement de dossier
    await browser.mailTabs.update(mailTab.id, {
      displayedFolder: folderId
    });
    // Pause de sécurité uniquement pour les e-mails envoyés récents (250 ms)
    if (isRecentSent) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await browser.mailTabs.setSelectedMessages(mailTab.id, [messageId]);
  }
}

