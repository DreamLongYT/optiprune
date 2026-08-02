import { AnalysisContext, ModuleRecord, AnalyzerPlugin, PluginAdapter, Finding } from "./types.js";
import traverse from "@babel/traverse";
import * as t from "@babel/types";
import fs from "node:fs/promises";
import path from "pathe";

export class PluginEngine {
  private plugins: AnalyzerPlugin[] = [];
  private findings: Finding[] = [];

  register(plugin: AnalyzerPlugin) {
    this.plugins.push(plugin);
  }

  async run(context: AnalysisContext): Promise<Finding[]> {
    const adapter = this.createAdapter(context);

    // 1. Detection Phase
    for (const plugin of this.plugins) {
      if (plugin.detect) {
        plugin.enabled = await plugin.detect(adapter);
      } else {
        plugin.enabled = true; // Enabled by default if no detect method
      }
    }

    // 2. onProjectInit
    for (const plugin of this.plugins) {
      if (plugin.enabled && plugin.lifecycle.onProjectInit) {
        await plugin.lifecycle.onProjectInit(adapter);
      }
    }

    // 2. File-level processing
    for (const module of context.modules.values()) {
      if (!module.ast) continue;

      // onFileStart
      for (const plugin of this.plugins) {
        if (plugin.enabled && plugin.lifecycle.onFileStart) {
          await plugin.lifecycle.onFileStart(module.id, adapter);
        }
      }

      // onASTNode (Traversal)
      const traverseFn = (traverse as any).default || traverse;
      traverseFn(module.ast, {
        enter: (path: any) => {
          for (const plugin of this.plugins) {
            if (plugin.enabled && plugin.lifecycle.onASTNode) {
              plugin.lifecycle.onASTNode(path.node, module.id, adapter);
            }
          }
        }
      });
    }

    // 4. onAnalysisComplete
    for (const plugin of this.plugins) {
      if (plugin.enabled && plugin.lifecycle.onAnalysisComplete) {
        await plugin.lifecycle.onAnalysisComplete(adapter);
      }
    }

    return this.findings;
  }

  private createAdapter(context: AnalysisContext): PluginAdapter {
    return {
      getAst: (fileId) => context.modules.get(fileId)?.ast,
      getSymbol: (name, fileId) => {
        const module = context.modules.get(fileId);
        return module?.exports.find(e => e.name === name || e.exportedAs === name);
      },
      getType: (node) => {
        // Simplified type inference
        if (t.isStringLiteral(node)) return 'string';
        if (t.isNumericLiteral(node)) return 'number';
        if (t.isBooleanLiteral(node)) return 'boolean';
        return undefined;
      },
      getDependencies: (fileId) => {
        const module = context.modules.get(fileId);
        return module?.edges.map(e => e.target).filter(Boolean) as string[] || [];
      },
      getConfig: () => context.options,
      readFile: async (filename) => {
        try {
          const fullPath = path.isAbsolute(filename) ? filename : path.join(context.options.rootDir, filename);
          return await fs.readFile(fullPath, 'utf8');
        } catch {
          return null;
        }
      },
      readJson: async (filename) => {
        try {
          const fullPath = path.isAbsolute(filename) ? filename : path.join(context.options.rootDir, filename);
          const content = await fs.readFile(fullPath, 'utf8');
          return JSON.parse(content);
        } catch {
          return null;
        }
      },
      emitFinding: (finding: Omit<Finding, "rule"> & { rule?: string }) => {
        this.findings.push({
          rule: 'plugin-finding', // default fallback
          ...finding,             // overrides 'rule' if finding.rule was provided
        } as Finding);
      },
      markAsUsed: (fileId, symbol) => {
        context.reachable.add(fileId);
        if (symbol) {
          context.usedExports.add(`${fileId}:${symbol}`);
        }
      },
      attachMetadata: (node, key, value) => {
        (node as any).metadata = (node as any).metadata || {};
        (node as any).metadata[key] = value;
      }
    };
  }
}

/**
 * Legacy ZodPlugin refactored to new architecture
 */
export const ZodPlugin: AnalyzerPlugin = {
  name: "zod-plugin",
  version: "2.0.0",
  lifecycle: {
    onASTNode: (node, fileId, adapter) => {
      // Pattern: const User = z.object(...)
      if (t.isVariableDeclarator(node) && t.isIdentifier(node.id)) {
        const init = node.init;
        const isZod = t.isCallExpression(init) && 
          ((t.isMemberExpression(init.callee) && t.isIdentifier(init.callee.object) && (init.callee.object.name === 'z' || init.callee.object.name === 'zod')) ||
           (t.isIdentifier(init.callee) && init.callee.name === 'z'));
        if (isZod) {
          adapter.markAsUsed(fileId, node.id.name);
        }
      }

      // Dynamic property access: controller[method]()
      if (t.isMemberExpression(node) && node.computed) {
        if (t.isStringLiteral(node.property)) {
          adapter.markAsUsed(fileId, node.property.value);
        }
      }
    }
  }
};
