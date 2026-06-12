/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ThreadResolver (Data Access Layer - DAL)
 * 
 * Isole la source des données du reste de l'extension. Actuellement (v1), 
 * il interroge Gloda via l'Experiment API convGloda. 
 */
export class ThreadResolver {
  /**
   * Récupère la liste des messages appartenant au même fil que le message fourni.
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
      return await browser.convGloda.getThreadMessages(messageId);
    } catch (e) {
      console.error("Magic Threads: Erreur dans ThreadResolver.getThreadMessages: ", e);
      return [];
    }
  }
}
