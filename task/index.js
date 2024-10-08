/**
 * Create task configs
 *
 * @see https://rollupjs.org/guide/en/#rolluprollup
 * @see https://rollupjs.org/guide/en/#big-list-of-options
 */

import path from 'path'

const supportedTaskTypes = ['js', 'sass', 'html', 'copy', 'custom']

export default async function createTaskConfigs({ config, task }) {
  if (supportedTaskTypes.indexOf(task.task) < 0) {
    return
  }

  const {
    rootDir,
    env, // Same as process.env.NODE_ENV but allow override
    isDev,
  } = config

  const createOptionsForTaskType = (await import(`./${task.task}.js`)).default

  if (!task.src || !task.dest)
    return {
      inputOptions: await createOptionsForTaskType(config, task),
      outputOptions: {},
    }

  const destFullPath = path.join(rootDir, task.dest)

  // Input options

  const inputOptions = {
    input: task.src,
    preserveSymlinks: true,

    ...await createOptionsForTaskType(config, task),

    // https://rollupjs.org/guide/en/#onwarn
    onwarn(warning, rollupWarn) {
      if (
        warning.code === 'CIRCULAR_DEPENDENCY' ||
        warning.code === 'THIS_IS_UNDEFINED'
      )
        return
      rollupWarn(warning)
    },
  }

  // Output options

  const outputOptions = {
    // name: task.name,
    file:
      task.task === 'sass'
        ? task.dest + '.tmp' // PostCSS emits its own file
        : task.dest,
    sourcemap:
      task.task === 'sass'
        ? false
        : task.map === 'dev' // See ../config for global default
          ? isDev // Only during development
          : task.map !== false,
    // Use default source map name to support dynamic exports and code splitting
    // sourcemapFile: task.dest + '.map',

    // cjs, es, iife, umd
    format: task.task === 'sass' || task.type === 'module' ? 'es' : 'iife',

    // For styles plugin
    assetFileNames: task.task === 'sass' ? '[name]' : '[name].module[extname]',

    ...(task.output || {}),
  }

  return {
    inputOptions,
    outputOptions,
  }
}
