/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* global ExtensionCommon, Services, ChromeUtils */

ChromeUtils.defineESModuleGetters(this, {
  Gloda: "resource:///modules/gloda/GlodaPublic.sys.mjs",
});

const { setTimeout, clearTimeout } = ChromeUtils.importESModule(
  "resource://gre/modules/Timer.sys.mjs"
);

const kSnippetLength = 700;

/* exported convGloda */
var convGloda = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    return {
      convGloda: {
        async getThreadMessages(messageId) {
          try {
            let msgHdr = context.extension.messageManager.get(messageId);
            if (!msgHdr) {
              return [];
            }

            let glodaMessages = await getGlodaMessages([msgHdr]);
            if (!glodaMessages || glodaMessages.length === 0) {
              let fallback = translateStandardMessage(context, msgHdr);
              return fallback ? [fallback] : [];
            }

            let glodaMsg = glodaMessages[0];
            let conversation = glodaMsg.conversation;
            if (!conversation) {
              let fallback = translateStandardMessage(context, msgHdr);
              return fallback ? [fallback] : [];
            }

            let threadGlodaMessages = await getConversationMessages(conversation);

            let results = [];
            for (let msg of threadGlodaMessages) {
              let webMsg = translateGlodaMessage(context, msg);
              if (webMsg) {
                results.push(webMsg);
              }
            }

            // S'assurer que le message actif de base est dans le résultat
            if (!results.some(r => r.headerMessageId === msgHdr.messageId)) {
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

function getGlodaMessages(msgHdrs) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.warn("Magic Threads: Gloda timeout — résolution avec tableau vide.");
      resolve([]);
    }, 10000);
    Gloda.getMessageCollectionForHeaders(
      msgHdrs,
      {
        onItemsAdded() {},
        onItemsModified() {},
        onItemsRemoved() {},
        onQueryCompleted(collection) {
          clearTimeout(timeout);
          resolve(collection.items);
        },
      },
      null
    );
  });
}

function getConversationMessages(conversation) {
  return new Promise((resolve) => {
    conversation.getMessagesCollection(
      {
        onItemsAdded() {},
        onItemsModified() {},
        onItemsRemoved() {},
        onQueryCompleted(collection) {
          resolve(collection.items);
        }
      },
      false
    );
  });
}

/**
 * Normalise un timestamp depuis un nsIMsgDBHdr.
 * dateInSeconds retourne des secondes, date retourne des microsecondes.
 */
function normalizeDate(msgHdr) {
  if (msgHdr.dateInSeconds) return msgHdr.dateInSeconds * 1000;
  if (msgHdr.date) return Math.floor(msgHdr.date / 1000);
  return Date.now();
}

function translateGlodaMessage(context, msg) {
  if (!msg.folderMessage) {
    return null;
  }
  let message = context.extension.messageManager.convert(msg.folderMessage);
  if (!message) {
    return null;
  }
  return {
    id: message.id,
    headerMessageId: message.headerMessageId || message.messageId || msg.folderMessage.messageId,
    author: message.author,
    date: normalizeDate(msg.folderMessage),
    folder: message.folder ? {
      accountId: message.folder.accountId,
      path: message.folder.path,
      type: message.folder.type
    } : { accountId: "", path: "?", type: "" },
    snippet: msg.indexedBodyText?.substring(0, kSnippetLength - 1) || "...",
    isRead: message.read,
    hasAttachments: !!(msg.folderMessage.flags & 0x10000000),
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
    hasAttachments: !!(msgHdr.flags & 0x10000000),
    tags: message.tags || []
  };
}
