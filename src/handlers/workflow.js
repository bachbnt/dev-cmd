// Copyright (c) 2026 bachbnt

const path = require('path');
const { buildLifecycleCommands, buildTaskCommands, listTasks } = require('../commands/lifecycle');
const { LIFECYCLE_COMMANDS } = require('../constants');
const { detectProject } = require('../projects/detect');
const { describeProfile, isTrusted, trustProfile } = require('../projects/profile');
const { formatSequence } = require('../runner/command');
const { runParallel } = require('../runner/parallel');
const { executeCommands } = require('../runtime/execute');

const TASK_NAME = /^[A-Za-z0-9][A-Za-z0-9:_.-]*$/;
const PARALLEL_ACTIONS = LIFECYCLE_COMMANDS.filter((action) => action !== 'open');

function detect(projectPath, context) {
  return detectProject(projectPath || process.cwd(), { registry: context.recipeRegistry });
}

function projectMetadata(project, command, config) {
  return {
    command,
    projectName: project.name,
    projectPath: project.root,
    projectType: project.type,
    config,
  };
}

async function handleTask(context) {
  const { p, pc, positionals, options, config } = context;
  if (positionals.length > 2) throw new Error('Usage: dev task [name] [path]');
  const [name, projectPath] = positionals;
  const project = detect(projectPath, context);
  if (!name) {
    const tasks = listTasks(project);
    if (tasks.length === 0) {
      p.outro('No tasks found. Add scripts to package.json or tasks to .devcmd.json.');
      return 0;
    }
    p.note(
      tasks.map((task) => {
        const description = task.description ? ` ${pc.dim(task.description)}` : '';
        return `${task.name.padEnd(20)} [${task.source}]${description}`;
      }).join('\n'),
      `Tasks: ${project.name}`
    );
    p.outro('Use: dev task <name> [path]');
    return 0;
  }
  if (!TASK_NAME.test(name)) throw new Error(`Invalid task name: ${name}`);
  const commands = buildTaskCommands(project, name, { config, filter: options.filter });
  return executeCommands(p, pc, commands, projectMetadata(project, 'task', config), options);
}

async function handleParallel(context) {
  const { p, pc, positionals, options, config } = context;
  const [action, ...paths] = positionals;
  if (!PARALLEL_ACTIONS.includes(action) || paths.length === 0) {
    throw new Error(`Usage: dev parallel <${PARALLEL_ACTIONS.join('|')}> <path> [path...]`);
  }
  const jobs = paths.map((projectPath) => {
    const project = detect(projectPath, context);
    return {
      label: project.name || path.basename(project.root),
      commands: buildLifecycleCommands(action, project, { config }),
    };
  });
  const labels = new Set(jobs.map((job) => job.label));
  if (labels.size !== jobs.length) {
    jobs.forEach((job, index) => {
      job.label = `${job.label}#${index + 1}`;
    });
  }
  for (const job of jobs) p.log.step(`${pc.cyan(job.label)}: ${pc.yellow(formatSequence(job.commands))}`);
  if (options.dryRun) {
    p.outro('No command was executed.');
    return 0;
  }
  const result = await runParallel(jobs);
  const summary = result.results
    .map((entry) => `${entry.ok ? pc.green('✔') : pc.red('✖')} ${entry.label}${entry.ok ? '' : ` (exit ${entry.exitCode})`}`)
    .join('\n');
  p.note(summary, `dev ${action}`);
  p.outro(result.ok ? `${pc.green('✔')} All projects completed.` : `${pc.red('✖')} Some projects failed.`);
  return result.exitCode;
}

async function handleTrust(context) {
  const { p, pc, positionals, options, config } = context;
  if (positionals.length > 1) throw new Error('Usage: dev trust [path]');
  const project = detect(positionals[0], context);
  if (!project.profile) throw new Error(`No .devcmd.json was found for ${project.root}.`);
  const entries = describeProfile(project, { config });
  p.note(
    entries.length
      ? entries.map((entry) => `${pc.bold(entry.label)}\n  ${formatSequence(entry.commands)}`).join('\n')
      : 'The profile does not define any commands.',
    project.profile.file
  );
  if (isTrusted(project.profile)) {
    p.outro('This profile is already trusted.');
    return 0;
  }
  if (!options.yes) {
    const approved = await p.confirm({ message: 'Trust this profile and allow DevCmd to run these commands?' });
    if (p.isCancel(approved) || !approved) {
      p.cancel('Profile was not trusted.');
      return 130;
    }
  }
  trustProfile(project.profile);
  p.outro('Profile trusted. It will need approval again if the file changes.');
  return 0;
}

module.exports = {
  PARALLEL_ACTIONS,
  handleParallel,
  handleTask,
  handleTrust,
};
