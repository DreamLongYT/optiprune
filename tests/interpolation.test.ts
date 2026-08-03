import { describe, it, expect } from 'vitest';
import { analyze } from '../src/index.ts';
import path from 'pathe';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('String Interpolation Dynamic Import', () => {
  const rootDir = path.resolve(__dirname, '..');
  const fixtureDir = path.join(__dirname, 'fixtures/interpolation-test');

  it('should resolve dynamic import with string interpolation using Layer 4', async () => {
    const results = await analyze({
      rootDir,
      entryPoints: [path.join(fixtureDir, 'main.ts')],
      reportUnusedExports: true,
      verbose: true,
      layers: { skip3: false, skip4: false }
    });
    
    // Check if my-plugin.ts exports are NOT flagged as unused
    const unusedExport = results.findings.find(f => 
      f.rule === 'unused-export' && f.file.includes('my-plugin.ts')
    );
    
    expect(unusedExport, 'my-plugin.ts exports should be recognized as used').toBeUndefined();
    
    const unknownImport = results.findings.find(f => 
      f.rule === 'unknown-dynamic-import' && f.file.includes('main.ts')
    );
    expect(unknownImport, 'Should not have unknown-dynamic-import warning').toBeUndefined();
  });
});
