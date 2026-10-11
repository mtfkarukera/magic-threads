/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const storage = browser.storage.sync || browser.storage.local;
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Crée une icône poubelle SVG monochrome (14x14) sans innerHTML.
 */
function createTrashIcon() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.style.display = "inline-block";
  svg.style.verticalAlign = "middle";

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("fill-rule", "evenodd");
  path.setAttribute("d", "M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.81 7.29A2 2 0 0 0 5.85 14.5h4.3a2 2 0 0 0 1.99-1.71l.81-7.29h.3a.75.75 0 0 0 0-1.5H11v-.75A1.75 1.75 0 0 0 9.25 1.5h-2.5A1.75 1.75 0 0 0 5 3.25zm1.5 0a.25.25 0 0 1 .25-.25h2.5a.25.25 0 0 1 .25.25V4h-3v-.75zM4.56 5.5l.74 6.64a.5.5 0 0 0 .5.43h4.4a.5.5 0 0 0 .5-.43l.74-6.64H4.56z");
  svg.appendChild(path);
  return svg;
}

/**
 * Localise tous les éléments avec l'attribut data-i18n.
 * Remplace le textContent par la traduction correspondante.
 */
function localizeDocument() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    let key = el.getAttribute("data-i18n");
    let msg = browser.i18n.getMessage(key);
    if (msg) {
      el.textContent = msg;
    }
  });
  // Titre de la page
  let titleMsg = browser.i18n.getMessage("optionsTitle");
  if (titleMsg) {
    document.title = titleMsg;
  }
}

const ALLOWED_VALUES = {
  navigationMode: ["currentTab", "newTab"],
  sidebarPosition: ["left", "right"],
  mainViewPosition: ["bottom", "right"],
  threadOrder: ["antichronological", "chronological"]
};

// Charge les options enregistrées
function loadOptions() {
  storage.get({
    navigationMode: "currentTab",
    sidebarPosition: "right",
    mainViewPosition: "bottom",
    threadOrder: "antichronological"
  }).then((items) => {
    // Migration (v2.2.0) : la position « left » en vue principale n'existe plus
    if (items.mainViewPosition === "left") {
      items.mainViewPosition = "right";
      storage.set({ mainViewPosition: "right" }).catch(console.error);
    }
    
    // Navigation mode
    const navMode = ALLOWED_VALUES.navigationMode.includes(items.navigationMode)
      ? items.navigationMode
      : "currentTab";
    const navRadio = document.querySelector(`input[name="navigationMode"][value="${navMode}"]`);
    if (navRadio) {
      navRadio.checked = true;
    }

    // Sidebar position
    const sidebarPos = ALLOWED_VALUES.sidebarPosition.includes(items.sidebarPosition)
      ? items.sidebarPosition
      : "right";
    const sidebarRadio = document.querySelector(`input[name="sidebarPosition"][value="${sidebarPos}"]`);
    if (sidebarRadio) {
      sidebarRadio.checked = true;
    }

    // Main view position
    const mainViewPos = ALLOWED_VALUES.mainViewPosition.includes(items.mainViewPosition)
      ? items.mainViewPosition
      : "bottom";
    const mainViewRadio = document.querySelector(`input[name="mainViewPosition"][value="${mainViewPos}"]`);
    if (mainViewRadio) {
      mainViewRadio.checked = true;
    }

    // Thread order
    const threadOrder = ALLOWED_VALUES.threadOrder.includes(items.threadOrder)
      ? items.threadOrder
      : "antichronological";
    const threadRadio = document.querySelector(`input[name="threadOrder"][value="${threadOrder}"]`);
    if (threadRadio) {
      threadRadio.checked = true;
    }
  }).catch(console.error);
}

// Enregistre les options lors d'un changement
function saveOptions() {
  const navEl = document.querySelector('input[name="navigationMode"]:checked');
  const sidebarEl = document.querySelector('input[name="sidebarPosition"]:checked');
  const mainViewEl = document.querySelector('input[name="mainViewPosition"]:checked');
  const threadOrderEl = document.querySelector('input[name="threadOrder"]:checked');
  storage.set({
    navigationMode: navEl ? navEl.value : "currentTab",
    sidebarPosition: sidebarEl ? sidebarEl.value : "right",
    mainViewPosition: mainViewEl ? mainViewEl.value : "bottom",
    threadOrder: threadOrderEl ? threadOrderEl.value : "antichronological"
  }).then(() => {
    const status = document.getElementById("status");
    // Insérer le texte au moment de l'enregistrement : la zone role="status"
    // (aria-live) annonce le changement de contenu aux lecteurs d'écran.
    status.textContent = browser.i18n.getMessage("optStatusSaved");
    status.classList.add("show");
    setTimeout(() => {
      status.classList.remove("show");
      status.textContent = "";
    }, 2000);
  }).catch(console.error);
}

/**
 * Vérifie la disponibilité de Gloda (3.5) et affiche un bandeau d'alerte si
 * l'indexeur est désactivé ou le module absent. L'API Experiment convGloda est
 * déclarée en scope addon_parent : elle est donc accessible directement depuis
 * cette page d'options, sans passer par le background.
 */
async function checkGlodaStatus() {
  try {
    if (typeof browser.convGloda === "undefined" || !browser.convGloda.isGlodaAvailable) {
      return;
    }
    const available = await browser.convGloda.isGlodaAvailable();
    if (!available) {
      const warning = document.getElementById("gloda-warning");
      warning.textContent = browser.i18n.getMessage("optGlodaDisabledWarning");
      warning.hidden = false;
    }
  } catch (e) {
    console.warn("Magic Threads: could not query Gloda availability:", e);
  }
}

/**
 * Charge et affiche les liaisons manuelles actives dans le tableau de gestion.
 */
async function loadManualLinks() {
  const container = document.getElementById("manual-links-container");
  if (!container) return;

  while (container.firstChild) {
    container.firstChild.remove();
  }

  try {
    let links = [];
    if (typeof browser.runtime?.sendMessage !== "undefined") {
      let res = await browser.runtime.sendMessage({ action: "getManualLinks" }).catch(() => null);
      if (res && Array.isArray(res.links)) {
        links = res.links;
      }
    }
    if (links.length === 0) {
      const data = await browser.storage.local.get({ manualThreadLinks: [] });
      links = Array.isArray(data.manualThreadLinks) ? data.manualThreadLinks : [];
    }

    if (links.length === 0) {
      let emptyMsg = document.createElement("div");
      emptyMsg.className = "empty-links-notice";
      emptyMsg.textContent = browser.i18n.getMessage("optManualLinksEmpty") || "Aucune liaison manuelle enregistrée pour le moment.";
      container.appendChild(emptyMsg);
      return;
    }

    let table = document.createElement("table");
    table.className = "links-table";

    let thead = document.createElement("thead");
    let headerRow = document.createElement("tr");

    const cols = [
      browser.i18n.getMessage("optManualLinksColSource") || "Message Source",
      browser.i18n.getMessage("optManualLinksColTarget") || "Fil Cible",
      browser.i18n.getMessage("optManualLinksColScope") || "Portée",
      browser.i18n.getMessage("optManualLinksColDate") || "Date",
      browser.i18n.getMessage("optManualLinksColAction") || "Actions"
    ];

    for (let colText of cols) {
      let th = document.createElement("th");
      th.setAttribute("scope", "col");
      th.textContent = colText;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    let tbody = document.createElement("tbody");

    for (let link of links) {
      let row = document.createElement("tr");

      // Source
      let tdSource = document.createElement("td");
      let sourceTitle = link.sourceSubject || link.sourceHeaderId || "?";
      tdSource.textContent = sourceTitle + (link.sourceAuthor ? ` (${link.sourceAuthor})` : "");
      row.appendChild(tdSource);

      // Target
      let tdTarget = document.createElement("td");
      let targetTitle = link.targetSubject || link.targetHeaderId || "?";
      tdTarget.textContent = targetTitle + (link.targetAuthor ? ` (${link.targetAuthor})` : "");
      row.appendChild(tdTarget);

      // Portée
      let tdScope = document.createElement("td");
      tdScope.textContent = link.scope === "entire_thread"
        ? (browser.i18n.getMessage("optManualLinksScopeEntire") || "Fil complet")
        : (browser.i18n.getMessage("optManualLinksScopeSingle") || "Message unique");
      row.appendChild(tdScope);

      // Date
      let tdDate = document.createElement("td");
      if (link.createdAt) {
        let d = new Date(link.createdAt);
        tdDate.textContent = d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
      } else {
        tdDate.textContent = "-";
      }
      row.appendChild(tdDate);

      // Action
      let tdAction = document.createElement("td");
      let delBtn = document.createElement("button");
      delBtn.className = "delete-link-btn";
      delBtn.appendChild(createTrashIcon());
      delBtn.title = browser.i18n.getMessage("optManualLinksBtnDelete") || "Supprimer la liaison";
      delBtn.setAttribute("aria-label", browser.i18n.getMessage("optManualLinksBtnDelete") || "Supprimer la liaison");
      delBtn.addEventListener("click", async () => {
        let success = false;
        if (typeof browser.runtime?.sendMessage !== "undefined") {
          let res = await browser.runtime.sendMessage({
            action: "removeManualLink",
            linkId: link.id
          }).catch(() => null);
          success = !!res?.success;
        }

        // Repli direct si le background n'est pas joignable
        if (!success) {
          let currentData = await browser.storage.local.get({ manualThreadLinks: [] });
          let currentLinks = Array.isArray(currentData.manualThreadLinks) ? currentData.manualThreadLinks : [];
          let updated = currentLinks.filter(l => l.id !== link.id);
          await browser.storage.local.set({ manualThreadLinks: updated });
          success = true;
        }

        const status = document.getElementById("status");
        if (status && success) {
          status.textContent = browser.i18n.getMessage("optManualLinksDeletedFeedback") || "Liaison supprimée avec succès.";
          status.classList.add("show");
          setTimeout(() => {
            status.classList.remove("show");
            status.textContent = "";
          }, 2000);
        }

        loadManualLinks();
      });
      tdAction.appendChild(delBtn);
      row.appendChild(tdAction);

      tbody.appendChild(row);
    }

    table.appendChild(tbody);
    container.appendChild(table);
  } catch (e) {
    console.error("Magic Threads: Erreur lors du chargement des liaisons manuelles:", e);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  localizeDocument();
  loadOptions();
  loadManualLinks();
  checkGlodaStatus();

  document.querySelectorAll('input[name="navigationMode"]').forEach((radio) => {
    radio.addEventListener("change", saveOptions);
  });
  document.querySelectorAll('input[name="sidebarPosition"]').forEach((radio) => {
    radio.addEventListener("change", saveOptions);
  });
  document.querySelectorAll('input[name="mainViewPosition"]').forEach((radio) => {
    radio.addEventListener("change", saveOptions);
  });
  document.querySelectorAll('input[name="threadOrder"]').forEach((radio) => {
    radio.addEventListener("change", saveOptions);
  });
});

