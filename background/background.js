/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ThreadResolver } from "./threadResolver.js";

const extVersion = browser.runtime.getManifest().version;
console.log(`Magic Threads v${extVersion}: Démarrage du script d'arrière-plan.`);

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
    let pos = prefs.mainViewPosition;
    if (pos === "left") {
      return "right";
    }
    return pos;
  } catch (e) {
    return "bottom";
  }
}

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
    "unknownAuthor"
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

function nextRequestId(tabId) {
  const id = (tabRequestIds.get(tabId) || 0) + 1;
  tabRequestIds.set(tabId, id);
  return id;
}

// Invalide les requêtes en vol pour un onglet (appelé avant tout masquage).
function invalidateRequests(tabId) {
  nextRequestId(tabId);
}

// Éviter que la Map ne grossisse indéfiniment
browser.tabs.onRemoved.addListener((tabId) => {
  tabRequestIds.delete(tabId);
});

async function showThreadForMessage(tab, message) {
  const requestId = nextRequestId(tab.id);
  console.log("Magic Threads: Message affiché, ID:", message.id, "tab:", tab.id);

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
    console.log("Magic Threads: Requête obsolète ignorée, requestId:", requestId);
    return;
  }

  console.log("Magic Threads: Fil récupéré, taille:", threadData ? threadData.length : 0);

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
    JSON.stringify(threadData),
    message.id,
    navMode,
    sidebarPos,
    mainViewPos,
    JSON.stringify(labels)
  );
}

// ---- Écouteur 3-pane : changement de sélection de messages ----
browser.mailTabs.onSelectedMessagesChanged.addListener(async (tab, messageList) => {
  try {
    if (!messageList || !messageList.messages || messageList.messages.length === 0) {
      // Invalider les requêtes en vol : sinon un fil parti avant la
      // désélection pourrait réafficher le panneau après le masquage.
      invalidateRequests(tab.id);
      await browser.magicThreadsWindow.hideBanner(tab.id).catch(() => {});
      return;
    }
    if (messageList.messages.length > 1) {
      invalidateRequests(tab.id);
      await browser.magicThreadsWindow.hideBanner(tab.id).catch(() => {});
      return;
    }
    await showThreadForMessage(tab, messageList.messages[0]);
  } catch (e) {
    console.error("Magic Threads: Erreur dans onSelectedMessagesChanged:", e);
  }
});

// ---- Écouteur onglet message : message affiché dans un onglet dédié ----
browser.messageDisplay.onMessageDisplayed.addListener(async (tab, message) => {
  try {
    // Ne traiter que les onglets message (pas les 3-pane, déjà gérés ci-dessus)
    if (tab.mailTab) {
      return;
    }
    await showThreadForMessage(tab, message);
  } catch (e) {
    console.error("Magic Threads: Erreur dans onMessageDisplayed:", e);
  }
});

// ---- Écouteur de clics sur les éléments du fil ----
browser.magicThreadsWindow.onBannerItemClicked.addListener(async (messageId, mode) => {
  console.log("Magic Threads: Clic sur message ID:", messageId, "mode:", mode);
  try {
    await handleOpenMessage(messageId, mode);
  } catch (e) {
    console.error("Magic Threads: Erreur de navigation:", e);
  }
});

// ---- Navigation vers un message ----
async function handleOpenMessage(messageId, mode) {
  // Détecter si on est dans un onglet message (pas un 3-pane)
  let [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  let isInMessageTab = activeTab && !activeTab.mailTab;

  // Dans un onglet message : utiliser l'API Experiment pour naviguer dans le même onglet
  if (isInMessageTab) {
    console.log("Magic Threads: Navigation dans onglet message →", activeTab.id);
    try {
      let success = await browser.magicThreadsWindow.navigateMessageTab(activeTab.id, messageId);
      if (success) return;
    } catch (e) {
      console.warn("Magic Threads: Fallback ouverture nouvel onglet:", e);
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
    console.log("Magic Threads: Pas de 3-pane, fallback ouverture en nouvel onglet.");
    await browser.messageDisplay.open({ messageId, active: true });
    return;
  }

  let mailTab = mailTabs[0];
  let targetMsg = await browser.messages.get(messageId);
  if (!targetMsg) {
    throw new Error("E-mail cible introuvable.");
  }

  let folderId = targetMsg.folder.id || targetMsg.folder;
  await browser.mailTabs.update(mailTab.id, {
    displayedFolder: folderId
  });
  await browser.mailTabs.setSelectedMessages(mailTab.id, [messageId]);
}

console.log(`Magic Threads v${extVersion}: Script d'arrière-plan initialisé avec succès.`);
