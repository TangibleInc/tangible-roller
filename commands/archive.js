/**
 * Archive command: Create a zip package of the project
 */
import path from 'path'
import url from 'url'
import glob from 'fast-glob'
import fs from 'fs-extra'
import { Zip } from 'zip-lib'
import fileExists from '../utils/fileExists.js'

export default async function archive({ config }) {
  if (!config.archive) {
    console.log('Required property "archive" in tangible.config.js')
    console.log(`Example:
{
  archive: {
    src: [
      '**/*',
      '!**/src',
      '!**/test'
    ],
    dest: 'build/project.zip'
  }
}
`)
    return
  }

  const args = process.argv.slice(2)
  const skipConfirm = args.indexOf('--confirm') === -1

  const { rootDir } = config
  const {
    src,
    dest,
    exclude = [],
    rootFolder: archiveRootFolder = config.archive.root, // Alias
    configs = []
  } = config.archive

  if (!src || !dest) {
    console.log('Required properties "src" and "dest"')
    return
  }

  for (const childConfig of configs) {
    const childConfigPath = path.join(rootDir, childConfig)
    const relativeChildRootPath = path.relative(
      rootDir,
      path.dirname(childConfigPath)
    )

    /**
     * ES Module loading with abolute path fails on Windows unless it's
     * converted to URL: https://github.com/nodejs/node/issues/31710
     */
    const configJsPathUrl = url.pathToFileURL(childConfigPath).href

    let configJson = {}
    try {
      configJson = (await import(configJsPathUrl)).default
    } catch (e) {
      console.warn('Child config not found', childConfigPath)
    }

    const relativeToChildFolder = (pattern) =>
      `${relativeChildRootPath}/${pattern.replace('^/', '')}`

    src.push(...(configJson?.archive?.src ?? []).map(relativeToChildFolder))
    exclude.push(
      ...(configJson?.archive?.exclude ?? []).map(relativeToChildFolder)
    )
  }

  /**
   * Process .gitignore patterns to glob ignore option
   */
  function processGitIgnorePatterns(patterns) {
    return patterns.map((p) => {
      // Starting slash means relative to current directory, same as in .gitignore
      p = p.replace(/^\//, './')
      return p.startsWith('./')
        ? // Ignore file or directory and its contents
          `{${p}, ${p}/**}`
        : // Ignore pattern in subdirectories by default, unless explicitly using / or ./
          !p.startsWith('**')
          ? `**/${p}`
          : p
    })
  }

  const globOptions = {
    cwd: rootDir,
    ignore: processGitIgnorePatterns([
      ...exclude,
      '/artifacts',
      'bun.lockb',
      'bun.lock',
      'composer.lock',
      '.git*',
      '.idea',
      'node_modules',
      'package-lock.json',
      '.phpunit.cache',
      '/publish',
      '.wp-env.json',
      '.wp-env.override.json',
      'yarn.lock'
    ])
  }

  const files = await glob(src, globOptions)

  console.log('Glob options:')
  console.log(globOptions)

  console.log('Files to archive:')
  console.log(files.join('\n'))

  console.log('Archive file:', dest)

  if (!skipConfirm) {
    function waitKeyPressed() {
      return new Promise((resolve) => {
        // const wasRaw = process.stdin.isRaw
        // process.stdin.setRawMode(true) // Single key press instead of line
        process.stdin.resume()
        process.stdin.once('data', (data) => {
          process.stdin.pause()
          // process.stdin.setRawMode(wasRaw)
          resolve(data.toString())
        })
      })
    }

    console.log('Press enter to continue, or CTRL + C to stop')
    await waitKeyPressed()
  }

  /**
   * https://github.com/fpsqdb/zip-lib
   */

  const zip = new Zip()
  const archivePath = path.join(rootDir, dest)

  await fs.mkdir(path.dirname(archivePath), {
    recursive: true // Ensure parent directories, and no error when dir exists
  })

  if (await fileExists(archivePath)) {
    await fs.rm(archivePath)
  }

  await new Promise((resolve, reject) => {
    for (const file of files) {
      const sourceFile = path.join(rootDir, file)
      const targetFile = archiveRootFolder
        ? path.join(archiveRootFolder, file)
        : file
      zip.addFile(sourceFile, targetFile)
    }

    zip.archive(archivePath).then(resolve, reject)
  })

  console.log('Wrote', dest)
}
