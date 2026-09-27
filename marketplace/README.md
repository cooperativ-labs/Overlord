# Cooperativ Plugins

This repository is a Git-hosted plugin marketplace for the ChatGPT desktop app
and Codex. It currently offers the Scribe plugin.

Overlord is not distributed here. Its Codex plugin calls the `ovld` CLI, so
install it with `ovld agent-setup codex`, which also sets up the Codex
permission rules and workspace profile that a marketplace install would skip.

## Add the marketplace

In the ChatGPT desktop app, open **Plugins**, choose **Add Marketplace**, then
**Add from a repository** and enter:

```text
https://github.com/cooperativ-labs/overlord-marketplace
```

Restart the app, open the Plugins Directory, select **Cooperativ Plugins**, and
install Scribe. In Codex CLI, add the marketplace and install the plugin with:

```sh
codex plugin marketplace add cooperativ-labs/overlord-marketplace
codex plugin add scribe@cooperativ
```

## Add or update a plugin

Put a complete OpenAI-compatible plugin package in `plugins/<plugin-name>/`,
then add an entry to `.agents/plugins/marketplace.json` with a `./`-relative
source path, installation policy, authentication policy, and category. Each
package should include its manifest and all files it needs at runtime.

Current packages come from their owning projects:

- `plugins/scribe` is Scribe's packaged local MCP server and transcript skill,
  with an OpenAI/Codex plugin manifest. It reads the Scribe library on the
  user's computer.

Refresh each package from its source project when that project releases a new
version, then update the catalog in the same change. Do not include credentials,
owner keys, or meeting data.

## Automated sync and validation

Marketplace updates arrive as pull requests on `sync/<plugin-name>`. The owning
project builds its installable package and opens or refreshes that pull request;
the marketplace `Validate marketplace` workflow checks local catalog paths,
manifest references, package names, version increases, and obvious secret files
or values before merge.

Scribe sync is owned by the Scribe repository: that workflow needs to build its
package and keep the Codex manifest in the source repo before it can open the
same kind of marketplace pull request.

## Distribution scope

This GitHub marketplace is a repo source for local plugin installs in supported
ChatGPT desktop and Codex surfaces. It is separate from OpenAI's universal
public Plugins Directory. Publishing there requires submitting each plugin for
OpenAI review. Scribe's hosted ChatGPT web service and portable remote package
are tracked in Scribe mission `coo:1081`; do not describe the local Scribe
package as a hosted web integration.
