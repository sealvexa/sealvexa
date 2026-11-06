"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const CONTAINER_MAGIC = "SVX1";
const ARCHIVE_MAGIC = "SVA1";
const VERSION = 1;
const KDF_SCRYPT = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

const DEFAULT_SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1 });

function reader(buffer, label) {
  let at = 0;
  const take = (size, what) => {
    if (buffer.length - at < size) {
      throw new Error(`Truncated ${label}: missing ${what}`);
    }
    const start = at;
    at += size;
    return buffer.subarray(start, at);
  };
  return {
    ascii(size, what) {
      return take(size, what).toString("ascii");
    },
    utf8(size, what) {
      return take(size, what).toString("utf8");
    },
    u8(what) {
      return take(1, what).readUInt8(0);
    },
    u16(what) {
      return take(2, what).readUInt16LE(0);
    },
    u32(what) {
      return take(4, what).readUInt32LE(0);
    },
    slice(size, what) {
      return take(size, what);
    },
    rest() {
      return buffer.subarray(at);
    },
  };
}

function assertCost(cost) {
  const { N, r, p } = cost;
  const powerOfTwo = Number.isInteger(N) && N >= 1024 && N <= 1048576 && (N & (N - 1)) === 0;
  if (!powerOfTwo) {
    throw new Error("scrypt N must be a power of two from 1024 through 1048576");
  }
  if (!Number.isInteger(r) || r < 1 || r > 32) {
    throw new Error("scrypt r must be an integer from 1 through 32");
  }
  if (!Number.isInteger(p) || p < 1 || p > 16) {
    throw new Error("scrypt p must be an integer from 1 through 16");
  }
}

function mergeCost(override) {
  const cost = { ...DEFAULT_SCRYPT, ...override };
  assertCost(cost);
  return cost;
}

function deriveKey(password, salt, cost) {
  return crypto.scryptSync(password, salt, KEY_LEN, {
    N: cost.N,
    r: cost.r,
    p: cost.p,
    maxmem: 256 * cost.N * cost.r,
  });
}

function encryptBytes(plaintext, password, scryptCost) {
  const cost = mergeCost(scryptCost);
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(password, salt, cost);
  try {
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const header = Buffer.alloc(19);
    let at = 0;
    header.write(CONTAINER_MAGIC, at, "ascii");
    at += 4;
    header.writeUInt8(VERSION, at);
    at += 1;
    header.writeUInt8(KDF_SCRYPT, at);
    at += 1;
    header.writeUInt32LE(cost.N, at);
    at += 4;
    header.writeUInt32LE(cost.r, at);
    at += 4;
    header.writeUInt32LE(cost.p, at);
    at += 4;
    header.writeUInt8(SALT_LEN, at);

    return Buffer.concat([header, salt, iv, tag, ciphertext]);
  } finally {
    key.fill(0);
  }
}

function decryptBytes(container, password) {
  if (!Buffer.isBuffer(container) || container.length < 19 + SALT_LEN + IV_LEN + TAG_LEN) {
    throw new Error("Not a sealvexa file");
  }

  const src = reader(container, "container");
  const magic = src.ascii(4, "magic");
  if (magic !== CONTAINER_MAGIC) {
    throw new Error("Not a sealvexa file");
  }

  const version = src.u8("version");
  if (version !== VERSION) {
    throw new Error(`Unsupported vault version: ${version}`);
  }

  const kdf = src.u8("kdf");
  if (kdf !== KDF_SCRYPT) {
    throw new Error(`Unsupported key derivation: ${kdf}`);
  }

  const cost = { N: src.u32("N"), r: src.u32("r"), p: src.u32("p") };
  assertCost(cost);

  const saltLen = src.u8("salt length");
  if (saltLen < 8 || saltLen > 64) {
    throw new Error("Invalid salt length");
  }

  const salt = src.slice(saltLen, "salt");
  const iv = src.slice(IV_LEN, "iv");
  const tag = src.slice(TAG_LEN, "auth tag");
  const ciphertext = src.rest();
  const key = deriveKey(password, salt, cost);

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } finally {
    key.fill(0);
  }
}

function staysInside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function assertArchivePath(relPath) {
  if (typeof relPath !== "string" || relPath.length === 0 || relPath.includes("\0")) {
    throw new Error("Archive entry has an invalid path");
  }
  if (path.isAbsolute(relPath) || path.win32.isAbsolute(relPath)) {
    throw new Error(`Unsafe archive path: ${relPath}`);
  }
  const parts = relPath.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Unsafe archive path: ${relPath}`);
  }
}

function collectFiles(sourceDir) {
  const root = path.resolve(sourceDir);
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }

  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(root, full).split(path.sep).join("/");
      files.push({
        rel,
        data: fs.readFileSync(full),
        mode: fs.statSync(full).mode & 0o777,
      });
    }
  };

  walk(root);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return files;
}

function packDirectory(sourceDir) {
  const files = collectFiles(sourceDir);
  const chunks = [];
  const header = Buffer.alloc(9);
  header.write(ARCHIVE_MAGIC, 0, "ascii");
  header.writeUInt8(VERSION, 4);
  header.writeUInt32LE(files.length, 5);
  chunks.push(header);

  for (const file of files) {
    const pathBytes = Buffer.from(file.rel, "utf8");
    if (pathBytes.length > 0xffff) {
      throw new Error(`Path is too long to archive: ${file.rel}`);
    }
    if (file.data.length > 0xffffffff) {
      throw new Error(`File is too large to archive: ${file.rel}`);
    }
    const entry = Buffer.alloc(2 + pathBytes.length + 2 + 4);
    let at = 0;
    entry.writeUInt16LE(pathBytes.length, at);
    at += 2;
    pathBytes.copy(entry, at);
    at += pathBytes.length;
    entry.writeUInt16LE(file.mode, at);
    at += 2;
    entry.writeUInt32LE(file.data.length, at);
    chunks.push(entry, file.data);
  }

  return Buffer.concat(chunks);
}

function extractArchive(archive, outDir) {
  if (!Buffer.isBuffer(archive) || archive.length < 9) {
    throw new Error("Invalid archive");
  }

  const src = reader(archive, "archive");
  const magic = src.ascii(4, "magic");
  if (magic !== ARCHIVE_MAGIC) {
    throw new Error("Invalid archive");
  }

  const version = src.u8("version");
  if (version !== VERSION) {
    throw new Error(`Unsupported archive version: ${version}`);
  }

  const count = src.u32("file count");
  const root = path.resolve(outDir);

  for (let i = 0; i < count; i += 1) {
    const pathLen = src.u16("path length");
    const relPath = src.utf8(pathLen, "path");
    assertArchivePath(relPath);
    const mode = src.u16("mode");
    const size = src.u32("size");
    const data = src.slice(size, "file contents");
    const target = path.resolve(root, relPath);
    if (!staysInside(root, target) || target === root) {
      throw new Error(`Refusing to write outside the destination: ${relPath}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data, { mode: mode || 0o644 });
  }
}

module.exports = {
  DEFAULT_SCRYPT,
  encryptBytes,
  decryptBytes,
  packDirectory,
  extractArchive,
  staysInside,
};
