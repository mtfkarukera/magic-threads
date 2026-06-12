/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const storage = browser.storage.sync || browser.storage.local;

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

// Charge les options enregistrées
function loadOptions() {
  storage.get({
    navigationMode: "currentTab",
    sidebarPosition: "right",
    mainViewPosition: "bottom",
    threadOrder: "antichronological"
  }).then((items) => {
    // Navigation mode
    const navRadio = document.querySelector(`input[name="navigationMode"][value="${items.navigationMode}"]`);
    if (navRadio) {
      navRadio.checked = true;
    }
    // Sidebar position
    const sidebarRadio = document.querySelector(`input[name="sidebarPosition"][value="${items.sidebarPosition}"]`);
    if (sidebarRadio) {
      sidebarRadio.checked = true;
    }
    // Main view position
    const mainViewRadio = document.querySelector(`input[name="mainViewPosition"][value="${items.mainViewPosition}"]`);
    if (mainViewRadio) {
      mainViewRadio.checked = true;
    }
    // Thread order
    const threadRadio = document.querySelector(`input[name="threadOrder"][value="${items.threadOrder}"]`);
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
    status.classList.add("show");
    setTimeout(() => {
      status.classList.remove("show");
    }, 2000);
  }).catch(console.error);
}

document.addEventListener("DOMContentLoaded", () => {
  localizeDocument();
  loadOptions();

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

