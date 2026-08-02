# Architecture Layers

Optiprune operates across 7 specialized layers to provide the most accurate dead-code analysis possible.

### Layer 1: Resilient Parser
Handles syntax errors gracefully via Parse-Recovery. It converts source code into an AST even when the code is partially broken.

### Layer 2: Control Flow Graph (CFG)
Analyzes internal logic and unreachable statements. It identifies code that can never run, such as code after a `return` or inside an `if (false)` block.

### Layer 3: Type-Flow & SMT Solver
Tracks data and types across variables and modules. It uses the **Z3 Solver** to prove constant conditions and logical contradictions.

### Layer 4: Graph Resolver & Proof Asserter
Builds the global dependency map of your project. It also uses **V8 Isolates** (`isolated-vm`) to surgically verify reachability for complex cases.

### Layer 5: Schema Alignment
Protects framework-specific code. It understands decorators for **NestJS, TypeORM, GraphQL**, and others, preventing false positives for externally called code.

### Layer 6: Dependency Auditor
Audits `package.json` and lockfiles against actual code usage. It identifies unused NPM packages and ensures your project's physical dependencies match your imports.

### Layer 7: Non-Standard Entry & Implicit Binding Engine
Handles implicit dependencies that are invisible to standard static analyzers. It contains three sub-engines:
- **DI Topology Engine**: Maps Dependency Injection tokens (NestJS, Inversify) to their providers.
- **Contract Engine**: Matches event producers to consumers across event buses (RabbitMQ, Kafka, tRPC).
- **Specifier Engine**: Resolves dynamic imports using template literals by bounded glob matching and SMT validation.
