"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const { decryptBytes, encryptBytes, extractArchive, packDirectory } = require("./codec");
const { resolvePassword, resolvePasswordSync } = require("./password");

function exists(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

function isOccupied(dir) {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
}

function writeAtomic(dest, bytes) {
  const tmp = `${dest}.partial-${crypto.randomBytes(6).toString("hex")}`;
  try {
    fs.writeFileSync(tmp, bytes, { mode: 0o600 });
    fs.renameSync(tmp, dest);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* the original error is the one that matters */
    }
    throw err;
  }
}

function sealSync({ from, to, password, scrypt } = {}) {
  if (!from) throw new Error("from is required");
  if (!to) throw new Error("to is required");

  const secret = resolvePasswordSync({ password });
  const packed = zlib.gzipSync(packDirectory(from));
  const sealed = encryptBytes(packed, secret, scrypt);
  const dest = path.resolve(to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  writeAtomic(dest, sealed);
  return { to: dest, bytes: sealed.length };
}

async function seal({ from, to, password, scrypt } = {}) {
  if (!from) throw new Error("from is required");
  if (!to) throw new Error("to is required");
  const secret = await resolvePassword({ password, label: "New password: " });
  return sealSync({ from, to, password: secret, scrypt });
}

function openSync({ file, into, password, force = false } = {}) {
  if (!file) throw new Error("file is required");
  if (!into) throw new Error("into is required");

  const dest = path.resolve(into);
  if (!force && exists(dest) && isOccupied(dest)) {
    throw new Error(`"${dest}" already has files. Pass { force: true } to replace them.`);
  }

  const secret = resolvePasswordSync({ password });
  const packed = zlib.gunzipSync(decryptBytes(fs.readFileSync(file), secret));
  const parent = path.dirname(dest);
  fs.mkdirSync(parent, { recursive: true });
  const tmp = path.join(parent, `.${path.basename(dest)}.partial-${crypto.randomBytes(6).toString("hex")}`);
  fs.mkdirSync(tmp);

  try {
    extractArchive(packed, tmp);
    if (exists(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
  } catch (err) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* keep the original failure */
    }
    throw err;
  }

  try {
    fs.chmodSync(dest, 0o700);
  } catch {
    /* permissions are best-effort on some filesystems */
  }

  return { into: dest };
}

async function open({ file, into, password, force = false } = {}) {
  if (!file) throw new Error("file is required");
  if (!into) throw new Error("into is required");
  const secret = await resolvePassword({ password, label: "Password: " });
  return openSync({ file, into, password: secret, force });
}

module.exports = {
  seal,
  sealSync,
  open,
  openSync,
};
