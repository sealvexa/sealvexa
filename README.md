# sealvexa

Seal a folder of JavaScript into one password-protected `.sealvexa` file. Later, open that file, or mount it inside this package and `require` the modules.

Node's built-in `crypto` does the work. There are no runtime dependencies.

Anyone who has the file and the password can read the source. Use sealvexa to keep a library encrypted on disk or in an artifact store. It does not hide code from someone you have already given the password to.

## Install

```bash
npm install sealvexa
```

Node 18 or newer. The command is `sealvexa`. The same operations are available from JavaScript.

## Sample

This repository already has a library and a small app.

```text
library/ledger.js     the module you seal
sealvexa-sample/       seals it, then loads it
```

`library/ledger.js` exports `total(amounts)`. The sample password is a plain string:

```js
const password = "sample-password";
```

From `sealvexa-sample/`:

```bash
node index.js
```

That writes `ledger.sealvexa`, decrypts it into this package, and prints `40`.

The mounted file is:

```text
node_modules/sealvexa/modules/ledger/ledger.js
```

In this repo the package lives at `sealvexa/`, so the same path is `sealvexa/modules/ledger/ledger.js`.

`modulePath: "ledger"` is the file inside that folder. The folder name comes from the sealed file: `ledger.sealvexa` becomes `modules/ledger/`. Leave `root` unset and the files stay inside the sealvexa package. Pass `root: __dirname` when you want them next to your own app instead.

```js
const path = require("node:path");
const { sealSync, loadSealedSync } = require("sealvexa");

const password = "sample-password";

sealSync({
  from: path.join(__dirname, "..", "library"),
  to: path.join(__dirname, "ledger.sealvexa"),
  password,
});

const ledger = loadSealedSync({
  file: path.join(__dirname, "ledger.sealvexa"),
  modulePath: "ledger",
  password,
  force: true,
});

console.log(ledger.total([10, 25, 5]));
```

## Another password

Prefer not to put the password in source. Set `SEALVEXA_PASSWORD` and omit `password` on the call. The sample password and this one are only examples. Use your own.

```bash
export SEALVEXA_PASSWORD="open-sesame"
sealvexa seal ./library -o ledger.sealvexa
sealvexa mount ledger.sealvexa
```

`mount` decrypts into the package `modules/` folder and prints the module names it found. The CLI never accepts the password as a flag. If `SEALVEXA_PASSWORD` is unset, it asks on the terminal and does not echo what you type.

The same variable works from JavaScript:

```js
const { loadSealedSync } = require("sealvexa");

const ledger = loadSealedSync({
  file: "./ledger.sealvexa",
  modulePath: "ledger",
  force: true,
});

console.log(ledger.total([10, 25, 5]));
```

Password lookup order:

1. The `password` option, such as `"sample-password"`.
2. `SEALVEXA_PASSWORD`, such as `"open-sesame"`.
3. A hidden prompt, on the async functions and the CLI only.

`sealSync`, `openSync`, `mountSync`, and `loadSealedSync` do not prompt. Pass `password`, or set `SEALVEXA_PASSWORD`, before calling them.

## Seal and open

```js
const { sealSync, openSync } = require("sealvexa");

sealSync({
  from: "./library",
  to: "./ledger.sealvexa",
  password: "sample-password",
});

openSync({
  file: "./ledger.sealvexa",
  into: "./restored",
  password: "sample-password",
});
```

`seal` returns `{ to, bytes }`. `open` returns `{ into }`.

`from` is the directory to pack. `to` is the `.sealvexa` file to write. `file` is that sealed file. `into` is the folder to restore. `force: true` replaces `into` when it already contains files. Without `force`, a non-empty destination throws and is left as it was.

A wrong password, a truncated file, or a file edited after sealing all throw. Extraction writes a temporary directory first and moves it into place only after every file succeeds.

Empty directories and symlinks are not stored. Regular files keep their permission bits.

`scrypt` overrides the key cost: `{ N, r, p }`. The default is `{ N: 16384, r: 8, p: 1 }`. `N` must be a power of two from 1024 through 1048576. `r` is 1–32. `p` is 1–16.

## Mount and load

Each sealed file gets its own folder, so a second library does not overwrite the first.

```text
modules/
  ledger/
    ledger.js
  billing/
    quote.js
```

```js
const { mountSync, readModule } = require("sealvexa");

const mounted = mountSync({
  file: "./ledger.sealvexa",
  password: "sample-password",
  force: true,
});

const ledger = readModule("ledger/ledger");
console.log(ledger.total([10, 25, 5]));
console.log(mounted.modules);
```

`mount` returns `{ store, name, installDir, modules }`.

| Field | Default | Meaning |
| --- | --- | --- |
| `file` | | The `.sealvexa` file |
| `password` | `SEALVEXA_PASSWORD`, then a prompt | |
| `root` | This package | Directory that contains the store |
| `store` | `"modules"` | Folder name, or an absolute path |
| `name` | File name without its extension | Subfolder inside the store |
| `force` | `false` | Replace that subfolder when it already has files |

`readModule(modulePath)` loads one file from the store and returns its exports. `"ledger/ledger"` is `modules/ledger/ledger.js`. The `.js` extension is optional. Absolute paths and any `..` segment are rejected. `reload: true` drops the require cache and runs the file again.

`loadSealed` is `mount` followed by `readModule`. Its `modulePath` is relative to the installed library, so `"ledger"` means the `ledger.js` inside `modules/ledger/`, not `modules/ledger` itself.

`listSync()` returns the library names in the store. `listSync({ name: "ledger" })` returns the entries inside that library: directories, plus `.js`, `.cjs`, `.mjs`, `.json`, and `.node` files with the extension removed. A missing directory returns `[]`.

`releaseModule("ledger/ledger")` removes one module from the require cache. It returns `true` when an entry was removed. The files on disk stay. Mount again with `force: true` to replace them.

`readModule` and `loadSealed` call `require`. The module runs in your process. Load libraries you sealed yourself. There is no `postinstall` script. Nothing is decrypted unless your code asks for it.

## File format

A `.sealvexa` file is a gzip archive encrypted with AES-256-GCM. The key comes from scrypt. The header stores the scrypt cost, a random salt, a random IV, and the authentication tag. The password is not in the file. Sealing the same directory twice produces different ciphertext.

Every extracted path has to stay inside the destination directory.

## Tests

```bash
npm test
```

## Author

James Loop ([jamesloop115](https://github.com/jamesloop115)) — [jamesloop115@proton.me](mailto:jamesloop115@proton.me)

Source: [github.com/sealvexa/sealvexa](https://github.com/sealvexa/sealvexa)

## License

MIT. Copyright (c) 2019 James Loop. See [LICENSE](LICENSE).
