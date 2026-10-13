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
 * Intègre un Garde d'Intégrité Strict interdisant l'injection de fils non authentifiés
 * en cas d'ancres numériques recyclées après un redémarrage (SEC-01 / B1).
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

      if (knownHeaderIds.size === 0 && !messageId) {
        return baseMessages;
      }

      // 3. Recherche des clusters de conversation enregistrés pour ces messages
      // (interroge par Message-IDs et par ancre numérique de secours en mémoire vive)
      let relevantClusters = await ManualLinksManager.getClustersForMessage({
        headerIds: knownHeaderIds,
        messageId
      });
      if (!relevantClusters || relevantClusters.length === 0) {
        return baseMessages;
      }

      // 4. Constitution de la carte de messages par en-tête normalisé (ou clé de secours par ID)
      let messagesByHeaderId = new Map();
      for (let m of baseMessages) {
        let hid = normalizeMessageId(m.headerMessageId);
        let key = hid || (typeof m.id === "number" ? "__id_" + m.id : null);
        if (key) {
          messagesByHeaderId.set(key, m);
        }
      }

      let visitedClusters = new Set();
      let loadedAnchorIds = new Set([messageId]);

      for (let cluster of relevantClusters) {
        let clusterKey = cluster.clusterId || cluster.id;
        if (visitedClusters.has(clusterKey)) continue;
        visitedClusters.add(clusterKey);

        let normSourceHeader = normalizeMessageId(cluster.sourceHeaderId);
        let clusterHeadersSet = new Set(
          (cluster.allHeaderIds || []).map(normalizeMessageId).filter(Boolean)
        );
        if (normSourceHeader) clusterHeadersSet.add(normSourceHeader);
        if (cluster.targetHeaderId) clusterHeadersSet.add(normalizeMessageId(cluster.targetHeaderId));

        // Marquer les messages déjà présents dans baseMessages qui appartiennent à ce cluster manuel
        for (let [key, existingMsg] of messagesByHeaderId.entries()) {
          if (!key.startsWith("__id_") && clusterHeadersSet.has(key)) {
            existingMsg.isManualLink = true;
            existingMsg.manualLinkId = cluster.id;
          }
        }

        // a) Rapatriement prioritaire via les ancres WebExtension de la session en RAM
        // avec GARDE D'INTÉGRITÉ STRICT (SEC-01 / B1)
        let sessionAnchors = Array.isArray(cluster.anchorMessageIds) ? cluster.anchorMessageIds : [];

        for (let anchorId of sessionAnchors) {
          if (loadedAnchorIds.has(anchorId)) continue;
          loadedAnchorIds.add(anchorId);

          try {
            let anchorThread = await browser.convGloda.getThreadMessages(anchorId);
            if (Array.isArray(anchorThread)) {
              // Garde d'intégrité strict : vérifier qu'au moins un message du fil d'ancre
              // appartient authentiquement au cluster. Si non, l'ancre est obsolète ou recyclée.
              let isAuthentic = anchorThread.some(m => clusterHeadersSet.has(normalizeMessageId(m.headerMessageId)));
              if (!isAuthentic) {
                continue;
              }

              for (let addMsg of anchorThread) {
                let hid = normalizeMessageId(addMsg.headerMessageId);
                if (!hid) continue;
                // Si la liaison est restreinte à un seul message, ne pas importer les autres messages du fil source
                if (cluster.scope === "single_message" && !clusterHeadersSet.has(hid)) {
                  continue;
                }
                if (!messagesByHeaderId.has(hid)) {
                  addMsg.isManualLink = true;
                  addMsg.manualLinkId = cluster.id;
                  messagesByHeaderId.set(hid, addMsg);
                }
              }
            }
          } catch (err) {
            // Ignorer silencieusement si l'ancre n'est plus accessible
          }
        }

        // b) Rapatriement canonique pérenne par Message-ID RFC 822 (infaillible inter-sessions)
        let allIds = Array.isArray(cluster.allHeaderIds) ? cluster.allHeaderIds : [];
        if (allIds.length === 0) {
          let s = normSourceHeader;
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
                if (cluster.scope === "single_message" && extHeaderId === normSourceHeader) {
                  threadMsgs = threadMsgs.filter(m => normalizeMessageId(m.headerMessageId) === extHeaderId);
                }
                for (let addMsg of threadMsgs) {
                  let hid = normalizeMessageId(addMsg.headerMessageId);
                  if (!hid) continue;
                  if (cluster.scope === "single_message" && !clusterHeadersSet.has(hid)) {
                    continue;
                  }
                  if (!messagesByHeaderId.has(hid)) {
                    addMsg.isManualLink = true;
                    addMsg.manualLinkId = cluster.id;
                    messagesByHeaderId.set(hid, addMsg);
                  }
                }
              }
            }
          } catch (err) {
            // Échec silencieux ou anonymisé sans fuite de Message-ID dans les journaux
            console.warn("Magic Threads: Rapatriement par Message-ID ignoré ou non indexé.");
          }
        }
      }

      let merged = Array.from(messagesByHeaderId.values());
      merged.sort((a, b) => a.date - b.date);

      // 5. Auto-consolidation (Self-Healing Overlay) :
      // Réinjecte en arrière-plan les Message-IDs découverts dans le cluster
      // pour garantir une bidirectionnalité parfaite lors de toute sélection ultérieure.
      for (let cluster of relevantClusters) {
        let clusterKey = cluster.clusterId || cluster.id;
        let newHeaders = [];
        let newAnchors = [];

        let existingHeaders = new Set(
          Array.isArray(cluster.allHeaderIds) ? cluster.allHeaderIds.map(normalizeMessageId).filter(Boolean) : []
        );
        if (cluster.sourceHeaderId) existingHeaders.add(normalizeMessageId(cluster.sourceHeaderId));
        if (cluster.targetHeaderId) existingHeaders.add(normalizeMessageId(cluster.targetHeaderId));

        let existingAnchors = ManualLinksManager.getSessionAnchors(clusterKey);
        let isSingleMessageScope = cluster.scope === "single_message";

        for (let m of merged) {
          let hid = normalizeMessageId(m.headerMessageId);
          if (!isSingleMessageScope && hid && !existingHeaders.has(hid)) {
            newHeaders.push(hid);
            existingHeaders.add(hid);
          }
          // En mode single_message, n'enregistrer l'ancre que si l'en-tête fait déjà partie du cluster
          if (typeof m.id === "number" && m.id > 0 && !existingAnchors.has(m.id)) {
            if (!isSingleMessageScope || (hid && existingHeaders.has(hid))) {
              newAnchors.push(m.id);
            }
          }
        }

        if (newHeaders.length > 0 || newAnchors.length > 0) {
          ManualLinksManager.healCluster(clusterKey, newHeaders, newAnchors).catch(() => {});
        }
      }

      return merged;
    } catch (e) {
      console.error("Magic Threads: Erreur dans ThreadResolver.getThreadMessages: ", e?.message || e);
      return [];
    }
  }
}
