/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Configuration ESLint « flat » (ESLint 9+).
 *
 * Équivalent de `.eslintrc.json` au nouveau format. Les deux coexistent
 * volontairement pendant la transition (action 4.5) : ESLint ≥ 9 lit ce
 * fichier, ESLint 8 lit `.eslintrc.json`. Prérequis : `npm install`
 * (devDependencies : eslint, @eslint/js, globals).
 */
const js = require("@eslint/js");
const globals = require("globals");

const sharedRules = {
  // caughtErrors: "none" restaure le défaut d'ESLint 8 : ESLint 9 a basculé sur
  // "all", ce qui signalerait tous nos `catch (e)` à e inutilisé. Conservé pour
  // l'alignement avec .eslintrc.json (et 0 warning sur le code existant).
  "no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrors: "none" }],
  "no-console": "off",
};

module.exports = [
  js.configs.recommended,
  {
    // Build output et dépendances
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    // Background + options : contexte WebExtension, ES modules
    files: ["background/**/*.js", "options/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: sharedRules,
  },
  {
    // Experiment APIs : contexte chrome/XPCOM, scripts classiques.
    // Pas d'env navigateur : setTimeout/clearTimeout sont IMPORTÉS depuis
    // Timer.sys.mjs (les exposer en globals déclencherait no-redeclare).
    files: ["experiment-api/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        console: "readonly",
        ExtensionCommon: "readonly",
        ExtensionAPI: "readonly",
        Services: "readonly",
        ChromeUtils: "readonly",
        Gloda: "readonly",
        GlodaMsgIndexer: "readonly",
        Cu: "readonly",
        Ci: "readonly",
        Cc: "readonly",
      },
    },
    rules: sharedRules,
  },
];
