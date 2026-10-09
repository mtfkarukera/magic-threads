/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Module de gestion des liaisons manuelles et clusters de conversations (Overlay virtuel).
 *
 * Ce module persiste les associations de fils de discussion dans browser.storage.local
 * sans altérer la base Gloda ou les dossiers locaux de Thunderbird.
 * Les liaisons sont modélisées sous forme de Clusters de Conversation bidirectionnels
 * pour garantir que TOUS les messages des branches réunies bénéficient de la fusion.
 */

const STORAGE_KEY = "manualThreadLinks";

/**
 * Normalise un Message-ID RFC 822 (minuscules, sans chevrons ni espaces superflus).
 * @param {string} id - Message-ID brut.
 * @returns {string} Message-ID normalisé.
 */
export function normalizeMessageId(id) {
  if (!id) return "";
  return id.trim().toLowerCase().replace(/^</, "").replace(/>$/, "");
}

export class ManualLinksManager {
  /**
   * Récupère l'intégralité des liaisons manuelles enregistrées.
   * Migre de manière transparente les anciens liens vers le schéma à base de cluster.
   * @returns {Promise<Array<object>>} Liste des liaisons et clusters ordonnés par date de création.
   */
  static async getAllLinks() {
    try {
      const data = await browser.storage.local.get({ [STORAGE_KEY]: [] });
      const rawLinks = data[STORAGE_KEY];
      if (!Array.isArray(rawLinks)) return [];

      // Migration transparente des anciens objets de liaison vers le modèle de cluster
      return rawLinks.map(link => {
        let normSource = normalizeMessageId(link.sourceHeaderId);
        let normTarget = normalizeMessageId(link.targetHeaderId);
        let allIds = Array.isArray(link.allHeaderIds) ? link.allHeaderIds.map(normalizeMessageId).filter(Boolean) : [];

        if (allIds.length === 0) {
          if (normSource) allIds.push(normSource);
          if (normTarget && normTarget !== normSource) allIds.push(normTarget);
        }

        let anchors = Array.isArray(link.anchorMessageIds)
          ? link.anchorMessageIds.filter(id => typeof id === "number" && id > 0)
          : [];

        return {
          ...link,
          clusterId: link.clusterId || link.id,
          allHeaderIds: Array.from(new Set(allIds)),
          anchorMessageIds: Array.from(new Set(anchors))
        };
      });
    } catch (e) {
      console.error("Magic Threads: Erreur lors de la lecture des liaisons manuelles :", e);
      return [];
    }
  }

  /**
   * Ajoute ou met à jour une liaison / un cluster entre un fil source et un fil cible.
   *
   * @param {object} params
   * @param {string} params.sourceHeaderId - Message-ID pivot du message source.
   * @param {string} [params.sourceSubject=""] - Objet du message source.
   * @param {string} [params.sourceAuthor=""] - Expéditeur du message source.
   * @param {Array<string>} [params.sourceThreadHeaderIds=[]] - Tous les en-têtes du fil source.
   * @param {number} [params.sourceMsgId] - Identifiant WebExtension du message source.
   * @param {string} params.targetHeaderId - Message-ID pivot du message cible.
   * @param {string} [params.targetSubject=""] - Objet du fil cible.
   * @param {string} [params.targetAuthor=""] - Expéditeur du fil cible.
   * @param {Array<string>} [params.targetThreadHeaderIds=[]] - Tous les en-têtes du fil cible.
   * @param {number} [params.targetMsgId] - Identifiant WebExtension du message cible.
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

    // Constitution des ancres WebExtension connues
    let newAnchors = new Set();
    if (typeof sourceMsgId === "number" && sourceMsgId > 0) newAnchors.add(sourceMsgId);
    if (typeof targetMsgId === "number" && targetMsgId > 0) newAnchors.add(targetMsgId);
    if (Array.isArray(anchorMessageIds)) {
      for (let anc of anchorMessageIds) {
        if (typeof anc === "number" && anc > 0) newAnchors.add(anc);
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

      // Absorber les en-têtes et ancres de tous les clusters recoupés
      for (let idx of overlappingIndexes) {
        let other = links[idx];
        for (let hid of other.allHeaderIds) newHeaderIds.add(hid);
        for (let anc of (other.anchorMessageIds || [])) newAnchors.add(anc);
      }

      linkObj = {
        ...primary,
        sourceSubject: sourceSubject || primary.sourceSubject,
        sourceAuthor: sourceAuthor || primary.sourceAuthor,
        targetSubject: targetSubject || primary.targetSubject,
        targetAuthor: targetAuthor || primary.targetAuthor,
        scope,
        allHeaderIds: Array.from(newHeaderIds),
        anchorMessageIds: Array.from(newAnchors),
        updatedAt: now
      };

      // Remplacer le premier et supprimer les autres clusters désormais fusionnés
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
        allHeaderIds: Array.from(newHeaderIds),
        anchorMessageIds: Array.from(newAnchors)
      };
      links.push(linkObj);
    }

    await browser.storage.local.set({ [STORAGE_KEY]: links });
    return linkObj;
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
   * Supprime une liaison manuelle ou un cluster d'après son identifiant unique.
   * @param {string} linkId - Identifiant de la liaison ou du cluster.
   * @returns {Promise<boolean>} true si la liaison a été supprimée.
   */
  static async removeLink(linkId) {
    if (!linkId) return false;
    const links = await this.getAllLinks();
    const filtered = links.filter(l => l.id !== linkId && l.clusterId !== linkId);
    if (filtered.length !== links.length) {
      await browser.storage.local.set({ [STORAGE_KEY]: filtered });
      return true;
    }
    return false;
  }

  /**
   * Supprime toute liaison ou cluster impliquant un Message-ID précis.
   * @param {string} headerId - Message-ID à détacher.
   * @returns {Promise<boolean>} true si au moins une liaison a été retirée.
   */
  static async removeLinksByHeaderId(headerId) {
    const normId = normalizeMessageId(headerId);
    if (!normId) return false;
    const links = await this.getAllLinks();
    const filtered = links.filter(l =>
      !l.allHeaderIds.includes(normId) &&
      normalizeMessageId(l.sourceHeaderId) !== normId &&
      normalizeMessageId(l.targetHeaderId) !== normId
    );
    if (filtered.length !== links.length) {
      await browser.storage.local.set({ [STORAGE_KEY]: filtered });
      return true;
    }
    return false;
  }

  /**
   * Trouve tous les clusters ou liaisons connectés à une collection de Message-IDs.
   * @param {Array<string>|Set<string>} headerIds - Collection de Message-IDs.
   * @returns {Promise<Array<object>>} Clusters concernés.
   */
  static async getClustersForHeaderIds(headerIds) {
    if (!headerIds || (Array.isArray(headerIds) && headerIds.length === 0)) {
      return [];
    }
    const idSet = new Set(
      Array.from(headerIds).map(id => normalizeMessageId(id)).filter(Boolean)
    );
    if (idSet.size === 0) return [];

    const allLinks = await this.getAllLinks();
    return allLinks.filter(l => {
      if (Array.isArray(l.allHeaderIds) && l.allHeaderIds.some(id => idSet.has(id))) {
        return true;
      }
      return idSet.has(normalizeMessageId(l.sourceHeaderId)) ||
             idSet.has(normalizeMessageId(l.targetHeaderId));
    });
  }

  /**
   * Alias de rétro-compatibilité pour getClustersForHeaderIds.
   * @param {Array<string>|Set<string>} headerIds
   * @returns {Promise<Array<object>>}
   */
  static async getLinksForHeaderIds(headerIds) {
    return this.getClustersForHeaderIds(headerIds);
  }
}
