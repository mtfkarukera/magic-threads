/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

ChromeUtils.defineESModuleGetters(this, {
  Gloda: "resource:///modules/gloda/GlodaPublic.sys.mjs",
});

const { setTimeout, clearTimeout } = ChromeUtils.importESModule(
  "resource://gre/modules/Timer.sys.mjs"
);

const kSnippetLength = 700;
// Délai maximal d'attente d'une requête Gloda (index corrompu, arrêt en cours…)
const kGlodaTimeoutMs = 10000;
// Bornes de la réunification des conversations fragmentées (v2.2.1) :
// nombre de passes d'expansion, taille des requêtes, taille maximale du fil.
const kMaxMergeRounds = 4;
const kMaxIdsPerQuery = 100;
const kMaxThreadMessages = 500;

// Préférence Thunderbird pilotant l'indexeur de recherche globale (Gloda).
const kGlodaIndexerPref = "mailnews.database.global.indexer.enabled";

const activeGlodaTimeouts = new Set();

function safeSetTimeout(callback, ms) {
  let timerId = setTimeout(() => {
    activeGlodaTimeouts.delete(timerId);
    callback();
  }, ms);
  activeGlodaTimeouts.add(timerId);
  return timerId;
}

function safeClearTimeout(timerId) {
  if (timerId) {
    clearTimeout(timerId);
    activeGlodaTimeouts.delete(timerId);
  }
}

function normalizeMessageId(id) {
  if (!id) return "";
  return id.trim().toLowerCase().replace(/^</, "").replace(/>$/, "");
}

function isAllMailFolder(nsFolder) {
  if (!nsFolder) return false;
  try {
    let uri = nsFolder.URI || "";
    let decodedUri = decodeURIComponent(uri);
    let path = decodedUri.split("?")[0];
    
    let isGmail = path.includes("[Gmail]") || path.includes("[Google Mail]");
    if (!isGmail) return false;

    if (path.endsWith("/")) {
      path = path.slice(0, -1);
    }
    
    let lowerPath = path.toLowerCase();
    const allMailNames = [
      "/all mail",
      "/tous les messages",
      "/todos",
      "/todos los mensajes",
      "/todos os e-mails",
      "/todos os emails",
      "/todo o correio",
      "/alle e-mails",
      "/alle emails",
      "/alle nachrichten",
      "/tutti i messaggi",
      "/wszystkie",
      "/wszystkie e-maile",
      "/wszystkie emaile",
      "/alle berichten",
      "/tüm postalar",
      "/вся почта",
      "/所有邮件",
      "/所有郵件",
      "/전체 보관함",
      "/すべてのメール",
      "/すべてメール"
    ];

    return allMailNames.some(name => lowerPath.endsWith(name));
  } catch (e) {
    return false;
  }
}

/**
 * Détecte si Gloda est utilisable (3.5) : l'indexeur doit être activé dans les
 * préférences ET le module Gloda doit se charger. Sans cela, l'extension reste
 * fonctionnelle en mode dégradé (fil local seul) mais l'utilisateur doit être
 * prévenu plutôt que de constater un panneau silencieusement incomplet.
 *
 * @returns {boolean}
 */
function checkGlodaAvailability() {
  let indexerEnabled = false;
  try {
    indexerEnabled = Services.prefs.getBoolPref(kGlodaIndexerPref, false);
  } catch (e) {
    indexerEnabled = false;
  }
  if (!indexerEnabled) {
    return false;
  }
  // Le getter paresseux déclenche le chargement réel du module : une version
  // de Thunderbird sans Gloda (retrait annoncé, profil cassé…) lèverait ici.
  try {
    return !!Gloda;
  } catch (e) {
    console.warn("Magic Threads: Gloda module unavailable:", e);
    return false;
  }
}

/* exported convGloda */
var convGloda = class extends ExtensionCommon.ExtensionAPI {
  onShutdown(_isAppShutdown) {
    for (let timerId of activeGlodaTimeouts) {
      clearTimeout(timerId);
    }
    activeGlodaTimeouts.clear();
  }

  getAPI(context) {
    return {
      convGloda: {
        // État de disponibilité de Gloda, consommé par la page d'options (3.5).
        async isGlodaAvailable() {
          return checkGlodaAvailability();
        },

        async getThreadMessages(messageId) {
          try {
            let msgHdr = context.extension.messageManager.get(messageId);
            if (!msgHdr) {
              return [];
            }

            // Résolution complète : conversation Gloda + fil local du dossier
            // + réunification des conversations fragmentées via References.
            let entries = await resolveFullThread(msgHdr);

            let results = [];
            for (let entry of entries) {
              let webMsg = entry.glodaMsg
                ? translateGlodaMessage(context, entry.glodaMsg, entry.msgHdr)
                : translateStandardMessage(context, entry.msgHdr);
              if (webMsg) {
                results.push(webMsg);
              }
            }

            // S'assurer que le message actif de base est dans le résultat (sans doublon)
            let activeHeaderId = normalizeMessageId(msgHdr.messageId);
            let alreadyPresent = results.some(r => 
              r.id === messageId || 
              (r.headerMessageId && normalizeMessageId(r.headerMessageId) === activeHeaderId)
            );
            if (!alreadyPresent) {
              let fallback = translateStandardMessage(context, msgHdr);
              if (fallback) results.push(fallback);
            }

            // Tri chronologique des e-mails
            results.sort((a, b) => a.date - b.date);

            return results;
          } catch (e) {
            console.error("Error in convGloda.getThreadMessages: ", e);
            return [];
          }
        }
      }
    };
  }
};

/**
 * Résout le fil COMPLET d'un message (v2.2.1).
 *
 * Pourquoi : Gloda affecte la conversation au moment de l'indexation et ne
 * fusionne jamais rétroactivement. Une même chaîne de réponses peut donc être
 * éclatée en plusieurs conversations Gloda (indexation dans le désordre,
 * reconstruction d'index…), alors que la liste de messages de Thunderbird,
 * qui recalcule le fil dynamiquement (nsIMsgThread), les regroupe.
 *
 * Stratégie (bornée par kMaxMergeRounds / kMaxIdsPerQuery / kMaxThreadMessages) :
 * 1. Conversation Gloda du message.
 * 2. Fil local nsIMsgThread du dossier de chaque message connu — exactement ce
 *    que la liste de Thunderbird affiche.
 * 3. Expansion par References : retrouver via Gloda (headerMessageID) les
 *    messages référencés mais absents, puis absorber leurs conversations.
 * Les doublons sont réunis par Message-ID (la version Gloda, avec snippet,
 * est préférée à l'en-tête brut).
 *
 * @returns {Array<{glodaMsg?: object, msgHdr: nsIMsgDBHdr}>}
 */
async function resolveFullThread(msgHdr) {
  let byHeaderId = new Map(); // Message-ID → { glodaMsg?, msgHdr }
  let knownConvIds = new Set();
  let queriedRefs = new Set();
  let pendingHdrs = []; // en-têtes sans version Gloda, à résoudre par lot

  function addGloda(m) {
    if (!m.folderMessage || byHeaderId.size >= kMaxThreadMessages) return false;
    let hid = normalizeMessageId(m.headerMessageID || m.folderMessage.messageId);
    let existing = byHeaderId.get(hid);

    if (existing) {
      let currentIsAllMail = isAllMailFolder(m.folderMessage.folder);
      let existingIsAllMail = existing.msgHdr && isAllMailFolder(existing.msgHdr.folder);

      if (!existingIsAllMail && currentIsAllMail) {
        // L'existant est dans un dossier spécifique, on ignore la copie "All Mail"
        // mais on rattache ou met à jour la version Gloda pour ne pas perdre le snippet
        if (!existing.glodaMsg) {
          existing.glodaMsg = m;
        } else if (!existing.glodaMsg.indexedBodyText && m.indexedBodyText) {
          existing.glodaMsg = m;
        }
        return false;
      }
      if (existingIsAllMail && !currentIsAllMail) {
        // Le nouveau est dans un dossier spécifique, on écrase la copie "All Mail"
        // tout en conservant l'objet Gloda s'il a un snippet indexé
        let mergedGloda = m;
        if (existing.glodaMsg && (existing.glodaMsg.indexedBodyText || !m.indexedBodyText)) {
          mergedGloda = existing.glodaMsg;
        }
        byHeaderId.set(hid, { glodaMsg: mergedGloda, msgHdr: m.folderMessage });
        absorbLocalThread(m.folderMessage);
        return true;
      }

      if (existing.glodaMsg) {
        // Si l'existant n'a pas de snippet indexé mais que la nouvelle copie en a un, on met à jour
        if (!existing.glodaMsg.indexedBodyText && m.indexedBodyText) {
          existing.glodaMsg = m;
        }
        return false;
      }
    }

    byHeaderId.set(hid, { glodaMsg: m, msgHdr: m.folderMessage });
    if (m.conversation) knownConvIds.add(m.conversation.id);
    if (!existing) absorbLocalThread(m.folderMessage);
    return !existing;
  }

  function addHdr(hdr) {
    if (!hdr || byHeaderId.size >= kMaxThreadMessages) return false;
    let hid = normalizeMessageId(hdr.messageId);
    let existing = byHeaderId.get(hid);

    if (existing) {
      let currentIsAllMail = isAllMailFolder(hdr.folder);
      let existingIsAllMail = existing.msgHdr && isAllMailFolder(existing.msgHdr.folder);

      if (!existingIsAllMail && currentIsAllMail) {
        return false;
      }
      if (existingIsAllMail && !currentIsAllMail) {
        existing.msgHdr = hdr;
        return true;
      }
      return false;
    }

    byHeaderId.set(hid, { msgHdr: hdr });
    pendingHdrs.push(hdr);
    return true;
  }

  // Le fil local nsIMsgThread du dossier d'un en-tête (vision "liste de messages")
  function absorbLocalThread(hdr) {
    try {
      let db = hdr.folder && hdr.folder.msgDatabase;
      if (!db) return;
      let thread = db.getThreadContainingMsgHdr(hdr);
      if (!thread) return;
      for (let i = 0; i < thread.numChildren; i++) {
        addHdr(thread.getChildHdrAt(i));
      }
    } catch (e) {
      // Dossier sans base locale exploitable : ignorer
    }
  }

  // ---- Amorce : conversation Gloda du message + son fil local ----
  try {
    let glodaMessages = await getGlodaMessages([msgHdr]);
    if (glodaMessages.length && glodaMessages[0].conversation) {
      let members = await getConversationMessages(glodaMessages[0].conversation);
      for (let m of members) addGloda(m);
    }
  } catch (e) {
    // Gloda indisponible : on continuera avec le fil local seul
  }
  addHdr(msgHdr);
  absorbLocalThread(msgHdr);

  // ---- Expansion bornée ----
  for (let round = 0; round < kMaxMergeRounds; round++) {
    let grew = false;

    // a) Résoudre par lot les en-têtes sans version Gloda, et absorber
    //    leurs conversations entières (ramène les copies des autres dossiers)
    if (pendingHdrs.length) {
      let batch = pendingHdrs.splice(0, kMaxIdsPerQuery);
      try {
        let glodaMsgs = await getGlodaMessages(batch);
        let newConvs = [];
        for (let m of glodaMsgs) {
          if (m.conversation && !knownConvIds.has(m.conversation.id)) {
            knownConvIds.add(m.conversation.id);
            newConvs.push(m.conversation);
          }
          if (addGloda(m)) grew = true;
        }
        for (let conv of newConvs) {
          let members = await getConversationMessages(conv);
          for (let m of members) {
            if (addGloda(m)) grew = true;
          }
        }
      } catch (e) {
        // Lot non résolu : les en-têtes bruts restent affichables
      }
    }

    // b) Suivre les References vers les messages absents du fil connu
    let wanted = [];
    for (let entry of byHeaderId.values()) {
      let hdr = entry.msgHdr;
      if (!hdr) continue;
      for (let i = 0; i < hdr.numReferences && wanted.length < kMaxIdsPerQuery; i++) {
        let rawRef = hdr.getStringReference(i);
        let ref = normalizeMessageId(rawRef);
        if (ref && !byHeaderId.has(ref) && !queriedRefs.has(ref)) {
          queriedRefs.add(ref);
          wanted.push(ref);
        }
      }
      if (wanted.length >= kMaxIdsPerQuery) break;
    }

    if (wanted.length) {
      try {
        let found = await queryGlodaByHeaderMessageId(wanted);
        let newConvs = [];
        for (let m of found) {
          if (m.conversation && !knownConvIds.has(m.conversation.id)) {
            knownConvIds.add(m.conversation.id);
            newConvs.push(m.conversation);
          }
          if (addGloda(m)) grew = true;
        }
        for (let conv of newConvs) {
          let members = await getConversationMessages(conv);
          for (let m of members) {
            if (addGloda(m)) grew = true;
          }
        }
      } catch (e) {
        // Requête References non aboutie : fil partiel, sans casse
      }
    }

    if (!grew && !pendingHdrs.length) break;
  }

  return [...byHeaderId.values()];
}

/**
 * Requête Gloda par Message-ID (attribut headerMessageID).
 */
function queryGlodaByHeaderMessageId(ids) {
  return new Promise((resolve, reject) => {
    const timeout = safeSetTimeout(() => {
      console.warn("Magic Threads: Gloda headerMessageID timeout — resolving with empty array.");
      resolve([]);
    }, kGlodaTimeoutMs);
    try {
      let query = Gloda.newQuery(Gloda.NOUN_MESSAGE);
      query.headerMessageID(...ids);
      query.getCollection({
        onItemsAdded() {},
        onItemsModified() {},
        onItemsRemoved() {},
        onQueryCompleted(collection) {
          safeClearTimeout(timeout);
          resolve(collection.items);
        }
      });
    } catch (e) {
      safeClearTimeout(timeout);
      reject(e);
    }
  });
}

function getGlodaMessages(msgHdrs) {
  return new Promise((resolve, reject) => {
    const timeout = safeSetTimeout(() => {
      console.warn("Magic Threads: Gloda timeout — resolving with empty array.");
      resolve([]);
    }, kGlodaTimeoutMs);
    try {
      Gloda.getMessageCollectionForHeaders(
        msgHdrs,
        {
          onItemsAdded() {},
          onItemsModified() {},
          onItemsRemoved() {},
          onQueryCompleted(collection) {
            safeClearTimeout(timeout);
            resolve(collection.items);
          },
        },
        null
      );
    } catch (e) {
      // Exception synchrone (ex. Gloda désactivée) : annuler le timer
      // pour éviter un warn trompeur 10 s plus tard.
      safeClearTimeout(timeout);
      reject(e);
    }
  });
}

function getConversationMessages(conversation) {
  return new Promise((resolve, reject) => {
    const timeout = safeSetTimeout(() => {
      console.warn("Magic Threads: Gloda conversation timeout — resolving with empty array.");
      resolve([]);
    }, kGlodaTimeoutMs);
    try {
      conversation.getMessagesCollection(
        {
          onItemsAdded() {},
          onItemsModified() {},
          onItemsRemoved() {},
          onQueryCompleted(collection) {
            safeClearTimeout(timeout);
            resolve(collection.items);
          },
        },
        null
      );
    } catch (e) {
      safeClearTimeout(timeout);
      reject(e);
    }
  });
}

/**
 * Normalise un timestamp depuis un nsIMsgDBHdr.
 * dateInSeconds retourne des secondes, date retourne des microsecondes.
 * Un message sans date retourne 0 (epoch) : il se classe en fin de fil
 * au lieu d'usurper la première place avec Date.now().
 */
function normalizeDate(msgHdr) {
  if (msgHdr.dateInSeconds) return msgHdr.dateInSeconds * 1000;
  if (msgHdr.date) return Math.floor(msgHdr.date / 1000);
  return 0;
}

function translateGlodaMessage(context, msg, preferredMsgHdr) {
  let targetHdr = preferredMsgHdr || msg.folderMessage;
  if (!targetHdr) {
    return null;
  }
  let message = context.extension.messageManager.convert(targetHdr);
  if (!message) {
    return null;
  }
  return {
    id: message.id,
    headerMessageId: message.headerMessageId || message.messageId || targetHdr.messageId,
    author: message.author,
    date: normalizeDate(targetHdr),
    folder: message.folder ? {
      accountId: message.folder.accountId,
      path: message.folder.path,
      type: message.folder.type
    } : { accountId: "", path: "?", type: "" },
    snippet: msg.indexedBodyText?.substring(0, kSnippetLength) || "...",
    isRead: message.read,
    hasAttachments: !!(targetHdr.flags & Ci.nsMsgMessageFlags.Attachment),
    tags: message.tags || []
  };
}

function translateStandardMessage(context, msgHdr) {
  let message = context.extension.messageManager.convert(msgHdr);
  if (!message) return null;
  return {
    id: message.id,
    headerMessageId: message.headerMessageId || message.messageId || msgHdr.messageId,
    author: message.author,
    date: normalizeDate(msgHdr),
    folder: message.folder ? {
      accountId: message.folder.accountId,
      path: message.folder.path,
      type: message.folder.type
    } : { accountId: "", path: "?", type: "" },
    snippet: "...",
    isRead: message.read,
    hasAttachments: !!(msgHdr.flags & Ci.nsMsgMessageFlags.Attachment),
    tags: message.tags || []
  };
}
