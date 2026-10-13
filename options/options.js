/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const storage = browser.storage.sync || browser.storage.local;
let statusTimer = null;

/**
 * Localise tous les éléments avec l'attribut data-i18n.
 * Remplace le textContent par la traduction correspondante.
 */
function localizeDocument() {
  if (typeof browser.i18n?.getUILanguage === "function") {
    document.documentElement.lang = browser.i18n.getUILanguage() || "fr";
  }

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
    if (statusTimer) {
      clearTimeout(statusTimer);
    }
    // Insérer le texte au moment de l'enregistrement : la zone role="status"
    // (aria-live) annonce le changement de contenu aux lecteurs d'écran.
    status.textContent = browser.i18n.getMessage("optStatusSaved");
    status.classList.add("show");
    statusTimer = setTimeout(() => {
      status.classList.remove("show");
      status.textContent = "";
      statusTimer = null;
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
 * Met à jour le récapitulatif des liaisons manuelles dans la page d'options.
 */
async function loadManualLinks() {
  const countEl = document.getElementById("manual-links-count-text");
  if (!countEl) return;

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

    if (links.length === 0) {
      countEl.textContent = browser.i18n.getMessage("optManualLinksEmpty") || "Aucune liaison manuelle enregistrée pour le moment.";
    } else {
      const countSuffix = browser.i18n.getMessage("linksPageCountActive") || "liaison(s) active(s)";
      countEl.textContent = `${links.length} ${countSuffix}`;
    }
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

  // Synchronisation temps réel si les liaisons sont modifiées depuis le gestionnaire ou un volet
  if (typeof browser.storage?.onChanged !== "undefined") {
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes.manualThreadLinks) {
        loadManualLinks();
      }
    });
  }
});

