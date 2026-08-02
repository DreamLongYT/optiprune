# OptiPrune Plugin Guide: Plugin Adapter Architecture

OptiPrune uses a formal **Plugin Adapter** architecture. Plugins interact with the core analyzer through a secure, abstracted bridge that provides reading, writing, and control abilities.

## The Plugin Structure

A plugin implements the `AnalyzerPlugin` interface, which uses lifecycle hooks to interact with the analysis process.

```typescript
import { AnalyzerPlugin, PluginAdapter } from './types';
import * as t from '@babel/types';

export const MyPlugin: AnalyzerPlugin = {
  name: "my-plugin",
  version: "1.0.0",
  // Optional: Only enable if a specific condition is met
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    return pkg?.dependencies?.['my-framework'] !== undefined;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      console.log("Analysis starting for:", adapter.getConfig().rootDir);
    },
    onASTNode: (node, fileId, adapter) => {
      if (t.isFunctionDeclaration(node) && node.id?.name.startsWith('handle')) {
        adapter.markAsUsed(fileId, node.id.name);
      }
    }
  }
};
```

## The Plugin Adapter API

The `PluginAdapter` provides the following abilities:

### 1. Reading Abilities (Inspect Context)
- `getAst(fileId)`: Get the full AST of a file.
- `getSymbol(name, fileId)`: Look up an export symbol.
- `getType(node)`: Get the inferred type of a node.
- `getDependencies(fileId)`: Get a list of files imported by this file.
- `getConfig()`: Access the current analysis configuration.
- `readFile(filename)`: Read a file's content from the project root.
- `readJson(filename)`: Read and parse a JSON file.

### 2. Writing Abilities (Instruct Core)
- `emitFinding(finding)`: Report a new issue (warning/error).
- `markAsUsed(fileId, symbol?)`: Tell the core that a file or specific export is reachable.
- `attachMetadata(node, key, value)`: Attach custom data to an AST node for later passes.

### 3. Lifecycle Hooks
- `onProjectInit`: Called once before any files are processed.
- `onFileStart`: Called before processing a specific file.
- `onASTNode`: Called for every node during AST traversal (Synchronous).
- `onAnalysisComplete`: Called after all files and layers have finished.

## Framework Support

OptiPrune comes with built-in plugins for popular frameworks:
- **React**: Automatically handles components and hooks.
- **Next.js**: Recognizes conventional entry points (`page.tsx`, `route.ts`) and data fetching methods.
- **Nuxt**: Handles directory-based routing and auto-import conventions.

## Best Practices
- **Synchronous AST Access**: `onASTNode` must be synchronous to ensure high-performance traversal.
- **Immutability**: Never mutate AST nodes directly. Use `attachMetadata` to store additional context.
- **Resource Safety**: The adapter enforces boundaries to ensure plugins don't freeze the main analysis.
