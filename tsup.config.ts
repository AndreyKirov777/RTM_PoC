import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'cli/reqsync': 'src/cli/reqsync.ts',
    'cli/reqgen': 'src/cli/reqgen.ts',
  },
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
