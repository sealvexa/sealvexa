"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { staysInside } = require("./codec");
const { openSync } = require("./files");
const { resolvePassword } = require("./password");

const DEFAULT_STORE = "modules";
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const LOADABLE = /\.(js|cjs|mjs|json|node)$/;

function resolveStore({ root = PACKAGE_ROOT, store = DEFAULT_STORE } = {}) {
  return path.isAbsolute(store) ? path.resolve(store) : path.resolve(root, store);
}

function assertModuleName(name) {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("Module name must be a non-empty string");
  }
  if (path.isAbsolute(name) || path.win32.isAbsolute(name)) {
    throw new Error(`Module name must be relative: ${name}`);
  }
  const parts = name.split(/[\\/]/);
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Unsafe module name: ${name}`);
  }
}

function nameFromFile(file) {
  const base = path.basename(file);
  const ext = path.extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

function namesIn(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const names = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      names.push(entry.name);
    } else if (entry.isFile() && LOADABLE.test(entry.name)) {
      names.push(entry.name.replace(LOADABLE, ""));
    }
  }
  return [...new Set(names)].sort();
}

function listSync({ root, store, name } = {}) {
  const base = resolveStore({ root, store });
  if (!name) return namesIn(base);
  assertModuleName(name);
  return namesIn(path.join(base, name));
}

async function list(options) {
  return listSync(options);
}

function mountSync({ file, password, root, store, name, force = false } = {}) {
  if (!file) throw new Error("file is required");

  const libraryName = name || nameFromFile(file);
  assertModuleName(libraryName);

  const storeDir = resolveStore({ root, store });
  const installDir = path.join(storeDir, libraryName);
  openSync({ file, into: installDir, password, force });

  return {
    store: storeDir,
    name: libraryName,
    installDir,
    modules: listSync({ store: installDir }),
  };
}

async function mount({ file, password, root, store, name, force = false } = {}) {
  if (!file) throw new Error("file is required");
  const secret = await resolvePassword({ password, label: "Password: " });
  return mountSync({ file, password: secret, root, store, name, force });
}

function readModule(modulePath, { root, store, reload = false } = {}) {
  assertModuleName(modulePath);
  const base = resolveStore({ root, store });
  const requested = path.resolve(base, modulePath);

  if (!staysInside(base, requested)) {
    throw new Error(`Refusing to load a module outside the store: ${modulePath}`);
  }
  if (!fs.existsSync(base)) {
    throw new Error(`Store "${base}" does not exist. Mount a sealed library first.`);
  }

  let resolved;
  try {
    resolved = require.resolve(requested);
  } catch (err) {
    if (err.code === "MODULE_NOT_FOUND") {
      throw new Error(`Module "${modulePath}" was not found in "${base}"`);
    }
    throw err;
  }

  if (!staysInside(base, resolved) || resolved === base) {
    throw new Error(`Refusing to load a module resolved outside the store: ${modulePath}`);
  }

  if (reload) delete require.cache[resolved];
  return require(resolved);
}

function releaseModule(modulePath, { root, store } = {}) {
  assertModuleName(modulePath);
  const base = resolveStore({ root, store });
  let resolved;
  try {
    resolved = require.resolve(path.resolve(base, modulePath));
  } catch {
    return false;
  }
  if (!require.cache[resolved]) return false;
  delete require.cache[resolved];
  return true;
}

function loadSealedSync({ file, modulePath, name, password, root, store, force = false } = {}) {
  if (!modulePath) throw new Error("modulePath is required");
  const { installDir } = mountSync({ file, password, root, store, name, force });
  return readModule(modulePath, { store: installDir, reload: true });
}

async function loadSealed({ file, modulePath, name, password, root, store, force = false } = {}) {
  if (!modulePath) throw new Error("modulePath is required");
  const secret = await resolvePassword({ password, label: "Password: " });
  return loadSealedSync({
    file,
    modulePath,
    name,
    password: secret,
    root,
    store,
    force,
  });
}

module.exports = {
  DEFAULT_STORE,
  PACKAGE_ROOT,
  resolveStore,
  list,
  listSync,
  mount,
  mountSync,
  readModule,
  releaseModule,
  loadSealed,
  loadSealedSync,
};
