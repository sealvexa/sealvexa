"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { extractArchive } = require("../lib/codec");
const {
  sealSync,
  openSync,
  loadSealedSync,
  mountSync,
  readModule,
  releaseModule,
  listSync,
} = require("..");

const password = "sample-password";

const LEDGER_SOURCE = `"use strict";

function total(amounts) {
  return amounts.reduce((sum, amount) => sum + amount, 0);
}

module.exports = { total };
`;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sealvexa-"));
}

function writeLedger(libraryDir) {
  fs.mkdirSync(libraryDir, { recursive: true });
  fs.writeFileSync(path.join(libraryDir, "ledger.js"), LEDGER_SOURCE);
}

function sealLedger(root) {
  const source = path.join(root, "library");
  const sealed = path.join(root, "ledger.sealvexa");
  writeLedger(source);
  const result = sealSync({ from: source, to: sealed, password });
  return { source, sealed, result };
}

test("seal ledger.js and load it with loadSealedSync", () => {
  const root = tempDir();
  const { sealed, result } = sealLedger(root);

  assert.equal(result.to, sealed);
  assert.ok(result.bytes > 0);

  const ledger = loadSealedSync({
    file: sealed,
    modulePath: "ledger",
    password,
    root,
    force: true,
  });

  assert.equal(ledger.total([10, 25, 5]), 40);
  assert.equal(
    fs.readFileSync(path.join(root, "modules", "ledger", "ledger.js"), "utf8"),
    LEDGER_SOURCE,
  );
});

test("sealing the same ledger twice produces different files", () => {
  const root = tempDir();
  const source = path.join(root, "library");
  writeLedger(source);

  sealSync({ from: source, to: path.join(root, "ledger-a.sealvexa"), password });
  sealSync({ from: source, to: path.join(root, "ledger-b.sealvexa"), password });

  const a = fs.readFileSync(path.join(root, "ledger-a.sealvexa"));
  const b = fs.readFileSync(path.join(root, "ledger-b.sealvexa"));
  assert.equal(a.equals(b), false);
});

test("loadSealedSync rejects a wrong password", () => {
  const root = tempDir();
  const { sealed } = sealLedger(root);

  assert.throws(
    () => loadSealedSync({
      file: sealed,
      modulePath: "ledger",
      password: "nope",
      root,
      force: true,
    }),
    /unable to authenticate|Unsupported state/i,
  );
});

test("loadSealedSync rejects a tampered ledger.sealvexa file", () => {
  const root = tempDir();
  const { sealed } = sealLedger(root);
  const bytes = fs.readFileSync(sealed);
  bytes[bytes.length - 1] ^= 0xff;
  fs.writeFileSync(sealed, bytes);

  assert.throws(
    () => loadSealedSync({
      file: sealed,
      modulePath: "ledger",
      password,
      root,
      force: true,
    }),
  );
});

test("loading again requires force when ledger is already mounted", () => {
  const root = tempDir();
  const { sealed } = sealLedger(root);

  const ledger = loadSealedSync({
    file: sealed,
    modulePath: "ledger",
    password,
    root,
    force: true,
  });
  assert.equal(ledger.total([10, 25, 5]), 40);

  assert.throws(
    () => loadSealedSync({
      file: sealed,
      modulePath: "ledger",
      password,
      root,
    }),
    /force: true/,
  );
  assert.equal(ledger.total([10, 25, 5]), 40);

  const replaced = loadSealedSync({
    file: sealed,
    modulePath: "ledger",
    password,
    root,
    force: true,
  });
  assert.equal(replaced.total([10, 25, 5]), 40);
  assert.notEqual(replaced, ledger);
});

test("sealSync requires a password up front", () => {
  const previous = process.env.SEALVEXA_PASSWORD;
  delete process.env.SEALVEXA_PASSWORD;
  try {
    assert.throws(
      () => sealSync({ from: ".", to: "ledger.sealvexa" }),
      /SEALVEXA_PASSWORD/,
    );
  } finally {
    if (previous === undefined) delete process.env.SEALVEXA_PASSWORD;
    else process.env.SEALVEXA_PASSWORD = previous;
  }
});

test("archive extraction rejects path traversal", () => {
  const header = Buffer.alloc(9);
  header.write("SVA1", 0, "ascii");
  header.writeUInt8(1, 4);
  header.writeUInt32LE(1, 5);
  const rel = Buffer.from("../../secret.txt", "utf8");
  const entry = Buffer.alloc(2 + rel.length + 2 + 4);
  let at = 0;
  entry.writeUInt16LE(rel.length, at);
  at += 2;
  rel.copy(entry, at);
  at += rel.length;
  entry.writeUInt16LE(0o644, at);
  at += 2;
  entry.writeUInt32LE(4, at);
  const archive = Buffer.concat([header, entry, Buffer.from("nope")]);
  assert.throws(() => extractArchive(archive, tempDir()), /Unsafe archive path/);
});

test("mount ledger, then load it again with loadSealedSync", () => {
  const root = tempDir();
  const { sealed } = sealLedger(root);

  const mounted = mountSync({
    file: sealed,
    password,
    root,
  });
  assert.equal(mounted.name, "ledger");
  assert.deepEqual(mounted.modules, ["ledger"]);
  assert.deepEqual(listSync({ root }), ["ledger"]);
  assert.deepEqual(listSync({ root, name: "ledger" }), ["ledger"]);

  const ledger = readModule("ledger/ledger", { root });
  assert.equal(ledger.total([10, 25, 5]), 40);
  assert.equal(releaseModule("ledger/ledger", { root }), true);
  assert.equal(releaseModule("ledger/ledger", { root }), false);

  const again = loadSealedSync({
    file: sealed,
    modulePath: "ledger",
    password,
    root,
    force: true,
  });
  assert.equal(again.total([10, 25, 5]), 40);
  assert.notEqual(again, ledger);
});

test("module names cannot escape the store", () => {
  assert.throws(() => readModule("../package.json", { root: tempDir() }), /Unsafe module name/);
});

test("symlinks are left out of the sealed library", (t) => {
  const root = tempDir();
  const source = path.join(root, "library");
  writeLedger(source);
  try {
    fs.symlinkSync(path.join(source, "ledger.js"), path.join(source, "alias.js"));
  } catch (err) {
    if (err.code === "EPERM" || err.code === "EACCES") {
      t.skip("this process cannot create symlinks");
      return;
    }
    throw err;
  }

  const sealed = path.join(root, "ledger.sealvexa");
  const restored = path.join(root, "restored");
  sealSync({ from: source, to: sealed, password });
  openSync({ file: sealed, into: restored, password });

  assert.equal(fs.existsSync(path.join(restored, "ledger.js")), true);
  assert.equal(fs.existsSync(path.join(restored, "alias.js")), false);

  const ledger = loadSealedSync({
    file: sealed,
    modulePath: "ledger",
    password,
    root,
    force: true,
  });
  assert.equal(ledger.total([10, 25, 5]), 40);
});

test("the CLI seals ledger.js and loadSealedSync opens it", () => {
  const root = tempDir();
  const source = path.join(root, "library");
  const sealed = path.join(root, "ledger.sealvexa");
  writeLedger(source);

  const bin = path.join(__dirname, "..", "bin", "sealvexa.js");
  const env = { ...process.env, SEALVEXA_PASSWORD: password };
  const sealedRun = spawnSync(process.execPath, [bin, "seal", source, "-o", sealed], {
    env,
    encoding: "utf8",
  });
  assert.equal(sealedRun.status, 0, sealedRun.stderr);

  const ledger = loadSealedSync({
    file: sealed,
    modulePath: "ledger",
    password,
    root,
    force: true,
  });
  assert.equal(ledger.total([10, 25, 5]), 40);
});
