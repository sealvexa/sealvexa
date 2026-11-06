"use strict";

const ENV_NAME = "SEALVEXA_PASSWORD";

function promptHidden(label) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY) {
      reject(new Error(
        `No password was given and stdin is not a terminal. Set ${ENV_NAME} or pass { password }.`,
      ));
      return;
    }

    const chars = [];
    let settled = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      input.removeListener("data", onData);
      if (input.setRawMode) input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
      if (err) reject(err);
      else resolve(value);
    };

    const onData = (chunk) => {
      for (const ch of chunk.toString("utf8")) {
        if (ch === "\n" || ch === "\r" || ch === "\u0004") {
          finish(null, chars.join(""));
          return;
        }
        if (ch === "\u0003") {
          finish(new Error("Password entry cancelled"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          chars.pop();
          continue;
        }
        chars.push(ch);
      }
    };

    process.stdout.write(label);
    if (input.setRawMode) input.setRawMode(true);
    input.setEncoding("utf8");
    input.resume();
    input.on("data", onData);
  });
}

async function resolvePassword({ password, label = "Password: " } = {}) {
  if (password) return password;
  if (process.env[ENV_NAME]) return process.env[ENV_NAME];
  return promptHidden(label);
}

function resolvePasswordSync({ password } = {}) {
  if (password) return password;
  if (process.env[ENV_NAME]) return process.env[ENV_NAME];
  throw new Error(
    `No password was given. Pass { password } or set ${ENV_NAME}. ` +
      "The hidden prompt is only available on the async functions.",
  );
}

module.exports = {
  ENV_NAME,
  resolvePassword,
  resolvePasswordSync,
};
