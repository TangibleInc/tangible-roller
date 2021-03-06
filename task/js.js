const path = require('path')

// Rollup plugins
const alias = require('@rollup/plugin-alias')
const commonjs = require('@rollup/plugin-commonjs')
const esbuild = require('rollup-plugin-esbuild').default
const externalGlobals = require('rollup-plugin-external-globals')
const inject = require('@rollup/plugin-inject')
const json = require('@rollup/plugin-json')
const polyfillNode = require('rollup-plugin-polyfill-node')
const { nodeResolve } = require('@rollup/plugin-node-resolve')
const replace = require('@rollup/plugin-replace')
const injectProcessEnv = require('rollup-plugin-inject-process-env')

function createOptionsForTaskType(config, task) {
  const {
    rootDir,
    env, // Same as process.env.NODE_ENV but allow override
    isDev,
  } = config

  // Directories for resolving modules

  const moduleDirectories = [
    ...(task.root
      ? (Array.isArray(task.root) ? task.root : [task.root]).map((f) =>
          path.resolve(f)
        )
      : []),
    path.join(rootDir, 'node_modules'),
  ]

  // Transform imports into global variables

  const importToGlobal = task.importToGlobal
    ? Object.assign({}, task.importToGlobal)
    : {}

  // Aliases: { moduleName: targetFilePath }

  const aliases = task.alias
    ? Object.keys(task.alias).reduce((obj, key) => {
        let target = task.alias[key]

        // Shortcut to alias import to global variable
        if (target.indexOf('window.') === 0) {
          importToGlobal[key] = target.replace('window.', '')
          return
        }

        // Transform relative to absolute path
        if (target[0] === '.') {
          target = path.join(rootDir, target)
        }

        obj[key] = target

        return obj
      }, {})
    : {}

  // Transform global variables into import statements

  const globalToImport = task.globalToImport
    ? Object.assign({}, task.globalToImport)
    : {}

  // Replace strings

  const processEnv = {
    NODE_ENV: env,
  }
  const values = {}

  if (task.replaceStrings) {
    for (const key of Object.keys(task.replaceStrings)) {
      if (key === 'process.env') {
        Object.assign(processEnv, task.replaceStrings[key])
        continue
      }
      values[key] =
        task.replaceStrings[key] instanceof Function
          ? () => JSON.stringify(task.replaceStrings[key]())
          : JSON.stringify(task.replaceStrings[key])
    }
  }

  const replaceStrings = {
    // Silence warning from plugin about default value (true) in next version
    preventAssignment: true,
    values,
  }

  // React

  // Mode: react, preact, wp
  let reactMode = task.react || 'react'

  if (reactMode.indexOf('window.') === 0) {
    importToGlobal.react = reactMode.replace('window.', '')
    reactMode = 'react'
  } else {
    reactMode = reactMode.toLowerCase()
  }

  // For backward compatibility with @tangible/builder
  if (reactMode === 'wp.element') reactMode = 'wp'

  // Global variable name for React
  const reactGlobal = importToGlobal.react
    ? importToGlobal.react
    : reactMode !== 'wp'
    ? 'React'
    : 'wp.element'

  // JSX transforms
  const jsxFactory = `${reactGlobal}.createElement`
  const jsxFragment = `${reactGlobal}.Fragment`

  // Provide default aliases for Preact
  if (reactMode === 'preact' && !aliases.react) {
    Object.assign(aliases, {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
    })
  }

  if (reactMode === 'wp') {
    // https://developer.wordpress.org/block-editor/reference-guides/packages/packages-element/

    Object.assign(importToGlobal, {
      react: 'wp.element',
      'react-dom': 'wp.element',
    })
  } else if (importToGlobal.react) {
    /**
     * Replace import 'react' with global variable
     * Ensure react-dom is aliased to the same, unless specified
     */
    if (!importToGlobal['react-dom']) {
      importToGlobal['react-dom'] = importToGlobal.react
    }
  } else {
    // import * as React from 'react'
    globalToImport.React = ['react', '*']
  }

  return {
    plugins: [
      // Plugins for JavaScript

      /**
       * CommonJS plugin moved from below ESBuild to top of list,
       * to better handle module and exports. It also means JSX is
       * only supported in files with .jsx file extension.
       */
      commonjs({

        preserveSymlinks: true,

        // https://github.com/rollup/plugins/tree/master/packages/commonjs#transformmixedesmodules
        transformMixedEsModules: true,

        // Option to leave require() uncompiled for some modules
        ignore: [],
      }),

      json(),

      alias({
        entries: aliases,
      }),

      injectProcessEnv({
        env: processEnv,
      }),

      replace(replaceStrings),

      // https://github.com/rollup/plugins/tree/master/packages/node-resolve
      nodeResolve({
        moduleDirectories,
        browser: true,
        // Following option must be *false* for polyfill to work
        preferBuiltins: false,
      }),

      // https://github.com/FredKSchott/rollup-plugin-polyfill-node
      polyfillNode({
        // include: null, // Transform Node.js builtins in all files
        sourceMap: true,
      }),

      // https://github.com/egoist/rollup-plugin-esbuild
      esbuild({
        include: /\.[jt]sx?$/,
        exclude: /node_modules/,

        target: 'es2017', // default, or 'es20XX', 'esnext'

        sourceMap: true,
        minify: !isDev,

        // Optionally preserve symbol names during minification
        // https://esbuild.github.io/api/#keep-names
        keepNames: true,

        jsx: 'transform',
        jsxFactory,
        jsxFragment,

        tsconfig: 'tsconfig.json', // default

        // Add extra loaders
        loaders: {
          // Enable JSX in .js files
          '.js': 'jsx',

          // Add .json files support - require @rollup/plugin-json
          '.json': 'json',

          // CSS/SASS modules - TODO: Options for styles plugin?
          '.css': 'css',
          '.scss': 'scss',
        },

        ...(task.esbuild || {}),
      }),

      /**
       * Transform imports into global variables
       */
      ...(Object.keys(importToGlobal).length
        ? [externalGlobals(importToGlobal)]
        : []),

      /**
       * Transform global variables into import statements
       *
       * For React, it serves as an auto-import when JSX is used.
       *
       * - The plugin can't parse JSX, so it must come after esbuild.
       * - If target import has an alias, such as for Preact, it is
       * correctly transformed.
       *
       * @see https://github.com/rollup/plugins/tree/master/packages/inject
       */
      inject(globalToImport),
    ],
  }
}

module.exports = createOptionsForTaskType
