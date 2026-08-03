import { describe, it, expect } from 'vitest';
import { analyze } from '../src/index.ts';
import path from 'pathe';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Dynamic Import Analysis Reproduction', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('should NOT flag AngularPlugin as unused when Layer 4 simulation is ENABLED', async () => {
    const results = await analyze({
      rootDir,
      entryPoints: [path.join(rootDir, 'src/engine.ts')],
      reportUnusedExports: true,
      verbose: true,
      layers: { skip3: false, skip4: false }
    });
    
    const unusedAngular = results.findings.find(f => 
      f.rule === 'unused-export' && f.file.includes('angular-plugin.ts')
    );

    if (unusedAngular) {
      console.log('❌ FAIL: AngularPlugin was incorrectly flagged as unused even with Layer 4 enabled.');
    } else {
      console.log('✅ SUCCESS: Layer 4 simulation correctly identified AngularPlugin as used.');
    }
    
    expect(unusedAngular, 'AngularPlugin should be recognized as used when Layer 4 is active').toBeUndefined();
  });

  it('should flag AngularPlugin as unused when Layer 4 simulation is DISABLED (Baseline Check)', async () => {
    const results = await analyze({
      rootDir,
      entryPoints: [path.join(rootDir, 'src/engine.ts')],
      reportUnusedExports: true,
      verbose: false,
      layers: { skip3: false, skip4: true } // Disable simulation
    });
    
    const unusedAngular = results.findings.find(f => 
      f.rule === 'unused-export' && f.file.includes('angular-plugin.ts')
    );

    if (unusedAngular) {
      console.log('✅ SUCCESS: Baseline confirmed. Without Layer 4, the plugin is (correctly) flagged as unused.');
    } else {
      console.log('❌ FAIL: The plugin should have been flagged as unused without simulation.');
    }
    
    expect(unusedAngular, 'Without Layer 4, the analyzer should not be able to find the dynamic import target').toBeDefined();
  });
});
