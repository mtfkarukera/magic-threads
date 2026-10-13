/**
 * Magic Threads - Gestionnaire Dédié des Fils Associés Manuellement
 * Script d'administration sécurisé (CSP stricte, zéro innerHTML).
 */

let allLinksCache = [];
let statusToastTimer = null;
let pendingFocusIndex = null;

/**
 * Générateur d'icône SVG sécurisé pour la corbeille de suppression.
 */
function createTrashIcon() {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("d", "M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z");
  svg.appendChild(path);

  const path2 = document.createElementNS(svgNS, "path");
  path2.setAttribute("fill-rule", "evenodd");
  path2.setAttribute("d", "M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z");
  svg.appendChild(path2);

  return svg;
}

/**
 * Générateur d'icône SVG sécurisé pour la loupe de recherche.
 */
function createSearchIcon() {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("d", "M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z");
  svg.appendChild(path);

  return svg;
}

/**
 * Localise l'ensemble du document en appliquant les messages i18n
 * via textContent ou setAttribute (strictement sans innerHTML).
 */
function localizeDocument() {
  if (typeof browser.i18n?.getUILanguage === "function") {
    document.documentElement.lang = browser.i18n.getUILanguage() || "fr";
  }

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const msg = browser.i18n.getMessage(key);
    if (msg) {
      el.textContent = msg;
    }
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    const msg = browser.i18n.getMessage(key);
    if (msg) {
      el.placeholder = msg;
    }
  });

  document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria-label");
    const msg = browser.i18n.getMessage(key);
    if (msg) {
      el.setAttribute("aria-label", msg);
    }
  });
}

/**
 * Affiche un toast flottant accessible avec annonce vocale role="status".
 */
function showStatusToast(message) {
  const status = document.getElementById("status");
  if (!status) return;

  if (statusToastTimer) {
    clearTimeout(statusToastTimer);
  }

  status.textContent = message;
  status.classList.add("show");
  statusToastTimer = setTimeout(() => {
    status.classList.remove("show");
    status.textContent = "";
    statusToastTimer = null;
  }, 2200);
}

/**
 * Met à jour le compteur dynamique de liaisons actives (avec ratio si filtré).
 */
function updateCounter(filteredCount, totalCount, isFiltered) {
  const counterEl = document.getElementById("links-counter");
  if (!counterEl) return;

  const countSuffix = browser.i18n.getMessage("linksPageCountActive") || "liaison(s) active(s)";
  counterEl.textContent = isFiltered
    ? `${filteredCount} / ${totalCount} ${countSuffix}`
    : `${totalCount} ${countSuffix}`;
}

/**
 * Construit et affiche le tableau des liaisons filtrées (100% sécurisé via DOM pur).
 */
function renderTable(links) {
  const container = document.getElementById("links-table-container");
  if (!container) return;

  while (container.firstChild) {
    container.firstChild.remove();
  }

  const searchInput = document.getElementById("search-input");
  const isFiltered = Boolean(searchInput && searchInput.value.trim().length > 0);
  updateCounter(links.length, allLinksCache.length, isFiltered);

  if (links.length === 0) {
    let emptyNotice = document.createElement("div");
    emptyNotice.className = "empty-notice";
    emptyNotice.setAttribute("role", "status");
    emptyNotice.textContent = isFiltered
      ? (browser.i18n.getMessage("linksPageEmptySearch") || "Aucune liaison ne correspond à votre recherche.")
      : (browser.i18n.getMessage("optManualLinksEmpty") || "Aucune liaison manuelle enregistrée pour le moment.");
    container.appendChild(emptyNotice);

    if (pendingFocusIndex !== null) {
      pendingFocusIndex = null;
      if (searchInput) searchInput.focus();
    }
    return;
  }

  let table = document.createElement("table");
  table.className = "links-table";

  let thead = document.createElement("thead");
  let headerRow = document.createElement("tr");

  const cols = [
    { text: browser.i18n.getMessage("optManualLinksColSource") || "Message Source", width: "35%" },
    { text: browser.i18n.getMessage("optManualLinksColTarget") || "Fil Cible", width: "35%" },
    { text: browser.i18n.getMessage("optManualLinksColScope") || "Portée", width: "12%" },
    { text: browser.i18n.getMessage("optManualLinksColDate") || "Date", width: "12%" },
    { text: browser.i18n.getMessage("optManualLinksColAction") || "Actions", width: "6%" }
  ];

  for (let col of cols) {
    let th = document.createElement("th");
    th.setAttribute("scope", "col");
    th.style.width = col.width;
    th.textContent = col.text;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  let tbody = document.createElement("tbody");

  links.forEach((link, rowIndex) => {
    let row = document.createElement("tr");

    // Colonne 1 : Source
    let tdSource = document.createElement("td");
    let sourceTitle = document.createElement("span");
    sourceTitle.className = "cell-title";
    const sText = link.sourceSubject || link.sourceHeaderId || "?";
    sourceTitle.textContent = sText;
    sourceTitle.title = sText;
    tdSource.appendChild(sourceTitle);

    if (link.sourceAuthor) {
      let sourceAuthor = document.createElement("span");
      sourceAuthor.className = "cell-author";
      sourceAuthor.textContent = link.sourceAuthor;
      sourceAuthor.title = link.sourceAuthor;
      tdSource.appendChild(sourceAuthor);
    }
    row.appendChild(tdSource);

    // Colonne 2 : Cible
    let tdTarget = document.createElement("td");
    let targetTitle = document.createElement("span");
    targetTitle.className = "cell-title";
    const tText = link.targetSubject || link.targetHeaderId || "?";
    targetTitle.textContent = tText;
    targetTitle.title = tText;
    tdTarget.appendChild(targetTitle);

    if (link.targetAuthor) {
      let targetAuthor = document.createElement("span");
      targetAuthor.className = "cell-author";
      targetAuthor.textContent = link.targetAuthor;
      targetAuthor.title = link.targetAuthor;
      tdTarget.appendChild(targetAuthor);
    }
    row.appendChild(tdTarget);

    // Colonne 3 : Portée
    let tdScope = document.createElement("td");
    let scopeBadge = document.createElement("span");
    const isEntire = link.scope === "entire_thread";
    scopeBadge.className = "scope-badge " + (isEntire ? "entire" : "single");
    scopeBadge.textContent = isEntire
      ? (browser.i18n.getMessage("optManualLinksScopeEntire") || "Fil complet")
      : (browser.i18n.getMessage("optManualLinksScopeSingle") || "Message unique");
    tdScope.appendChild(scopeBadge);
    row.appendChild(tdScope);

    // Colonne 4 : Date
    let tdDate = document.createElement("td");
    tdDate.className = "date-cell";
    if (link.createdAt) {
      let d = new Date(link.createdAt);
      tdDate.textContent = d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
    } else {
      tdDate.textContent = "-";
    }
    row.appendChild(tdDate);

    // Colonne 5 : Actions (Suppression sécurisée)
    let tdAction = document.createElement("td");
    tdAction.className = "action-cell";

    let delBtn = document.createElement("button");
    delBtn.className = "delete-link-btn";
    delBtn.appendChild(createTrashIcon());
    const baseDeleteLabel = browser.i18n.getMessage("optManualLinksBtnDelete") || "Supprimer la liaison";
    delBtn.title = baseDeleteLabel;
    delBtn.setAttribute("aria-label", `${baseDeleteLabel} — ${sText}`);

    delBtn.addEventListener("click", async () => {
      if (delBtn.disabled) return;
      delBtn.disabled = true;
      pendingFocusIndex = rowIndex;

      const targetLinkId = link.id || link.clusterId;
      let res = null;
      if (typeof browser.runtime?.sendMessage !== "undefined") {
        res = await browser.runtime.sendMessage({
          action: "removeManualLink",
          linkId: targetLinkId
        }).catch(() => null);
      }

      let success = Boolean(res?.success);

      // Repli direct uniquement si le script d'arrière-plan est réellement injoignable (res === null)
      if (res === null) {
        let currentData = await browser.storage.local.get({ manualThreadLinks: [] });
        let currentLinks = Array.isArray(currentData.manualThreadLinks) ? currentData.manualThreadLinks : [];
        let updated = currentLinks.filter(l => l.id !== targetLinkId && l.clusterId !== targetLinkId);
        await browser.storage.local.set({ manualThreadLinks: updated });
        success = true;
      }

      if (success) {
        showStatusToast(browser.i18n.getMessage("optManualLinksDeletedFeedback") || "Liaison supprimée avec succès.");
      }

      // Si storage.onChanged n'est pas disponible ou si rien n'a changé en stockage, recharger manuellement
      if (!success || typeof browser.storage?.onChanged === "undefined") {
        await loadLinks();
      }
    });

    tdAction.appendChild(delBtn);
    row.appendChild(tdAction);

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  container.appendChild(table);

  // Restauration du focus clavier après suppression d'une ligne (WCAG 2.4.3)
  if (pendingFocusIndex !== null) {
    const allDelBtns = container.querySelectorAll(".delete-link-btn");
    const targetBtn = allDelBtns[Math.min(pendingFocusIndex, allDelBtns.length - 1)];
    pendingFocusIndex = null;
    if (targetBtn) {
      targetBtn.focus();
    } else if (searchInput) {
      searchInput.focus();
    }
  }
}

/**
 * Filtre les liaisons en mémoire vive en fonction du texte saisi.
 */
function applyFilter() {
  const searchInput = document.getElementById("search-input");
  const query = (searchInput ? searchInput.value : "").trim().toLowerCase();

  if (!query) {
    renderTable(allLinksCache);
    return;
  }

  const filtered = allLinksCache.filter(link => {
    const sSub = (link.sourceSubject || link.sourceHeaderId || "").toLowerCase();
    const sAuth = (link.sourceAuthor || "").toLowerCase();
    const tSub = (link.targetSubject || link.targetHeaderId || "").toLowerCase();
    const tAuth = (link.targetAuthor || "").toLowerCase();
    return sSub.includes(query) || sAuth.includes(query) || tSub.includes(query) || tAuth.includes(query);
  });

  renderTable(filtered);
}

/**
 * Charge les liaisons manuelles actives depuis le background ou storage.local.
 */
async function loadLinks() {
  try {
    let links = [];
    let loadedFromBg = false;
    if (typeof browser.runtime?.sendMessage !== "undefined") {
      let res = await browser.runtime.sendMessage({ action: "getManualLinks" }).catch(() => null);
      if (res && Array.isArray(res.links)) {
        links = res.links;
        loadedFromBg = true;
      }
    }

    if (!loadedFromBg) {
      const data = await browser.storage.local.get({ manualThreadLinks: [] });
      links = Array.isArray(data.manualThreadLinks) ? data.manualThreadLinks : [];
    }

    allLinksCache = links;
    applyFilter();
  } catch (e) {
    console.error("Magic Threads: Erreur lors du chargement des liaisons :", e);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  localizeDocument();

  const searchIconPlaceholder = document.getElementById("search-icon-placeholder");
  if (searchIconPlaceholder) {
    searchIconPlaceholder.appendChild(createSearchIcon());
  }

  loadLinks();

  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.addEventListener("input", applyFilter);
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && searchInput.value) {
        e.preventDefault();
        searchInput.value = "";
        applyFilter();
      }
    });
  }

  // Synchronisation temps réel si le stockage est modifié
  if (typeof browser.storage?.onChanged !== "undefined") {
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes.manualThreadLinks) {
        loadLinks();
      }
    });
  }
});
