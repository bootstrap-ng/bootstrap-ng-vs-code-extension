"use strict";

const js = require("@eslint/js");
const prettier = require("eslint-config-prettier");
const globals = require("globals");

module.exports = [
  {
    ignores: [
      "**/*.vsix",
      "**/*._*",
      ".vscode-test/**",
      "node_modules/**",
      "out/**",
    ],
  },
  js.configs.all,
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
      reportUnusedInlineConfigs: "error",
    },
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: globals.node,
      sourceType: "commonjs",
    },
    rules: {
      /*
       * Image parsers use bitwise math, magic numbers and continue. Size and
       * complexity limits sit just above the largest existing parser, so they
       * stop growth without forcing a rewrite.
       */
      complexity: ["error", 32],
      "func-style": "off",
      "id-length": [
        "error",
        {
          exceptions: ["x", "y"],
        },
      ],
      "max-classes-per-file": "off",
      "max-lines": [
        "error",
        {
          max: 1000,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      "max-lines-per-function": [
        "error",
        {
          max: 110,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      "max-params": ["error", 5],
      "max-statements": ["error", 55],
      "no-bitwise": "off",
      "no-continue": "off",
      "no-magic-numbers": "off",
      "no-ternary": "off",
      "no-undefined": "off",
      "no-underscore-dangle": [
        "error",
        {
          allow: ["_compile", "_extensions"],
        },
      ],
      "no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          reportUsedIgnorePattern: true,
          varsIgnorePattern: "^_",
        },
      ],
      "no-use-before-define": [
        "error",
        {
          classes: false,
          functions: false,
          variables: true,
        },
      ],
      "no-void": "off",
      "one-var": "off",
      "prefer-destructuring": [
        "error",
        {
          array: false,
          object: true,
        },
      ],
      "sort-keys": "off",
    },
  },
  {
    // Test suites are single long describe() callbacks.
    files: ["test/**/*.js"],
    rules: {
      "max-lines-per-function": "off",
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      sourceType: "module",
    },
  },
  prettier,
];
