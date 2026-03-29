# Overlord CLI

`overlord-cli` is the packaged command-line interface for Overlord. It lets you launch agents on tickets, create new tickets, and manage the ticket lifecycle from the terminal.

Website: [ovld.ai](https://ovld.ai)

## Install

Install it globally so the `ovld` and `overlord` commands are available on your `PATH`:

```bash
npm install -g overlord-cli
```

## Usage

```bash
ovld help
overlord help
```

The CLI exposes the same command set under both names.
`ovld auth login` opens a browser when possible and also prints a verification URL/code so login can be completed from another machine over SSH.

Common commands:

```bash
ovld auth login
ovld attach
ovld create "Investigate the failing build"
ovld prompt "Draft a fix for the onboarding flow"
ovld setup codex
ovld setup cursor
ovld setup gemini
ovld setup all
ovld doctor
```

## Requirements

- Node.js 18 or newer
- Access to an Overlord instance when using authenticated commands

## Commands

- `attach` - search tickets and launch an agent interactively
- `create` - create a ticket from a short objective
- `prompt` - create a ticket and launch an agent on it
- `auth` - log in, log out, or check auth status
- `tickets` - list or create tickets
- `ticket` - work with a single ticket
- `protocol` - run ticket lifecycle commands
- `connect`, `restart`, `run`, `resume`, `context` - launch or resume an agent session
- `setup` - install the Overlord connector or plugin bundle for a supported agent
- `doctor` - verify installed agent connectors and check whether a newer CLI version is available

## Publishing

This package is published from the repository root with:

```bash
yarn cli:publish
```

That script syncs the package payload and then runs `npm publish --access public` from `packages/overlord-cli/`.
