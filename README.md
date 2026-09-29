# DSH Preset Library

Search, tag and organize a large DeepSeek Harness preset collection without rewriting the presets themselves.

Features include compact grid/list/grouped views, bulk tags, status filters, and one-level parent/child affiliations. Metadata is versioned, validated and saved atomically with revision conflict checks. The interface supports English and Chinese.

## Install

Requires **Node.js 24**, npm and a working **DSH 0.1.7-rc.2** Web profile.

```sh
git clone https://github.com/LiweiDonVee/dsh-preset-library.git
cd dsh-preset-library
npm ci
npm run check
npx --yes @deepseek-ai/dsh@0.1.7-rc.2 plugin --profile web add .
npx --yes @deepseek-ai/dsh@0.1.7-rc.2 web
```

Keep the clone in place if the package manager installs it as a local link. Restart the host after installation and use its printed login URL. Open **Settings → Preset Library**.

The metadata file is `$DSH_HOME/preset-library.json`, defaulting to `~/.dsh/preset-library.json`. Back up this file before bulk changes. Preset declarations are read-only in this plugin. The new-task default uses DSH's volatile `selectedDefault` setting, and bundle inventory uses DSH's plugin manager APIs.

Remove with:

```sh
npx --yes @deepseek-ai/dsh@0.1.7-rc.2 plugin --profile web remove dsh-preset-library
```

Restart DSH afterward. Uninstall does not erase tag metadata.

## Development and limits

`npm run check` runs deterministic regression tests and rebuilds the host/client bundles. The plugin uses `agentPresets.list`, volatile default selection through `settings.update('agent-preset-registry', { selectedDefault })`, `pluginManager.listBundles`/`setBundleEnabled`, and `pluginInventory.list`. CI tests Windows and Linux.

The metadata API deliberately accepts only loopback requests, even if the host itself is exposed remotely. Relationships support one parent level. This preview plugin depends on DSH's evolving Remote/slot contracts.

Original community implementation; no affiliation with DeepSeek AI. MIT license; see [LICENSE](LICENSE). Icons and React are imported from the host, not copied into this package.
