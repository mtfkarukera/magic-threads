/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ManualLinksManager, normalizeMessageId } from "./manualLinksManager.js";

/**
 * ThreadResolver (Data Access Layer - DAL)
 * 
 * Isole la source des données du reste de l'extension.
 * Interroge Gloda via convGloda et enrichit le fil avec les liaisons
 * virtuelles manuelles stockées dans browser.storage.local.
 */
export class ThreadResolver {
  /**
   * Récupère la liste des messages appartenant au même fil que le message fourni,
   * augmentée des messages ou conversations rattachés manuellement.
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

      // 1. Récupération du fil naturel via Gloda
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

      // Si le fil de base est vide ou sans headerMessageId, tenter d'extraire celui du message actif
      if (knownHeaderIds.size === 0 && messageId) {
        try {
          let directMsg = await browser.messages.get(messageId);
          if (directMsg?.headerMessageId) {
            knownHeaderIds.add(normalizeMessageId(directMsg.headerMessageId));
          }
        } catch (e) {
          // Ignorer si le message n'est pas trouvable
        }
      }

      if (knownHeaderIds.size === 0) {
        return baseMessages;
      }

      // 3. Recherche des ponts manuels enregistrés pour ces messages
      let relevantLinks = await ManualLinksManager.getLinksForHeaderIds(knownHeaderIds);
      if (!relevantLinks || relevantLinks.length === 0) {
        return baseMessages;
      }

      // 4. Fusion des conversations ou messages liés (avec garde anti-boucle)
      let visitedLinks = new Set();
      let visitedHeaderIds = new Set(knownHeaderIds);
      let messagesByHeaderId = new Map();

      for (let m of baseMessages) {
        let hid = normalizeMessageId(m.headerMessageId);
        if (hid) {
          messagesByHeaderId.set(hid, m);
        }
      }

      let queue = [...relevantLinks];
      while (queue.length > 0) {
        let link = queue.shift();
        if (visitedLinks.has(link.id)) continue;
        visitedLinks.add(link.id);

        let normSource = normalizeMessageId(link.sourceHeaderId);
        let normTarget = normalizeMessageId(link.targetHeaderId);

        // Déterminer l'extrémité externe au groupe déjà exploré
        let externalId = visitedHeaderIds.has(normSource) ? normTarget : normSource;
        if (!externalId || visitedHeaderIds.has(externalId)) {
          // Si les deux extrémités sont déjà intégrées, passer
          if (visitedHeaderIds.has(normSource) && visitedHeaderIds.has(normTarget)) {
            continue;
          }
          externalId = !visitedHeaderIds.has(normSource) ? normSource : normTarget;
        }

        visitedHeaderIds.add(externalId);

        // Rapatriement des messages distants via Gloda
        let additionalMessages = [];
        try {
          if (link.scope === "entire_thread" && browser.convGloda.getThreadByHeaderId) {
            additionalMessages = await browser.convGloda.getThreadByHeaderId(externalId);
          } else if (browser.convGloda.getThreadByHeaderId) {
            // Scope "single_message" : ne retenir que le message dont l'en-tête correspond exactement
            let threadMsgs = await browser.convGloda.getThreadByHeaderId(externalId);
            additionalMessages = threadMsgs.filter(m => normalizeMessageId(m.headerMessageId) === externalId);
          }
        } catch (err) {
          console.warn("Magic Threads: Échec du rapatriement du message lié", externalId, err);
        }

        for (let addMsg of additionalMessages) {
          let hid = normalizeMessageId(addMsg.headerMessageId);
          if (hid && !messagesByHeaderId.has(hid)) {
            addMsg.isManualLink = true;
            addMsg.manualLinkId = link.id;
            messagesByHeaderId.set(hid, addMsg);
            visitedHeaderIds.add(hid);
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

