const path = require('path')
const fs = require('fs')
const { readFile } = require('fs/promises')
const url = require('url')

const prompt = require('../utils/prompt')
const run = require('../utils/run')

async function createConfig({ commandName, subproject }) {
  const cwd = process.cwd()
  let rootDir = cwd
  let isChildProjectFolder = false

  const configJsFileName = 'tangible.config.js'

  let configJsPath = path.join(rootDir, configJsFileName)

  // Commands that optionally accept a subproject (module) name
  if (subproject) {
    const name = subproject

    // Child project directory
    const customConfigJsPath = path.join(rootDir, name, configJsFileName)

    if (fs.existsSync(customConfigJsPath)) {
      /**
       * Was using process.chdir(name) but some rollup internals is using
       * del() to remove previously built files, and it throws an error when
       * they're outside the current working directory.
       */
      rootDir = path.join(rootDir, name)
      isChildProjectFolder = true

      configJsPath = customConfigJsPath
    } else {
      // Child project config file
      configJsPath = path.join(rootDir, `tangible.config.${name}.js`)

      if (name.includes('/') || !fs.existsSync(configJsPath)) {
        console.warn(
          `Couldn't find project directory "${name}" with tangible.config.js`
        )
        process.exit(1)
      }
    }
  }

  const packageJsonPath = path.join(rootDir, 'package.json')
  let packageJson = {}

  try {
    packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  } catch (e) {
    // OK
  }

  if (!fs.existsSync(configJsPath)) {
    if (commandName === 'help') return // No message for help screen

    // Optionally run command "init" to create new config
    const answer = await prompt(
      `Press enter to create a new configuration file, ${configJsFileName}, or CTRL+C to exit\n`
    )
    console.log()
    if (answer === false) {
      // Cancelled
      process.exit()
    }

    fs.writeFileSync(
      configJsPath,
      `${
        packageJson.type === 'module'
          ? 'export default' // ES Module
          : 'module.exports =' // CommonJS
      } {
  build: [
    {
      src:  'src/index.html',
      dest: 'build',
    },
    {
      src:  'src/index.ts',
      dest: 'build/app.min.js',
    },
    {
      src:  'src/index.scss',
      dest: 'build/app.min.css',
    },
  ],
  format: 'src',
  serve: {
    dir: 'build'
  }
}
`
    )
    console.log('Wrote', configJsPath)
  }

  /**
   * ES Module loading with abolute path fails on Windows unless it's
   * converted to URL: https://github.com/nodejs/node/issues/31710
   */
  const configJsPathUrl = url.pathToFileURL(configJsPath).href

  const { default: configJson } = await import(configJsPathUrl)
  // const configJson = require(configJsPath) // Previously with CommonJS

  const { name = '', dependencies = {}, devDependencies = {} } = packageJson

  const {
    build: tasks = [],
    format,
    lint,
    serve,
    archive,
    map = 'dev' // Global default, can override per task
  } = configJson instanceof Function ? await configJson() : configJson

  for (const task of tasks) {
    if (typeof task.map==='undefined') {
      task.map = map
    }
  }

  // Ensure project dependencies are installed
  if (
    Object.keys(dependencies).length > 0 &&
    !fs.existsSync(path.join(rootDir, 'node_modules'))
  ) {
    console.log('Project has uninstalled dependencies')
    console.log()
    const answer = await prompt(
      'Press enter to run "npm install", or CTRL+C to cancel..'
    )
    console.log()
    if (answer === false) {
      // Cancelled
      process.exit()
    }
    console.log('npm install')
    await run('npm install --production', {
      cwd: rootDir,
    })
    console.log()
  }

  const env = process.env.NODE_ENV
  const isDev = env === 'development'

  return {
    cwd,
    rootDir,
    env,
    isDev,

    name,
    dependencies,
    devDependencies,

    tasks: !isChildProjectFolder
      ? tasks
      : tasks.map((task) => ({
          ...task,
          src: task.src.startsWith('/')
            ? task.src
            : path.join(rootDir, task.src),
          dest: task.dest.startsWith('/')
            ? task.dest
            : path.join(rootDir, task.dest),
        })),

    format,
    lint,
    serve,
    archive,
  }
}

module.exports = createConfig
