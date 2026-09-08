# DSH Preset Library

Search, tag and organize a large DeepSeek Harness preset collection without rewriting the presets themselves.

Features include compact grid/list/grouped views, bulk tags, status filters, and one-level parent/child affiliations. Metadata is versioned, validated and saved atomically with revision conflict checks. The interface supports English and Chinese.

## Install

Requires **Node.js 24**, npm and a working **DSH 0.1.2-rc.1** Web profile. Later DSH versions are not certified.

```sh
git clone https://github.com/LiweiDonVee/dsh-preset-library.git
cd dsh-preset-library
npm ci
npm run check
npx --yes @deepseek-ai/dsh@0.1.2-rc.1 plugin --profile web add .
npx --yes @deepseek-ai/dsh@0.1.2-rc.1 web
```

Keep the clone in place if the package manager installs it as a local link. Restart the host after installation and use its printed login URL. Open **Settings → Preset Library**.

The metadata file is `$DSH_HOME/preset-library.json`, defaulting to `~/.dsh/preset-library.json`. Back up this file before bulk changes. Preset copy/delete actions use official DSH Remote APIs; deleting a preset is distinct from removing its tags.

Remove with:

```sh
npx --yes @deepseek-ai/dsh@0.1.2-rc.1 plugin --profile web remove dsh-preset-library
```

Restart DSH afterward. Uninstall does not erase tag metadata.

## Development and limits

`npm run check` runs 57 deterministic regression tests and rebuilds the host/client bundles. The local rc.1 integration also exercised authenticated HTTP and the real settings page. CI tests Windows and Linux; the Actions result is the current platform evidence.

The metadata API deliberately accepts only loopback requests, even if the host itself is exposed remotely. Relationships support one parent level. This preview plugin depends on DSH's evolving Remote/slot contracts.

Original community implementation; no affiliation with DeepSeek AI. MIT license; see [LICENSE](LICENSE). Icons and React are imported from the host, not copied into this package.
