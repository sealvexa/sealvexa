#!/usr/bin/env node
"use strict";

const { parseArgs } = require("node:util");
const { seal, open, mount } = require("../lib/index");

const USAGE = `
sealvexa — seal a library directory, then open or mount it.

  sealvexa seal <directory> -o <file.sealvexa>
  sealvexa open <file.sealvexa> -o <directory> [--force]
  sealvexa mount <file.sealvexa> [--root <dir>] [--store <dir>] [--name <name>] [--force]

The password comes from SEALVEXA_PASSWORD, or from a hidden prompt.
It is not accepted as a flag.
`;

function failUsage() {
  process.stderr.write(USAGE);
  process.exit(1);
}

const commands = {
  async seal(rest) {
    const { values, positionals } = parseArgs({
      args: rest,
      options: { output: { type: "string", short: "o" } },
      allowPositionals: true,
    });
    const [from] = positionals;
    if (!from || !values.output) failUsage();
    const result = await seal({ from, to: values.output });
    console.log(`Sealed ${from} -> ${result.to} (${result.bytes} bytes)`);
  },

  async open(rest) {
    const { values, positionals } = parseArgs({
      args: rest,
      options: {
        output: { type: "string", short: "o" },
        force: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });
    const [file] = positionals;
    if (!file || !values.output) failUsage();
    const result = await open({ file, into: values.output, force: values.force });
    console.log(`Opened ${file} -> ${result.into}`);
  },

  async mount(rest) {
    const { values, positionals } = parseArgs({
      args: rest,
      options: {
        root: { type: "string" },
        store: { type: "string" },
        name: { type: "string" },
        force: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });
    const [file] = positionals;
    if (!file) failUsage();
    const result = await mount({
      file,
      root: values.root,
      store: values.store,
      name: values.name,
      force: values.force,
    });
    const found = result.modules.length ? result.modules.join(", ") : "(none)";
    console.log(`Mounted ${file} -> ${result.installDir} (${result.name})`);
    console.log(`Modules: ${found}`);
  },
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    process.exit(command ? 0 : 1);
  }
  const run = commands[command];
  if (!run) failUsage();
  await run(rest);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
