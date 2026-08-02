![Optiprune Logo](docs/public/logo.svg)
![NPM Version](https://img.shields.io/npm/v/optiprune)
![GitHub License](https://img.shields.io/github/license/DreamLongYT/optiprune)


# Optiprune

**Resilient static dead-code analyzer for TypeScript and JavaScript workspaces.**

---

**Optiprune** is a multi-layered static analyzer designed to prune unreachable files, dead exports, untangled monorepo imports, and unused dependencies with surgical precision. Built for cross-platform reliability (Windows/Linux) and fast CI pipelines.

## Key Features

* **Staged 7-Layer Engine:** From AST entry point resolution to SMT constraint solving, isolated V8 execution, implicit binding analysis, and unused package sweeping.
* **Schema & Contract Preserver (Layer 5):** Introspects Zod schemas (`z.*`), Class declarations (`*Schema`), Prisma models, decorators, and OpenAPI resolvers to prevent false positives on public interfaces.
* **Cross-Platform Path Normalization:** Flawless resolution across Windows drive letters, backslashes, and POSIX path specs.
* **Circular Dependency Resilient:** Iterative worklist analysis using Strongly Connected Components (SCCs) to resolve cyclical import paths accurately.
* **Monorepo & Package Sweeper (Layer 6):** Identifies unused root and package-level `node_modules` dependencies alongside dead code.
* **Non-Standard Entry & Implicit Binding (Layer 7):** Maps DI topologies (NestJS/Inversify), event-driven contracts, and resolves dynamic import patterns.

---

## Architecture Overview

Optiprune runs code through a 7-stage analysis pipeline:

| Layer | Stage | Focus |
| :--- | :--- | :--- |
| **Layer 1** | Entry Point Graph | Static import/export dependency graph & entry point discovery |
| **Layer 2** | Monorepo & Workspaces | Cross-package references and boundary resolution |
| **Layer 3** | Dynamic Tracing & SMT | Path unreachability via Z3 constraint solving |
| **Layer 4** | Isolated V8 Execution | Candidate validation inside sandboxed `isolated-vm` Isolates |
| **Layer 5** | AST Contract & Schema | Preserves Zod/Schema classes, decorators, and API boundaries |
| **Layer 6** | Unused Package Sweeper | Flags unused external dependencies in `package.json` |
| **Layer 7** | Non-Standard Entry | Implicit bindings (DI/Events) and Dynamic Specifier resolution |

---

## Installation

Install Optiprune as a dev dependency via pnpm, npm, or yarn:

```bash
pnpm add -D optiprune
# or
npm install --save-dev optiprune
# or
yarn add -D optiprune

---

## Usage

Run Optiprune from your project root:

```bash
npx optiprune
```

### CLI Options

| Flag | Description | Default |
| :--- | :--- | :--- |
| `-r, --rootDir` | Project root directory | `process.cwd()` |
| `-e, --entry` | Entry point patterns (glob) | `[]` |
| `-i, --ignore` | Patterns to ignore | `[]` |
| `--no-report-unused-exports` | Disable unused export reporting | `false` |
| `--fail-on` | Fail on confidence (high/medium/low/none) | `high` |
| `--json` | Output as JSON | `false` |
| `--sarif` | Output as SARIF | `false` |
| `--skip-3` | Skip Layer 3 (SMT Constraint Solver) | `false` |
| `--skip-4` | Skip Layer 4 (Concolic Execution Proofs) | `false` |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and development guides.
