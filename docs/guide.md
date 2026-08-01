# Getting Started

Optiprune is a next-generation dead-code analyzer. Unlike traditional scanners, it uses a 6-layer architecture to understand your code's logic and framework context.

## Installation

```bash
npm install -g optiprune
```

## Usage

Run it in your project root:

```bash
optiprune --rootDir . --entry src/index.ts
```

## Why Optiprune?

1. **Precision**: Uses Z3 Solver for formal logic.
2. **Resilience**: Doesn't crash on syntax errors.
3. **Intelligence**: Understands framework decorators (NestJS, TypeORM).
