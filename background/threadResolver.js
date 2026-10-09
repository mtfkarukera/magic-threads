/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ManualLinksManager, normalizeMessageId } from "./manualLinksManager.js";

/**
 * ThreadResolver (Data Access Layer - DAL)
 * 
 * Isole la source des données du reste de l'extension.
 * Interroge Gloda via convGloda et enrichit le fil avec les Clusters de Conversations
 * virtuels manuels stockés dans browser.storage.local.
 */
export class ThreadResolver {
  /**
   * Récupère la liste des messages appartenant au même fil que le message fourni,
   * augmentée des messages ou conversations rattachés via les clusters manuels.
   * 
   * @param {number} messageId - Identifiant WebExtension du message
   * @returns {Promise<Array<object>>} Tableau standardisé d'objets ThreadMessage
   */
  static async getThreadMessages(messageId) {
    try {
      if (typeof browser.convGloda === "undefined" || !browser.convGloda.getThreadMessages) {
        console.warn("Magic Threads: Experiment API convGloda non disponible.");
        return [];
      }

      // 1. Récupération du fil naturel via Gloda et fil local
      let baseMessages = await browser.convGloda.getThreadMessages(messageId);
      if (!Array.isArray(baseMessages)) {
        baseMessages = [];
      }

      // 2. Détection des en-têtes Message-ID connus dans le fil de base
      let knownHeaderIds = new Set(
        baseMessages
          .map(m => normalizeMessageId(m.headerMessageId))
          .filter(Boolean)
      );

      // Si le fil de base est vide ou sans headerMessageId, extraire celui du message actif
      if (knownHeaderIds.size === 0 && messageId) {
        try {
          let directMsg = await browser.messages.get(messageId);
          if (directMsg?.headerMessageId) {
            knownHeaderIds.add(normalizeMessageId(directMsg.headerMessageId));
          }
        } catch (e) {
          // Ignorer si le message n'est pas accessible
        }
      }

      if (knownHeaderIds.size === 0) {
        return baseMessages;
      }

      // 3. Recherche des clusters de conversation enregistrés pour ces messages
      let relevantClusters = await ManualLinksManager.getClustersForHeaderIds(knownHeaderIds);
      if (!relevantClusters || relevantClusters.length === 0) {
        return baseMessages;
      }

      // 4. Constitution de la carte de messages par en-tête normalisé
      let messagesByHeaderId = new Map();
      for (let m of baseMessages) {
        let hid = normalizeMessageId(m.headerMessageId);
        if (hid) {
          messagesByHeaderId.set(hid, m);
        }
      }

      let visitedClusters = new Set();
      let loadedAnchorIds = new Set([messageId]);

      for (let cluster of relevantClusters) {
        let clusterKey = cluster.clusterId || cluster.id;
        if (visitedClusters.has(clusterKey)) continue;
        visitedClusters.add(clusterKey);

        // a) Rapatriement prioritaire via les ancres WebExtension (méthode la plus complète et rapide)
        if (Array.isArray(cluster.anchorMessageIds)) {
          for (let anchorId of cluster.anchorMessageIds) {
            if (loadedAnchorIds.has(anchorId)) continue;
            loadedAnchorIds.add(anchorId);

            try {
              let anchorThread = await browser.convGloda.getThreadMessages(anchorId);
              if (Array.isArray(anchorThread)) {
                for (let addMsg of anchorThread) {
                  let hid = normalizeMessageId(addMsg.headerMessageId);
                  if (hid && !messagesByHeaderId.has(hid)) {
                    addMsg.isManualLink = true;
                    addMsg.manualLinkId = cluster.id;
                    messagesByHeaderId.set(hid, addMsg);
                  }
                }
              }
            } catch (err) {
              console.warn("Magic Threads: Erreur lors du chargement via l'ancre", anchorId, err);
            }
          }
        }

        // b) Rapatriement complémentaire par Message-ID externe pour les en-têtes non encore résolus
        let allIds = Array.isArray(cluster.allHeaderIds) ? cluster.allHeaderIds : [];
        if (allIds.length === 0) {
          let s = normalizeMessageId(cluster.sourceHeaderId);
          let t = normalizeMessageId(cluster.targetHeaderId);
          if (s) allIds.push(s);
          if (t && t !== s) allIds.push(t);
        }

        for (let extHeaderId of allIds) {
          if (!extHeaderId || messagesByHeaderId.has(extHeaderId)) continue;

          try {
            if (browser.convGloda.getThreadByHeaderId) {
              let threadMsgs = await browser.convGloda.getThreadByHeaderId(extHeaderId);
              if (Array.isArray(threadMsgs)) {
                if (cluster.scope === "single_message") {
                  threadMsgs = threadMsgs.filter(m => normalizeMessageId(m.headerMessageId) === extHeaderId);
                }
                for (let addMsg of threadMsgs) {
                  let hid = normalizeMessageId(addMsg.headerMessageId);
                  if (hid && !messagesByHeaderId.has(hid)) {
                    addMsg.isManualLink = true;
                    addMsg.manualLinkId = cluster.id;
                    messagesByHeaderId.set(hid, addMsg);
                  }
                }
              }
            }
          } catch (err) {
            console.warn("Magic Threads: Échec du rapatriement par headerId", extHeaderId, err);
          }
        }
      }

      let merged = Array.from(messagesByHeaderId.values());
      merged.sort((a, b) => a.date - b.date);
      return merged;
    } catch (e) {
      console.error("Magic Threads: Erreur dans ThreadResolver.getThreadMessages: ", e);
      return [];
    }
  }
}
