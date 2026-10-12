import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  webExt: { disabled: true },
  vite: () => ({
    plugins: [tailwindcss()],
    // Supported Chrome versions preload modules natively; omit the fetch fallback.
    build: { modulePreload: { polyfill: false } },
  }),
  manifest: {
    name: 'TabSiesta',
    description: 'Sleep idle tabs and collapsed groups, with protection for forms and one-time secrets.',
    minimum_chrome_version: '121',
    permissions: ['tabs', 'tabGroups', 'alarms', 'storage', 'scripting', 'webNavigation', 'contextMenus'],
    host_permissions: ['http://*/*', 'https://*/*'],
    action: { default_title: 'TabSiesta' },
    icons: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
  },
});
