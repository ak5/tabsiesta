import { defineConfig } from 'vitest/config';
import { compile } from 'svelte/compiler';

export default defineConfig({
  resolve: { conditions: ['browser'] },
  plugins: [{
    name: 'svelte-test-components',
    transform(source, id) {
      if (!id.endsWith('.svelte')) return;
      const { js } = compile(source, { filename: id, generate: 'client', css: 'injected' });
      return { code: js.code, map: js.map };
    },
  }],
  test: { include: ['tests/**/*.test.ts'], environment: 'jsdom', restoreMocks: true, clearMocks: true },
});
