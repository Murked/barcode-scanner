import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'element/index': 'src/element/index.ts',
    'react/index': 'src/react/index.ts',
  },
  format: ['esm'],
  target: 'es2022',
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: true, // zxing detector stays in its own lazy chunk
  treeshake: true,
  external: ['react', 'barcode-detector'],
});
