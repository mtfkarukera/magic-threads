/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Résolveur de fil — ÉTAGE (C) : 100 % WebExtension, sans Gloda ni Experiment API.
 *
 * Filet ultime de l'après-Gloda (action 4.1, cf. CONCEPTION_POST-GLODA.md).
 * N'utilise que le SDK public `messages.*`, donc :
 *   - survit au retrait de Gloda ET des Experiment APIs ;
 *   - prêt pour Manifest V3.
 *
 * ⚠️ MODULE NON CÂBLÉ. Fourni pour test/validation isolée. Le branchement dans
 *    la cascade de threadResolver.js est une étape ultérieure (plan §7, étape 3).
 *
 * Dégradations assumées (cf. doc §5.4) :
 *   - pas de snippet de corps (l'API publique ne l'expose pas sans getFull) ;
 *   - réunification inter-dossiers en best-effort (dossiers candidats seulement).
 *
 * Contrat de sortie : tableau d'objets ThreadMessage identique aux autres étages.
 */

// ---- Bornes (calquées sur glodaApi.js, voir doc §5.3) ----
const kMaxRounds = 4;
const kMaxThreadMessages = 500;
const kMaxScanPerFolder = 400; // plafond de messages inspectés par dossier (descendants)

/**
 * Découpe une valeur d'en-tête References / In-Reply-To en Message-IDs.
 * Les en-têtes WebExtension (getHeaders) arrivent sous forme de tableau de
 * chaînes ; on tolère aussi une chaîne unique. Les angle-brackets sont retirés
 * pour coller à la forme `headerMessageId` attendue par messages.query.
 */
function parseMessageIds(headerValue) {
  if (!headerValue) return [];
  const raw = Array.isArray(headerValue) ? headerValue.join(" ") : String(headerValue);
  const ids = [];
  const re = /<([^<>]+)>/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    ids.push(m[1].trim());
  }
  // Repli : en-tête sans chevrons (rare mais légal)
  if (ids.length === 0) {
    for (const tok of raw.split(/\s+/)) {
      if (tok.includes("@")) ids.push(tok.trim());
    }
  }
  return ids;
}

/** Lit References + In-Reply-To d'un message, normalisés en liste de Message-IDs. */
async function getParentMessageIds(messageId) {
  try {
    const headers = await browser.messages.getHeaders(messageId);
    const refs = parseMessageIds(headers.references);
    const irt = parseMessageIds(headers["in-reply-to"]);
    return [...new Set([...refs, ...irt])];
  } catch (e) {
    return [];
  }
}

/** Convertit un MessageHeader WebExtension en ThreadMessage standardisé. */
function toThreadMessage(hdr, hasAttachments) {
  return {
    id: hdr.id,
    headerMessageId: hdr.headerMessageId || "",
    author: hdr.author || "",
    // hdr.date est un objet Date (cross-compartment OK ici, contexte WebExtension)
    date: hdr.date ? hdr.date.getTime() : 0,
    folder: hdr.folder
      ? {
          accountId: hdr.folder.accountId || "",
          path: hdr.folder.path || "?",
          type: hdr.folder.type || ""
        }
      : { accountId: "", path: "?", type: "" },
    snippet: "…", // pas de corps indexé en mode dégradé (doc §5.4)
    isRead: !!hdr.read,
    hasAttachments: !!hasAttachments,
    tags: hdr.tags || []
  };
}

/** Détecte la présence de pièces jointes via messages.listAttachments (borné). */
async function detectAttachments(messageId) {
  try {
    const atts = await browser.messages.listAttachments(messageId);
    return Array.isArray(atts) && atts.length > 0;
  } catch (e) {
    return false;
  }
}

/** Résout un Message-ID en MessageHeader(s) du magasin local, tous dossiers. */
async function queryByHeaderMessageId(headerMessageId) {
  try {
    // NB : la requête locale supporte headerMessageId tous comptes confondus.
    // (La restriction "NNTP seulement" ne concerne que la requête EN LIGNE.)
    const list = await browser.messages.query({ headerMessageId });
    return (list && list.messages) || [];
  } catch (e) {
    return [];
  }
}

/**
 * Point d'entrée de l'étage (C).
 *
 * @param {number} messageId - identifiant WebExtension du message courant
 * @returns {Promise<Array<object>>} tableau de ThreadMessage (≥ 1 si le message existe)
 */
export async function resolveThreadViaWebExt(messageId) {
  const byHeaderId = new Map(); // headerMessageId -> MessageHeader
  const candidateFolders = new Map(); // "accountId\0path" -> folder
  let seed;

  try {
    seed = await browser.messages.get(messageId);
  } catch (e) {
    return [];
  }
  if (!seed) return [];

  function add(hdr) {
    if (!hdr || !hdr.headerMessageId) return false;
    if (byHeaderId.has(hdr.headerMessageId)) return false;
    if (byHeaderId.size >= kMaxThreadMessages) return false;
    byHeaderId.set(hdr.headerMessageId, hdr);
    if (hdr.folder) {
      candidateFolders.set(`${hdr.folder.accountId}\0${hdr.folder.path}`, hdr.folder);
    }
    return true;
  }

  add(seed);

  // ---- (1) ANCÊTRES : remonter la chaîne References/In-Reply-To ----
  let frontier = [seed];
  const queriedIds = new Set();
  for (let round = 0; round < kMaxRounds && frontier.length; round++) {
    const wanted = [];
    for (const hdr of frontier) {
      for (const mid of await getParentMessageIds(hdr.id)) {
        if (!queriedIds.has(mid) && !byHeaderId.has(mid)) {
          queriedIds.add(mid);
          wanted.push(mid);
        }
      }
    }
    const next = [];
    for (const mid of wanted) {
      for (const found of await queryByHeaderMessageId(mid)) {
        if (add(found)) next.push(found);
      }
    }
    frontier = next;
  }

  // ---- (2) DESCENDANTS : balayer les dossiers candidats (heuristique, doc §5.3) ----
  const knownIds = new Set(byHeaderId.keys());
  for (let round = 0; round < kMaxRounds; round++) {
    let grew = false;
    for (const folder of candidateFolders.values()) {
      let scanned = 0;
      let page;
      try {
        page = await browser.messages.query({ folderId: folder.id || undefined });
      } catch (e) {
        continue;
      }
      while (page && scanned < kMaxScanPerFolder) {
        for (const hdr of page.messages || []) {
          if (++scanned > kMaxScanPerFolder) break;
          if (byHeaderId.has(hdr.headerMessageId)) continue;
          const parents = await getParentMessageIds(hdr.id);
          if (parents.some((mid) => knownIds.has(mid))) {
            if (add(hdr)) {
              knownIds.add(hdr.headerMessageId);
              grew = true;
            }
          }
        }
        if (!page.id || scanned >= kMaxScanPerFolder) break;
        try {
          page = await browser.messages.continueList(page.id);
        } catch (e) {
          break;
        }
      }
    }
    if (!grew) break;
  }

  // ---- (3) Traduire vers le contrat ThreadMessage ----
  const results = [];
  for (const hdr of byHeaderId.values()) {
    const hasAtt = await detectAttachments(hdr.id);
    results.push(toThreadMessage(hdr, hasAtt));
  }
  results.sort((a, b) => a.date - b.date);
  return results;
}
