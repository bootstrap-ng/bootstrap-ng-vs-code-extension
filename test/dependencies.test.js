"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  ALPHA1_CODE,
  diagnoseDependencies,
  updatedSpecifier,
} = require("../src/dependencies");

function messages(source) {
  return diagnoseDependencies(source).map((item) => item.message);
}

describe("dependency versions", () => {
  it("warns when bootstrap or bootstrap-ng is 6.0.0-alpha.1", () => {
    const source = `{
  "dependencies": {
    "bootstrap": "^6.0.0-alpha.1",
    "bootstrap-ng": "6.0.0-alpha.1"
  }
}
`;
    const found = diagnoseDependencies(source);

    assert.equal(found.length, 2);
    assert.equal(found[0].severity, "warning");
    assert.equal(found[0].code, ALPHA1_CODE);
    assert.equal(
      found[0].message,
      "bootstrap 6.0.0-alpha.1 is out of date. Update to 6.0.0-alpha.2.",
    );
    assert.equal(
      found[1].message,
      "bootstrap-ng 6.0.0-alpha.1 is out of date. Update to 6.0.0-alpha.2.",
    );
    assert.equal(source.slice(found[0].start, found[0].end), "^6.0.0-alpha.1");
    assert.equal(source.slice(found[1].start, found[1].end), "6.0.0-alpha.1");
    assert.equal(source[found[0].start - 1], '"');
    assert.equal(source[found[0].end], '"');
  });

  it("warns for ranged, aliased, and nested version fields", () => {
    const source = `{
  "keywords": ["bootstrap"],
  "contributors": [{ "name": "Ada" }],
  "description": "Built with bootstrap 6.0.0-alpha.1",
  "devDependencies": {
    "bootstrap": "~6.0.0-alpha.1"
  },
  "optionalDependencies": {
    "bootstrap-ng": ">=6.0.0-alpha.1"
  },
  "overrides": {
    "bootstrap": "npm:bootstrap@6.0.0-alpha.1",
    "app": {
      "bootstrap-ng": "6.0.0-alpha.1"
    }
  },
  "peerDependencies": {
    "bootstrap": "6.0.0-alpha.1"
  },
  "resolutions": {
    "bootstrap-ng": "github:bootstrap-ng/bootstrap-ng#v6.0.0-alpha.1"
  },
  "scripts": {
    "start": "echo 6.0.0-alpha.1"
  }
}
`;
    const found = diagnoseDependencies(source);

    assert.deepEqual(
      found.map((item) => source.slice(item.start, item.end)),
      [
        "~6.0.0-alpha.1",
        ">=6.0.0-alpha.1",
        "npm:bootstrap@6.0.0-alpha.1",
        "6.0.0-alpha.1",
        "6.0.0-alpha.1",
        "github:bootstrap-ng/bootstrap-ng#v6.0.0-alpha.1",
      ],
    );
    const mention = source.indexOf("6.0.0-alpha.1");

    assert.ok(mention < source.indexOf("devDependencies"));
    assert.ok(found.every((item) => item.start > mention));
  });

  it("ignores other versions and invalid manifests", () => {
    assert.deepEqual(
      messages(`{
        "dependencies": {
          "bootstrap": "6.0.0-alpha.2",
          "bootstrap-ng": "^5.3.8"
        }
      }`),
      [],
    );
    assert.deepEqual(
      messages(
        '{"dependencies":{"bootstrap":"6.0.0-alpha.10","bootstrap-ng":"16.0.0-alpha.1"}}',
      ),
      [],
    );
    assert.deepEqual(
      messages('{"dependencies":{"bootstrap":"6.0.0-alpha.1",}}'),
      [],
    );
    assert.deepEqual(messages(""), []);
  });

  it("replaces only the alpha 1 version token", () => {
    assert.equal(updatedSpecifier("^6.0.0-alpha.1"), "^6.0.0-alpha.2");
    assert.equal(updatedSpecifier("6.0.0-alpha.1+001"), "6.0.0-alpha.2+001");
    assert.equal(
      updatedSpecifier("6.0.0-alpha.1 || 6.0.0-alpha.1"),
      "6.0.0-alpha.2 || 6.0.0-alpha.2",
    );
    assert.equal(updatedSpecifier("6.0.0-alpha.10"), "6.0.0-alpha.10");
    assert.equal(updatedSpecifier("6.0.0-alpha.2"), "6.0.0-alpha.2");
    assert.equal(updatedSpecifier("16.0.0-alpha.1"), "16.0.0-alpha.1");
  });
});
