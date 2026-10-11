/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Module de gestion des liaisons manuelles et clusters de conversations (Overlay virtuel).
 *
 * Ce module persiste les associations de fils de discussion dans browser.storage.local
 * sans altérer la base Gloda ou les dossiers locaux de Thunderbird.
 * Les liaisons sont modélisées sous forme de Clusters de Conversation bidirectionnels
 * fondés exclusivement sur les identifiants immuables RFC 822 (Message-ID).
 * Les identifiants numériques WebExtension (message.id) ne sont JAMAIS persistés sur disque
 * pour éviter toute collision après redémarrage de session (SEC-01 / B1).
 */

const STORAGE_KEY = "manualThreadLinks";

/**
 * Normalise un Message-ID RFC 822 (minuscules, sans chevrons ni espaces superflus).
 * @param {string} id - Message-ID brut.
 * @returns {string} Message-ID normalisé.
 */
export function normalizeMessageId(id) {
  if (typeof id !== "string" || !id.trim()) return "";
  return id.trim().toLowerCase().replace(/^</, "").replace(/>$/, "");
}

/**
 * File d'attente de promesses pour le verrou d'exclusion mutuelle (Mutex).
 * Garantit que toutes les écritures dans browser.storage.local sont strictement sérialisées.
 */
let storageLockPromise = Promise.resolve();

/**
 * Exécute une opération asynchrone sous un verrou d'exclusion mutuelle (Mutex).
 * Élimine les conditions de course et pertes d'écritures concurrentes (R1).
 * Comporte un garde-fou de temporisation (timeout 5s) pour prévenir tout deadlock.
 *
 * @param {Function} fn - Fonction asynchrone à exécuter sous verrou.
 * @returns {Promise<*>} Résultat de la fonction.
 */
export function withStorageLock(fn) {
  let release;
  const lock = new Promise(resolve => { release = resolve; });
  const wait = storageLockPromise;
  storageLockPromise = lock;

  return wait.then(async () => {
    let timeoutId;
    const safetyTimeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("Magic Threads: Délai d'attente du verrou de stockage dépassé (5s)"));
      }, 5000);
    });

    try {
      return await Promise.race([fn(), safetyTimeout]);
    } finally {
      clearTimeout(timeoutId);
      release();
    }
  });
}

/**
 * Cache volatil en mémoire vive (RAM) associant chaque cluster aux IDs numériques
 * des messages consultés ou liés durant la SESSION COURANTE de Thunderbird.
 * Réinitialisé à chaque fermeture de session : zéro risque de collision post-reboot.
 * Structure : clusterId -> Set<number>
 */
const sessionClusterAnchorsMap = new Map();

export class ManualLinksManager {
  /**
   * Retourne les ancres numériques WebExtension valides pour la session courante en RAM.
   * @param {string} clusterId - Identifiant du cluster.
   * @returns {Set<number>} Ensemble des identifiants numériques de la session.
   */
  static getSessionAnchors(clusterId) {
    return sessionClusterAnchorsMap.get(clusterId) || new Set();
  }

  /**
   * Enregistre un identifiant numérique WebExtension dans la mémoire vive de session.
   * @param {string} clusterId - Identifiant du cluster.
   * @param {number} messageId - Identifiant numérique WebExtension.
   */
  static addSessionAnchor(clusterId, messageId) {
    if (!clusterId || typeof messageId !== "number" || messageId <= 0) return;
    if (!sessionClusterAnchorsMap.has(clusterId)) {
      sessionClusterAnchorsMap.set(clusterId, new Set());
    }
    sessionClusterAnchorsMap.get(clusterId).add(messageId);
  }

  /**
   * Supprime un identifiant numérique de la mémoire vive de session.
   * @param {string} clusterId - Identifiant du cluster.
   * @param {number} messageId - Identifiant numérique WebExtension.
   */
  static removeSessionAnchor(clusterId, messageId) {
    if (!clusterId || !sessionClusterAnchorsMap.has(clusterId)) return;
    if (typeof messageId === "number") {
      sessionClusterAnchorsMap.get(clusterId).delete(messageId);
    }
  }

  /**
   * Récupère l'intégralité des liaisons manuelles enregistrées.
   * Migre de manière transparente les anciens liens vers le schéma à base de cluster
   * et purge en tâche de fond les anciennes clés anchorMessageIds persistées (SEC-01).
   * @returns {Promise<Array<object>>} Liste des liaisons et clusters ordonnés par date de création.
   */
  static async getAllLinks() {
    try {
      const data = await browser.storage.local.get({ [STORAGE_KEY]: [] });
      const rawLinks = data[STORAGE_KEY];
      if (!Array.isArray(rawLinks)) return [];

      let needsCleanup = false;
      const sanitizedLinks = [];

      for (let link of rawLinks) {
        let normSource = normalizeMessageId(link.sourceHeaderId);
        let normTarget = normalizeMessageId(link.targetHeaderId);
        let allIds = Array.isArray(link.allHeaderIds) ? link.allHeaderIds.map(normalizeMessageId).filter(Boolean) : [];

        if (allIds.length === 0) {
          if (normSource) allIds.push(normSource);
          if (normTarget && normTarget !== normSource) allIds.push(normTarget);
        }

        if (Object.prototype.hasOwnProperty.call(link, "anchorMessageIds")) {
          needsCleanup = true;
        }

        const clusterId = link.clusterId || link.id;
        const sessionAnchors = sessionClusterAnchorsMap.get(clusterId) || new Set();

        const cleanLink = {
          ...link,
          clusterId,
          allHeaderIds: Array.from(new Set(allIds)),
          // Les ancres ne proviennent que de la mémoire vive volatile de la session
          anchorMessageIds: Array.from(sessionAnchors)
        };
        sanitizedLinks.push(cleanLink);
      }

      if (needsCleanup) {
        // Migration assainissante en tâche de fond sous mutex
        withStorageLock(async () => {
          const freshData = await browser.storage.local.get({ [STORAGE_KEY]: [] });
          const freshLinks = freshData[STORAGE_KEY];
          if (Array.isArray(freshLinks)) {
            const purged = freshLinks.map(l => {
              const copy = { ...l };
              delete copy.anchorMessageIds;
              return copy;
            });
            await browser.storage.local.set({ [STORAGE_KEY]: purged });
          }
        }).catch(() => {});
      }

      return sanitizedLinks;
    } catch (e) {
      console.error("Magic Threads: Erreur lors de la lecture des liaisons manuelles :", e);
      return [];
    }
  }

  /**
   * Ajoute ou met à jour une liaison / un cluster entre un fil source et un fil cible.
   * Opération entièrement sérialisée sous le verrou withStorageLock.
   *
   * @param {object} params
   * @param {string} params.sourceHeaderId - Message-ID pivot du message source.
   * @param {string} [params.sourceSubject=""] - Objet du message source.
   * @param {string} [params.sourceAuthor=""] - Expéditeur du message source.
   * @param {Array<string>} [params.sourceThreadHeaderIds=[]] - Tous les en-têtes du fil source.
   * @param {number} [params.sourceMsgId] - Identifiant WebExtension du message source (RAM uniquement).
   * @param {string} params.targetHeaderId - Message-ID pivot du message cible.
   * @param {string} [params.targetSubject=""] - Objet du fil cible.
   * @param {string} [params.targetAuthor=""] - Expéditeur du fil cible.
   * @param {Array<string>} [params.targetThreadHeaderIds=[]] - Tous les en-têtes du fil cible.
   * @param {number} [params.targetMsgId] - Identifiant WebExtension du message cible (RAM uniquement).
   * @param {Array<number>} [params.anchorMessageIds=[]] - Ancres de session supplémentaires (RAM uniquement).
   * @param {string} [params.scope="entire_thread"] - "entire_thread" ou "single_message".
   * @returns {Promise<object>} L'objet de liaison enregistré.
   */
  static async addLink({
    sourceHeaderId,
    sourceSubject = "",
    sourceAuthor = "",
    sourceThreadHeaderIds = [],
    sourceMsgId,
    targetHeaderId,
    targetSubject = "",
    targetAuthor = "",
    targetThreadHeaderIds = [],
    targetMsgId,
    anchorMessageIds = [],
    scope = "entire_thread"
  }) {
    const normSource = normalizeMessageId(sourceHeaderId);
    const normTarget = normalizeMessageId(targetHeaderId);

    if (!normSource || !normTarget || normSource === normTarget) {
      throw new Error("Message-IDs source et cible invalides ou identiques.");
    }

    return withStorageLock(async () => {
      const links = await this.getAllLinks();

      // Constitution de l'ensemble d'en-têtes réunis pour ce cluster
      let newHeaderIds = new Set();
      if (scope === "entire_thread") {
        for (let hid of sourceThreadHeaderIds) {
          let n = normalizeMessageId(hid);
          if (n) newHeaderIds.add(n);
        }
      }
      newHeaderIds.add(normSource);

      for (let hid of targetThreadHeaderIds) {
        let n = normalizeMessageId(hid);
        if (n) newHeaderIds.add(n);
      }
      newHeaderIds.add(normTarget);

      // Constitution des ancres WebExtension connues pour la session RAM
      let sessionAnchors = new Set();
      if (typeof sourceMsgId === "number" && sourceMsgId > 0) sessionAnchors.add(sourceMsgId);
      if (typeof targetMsgId === "number" && targetMsgId > 0) sessionAnchors.add(targetMsgId);
      if (Array.isArray(anchorMessageIds)) {
        for (let anc of anchorMessageIds) {
          if (typeof anc === "number" && anc > 0) sessionAnchors.add(anc);
        }
      }

      // Recherche de clusters existants se recoupant avec ces en-têtes (Union-Find)
      let overlappingIndexes = [];
      for (let i = 0; i < links.length; i++) {
        let l = links[i];
        let hasOverlap = l.allHeaderIds.some(id => newHeaderIds.has(id)) ||
                         normalizeMessageId(l.sourceHeaderId) === normSource ||
                         normalizeMessageId(l.targetHeaderId) === normTarget ||
                         normalizeMessageId(l.sourceHeaderId) === normTarget ||
                         normalizeMessageId(l.targetHeaderId) === normSource;
        if (hasOverlap) {
          overlappingIndexes.push(i);
        }
      }

      const now = Date.now();
      let linkObj;

      if (overlappingIndexes.length > 0) {
        // Fusion dans le premier cluster recoupé
        let primaryIndex = overlappingIndexes[0];
        let primary = links[primaryIndex];
        let primaryClusterId = primary.clusterId || primary.id;

        // Absorber les en-têtes et les ancres de session de tous les clusters recoupés
        for (let idx of overlappingIndexes) {
          let other = links[idx];
          for (let hid of other.allHeaderIds) newHeaderIds.add(hid);
          let otherClusterId = other.clusterId || other.id;
          let otherAnchors = sessionClusterAnchorsMap.get(otherClusterId);
          if (otherAnchors) {
            for (let a of otherAnchors) sessionAnchors.add(a);
            if (otherClusterId !== primaryClusterId) {
              sessionClusterAnchorsMap.delete(otherClusterId);
            }
          }
        }

        linkObj = {
          ...primary,
          sourceSubject: sourceSubject || primary.sourceSubject,
          sourceAuthor: sourceAuthor || primary.sourceAuthor,
          targetSubject: targetSubject || primary.targetSubject,
          targetAuthor: targetAuthor || primary.targetAuthor,
          scope,
          allHeaderIds: Array.from(newHeaderIds),
          updatedAt: now
        };
        delete linkObj.anchorMessageIds;

        links[primaryIndex] = linkObj;
        for (let j = overlappingIndexes.length - 1; j >= 1; j--) {
          links.splice(overlappingIndexes[j], 1);
        }
      } else {
        // Nouveau cluster autonome
        const linkId = "link_" + now + "_" + Math.random().toString(36).substring(2, 8);
        linkObj = {
          id: linkId,
          clusterId: linkId,
          createdAt: now,
          updatedAt: now,
          sourceHeaderId: normSource,
          sourceSubject: (sourceSubject || "").trim(),
          sourceAuthor: (sourceAuthor || "").trim(),
          targetHeaderId: normTarget,
          targetSubject: (targetSubject || "").trim(),
          targetAuthor: (targetAuthor || "").trim(),
          scope,
          allHeaderIds: Array.from(newHeaderIds)
        };
        links.push(linkObj);
      }

      // Enregistrer les ancres en mémoire vive pour la session active
      const finalClusterId = linkObj.clusterId || linkObj.id;
      for (let a of sessionAnchors) {
        this.addSessionAnchor(finalClusterId, a);
      }

      // Persistance sur disque SANS aucun identifiant numérique
      const toSave = links.map(l => {
        const c = { ...l };
        delete c.anchorMessageIds;
        return c;
      });
      await browser.storage.local.set({ [STORAGE_KEY]: toSave });

      return {
        ...linkObj,
        anchorMessageIds: Array.from(sessionClusterAnchorsMap.get(finalClusterId) || [])
      };
    });
  }

  /**
   * Crée directement un cluster regroupant une sélection multiple de messages.
   *
   * @param {Array<object>} messages - Liste d'objets messages WebExtension.
   * @param {string} [scope="entire_thread"] - "entire_thread" ou "single_message".
   * @returns {Promise<object>} Le cluster créé ou fusionné.
   */
  static async addMultiMessageCluster(messages, scope = "entire_thread") {
    if (!Array.isArray(messages) || messages.length < 2) {
      throw new Error("Au moins 2 messages sont requis pour former un cluster.");
    }

    const firstMsg = messages[0];
    const secondMsg = messages[1];

    const sourceHeaderId = normalizeMessageId(firstMsg.headerMessageId || firstMsg.messageId);
    const targetHeaderId = normalizeMessageId(secondMsg.headerMessageId || secondMsg.messageId);

    const allHeaders = messages
      .map(m => normalizeMessageId(m.headerMessageId || m.messageId))
      .filter(Boolean);

    const anchorIds = messages
      .map(m => m.id)
      .filter(id => typeof id === "number" && id > 0);

    return this.addLink({
      sourceHeaderId,
      sourceSubject: firstMsg.subject || "",
      sourceAuthor: firstMsg.author || "",
      sourceThreadHeaderIds: allHeaders,
      sourceMsgId: firstMsg.id,
      targetHeaderId,
      targetSubject: secondMsg.subject || "",
      targetAuthor: secondMsg.author || "",
      targetThreadHeaderIds: allHeaders,
      targetMsgId: secondMsg.id,
      anchorMessageIds: anchorIds,
      scope
    });
  }

  /**
   * Détache intelligemment un message ou une branche d'un cluster.
   * - Si le message est orphelin (fil natif de taille 1) : seul ce message est retiré.
   * - Si le message appartient à un fil natif (taille > 1) : l'ensemble des messages
   *   de ce fil natif sont retirés (découplage de la branche).
   * - Si le cluster résiduel ne relie plus au moins 2 entités distinctes, il est dissous.
   *
   * @param {object} params
   * @param {string} params.clusterId - Identifiant du cluster.
   * @param {number} [params.messageId] - Identifiant numérique WebExtension du message cliqué.
   * @param {string} [params.headerMessageId] - En-tête RFC 822 du message cliqué.
   * @returns {Promise<boolean>} True si le cluster a été modifié ou dissous.
   */
  static async detachMessageFromCluster({ clusterId, messageId, headerMessageId }) {
    if (!clusterId) return false;

    const normHeader = normalizeMessageId(headerMessageId);
    const validMsgId = typeof messageId === "number" && messageId > 0 ? messageId : null;

    // Si ni messageId ni headerMessageId ne sont fournis, repli sur la suppression globale
    if (!validMsgId && !normHeader) {
      return this.removeLink(clusterId);
    }

    if (validMsgId) {
      this.removeSessionAnchor(clusterId, validMsgId);
    }

    return withStorageLock(async () => {
      const links = await this.getAllLinks();
      const clusterIndex = links.findIndex(l => (l.clusterId || l.id) === clusterId);
      if (clusterIndex === -1) {
        return this.removeLink(clusterId);
      }

      const cluster = links[clusterIndex];

      // Collecte des identifiants du fil natif du message cliqué
      let headersToRemove = new Set();
      if (normHeader) headersToRemove.add(normHeader);

      try {
        let nativeMsgs = [];
        if (validMsgId && browser.convGloda?.getThreadMessages) {
          nativeMsgs = await browser.convGloda.getThreadMessages(validMsgId);
        } else if (normHeader && browser.convGloda?.getThreadByHeaderId) {
          nativeMsgs = await browser.convGloda.getThreadByHeaderId(normHeader);
        }

        if (Array.isArray(nativeMsgs) && nativeMsgs.length > 1) {
          // Le message appartient à un fil natif complet (branche).
          // On soustrait l'ensemble des messages de cette branche.
          for (let m of nativeMsgs) {
            let h = normalizeMessageId(m.headerMessageId);
            if (h) headersToRemove.add(h);
            if (typeof m.id === "number" && m.id > 0) {
              this.removeSessionAnchor(clusterId, m.id);
            }
          }
        }
      } catch (err) {
        console.warn("Magic Threads: Erreur lors de la résolution du fil natif pour détachement :", err?.message || err);
      }

      // Soustraction des en-têtes
      let remainingHeaders = (cluster.allHeaderIds || [])
        .map(normalizeMessageId)
        .filter(h => h && !headersToRemove.has(h));

      // Contrôle de viabilité résiduelle :
      // Si la liste des en-têtes restants est <= 1, le cluster ne relie plus rien
      if (remainingHeaders.length <= 1) {
        links.splice(clusterIndex, 1);
        const toSave = links.map(l => { const c = { ...l }; delete c.anchorMessageIds; return c; });
        await browser.storage.local.set({ [STORAGE_KEY]: toSave });
        sessionClusterAnchorsMap.delete(clusterId);
        return true;
      }

      // Vérifier si tous les messages restants appartiennent au même fil natif
      try {
        let sampleHeader = remainingHeaders[0];
        let remainingNative = [];

        if (sampleHeader && browser.convGloda?.getThreadByHeaderId) {
          remainingNative = await browser.convGloda.getThreadByHeaderId(sampleHeader);
        }

        if (Array.isArray(remainingNative) && remainingNative.length > 0) {
          let remainingNativeSet = new Set(
            remainingNative.map(m => normalizeMessageId(m.headerMessageId)).filter(Boolean)
          );
          let allBelongToSameNativeThread = remainingHeaders.every(h => remainingNativeSet.has(h));
          if (allBelongToSameNativeThread) {
            // Tous les messages restants sont déjà naturellement groupés par Thunderbird,
            // le cluster n'a plus lieu d'exister.
            links.splice(clusterIndex, 1);
            const toSave = links.map(l => { const c = { ...l }; delete c.anchorMessageIds; return c; });
            await browser.storage.local.set({ [STORAGE_KEY]: toSave });
            sessionClusterAnchorsMap.delete(clusterId);
            return true;
          }
        }
      } catch (err) {
        console.warn("Magic Threads: Erreur lors du contrôle de viabilité résiduelle :", err?.message || err);
      }

      // Le cluster contient encore au moins deux entités distinctes : sauvegarde
      const updatedCluster = {
        ...cluster,
        sourceHeaderId: remainingHeaders[0],
        targetHeaderId: remainingHeaders[1] || remainingHeaders[0],
        allHeaderIds: remainingHeaders,
        updatedAt: Date.now()
      };
      delete updatedCluster.anchorMessageIds;

      links[clusterIndex] = updatedCluster;
      const toSave = links.map(l => { const c = { ...l }; delete c.anchorMessageIds; return c; });
      await browser.storage.local.set({ [STORAGE_KEY]: toSave });
      return true;
    });
  }

  /**
   * Supprime une liaison manuelle ou un cluster d'après son identifiant unique.
   * @param {string} linkId - Identifiant de la liaison ou du cluster.
   * @returns {Promise<boolean>} true si la liaison a été supprimée.
   */
  static async removeLink(linkId) {
    if (!linkId) return false;
    return withStorageLock(async () => {
      const data = await browser.storage.local.get({ [STORAGE_KEY]: [] });
      const links = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
      const filtered = links.filter(l => l.id !== linkId && l.clusterId !== linkId);
      sessionClusterAnchorsMap.delete(linkId);
      if (filtered.length !== links.length) {
        const toSave = filtered.map(l => { const c = { ...l }; delete c.anchorMessageIds; return c; });
        await browser.storage.local.set({ [STORAGE_KEY]: toSave });
        return true;
      }
      return false;
    });
  }

  /**
   * Supprime toute liaison ou cluster impliquant un Message-ID précis.
   * @param {string} headerId - Message-ID à détacher.
   * @returns {Promise<boolean>} true si au moins une liaison a été retirée.
   */
  static async removeLinksByHeaderId(headerId) {
    const normId = normalizeMessageId(headerId);
    if (!normId) return false;
    return withStorageLock(async () => {
      const data = await browser.storage.local.get({ [STORAGE_KEY]: [] });
      const links = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
      const filtered = links.filter(l =>
        !l.allHeaderIds.includes(normId) &&
        normalizeMessageId(l.sourceHeaderId) !== normId &&
        normalizeMessageId(l.targetHeaderId) !== normId
      );
      if (filtered.length !== links.length) {
        const toSave = filtered.map(l => { const c = { ...l }; delete c.anchorMessageIds; return c; });
        await browser.storage.local.set({ [STORAGE_KEY]: toSave });
        return true;
      }
      return false;
    });
  }

  /**
   * Trouve tous les clusters ou liaisons connectés à une collection de Message-IDs
   * ou à un identifiant d'ancre numérique de session courante en RAM.
   * @param {Array<string>|Set<string>} headerIds - Collection de Message-IDs.
   * @param {number|null} [anchorMessageId=null] - Identifiant WebExtension de secours en session active.
   * @returns {Promise<Array<object>>} Clusters concernés.
   */
  static async getClustersForHeaderIds(headerIds, anchorMessageId = null) {
    const hasHeaders = headerIds && (Array.isArray(headerIds) ? headerIds.length > 0 : headerIds.size > 0);
    const hasAnchor = typeof anchorMessageId === "number" && anchorMessageId > 0;

    if (!hasHeaders && !hasAnchor) {
      return [];
    }

    const idSet = new Set(
      hasHeaders ? Array.from(headerIds).map(id => normalizeMessageId(id)).filter(Boolean) : []
    );

    const allLinks = await this.getAllLinks();
    return allLinks.filter(l => {
      const clusterId = l.clusterId || l.id;

      // 1. Correspondance par ancre de session volatile en RAM (zéro risque d'ID recyclé post-reboot)
      if (hasAnchor) {
        const sessionAnchors = sessionClusterAnchorsMap.get(clusterId);
        if (sessionAnchors && sessionAnchors.has(anchorMessageId)) {
          return true;
        }
      }

      if (idSet.size === 0) return false;

      // 2. Correspondance par l'ensemble des Message-IDs réunis dans le cluster
      if (Array.isArray(l.allHeaderIds) && l.allHeaderIds.some(id => idSet.has(id))) {
        return true;
      }

      // 3. Correspondance par pivots source / target
      return idSet.has(normalizeMessageId(l.sourceHeaderId)) ||
             idSet.has(normalizeMessageId(l.targetHeaderId));
    });
  }

  /**
   * Trouve les clusters pour un message donné (par ses en-têtes et son ancre de session).
   * @param {object} params
   * @param {Array<string>|Set<string>} [params.headerIds]
   * @param {number} [params.messageId]
   * @returns {Promise<Array<object>>}
   */
  static async getClustersForMessage({ headerIds, messageId }) {
    return this.getClustersForHeaderIds(headerIds, messageId);
  }

  /**
   * Auto-consolidation d'un cluster existant (Self-Healing Overlay).
   * Persiste les nouveaux en-têtes découverts lors de la résolution Gloda
   * pour assurer une bidirectionnalité parfaite de la navigation.
   * Les ancres numériques découvertes sont enregistrées en RAM uniquement pour la session.
   *
   * @param {string} clusterId - Identifiant du cluster à consolider.
   * @param {Array<string>} [discoveredHeaderIds=[]] - Nouveaux en-têtes Message-ID découverts.
   * @param {Array<number>} [discoveredAnchorIds=[]] - Nouvelles ancres numériques de session.
   * @returns {Promise<boolean>} True si le cluster a été mis à jour et persisté.
   */
  static async healCluster(clusterId, discoveredHeaderIds = [], discoveredAnchorIds = []) {
    if (!clusterId) return false;

    const normHeaders = Array.isArray(discoveredHeaderIds)
      ? discoveredHeaderIds.map(normalizeMessageId).filter(Boolean)
      : [];
    const validAnchors = Array.isArray(discoveredAnchorIds)
      ? discoveredAnchorIds.filter(id => typeof id === "number" && id > 0)
      : [];

    // Enregistrer immédiatement les ancres de session en RAM (aucune persistance sur disque)
    for (let a of validAnchors) {
      this.addSessionAnchor(clusterId, a);
    }

    if (normHeaders.length === 0) {
      return false;
    }

    return withStorageLock(async () => {
      try {
        const data = await browser.storage.local.get({ [STORAGE_KEY]: [] });
        let links = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
        let targetIndex = links.findIndex(l => (l.clusterId || l.id) === clusterId);

        if (targetIndex === -1) {
          return false;
        }

        let cluster = links[targetIndex];
        let existingHeaders = new Set(
          Array.isArray(cluster.allHeaderIds) ? cluster.allHeaderIds.map(normalizeMessageId).filter(Boolean) : []
        );
        if (cluster.sourceHeaderId) existingHeaders.add(normalizeMessageId(cluster.sourceHeaderId));
        if (cluster.targetHeaderId) existingHeaders.add(normalizeMessageId(cluster.targetHeaderId));

        let changed = false;

        for (let h of normHeaders) {
          if (!existingHeaders.has(h)) {
            existingHeaders.add(h);
            changed = true;
          }
        }

        if (!changed) {
          return false;
        }

        const updatedCluster = {
          ...cluster,
          allHeaderIds: Array.from(existingHeaders),
          updatedAt: Date.now()
        };
        delete updatedCluster.anchorMessageIds;

        links[targetIndex] = updatedCluster;

        const toSave = links.map(l => { const c = { ...l }; delete c.anchorMessageIds; return c; });
        await browser.storage.local.set({ [STORAGE_KEY]: toSave });
        return true;
      } catch (e) {
        console.warn("Magic Threads: Échec de l'auto-consolidation du cluster :", e?.message || e);
        return false;
      }
    });
  }

  /**
   * Alias de rétro-compatibilité pour getClustersForHeaderIds.
   * @param {Array<string>|Set<string>} headerIds
   * @param {number|null} [anchorMessageId=null]
   * @returns {Promise<Array<object>>}
   */
  static async getLinksForHeaderIds(headerIds, anchorMessageId = null) {
    return this.getClustersForHeaderIds(headerIds, anchorMessageId);
  }
}
