import { AnalysisContext, ModuleRecord, AnalyzerPlugin } from "./types.js";
import traverse from "@babel/traverse";
import * as t from "@babel/types";

export class PluginEngine {
  private plugins: AnalyzerPlugin[] = [];

  register(plugin: AnalyzerPlugin) {
    this.plugins.push(plugin);
  }

  runUsageInstructions(context: AnalysisContext) {
    for (const module of context.modules.values()) {
      if (!module.ast) continue;
      
      // Use the default export of traverse
      const traverseFn = (traverse as any).default || traverse;
      
      traverseFn(module.ast, {
        enter: (path: any) => {
          // Layer 2: Dead Branch Pruning (Integrated into walk)
          if (t.isIfStatement(path.node)) {
            const test = path.node.test;
            if (t.isBooleanLiteral(test) && test.value === false) {
              path.skip();
              return;
            }
            if (t.isBinaryExpression(test) && t.isNumericLiteral(test.left) && t.isNumericLiteral(test.right)) {
               if (test.operator === '===' && test.left.value !== test.right.value) {
                 path.skip();
                 return;
               }
            }
          }

          for (const plugin of this.plugins) {
            for (const instruction of plugin.instructions) {
              if (instruction.identifyUsage) {
                const usedIdentifiers = instruction.identifyUsage(path.node, module, context);
                usedIdentifiers.forEach(id => {
                  context.usedExports.add(`${module.id}:${id}`);
                });
              }
            }
          }
        }
      });
    }
  }
}

/**
 * Zod Instruction Plugin
 * A lightweight instruction set for identifying Zod schema usage.
 */
export const ZodPlugin: AnalyzerPlugin = {
  name: "zod-plugin",
  instructions: [
    {
      name: "zod-schema-usage",
      description: "Identifies exports that are Zod schemas and marks them as used.",
      identifyUsage(node: any): string[] {
        const used: string[] = [];
        // Pattern: const User = z.object(...)
        if (t.isVariableDeclarator(node) && t.isIdentifier(node.id)) {
          const init = node.init;
          const isZod = t.isCallExpression(init) && 
            ((t.isMemberExpression(init.callee) && t.isIdentifier(init.callee.object) && (init.callee.object.name === 'z' || init.callee.object.name === 'zod')) ||
             (t.isIdentifier(init.callee) && init.callee.name === 'z'));
          if (isZod) {
            used.push(node.id.name);
          }
        }
        return used;
      }
    },
    {
      name: "dynamic-property-access",
      description: "Handles cases like controller[method]() where method is a string.",
      identifyUsage(node: any): string[] {
        const used: string[] = [];
        if (t.isMemberExpression(node) && node.computed) {
          if (t.isStringLiteral(node.property)) {
            used.push(node.property.value);
          }
        }
        return used;
      }
    }
  ]
};
