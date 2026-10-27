import javascript from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';

// `pnpm run lint` checks everything; `pnpm run lint --fix` fixes what it can.
//
// The rules are ESLint's recommended set, which catches likely mistakes,
// plus layout: two space indents and no tabs, single quotes, semicolons,
// and trailing commas on lines that are split.
export default [
  { ignores: ['dist/', 'dist-demo/', 'node_modules/', '.pnpm-store/'] },
  javascript.configs.recommended,
  {
    plugins: { '@stylistic': stylistic },
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^unused', caughtErrors: 'none', ignoreRestSiblings: true }],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      '@stylistic/indent': ['error', 2, { SwitchCase: 1 }],
      '@stylistic/no-tabs': 'error',
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/eol-last': ['error', 'always'],
    },
  },
  // The map itself, and the demo pages, run in the browser.
  {
    files: ['src/**/*.js', 'examples/*.js'],
    languageOptions: { globals: globals.browser },
  },
  // The example loader runs in a Web Worker.
  {
    files: ['examples/spansh-loader/**/*.js'],
    languageOptions: { globals: { ...globals.worker } },
  },
  // Command line scripts, benchmarks, tests and configuration run in Node.
  {
    files: ['scripts/**/*.mjs', 'bench/**/*.mjs', 'test/**/*.js', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
];
