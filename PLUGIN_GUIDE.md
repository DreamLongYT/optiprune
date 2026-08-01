# OptiPrune Plugin Guide: Instruction-based Analysis

OptiPrune uses a **lightweight instruction-based plugin system**. Unlike other tools that require complex dependency graph manipulation, OptiPrune plugins provide simple "instructions" to the core engine.

## What is an Instruction?

An instruction is a simple rule that tells the engine: *"If you see this specific pattern in the code, mark these exports as used."*

This is much more efficient than full static analysis for framework-specific patterns (like Zod, NestJS, or Prisma).

## Creating a Plugin

A plugin consists of a name and a list of instructions.

```typescript
import { AnalyzerPlugin, PluginInstruction, AnalysisContext, ModuleRecord } from './types';
import * as t from '@babel/types';

export const MyFrameworkPlugin: AnalyzerPlugin = {
  name: "my-framework",
  instructions: [
    {
      name: "detect-custom-decorator",
      description: "Marks classes with @CustomDecorator as used.",
      identifyUsage(node, module, context) {
        const used = [];
        
        // Check if node is a class with a specific decorator
        if (t.isClassDeclaration(node) && node.decorators) {
          const hasDecorator = node.decorators.some(d => 
            t.isIdentifier(d.expression) && d.expression.name === 'CustomDecorator'
          );
          
          if (hasDecorator && node.id) {
            used.push(node.id.name);
          }
        }
        
        return used;
      }
    }
  ]
};
```

## How it Works

1.  **AST Walking**: The core engine walks the AST of every reachable file once.
2.  **Instruction Execution**: For every node, all registered instructions are called.
3.  **Usage Marking**: If an instruction returns identifiers, the engine marks them as `used` in the global context.
4.  **Final Sweep**: The engine compares the `used` list against all exports to find dead code.

## Best Practices

- **Keep it Stateless**: Instructions should not store state between nodes.
- **Fast Checks First**: Check the node type (e.g., `t.isIdentifier(node)`) before performing expensive logic.
- **Use `@babel/types`**: Use the type guards provided by Babel for reliable node checking.
