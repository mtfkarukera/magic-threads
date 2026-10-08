/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ThreadResolver } from "./threadResolver.js";
import { ManualLinksManager } from "./manualLinksManager.js";

// État de l'association manuelle en cours (mode staging)
let pendingStagingState = null;

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
    "unknownAuthor", "unreadLabel",
    "stagingBannerTitle", "stagingBannerPromptSingle", "stagingBannerPromptThread",
    "stagingSourceLabel", "stagingOptionMergeThreads", "stagingOptionSingleMsg",
    "btnConfirmLink", "btnCancelLink", "badgeManualLink", "btnDetachLink", "confirmDetachPrompt"
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
  let [threadData, order, navMode, sidebarPos, mainViewPos] = await Promise.all([
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

  // Message orphelin → masquer (sauf si mode association de fil en cours)
  if (!threadData || threadData.length <= 1) {
    if (!pendingStagingState) {
      tabLastMessageId.delete(tab.id);
      await browser.magicThreadsWindow.hideBanner(tab.id).catch(() => {});
      return;
    }

    // En mode association actif sur message unique : garantir un tableau non vide pour afficher la bannière
    if (!threadData || threadData.length === 0) {
      threadData = [{
        id: message.id,
        headerMessageId: message.headerMessageId || message.messageId,
        author: message.author,
        date: new Date(message.date).getTime(),
        folder: message.folder ? {
          accountId: message.folder.accountId,
          path: message.folder.path,
          type: message.folder.type
        } : { accountId: "", path: "?", type: "" },
        snippet: "...",
        isRead: message.read,
        hasAttachments: false,
        tags: []
      }];
    }
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
    labels,
    pendingStagingState ? { ...pendingStagingState } : null
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

// ---- Menu contextuel pour le rattachement manuel de fil ----
try {
  browser.menus.create({
    id: "magic-threads-link-to-thread",
    title: browser.i18n.getMessage("menuLinkToThread") || "Rattacher à un fil de discussion...",
    contexts: ["message_list"],
  });
} catch (e) {
  // Ignorer si le menu existe déjà lors d'un rechargement
}

browser.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "magic-threads-link-to-thread") {
    try {
      let selectedMessages = [];
      if (info.selectedMessages?.messages?.length > 0) {
        selectedMessages = info.selectedMessages.messages;
      } else if (tab?.id) {
        let selection = await browser.mailTabs.getSelectedMessages(tab.id).catch(() => null);
        if (selection?.messages?.length > 0) {
          selectedMessages = selection.messages;
        }
      }
      if (selectedMessages.length === 0) return;

      let primaryMsg = selectedMessages[0];
      let sourceThread = await ThreadResolver.getThreadMessages(primaryMsg.id).catch(() => []);
      let hasThread = Array.isArray(sourceThread) && sourceThread.length > 1;

      pendingStagingState = {
        sourceHeaderId: primaryMsg.headerMessageId || primaryMsg.messageId,
        sourceSubject: primaryMsg.subject || "",
        sourceAuthor: primaryMsg.author || "",
        sourceCount: selectedMessages.length,
        isSourceInThread: hasThread,
        sourceThreadCount: hasThread ? sourceThread.length : 1
      };

      // Si l'onglet actif affiche un message, rafraîchir son affichage pour montrer la bannière
      if (tab?.id) {
        tabLastMessageId.delete(tab.id);
        await showThreadForMessage(tab, primaryMsg);
      }
    } catch (e) {
      console.error("Magic Threads: Erreur lors de l'activation du mode liaison :", e);
    }
  }
});

// ---- Écouteurs pour les événements d'association manuelle ----
browser.magicThreadsWindow.onConfirmManualLink.addListener(async (scope) => {
  try {
    if (!pendingStagingState) return;

    let [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) return;

    let targetMsgId = tabLastMessageId.get(activeTab.id);
    if (!targetMsgId) return;

    let targetMsg = await browser.messages.get(targetMsgId).catch(() => null);
    if (!targetMsg) return;

    let targetHeaderId = targetMsg.headerMessageId || targetMsg.messageId;
    if (!targetHeaderId || targetHeaderId === pendingStagingState.sourceHeaderId) {
      pendingStagingState = null;
      return;
    }

    await ManualLinksManager.addLink({
      sourceHeaderId: pendingStagingState.sourceHeaderId,
      sourceSubject: pendingStagingState.sourceSubject,
      sourceAuthor: pendingStagingState.sourceAuthor,
      targetHeaderId,
      targetSubject: targetMsg.subject || "",
      targetAuthor: targetMsg.author || "",
      scope: scope || "entire_thread"
    });

    pendingStagingState = null;

    // Forcer le rafraîchissement complet du panneau avec le fil fusionné
    tabLastMessageId.delete(activeTab.id);
    await showThreadForMessage(activeTab, targetMsg);
  } catch (e) {
    console.error("Magic Threads: Erreur lors de la confirmation d'association :", e);
  }
});

browser.magicThreadsWindow.onCancelManualLink.addListener(async () => {
  try {
    pendingStagingState = null;
    let [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) return;
    let targetMsgId = tabLastMessageId.get(activeTab.id);
    if (targetMsgId) {
      let targetMsg = await browser.messages.get(targetMsgId).catch(() => null);
      if (targetMsg) {
        tabLastMessageId.delete(activeTab.id);
        await showThreadForMessage(activeTab, targetMsg);
      }
    }
  } catch (e) {
    console.error("Magic Threads: Erreur lors de l'annulation d'association :", e);
  }
});

browser.magicThreadsWindow.onDetachManualLink.addListener(async (manualLinkId) => {
  try {
    if (!manualLinkId) return;
    await ManualLinksManager.removeLink(manualLinkId);

    let [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) return;
    let targetMsgId = tabLastMessageId.get(activeTab.id);
    if (targetMsgId) {
      let targetMsg = await browser.messages.get(targetMsgId).catch(() => null);
      if (targetMsg) {
        tabLastMessageId.delete(activeTab.id);
        await showThreadForMessage(activeTab, targetMsg);
      }
    }
  } catch (e) {
    console.error("Magic Threads: Erreur lors de la dissociation :", e);
  }
});

// Sélectionne un message avec retry adapté selon le contexte (même dossier vs changement de dossier)
async function setSelectedMessagesWithRetry(tabId, messageId, isFolderChange = false) {
  // Dans le même dossier, la liste est déjà chargée et stable : une seule tentative suffit.
  // Lors d'un changement de dossier, Thunderbird doit ouvrir la base : 6 tentatives rapides de 30 ms (180 ms max).
  const maxAttempts = isFolderChange ? 6 : 1;
  const delayMs = 30;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await browser.mailTabs.setSelectedMessages(tabId, [messageId]);
      let selection = await browser.mailTabs.getSelectedMessages(tabId).catch(() => null);
      if (selection && selection.messages && selection.messages.some(m => m.id === messageId)) {
        return true;
      }
    } catch (e) {
      // Ignorer l'erreur et réessayer
    }
    if (attempt < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return false;
}

// ---- Navigation vers un message ----
async function handleOpenMessage(messageId, mode) {
  if (mode === "newTab") {
    await browser.messageDisplay.open({ messageId, active: true });
    return;
  }

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
    // Fallback de sécurité si l'onglet est inaccessible
    await browser.messageDisplay.open({ messageId, active: true });
    return;
  }

  // Mode "currentTab" : naviguer dans le 3-pane
  let mailTabs = await browser.mailTabs.query({ currentWindow: true });
  if (!mailTabs || mailTabs.length === 0) {
    await browser.messageDisplay.open({ messageId, active: true });
    return;
  }

  let mailTab = mailTabs.find(t => t.id === activeTab?.id) || mailTabs[0];
  let targetMsg = await browser.messages.get(messageId);
  if (!targetMsg) {
    throw new Error("Target message not found.");
  }

  // Détection d'un message envoyé de moins de 5 minutes
  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  let msgDate = new Date(targetMsg.date).getTime();
  let age = Date.now() - msgDate;
  let isRecentSent = targetMsg.folder && 
                     targetMsg.folder.type === "sent" && 
                     age >= 0 && age < FIVE_MINUTES_MS;

  // Pause de sécurité pour laisser l'écriture locale de l'index se terminer si le message est récent
  if (isRecentSent) {
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  let isFolderChange = !!(
    mailTab.displayedFolder &&
    targetMsg.folder &&
    (mailTab.displayedFolder.accountId !== targetMsg.folder.accountId ||
     mailTab.displayedFolder.path !== targetMsg.folder.path)
  );
  if (isFolderChange) {
    // Dossier différent : changement de dossier
    await browser.mailTabs.update(mailTab.id, {
      displayedFolder: targetMsg.folder
    });
  }

  // Sélection avec tolérance différenciée (immédiate si même dossier, retry si changement de dossier)
  let selected = await setSelectedMessagesWithRetry(mailTab.id, messageId, isFolderChange);
  if (!selected) {
    // Le message n'a pas pu être sélectionné dans la liste (ex: masqué par un filtre rapide actif)
    // Fallback d'affichage direct dans le visualiseur sans toucher au filtre
    let directOk = await browser.magicThreadsWindow.displayMessageDirectly(mailTab.id, messageId).catch(() => false);
    if (directOk) {
      // Invalider le cache de sélection d'onglet pour forcer la mise à jour de la bannière
      tabLastMessageId.delete(mailTab.id);
      await showThreadForMessage(mailTab, targetMsg);
    } else {
      // Fallback de dernier recours si l'affichage direct échoue
      await browser.messageDisplay.open({ messageId, active: true });
    }
  }
}

