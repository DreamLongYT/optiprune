![Optiprune Logo](docs/public/logo.svg)
![NPM Version](https://img.shields.io/npm/v/optiprune)
![GitHub License](https://img.shields.io/github/license/DreamLongYT/optiprune)


# Optiprune

**Resilient static dead-code analyzer for TypeScript and JavaScript workspaces.**

---

**Optiprune** is a multi-layered static analyzer designed to prune unreachable files, dead exports, untangled monorepo imports, and unused dependencies with surgical precision. Built for cross-platform reliability (Windows/Linux) and fast CI pipelines.

## Key Features

* **Staged 6-Layer Engine:** From AST entry point resolution to SMT constraint solving, isolated V8 execution, and unused package sweeping.
* **Schema & Contract Preserver (Layer 5):** Introspects Zod schemas (`z.*`), Class declarations (`*Schema`), Prisma models, decorators, and OpenAPI resolvers to prevent false positives on public interfaces.
* **Cross-Platform Path Normalization:** Flawless resolution across Windows drive letters, backslashes, and POSIX path specs.
* **Circular Dependency Resilient:** Iterative worklist analysis using Strongly Connected Components (SCCs) to resolve cyclical import paths accurately.
* **Monorepo & Package Sweeper (Layer 6):** Identifies unused root and package-level `node_modules` dependencies alongside dead code.
* **VitePress Powered Docs:** Comprehensive architecture breakdown and guide available in the `/docs` suite.

---

## Architecture Overview

Optiprune runs code through a 6-stage analysis pipeline:

| Layer | Stage | Focus |
| :--- | :--- | :--- |
| **Layer 1** | Entry Point Graph | Static import/export dependency graph & entry point discovery |
| **Layer 2** | Monorepo & Workspaces | Cross-package references and boundary resolution |
| **Layer 3** | Dynamic Tracing & SMT | Path unreachability via Z3 constraint solving |
| **Layer 4** | Isolated V8 Execution | Candidate validation inside sandboxed `isolated-vm` Isolates |
| **Layer 5** | AST Contract & Schema | Preserves Zod/Schema classes, decorators, and API boundaries |
| **Layer 6** | Unused Package Sweeper | Flags unused external dependencies in `package.json` |

---

## Installation

Install Optiprune as a dev dependency via pnpm, npm, or yarn:

```bash
pnpm add -D optiprune
# or
npm install --save-dev optiprune
# or
yarn add -D optiprune