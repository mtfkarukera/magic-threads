/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Module de gestion des liaisons manuelles de messages (Overlay virtuel).
 *
 * Ce module persiste les associations de fils de discussion dans browser.storage.local
 * sans altérer la base Gloda ou les dossiers locaux de Thunderbird.
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
   * @returns {Promise<Array<object>>} Liste des liaisons ordonnées par date de création.
   */
  static async getAllLinks() {
    try {
      const data = await browser.storage.local.get({ [STORAGE_KEY]: [] });
      const links = data[STORAGE_KEY];
      return Array.isArray(links) ? links : [];
    } catch (e) {
      console.error("Magic Threads: Erreur lors de la lecture des liaisons manuelles :", e);
      return [];
    }
  }

  /**
   * Ajoute ou met à jour une liaison manuelle entre un message source et un fil cible.
   *
   * @param {object} params
   * @param {string} params.sourceHeaderId - Message-ID du message source.
   * @param {string} params.sourceSubject - Objet du message source.
   * @param {string} params.sourceAuthor - Expéditeur du message source.
   * @param {string} params.targetHeaderId - Message-ID du message / fil cible.
   * @param {string} params.targetSubject - Objet du fil cible.
   * @param {string} params.targetAuthor - Expéditeur du fil cible.
   * @param {string} [params.scope="entire_thread"] - "entire_thread" ou "single_message".
   * @returns {Promise<object>} L'objet de liaison enregistré.
   */
  static async addLink({
    sourceHeaderId,
    sourceSubject,
    sourceAuthor,
    targetHeaderId,
    targetSubject,
    targetAuthor,
    scope = "entire_thread"
  }) {
    const normSource = normalizeMessageId(sourceHeaderId);
    const normTarget = normalizeMessageId(targetHeaderId);

    if (!normSource || !normTarget || normSource === normTarget) {
      throw new Error("Message-IDs source et cible invalides ou identiques.");
    }

    const links = await this.getAllLinks();

    // Vérifier si une liaison identique existe déjà (dans un sens ou dans l'autre)
    const existingIndex = links.findIndex(l =>
      (normalizeMessageId(l.sourceHeaderId) === normSource && normalizeMessageId(l.targetHeaderId) === normTarget) ||
      (normalizeMessageId(l.sourceHeaderId) === normTarget && normalizeMessageId(l.targetHeaderId) === normSource)
    );

    const now = Date.now();
    let linkObj;

    if (existingIndex !== -1) {
      // Mise à jour de la portée et des métadonnées
      linkObj = {
        ...links[existingIndex],
        sourceSubject: sourceSubject || links[existingIndex].sourceSubject,
        sourceAuthor: sourceAuthor || links[existingIndex].sourceAuthor,
        targetSubject: targetSubject || links[existingIndex].targetSubject,
        targetAuthor: targetAuthor || links[existingIndex].targetAuthor,
        scope,
        updatedAt: now
      };
      links[existingIndex] = linkObj;
    } else {
      // Nouvelle liaison
      linkObj = {
        id: "link_" + now + "_" + Math.random().toString(36).substring(2, 8),
        createdAt: now,
        sourceHeaderId: normSource,
        sourceSubject: (sourceSubject || "").trim(),
        sourceAuthor: (sourceAuthor || "").trim(),
        targetHeaderId: normTarget,
        targetSubject: (targetSubject || "").trim(),
        targetAuthor: (targetAuthor || "").trim(),
        scope
      };
      links.push(linkObj);
    }

    await browser.storage.local.set({ [STORAGE_KEY]: links });
    return linkObj;
  }

  /**
   * Supprime une liaison manuelle d'après son identifiant unique.
   * @param {string} linkId - Identifiant de la liaison.
   * @returns {Promise<boolean>} true si la liaison a été supprimée.
   */
  static async removeLink(linkId) {
    if (!linkId) return false;
    const links = await this.getAllLinks();
    const filtered = links.filter(l => l.id !== linkId);
    if (filtered.length !== links.length) {
      await browser.storage.local.set({ [STORAGE_KEY]: filtered });
      return true;
    }
    return false;
  }

  /**
   * Supprime toute liaison impliquant un Message-ID précis (source ou cible).
   * @param {string} headerId - Message-ID à détacher.
   * @returns {Promise<boolean>} true si au moins une liaison a été retirée.
   */
  static async removeLinksByHeaderId(headerId) {
    const normId = normalizeMessageId(headerId);
    if (!normId) return false;
    const links = await this.getAllLinks();
    const filtered = links.filter(l =>
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
   * Trouve toutes les liaisons actives connectées à une liste de Message-IDs donnée.
   * @param {Array<string>|Set<string>} headerIds - Collection de Message-IDs.
   * @returns {Promise<Array<object>>} Liaisons concernées.
   */
  static async getLinksForHeaderIds(headerIds) {
    if (!headerIds || (Array.isArray(headerIds) && headerIds.length === 0)) {
      return [];
    }
    const idSet = new Set(
      Array.from(headerIds).map(id => normalizeMessageId(id)).filter(Boolean)
    );
    if (idSet.size === 0) return [];

    const allLinks = await this.getAllLinks();
    return allLinks.filter(l =>
      idSet.has(normalizeMessageId(l.sourceHeaderId)) ||
      idSet.has(normalizeMessageId(l.targetHeaderId))
    );
  }
}
