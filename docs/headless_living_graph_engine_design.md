# Design for Headless Living Graph Engine Integration into OptiPrune

## 1. Introduction

This document outlines the architectural design for integrating a "Headless Living Graph Engine" into the existing OptiPrune code analyzer. The concept, inspired by discussions with Gemini, aims to enhance OptiPrune's accuracy and performance by moving from a file-scanning approach to a persistent, in-memory semantic graph representation of the codebase. This will enable real-time, mathematically accurate dead-code detection and advanced symbolic execution for dynamic code patterns.

## 2. Current OptiPrune Architecture Overview

OptiPrune currently operates through a layered architecture, as described in its `architecture.md` [1]:

| Layer | Description |
| :---- | :---------- |
| **Layer 1: Resilient Parser** | Converts source code into an Abstract Syntax Tree (AST), handling syntax errors gracefully. |
| **Layer 2: Control Flow Graph (CFG)** | Analyzes internal logic and identifies unreachable statements within a single module. |
| **Layer 3: Type-Flow & SMT Solver** | Tracks data and types, using the Z3 Solver to prove constant conditions and logical contradictions. |
| **Layer 4: Graph Resolver & Proof Asserter** | Builds a global dependency map and uses V8 Isolates (QuickJS Wasm sandbox) to verify reachability for complex cases. |
| **Layer 5: Schema Alignment** | Protects framework-specific code by understanding decorators and JSDoc markers. |
| **Layer 6: Dependency Auditor** | Audits `package.json` and lockfiles against actual code usage. |

The core graph building logic resides in `src/graph.ts`, which constructs a dependency graph (`ModuleRecord`s and `DependencyEdge`s) on each analysis run. `src/parser.ts` is responsible for AST generation and initial edge/export extraction. `src/index.ts` orchestrates these layers and manages a file-hash-based cache for `ModuleRecord`s.

## 3. Headless Living Graph Engine Concept

The proposed engine, as discussed, introduces three key paradigms:

1.  **The Headless Living Image**: A persistent, in-memory semantic graph where every code entity (function, class, variable) is represented as a content-addressed, cryptographic node. These nodes maintain live, bi-directional pointers to their observers and invocations, allowing for reactive topology updates.
2.  **Symbolic Execution Units**: Instead of giving up on dynamic code, the analyzer assigns a "Symbolic Execution Contract" to dynamic nodes. It evaluates all possible algebraic states of dynamic expressions through Abstract Interpretation, achieving 100% path coverage without false positives.
3.  **Persistent Incremental Graph Updates**: To maintain speed, the graph is updated incrementally. Only affected nodes and their live observers re-verify their structural contracts, propagating changes in O(Diff) time. The graph acts as a tiny, hyper-efficient database daemon.

## 4. Architectural Design for Integration

### 4.1. Core Graph Representation (`src/graph.ts` and new files)

**Current State**: `ModuleRecord`s are the primary nodes, with `DependencyEdge`s representing connections. The graph is rebuilt or partially updated based on file hashes.

**Proposed Changes**:

*   **Content-Addressed Nodes**: Introduce a new `SemanticNode` interface. Each `SemanticNode` will have a unique, content-derived hash (e.g., SHA-256 of its canonical representation) as its identifier. This hash will represent the *identity* of the code entity, independent of its file path or name. This will require changes in `src/parser.ts` to generate these hashes during AST traversal.
*   **Node Types**: Extend `SemanticNode` to represent various code entities: `FileNode`, `FunctionNode`, `ClassNode`, `VariableNode`, `ExportNode`, `ImportNode`, etc. Each node will store its relevant metadata (e.g., AST reference, type information, location).
*   **Bi-Directional Edges**: Instead of simple `DependencyEdge`s, implement explicit `Reference` objects that connect `SemanticNode`s. Each `Reference` will have a `source` and `target` `SemanticNode` and a `kind` (e.g., `CALLS`, `IMPORTS`, `EXPORTS`, `DEFINES`). Crucially, each `SemanticNode` will maintain two lists: `incomingReferences` and `outgoingReferences`.
*   **Persistent Graph Store**: Replace the `Map<string, ModuleRecord>` in `AnalysisContext` with a `Map<string, SemanticNode>` (where the key is the content-addressed hash). This map will be the persistent, in-memory representation of the codebase. The `cache.ts` mechanism will need to be adapted to store and retrieve these `SemanticNode`s and their relationships.
*   **Reactive Topology Manager**: Introduce a new component, `TopologyManager`, responsible for listening to changes in `SemanticNode`s and their `Reference`s. When a node's content hash changes (indicating a code modification) or a `Reference` is added/removed, the `TopologyManager` will trigger re-evaluation of affected nodes and their dependents. This will be the foundation for O(1) dead code detection.

### 4.2. Enhanced Parser and Ingestion (`src/parser.ts`)

**Current State**: `extractAstModule` parses AST and populates `exports` and `edges` for a `ModuleRecord`.

**Proposed Changes**:

*   **Semantic Node Generation**: Modify `extractAstModule` to traverse the AST and generate `SemanticNode`s for each significant code entity (functions, classes, variables, imports, exports). During this process, compute the content-addressed hash for each node.
*   **Reference Creation**: Instead of `DependencyEdge`s, create `Reference` objects between `SemanticNode`s. For example, an `ImportDeclaration` would create an `IMPORTS` reference from the `FileNode` to the `ExportNode` of the imported module.
*   **Dynamic Code Identification**: Strengthen the identification of dynamic imports (`dynamic-pattern`, `unknown-dynamic`) and other dynamic code constructs. These will be marked with a special `DynamicNode` type or a flag, indicating the need for Symbolic Execution Units.

### 4.3. Symbolic Execution Units (`src/layer3.ts`, `src/layer4.ts`, and new files)

**Current State**: `layer3.ts` uses Z3 for SMT solving on conditional branches, and `layer4.ts` uses a QuickJS Wasm sandbox for concolic verification of candidate branches.

**Proposed Changes**:

*   **Symbolic Execution Contracts**: When `parser.ts` identifies a `DynamicNode` or a code path involving dynamic behavior, a `SymbolicExecutionContract` will be generated and attached to the relevant `SemanticNode`. This contract will define the inputs and expected outputs/behaviors of the dynamic part.
*   **Abstract Interpretation Engine**: Develop a more robust Abstract Interpretation engine, potentially extending the capabilities of `layer3.ts` and `layer4.ts`. This engine will take a `SymbolicExecutionContract` and systematically explore the possible states and outcomes of the dynamic code without full execution.
*   **Integration with Z3/QuickJS**: The existing Z3 solver and QuickJS sandbox can be leveraged as tools within the Abstract Interpretation engine to prove or disprove path reachability for specific symbolic states. The `seedInput` generation in `layer3.ts` would become more sophisticated, driven by the symbolic states.
*   **State Space Exploration**: The engine will maintain a symbolic state for variables and expressions, propagating constraints and evaluating expressions symbolically. This will allow it to determine all possible algebraic states of dynamic variables (e.g., `config.mode` in the Gemini example) and link to all potential targets.

### 4.4. Incremental Updates and Reactive Analysis (`src/index.ts`, `src/cache.ts`, and new files)

**Current State**: `index.ts` rebuilds `ModuleRecord`s if file hashes change. The graph is then built from these records.

**Proposed Changes**:

*   **File Watcher**: Implement a file watcher (e.g., using `chokidar`) to monitor changes in the codebase. This will trigger incremental updates.
*   **Diff-Based Propagation**: When a file changes, `parser.ts` will re-parse only that file and generate new `SemanticNode`s and `Reference`s. The `TopologyManager` will then compare the new nodes/references with the existing ones in the persistent graph.
*   **Minimal Re-evaluation**: If a `SemanticNode`'s content hash changes, the `TopologyManager` will identify all `SemanticNode`s that have `incomingReferences` from the changed node. Only these directly affected nodes and their transitive dependents will be marked for re-analysis. This ensures O(Diff) propagation.
*   **Persistent Cache for Graph**: The `cache.ts` will be extended to store the entire `SemanticNode` graph, not just `ModuleRecord`s. This allows for fast loading of the graph on startup and persistence across sessions.
*   **Background Daemon**: The entire analyzer will run as a background process, continuously maintaining the live graph and providing real-time feedback.

### 4.5. Integration with Existing Layers

*   **Layer 1 (Parser)**: Will be heavily modified to produce `SemanticNode`s and `Reference`s instead of `ModuleRecord`s and `DependencyEdge`s.
*   **Layer 2 (CFG)**: Will operate on the `SemanticNode`s within a `FileNode` to perform intra-file analysis.
*   **Layer 3 (SMT Solver)** and **Layer 4 (Proof Asserter)**: Will be integrated into the Symbolic Execution Units, providing the underlying mechanisms for proving path reachability for symbolic states.
*   **Layer 5 (Schema Alignment)**: Will identify and mark `ExportNode`s as `isExternalContract` within the `SemanticNode` graph.
*   **Layer 6 (Dependency Auditor)**: Will query the `SemanticNode` graph for package dependencies and compare them against lockfiles.

## 5. Data Structures (Illustrative)

```typescript
// New SemanticNode interface
interface SemanticNode {
  id: string; // Content-addressed cryptographic hash
  type: 'File' | 'Function' | 'Class' | 'Variable' | 'Export' | 'Import' | 'Dynamic';
  name?: string;
  location?: Range;
  metadata: Record<string, any>; // e.g., AST reference, type info, isExternalContract
  incomingReferences: Reference[];
  outgoingReferences: Reference[];
}

// New Reference interface
interface Reference {
  sourceNodeId: string;
  targetNodeId: string;
  kind: 'CALLS' | 'IMPORTS' | 'EXPORTS' | 'DEFINES' | 'USES' | 'TYPE_DEPENDENCY';
  metadata?: Record<string, any>; // e.g., importedNames, isTypeOnly
}

// Symbolic Execution Contract
interface SymbolicExecutionContract {
  nodeId: string; // ID of the DynamicNode
  inputs: { [key: string]: 'symbolic' | any }; // Symbolic or concrete inputs
  constraints: any[]; // Z3-compatible constraints
  expectedOutcomes: any[];
}

// Updated AnalysisContext
interface AnalysisContext {
  options: ResolvedOptions;
  semanticGraph: Map<string, SemanticNode>; // The core persistent graph
  entryPoints: Set<string>;
  // ... other context properties
  symbolicContracts: Map<string, SymbolicExecutionContract>;
}
```

## 6. Workflow Changes

1.  **Initialization**: On startup, load the persistent `semanticGraph` from cache. If no cache exists or it's invalid, perform an initial full ingestion.
2.  **File Change Detection**: File watcher detects changes. Only changed files are re-parsed by the modified `parser.ts`.
3.  **Incremental Graph Update**: The `TopologyManager` updates the `semanticGraph` with new/modified `SemanticNode`s and `Reference`s. It identifies affected nodes.
4.  **Reactive Analysis**: Only the affected parts of the graph are re-analyzed by the relevant layers. For example, if a function's body changes, only that `FunctionNode` and its direct callers/callees are re-evaluated for reachability and potential dead code.
5.  **Symbolic Execution**: When dynamic code is encountered, `SymbolicExecutionContract`s are generated and passed to the Abstract Interpretation Engine. The engine explores states and updates the graph with resolved dynamic links.
6.  **Real-time Feedback**: Findings are generated and updated in real-time as the graph changes, providing instant feedback to the developer.

## 7. Conclusion

This architectural design proposes a fundamental shift in OptiPrune's approach to code analysis, moving towards a dynamic, semantic understanding of the codebase. By implementing a Headless Living Graph Engine with content-addressed nodes, bi-directional references, symbolic execution units, and incremental updates, OptiPrune can achieve significantly higher accuracy, real-time performance, and a more robust detection of dead code and contract violations.

## References

[1] [architecture.md](file:///home/ubuntu/optiprune/docs/architecture.md) "Architecture Layers"
