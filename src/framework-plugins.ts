import { AnalyzerPlugin } from "./types.js";
import * as t from "@babel/types";

/**
 * Utility to check for dependencies in package.json
 */
async function hasDependency(adapter: any, name: string): Promise<boolean> {
  const pkg = await adapter.readJson('package.json');
  if (!pkg) return false;
  return !!(pkg.dependencies?.[name] || pkg.devDependencies?.[name] || pkg.peerDependencies?.[name]);
}

/**
 * React Plugin
 * Handles React-specific patterns like components and hooks.
 */
export const ReactPlugin: AnalyzerPlugin = {
  name: "react-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    return await hasDependency(adapter, 'react');
  },
  lifecycle: {
    onASTNode: (node, fileId, adapter) => {
      // 1. Detect React components (Functions starting with uppercase)
      if (t.isFunctionDeclaration(node) && node.id && /^[A-Z]/.test(node.id.name)) {
        adapter.markAsUsed(fileId, node.id.name);
      }

      // 2. Detect hooks (Functions starting with 'use')
      if (t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name.startsWith('use')) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

/**
 * Next.js Plugin
 * Handles Next.js specific entry points and conventions.
 */
export const NextjsPlugin: AnalyzerPlugin = {
  name: "nextjs-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    return await hasDependency(adapter, 'next');
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      // Read next.config.js to look for custom entry points or redirects
      const nextConfig = await adapter.readFile('next.config.js') || await adapter.readFile('next.config.mjs');
      if (nextConfig) {
        // In a real implementation, we would parse the config to find custom rewrites/redirects
        // For now, we just log that we found it
      }
    },
    onFileStart: (fileId, adapter) => {
      const filename = fileId.split('/').pop() || '';
      if (['page.tsx', 'page.js', 'layout.tsx', 'layout.js', 'route.ts', 'route.js', 'error.tsx', 'loading.tsx'].includes(filename)) {
        adapter.markAsUsed(fileId);
      }
      if (fileId.includes('/pages/api/')) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      if (t.isExportNamedDeclaration(node) && node.declaration) {
        const decl = node.declaration;
        if (t.isFunctionDeclaration(decl) && decl.id) {
          const name = decl.id.name;
          if (['getStaticProps', 'getServerSideProps', 'getStaticPaths', 'generateMetadata', 'generateStaticParams'].includes(name)) {
            adapter.markAsUsed(fileId, name);
          }
        }
      }
    }
  }
};

/**
 * Nuxt Plugin
 * Handles Nuxt-specific directory conventions and auto-imports.
 */
export const NuxtPlugin: AnalyzerPlugin = {
  name: "nuxt-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    return await hasDependency(adapter, 'nuxt');
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      // Read nuxt.config.ts to look for custom modules or dir overrides
      const nuxtConfig = await adapter.readFile('nuxt.config.ts') || await adapter.readFile('nuxt.config.js');
      if (nuxtConfig) {
        // Example: Nuxt might have custom directory configurations
      }
    },
    onFileStart: (fileId, adapter) => {
      const pathParts = fileId.split('/');
      if (pathParts.includes('pages') || pathParts.includes('layouts') || pathParts.includes('middleware') || pathParts.includes('server') || pathParts.includes('composables')) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        if (['definePageMeta', 'defineNuxtComponent', 'useNuxtApp', 'useFetch', 'defineEventHandler'].includes(node.callee.name)) {
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};
