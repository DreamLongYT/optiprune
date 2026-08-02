# OptiPrune Plugin Guide: Complete Architecture Reference

OptiPrune uses a **Plugin Adapter** architecture that allows framework-specific dead code detection. Plugins hook into the analysis lifecycle to recognize framework patterns, decorators, and conventions that would otherwise be marked as unused.

---

## Quick Start: Plugin Structure

Every OptiPrune plugin implements the `AnalyzerPlugin` interface:

```typescript
import { AnalyzerPlugin } from "../types.js";
import * as t from "@babel/types";

export const MyFrameworkPlugin: AnalyzerPlugin = {
  name: "my-framework-plugin",
  version: "1.0.0",
  
  // Auto-detect if framework is installed
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    return !!pkg?.dependencies?.['my-framework'];
  },
  
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Mark framework entry points before analysis
    },
    onASTNode: (node, fileId, adapter) => {
      // Inspect AST nodes and mark used symbols
    }
  }
};

export default MyFrameworkPlugin;
```

---

## Core Concepts

### 1. **Auto-Detection (`detect`)**

The `detect` function runs before analysis to determine if the plugin should activate:

```typescript
detect: async (adapter) => {
  // Check package.json for framework dependency
  const pkg = await adapter.readJson('package.json');
  if (pkg?.dependencies?.['@angular/core'] || pkg?.devDependencies?.['@angular/core']) {
    return true;
  }
  
  // Fallback: Check for framework config files
  const angularJson = await adapter.readFile('angular.json');
  return !!angularJson;
}
```

**Best Practices:**
- Always check both `dependencies` and `devDependencies`
- Provide a fallback check for framework config files
- Return `false` if framework is not detected

---

## Lifecycle Hooks

### 2. **`onFileStart(fileId, adapter)`**

Called **before** analyzing each file. Use this to mark framework-specific entry points.

```typescript
onFileStart: (fileId, adapter) => {
  // Mark Next.js page routes as entry points
  if (fileId.endsWith('page.tsx') || fileId.endsWith('page.ts')) {
    adapter.markAsUsed(fileId);
  }
  
  // Mark Vue components as entry points
  if (fileId.endsWith('.vue')) {
    adapter.markAsUsed(fileId);
  }
}
```

**Use Cases:**
- Mark conventional file patterns (e.g., `page.tsx`, `.vue`, `.astro`)
- Mark files in specific directories (e.g., `pages/`, `components/`)
- Mark framework-specific file types as always-used

---

### 3. **`onASTNode(node, fileId, adapter)`**

Called **synchronously** for every AST node during traversal. Use this to detect framework-specific patterns.

```typescript
onASTNode: (node, fileId, adapter) => {
  // Detect Angular decorators
  const decorators = (node as any).decorators || (node as any).modifiers?.filter((m: any) => m.type === 'Decorator');
  
  if (t.isClassDeclaration(node) && decorators) {
    const hasAngularDecorator = decorators.some((dec: any) => {
      const expr = dec.expression;
      const callee = t.isCallExpression(expr) ? expr.callee : expr;
      const name = t.isIdentifier(callee) ? callee.name : null;
      return name && ['Component', 'Injectable', 'Module'].includes(name);
    });
    
    if (hasAngularDecorator) {
      adapter.markAsUsed(fileId, (node as any).id?.name);
    }
  }
}
```

**Important:** This hook **must be synchronous** for performance. Do not use `await` or async operations.

---

## Plugin Adapter API

### Reading Methods

| Method | Purpose | Example |
|--------|---------|---------|
| `readJson(filename)` | Read and parse JSON files | `const pkg = await adapter.readJson('package.json')` |
| `readFile(filename)` | Read file content as string | `const config = await adapter.readFile('next.config.js')` |
| `getConfig()` | Get analysis configuration | `const rootDir = adapter.getConfig().rootDir` |

### Writing Methods

| Method | Purpose | Example |
|--------|---------|---------|
| `markAsUsed(fileId, symbol?)` | Mark file or export as reachable | `adapter.markAsUsed(fileId, 'ComponentName')` |
| `emitFinding(finding)` | Report a custom issue | `adapter.emitFinding({ type: 'warning', message: '...' })` |

---

## Real-World Examples

### Example 1: Next.js Plugin

Detects Next.js conventions and data fetching patterns:

```typescript
export const NextJsPlugin: AnalyzerPlugin = {
  name: "nextjs-plugin",
  version: "1.0.0",
  
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    return !!pkg?.dependencies?.['next'];
  },
  
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Mark conventional routes
      const nextJsPatterns = ['page.tsx', 'route.ts', 'layout.tsx', 'middleware.ts'];
      if (nextJsPatterns.some(pattern => fileId.endsWith(pattern))) {
        adapter.markAsUsed(fileId);
      }
    },
    
    onASTNode: (node, fileId, adapter) => {
      // Detect data fetching functions
      if (t.isExportNamedDeclaration(node)) {
        const funcName = (node.declaration as any).id?.name;
        if (['getServerSideProps', 'getStaticProps', 'generateStaticParams'].includes(funcName)) {
          adapter.markAsUsed(fileId, funcName);
        }
      }
      
      // Detect Next.js hooks
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        if (['useRouter', 'usePathname', 'useSearchParams'].includes(node.callee.name)) {
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};
```

### Example 2: NestJS Plugin

Detects NestJS decorators and dependency injection:

```typescript
export const NestJsPlugin: AnalyzerPlugin = {
  name: "nestjs-plugin",
  version: "1.0.0",
  
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    return !!pkg?.dependencies?.['@nestjs/core'];
  },
  
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Mark NestJS modules and services
      if (fileId.endsWith('.module.ts') || fileId.endsWith('.service.ts')) {
        adapter.markAsUsed(fileId);
      }
    },
    
    onASTNode: (node, fileId, adapter) => {
      // Detect @Controller, @Injectable, @Module decorators
      const decorators = (node as any).decorators;
      
      if (t.isClassDeclaration(node) && decorators) {
        const nestDecorators = ['Controller', 'Injectable', 'Module', 'Guard', 'Interceptor'];
        const hasNestDecorator = decorators.some((dec: any) => {
          const name = dec.expression.callee?.name || dec.expression.name;
          return nestDecorators.includes(name);
        });
        
        if (hasNestDecorator) {
          adapter.markAsUsed(fileId, (node as any).id?.name);
        }
      }
      
      // Detect @Get, @Post, @Put, @Delete route decorators
      if (t.isClassMethod(node)) {
        const routeDecorators = decorators?.filter((dec: any) => {
          const name = dec.expression.callee?.name;
          return ['Get', 'Post', 'Put', 'Delete', 'Patch'].includes(name);
        });
        
        if (routeDecorators?.length) {
          adapter.markAsUsed(fileId, (node as any).key?.name);
        }
      }
    }
  }
};
```

### Example 3: Vue.js Plugin

Detects Vue composition API and lifecycle hooks:

```typescript
export const VueJsPlugin: AnalyzerPlugin = {
  name: "vuejs-plugin",
  version: "1.0.0",
  
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    return !!pkg?.dependencies?.['vue'];
  },
  
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Vue components are always entry points
      if (fileId.endsWith('.vue')) {
        adapter.markAsUsed(fileId);
      }
    },
    
    onASTNode: (node, fileId, adapter) => {
      // Detect Vue lifecycle hooks
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const hooks = ['onMounted', 'onUpdated', 'onUnmounted', 'beforeUpdate', 'afterUpdate'];
        if (hooks.includes(node.callee.name)) {
          adapter.markAsUsed(fileId);
        }
      }
      
      // Detect Vue reactive API
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const reactiveApi = ['ref', 'reactive', 'computed', 'watch', 'provide', 'inject'];
        if (reactiveApi.includes(node.callee.name)) {
          adapter.markAsUsed(fileId);
        }
      }
      
      // Detect defineComponent
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        if (node.callee.name === 'defineComponent') {
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};
```

---

## Best Practices

### ✅ DO

- **Use `onFileStart` for entry points**: Mark framework-specific files before AST analysis
- **Keep `onASTNode` synchronous**: Never use `await` in this hook
- **Check both dependency types**: Always check `dependencies` and `devDependencies`
- **Provide fallback detection**: Check for config files if package.json check fails
- **Use Babel types**: Leverage `@babel/types` for safe AST node checks
- **Be specific with decorators**: Extract decorator names carefully to avoid false positives

### ❌ DON'T

- **Don't use async in `onASTNode`**: This breaks the synchronous traversal
- **Don't mutate AST nodes**: Use `markAsUsed` instead of modifying nodes
- **Don't assume node structure**: Always check node types with `t.isXxx()` predicates
- **Don't mark everything as used**: Only mark framework-specific patterns
- **Don't ignore edge cases**: Handle both TypeScript and JavaScript syntax

---

## Testing Your Plugin

### 1. Create a Test Project

```bash
mkdir test-framework-project
cd test-framework-project
npm init -y
npm install my-framework
```

### 2. Add Framework-Specific Files

```
test-framework-project/
├── package.json
├── src/
│   ├── component.vue
│   ├── unused.ts
│   └── service.ts
```

### 3. Run OptiPrune

```bash
optiprune --rootDir . --entry src/main.ts
```

### 4. Verify Plugin Output

Check that:
- Framework entry points are marked as used
- Framework-specific patterns are recognized
- Unused code is still detected correctly

---

## Built-in Plugins

OptiPrune ships with plugins for:

| Framework | Plugin | Detects |
|-----------|--------|---------|
| **Angular** | `angular-plugin.ts` | `@Component`, `@Injectable`, `@Module`, `.component.ts`, `.service.ts` |
| **Svelte** | `svelte-plugin.ts` | `.svelte` files, lifecycle hooks, stores |
| **Next.js** | `nextjs-plugin.ts` | `page.tsx`, `route.ts`, data fetching functions, hooks |
| **NestJS** | `nestjs-plugin.ts` | `@Controller`, `@Injectable`, route decorators, DI |
| **Vue.js** | `vuejs-plugin.ts` | `.vue` files, composition API, lifecycle hooks |
| **Nuxt** | `nuxt-plugin.ts` | `pages/`, `layouts/`, composables, `definePageMeta` |
| **Astro** | `astro-plugin.ts` | `.astro` files, API routes, `getStaticPaths` |

---

## Contributing New Plugins

To add a new framework plugin:

1. **Create the plugin file**: `src/plugins/framework-name-plugin.ts`
2. **Implement `AnalyzerPlugin` interface**: Follow the structure above
3. **Test on real projects**: Verify detection works correctly
4. **Add to registry**: Update `src/framework-plugins.ts` to export your plugin
5. **Document patterns**: Add framework-specific patterns to this guide
6. **Submit PR**: Include tests and documentation

---

## Troubleshooting

### Plugin Not Activating

**Problem**: Your plugin's `detect()` returns `false`

**Solution**:
- Check that `package.json` has the framework dependency
- Verify the dependency name matches exactly
- Add a fallback check for config files

### Symbols Not Marked as Used

**Problem**: Framework-specific code is still marked as unused

**Solution**:
- Verify decorator names are correct (case-sensitive)
- Check that `onASTNode` is detecting the right node types
- Use `console.log` to debug AST node structure
- Ensure `markAsUsed()` is called with correct file/symbol names

### Performance Issues

**Problem**: Analysis is slow with your plugin

**Solution**:
- Remove any `await` calls from `onASTNode`
- Minimize expensive checks in the hot path
- Use early returns to skip unnecessary processing
- Profile with `--verbose` flag

---

## API Reference

### AnalyzerPlugin Interface

```typescript
interface AnalyzerPlugin {
  name: string;                              // Unique plugin identifier
  version: string;                           // Semantic version
  detect?: (adapter: PluginAdapter) => Promise<boolean>;  // Auto-detection
  lifecycle?: {
    onFileStart?: (fileId: string, adapter: PluginAdapter) => void;
    onASTNode?: (node: any, fileId: string, adapter: PluginAdapter) => void;
  };
}
```

### PluginAdapter Interface

```typescript
interface PluginAdapter {
  readJson(filename: string): Promise<any>;
  readFile(filename: string): Promise<string | null>;
  getConfig(): AnalysisConfig;
  markAsUsed(fileId: string, symbol?: string): void;
  emitFinding(finding: Finding): void;
}
```

---

## Questions?

For issues, questions, or plugin contributions, visit the [OptiPrune GitHub repository](https://github.com/DreamLongYT/optiprune).
