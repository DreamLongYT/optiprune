import path from "pathe";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import type { Config, ResolvedOptions } from "./types.js";
import { DEFAULT_EXTENSIONS, DEFAULT_IGNORE, normalizeAbsolute } from "./fs-utils.js";

export const DEFAULT_CONFIG: ResolvedOptions = {
  rootDir: normalizeAbsolute(process.cwd()),
  entry: [],
  extensions: DEFAULT_EXTENSIONS,
  ignore: DEFAULT_IGNORE,
  reportUnusedExports: true,
  schemaEnums: {},
  failOn: "high",
  json: false,
  includeConventionalEntries: true,
  externalContracts: [],
  layers: {
    smtTimeoutMs: 100,
    isolateMemoryLimitMb: 16,
    enableConcolicProof: true,
  },
  rules: {
    'unused-export': 'warning',
    'unreachable-file': 'warning',
    'constant-condition': 'warning',
    'unreachable-dynamic-path': 'warning',
  }
};

export async function loadConfig(rootDir: string): Promise<Config> {
  const configPaths = [
    path.join(rootDir, "optiprune.config.ts"),
    path.join(rootDir, "optiprune.config.js"),
    path.join(rootDir, "optiprune.config.mjs"),
  ];

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        // In a real CLI, we'd use something like jiti or ts-node to load TS configs
        // For this sandbox, we'll try dynamic import
        const configUrl = pathToFileURL(configPath).href;
        const module = await import(configUrl);
        return module.default || module;
      } catch (e) {
        console.warn(`[Config] Failed to load config from ${configPath}:`, e);
      }
    }
  }

  return {};
}

export function mergeConfig(base: ResolvedOptions, userConfig: Config): ResolvedOptions {
  return {
    ...base,
    ...userConfig,
    layers: {
      ...base.layers,
      ...userConfig.layers,
    },
    rules: {
      ...base.rules,
      ...userConfig.rules,
    },
    externalContracts: [
      ...base.externalContracts,
      ...(userConfig.externalContracts || []),
    ],
  } as ResolvedOptions;
}
