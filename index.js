import createConfig from './config/index.js'
import createTaskConfigs from './task/index.js'
import createReloader from './lib/reloader/index.js'

const supportedCommands = [
  'archive',
  'build',
  'bun-or',
  'dev',
  'format',
  'help',
  'init',
  'install',
  'lint',
  'list',
  'run',
  'serve',
  'update',
]

;(async function run(commandName = 'help', ...args) {
  if (supportedCommands.indexOf(commandName) < 0) {
    commandName = 'help'
  }

  const runCommand = (await import(`./commands/${commandName}.js`)).default

  if (!(runCommand instanceof Function)) return

  process.env.NODE_ENV = commandName === 'dev' ? 'development' : 'production'

  const commandWithProjects = ['build', 'dev', 'format', 'lint'].includes(
    commandName,
  )

  // Support specifying more than one project
  if (commandWithProjects && args.length > 1) {
    for (const arg of args) {
      console.log(`\nProject "${arg}"\n`)

      const config = await createConfig({
        commandName,
        subproject: arg,
      })

      await runWithConfig({
        commandName,
        runCommand,
        config,
      })
    }
    return
  }

  const config = await createConfig({
    commandName,
    subproject: commandWithProjects ? args[0] : false,
  })

  await runWithConfig({
    commandName,
    runCommand,
    config,
  })
})(...process.argv.slice(2)).catch(console.error)

async function runWithConfig({ commandName, runCommand, config }) {
  if (['dev', 'build'].indexOf(commandName) < 0) {
    // Other commands
    return runCommand({ config })
  }

  console.log('Build for', process.env.NODE_ENV)

  // Prepare tasks

  const { tasks } = config

  tasks.forEach(function (task, index) {
    if (task instanceof Function) {
      tasks[index] = {
        task: 'custom',
        build: task,
      }
      return
    }

    if (!task.task && task.src) {
      // Determine task type from src file extension

      const extension = task.src.split('.').pop()

      task.task =
        extension === 'scss'
          ? 'sass'
          : extension === 'html'
            ? 'html'
            : ['js', 'jsx', 'ts', 'tsx'].indexOf(extension) >= 0
              ? 'js'
              : undefined
    }
  })

  const reloader = await createReloader({
    commandName,
    config,
    tasks,
  })

  // Run tasks in parallel

  return Promise.all(
    tasks.map((task) =>
      (async () => {
        const taskConfigs = await createTaskConfigs({ config, task })

        if (!taskConfigs) {
          console.log(`Task not supported:`, task)
          return Promise.resolve() // Let other tasks continue
        }

        try {
          return await runCommand({
            config,
            task,
            reloader,
            ...taskConfigs,
          })
        } catch (e) {
          console.log(e)
        }
      })(),
    ),
  )
    .then(async function () {
      // All tasks done

      if (commandName !== 'dev') return

      if (reloader.active) {
        reloader.startServer()
      }

      if (config.serve) {
        await (
          await import('./commands/serve.js')
        ).default({
          config,
          reloader,
        })
      }

      console.log('..Watching files for changes - Press CTRL+C to exit')
    })
    .catch(console.log)
}
