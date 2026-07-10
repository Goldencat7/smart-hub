import js from '@eslint/js';
import globals from 'globals';

// O repo mistura três ambientes; cada um precisa dos seus globals, senão o
// no-undef vira ruído e a gente para de olhar pra ele.
//   - main process do Electron + Cloud Functions  -> CommonJS, globals do Node
//   - preloads                                    -> CommonJS, mas rodam com DOM
//   - renderers (hub/admin/login)                 -> módulos ES, globals do browser
//
// As regras de estilo ficam de fora de propósito: o CI só deve falhar por coisa
// que quebra em runtime. Aviso não derruba o build (`eslint` só sai 1 com erro).
const regras = {
  ...js.configs.recommended.rules,
  // args e erros de catch não usados são idiomáticos aqui (ex.: `catch (e) {}`)
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-empty': ['error', { allowEmptyCatch: true }],
};

export default [
  {
    ignores: [
      'node_modules/**', 'functions/node_modules/**',
      'release/**', 'build/**', '.firebase/**',
      'marketing/**', 'public/**',   // HTML com script inline
      '_*.js',                       // scratch local
    ],
  },
  {
    // Node puro
    files: ['main.js', 'firebase-config.js', 'functions/index.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: regras,
  },
  {
    // preloads: CommonJS + DOM
    files: ['preload.js', 'autologin-preload.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: regras,
  },
  {
    // renderers
    files: ['hub-app.js', 'admin-app.js', 'auth-login.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        hubApi: 'readonly',   // exposto pelo preload via contextBridge
      },
    },
    rules: regras,
  },
];
