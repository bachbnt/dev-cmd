// Copyright (c) 2026 bachbnt

const { PACKAGE_MANAGERS } = require('../config');
const { FILTER_COMMANDS, JSON_COMMANDS } = require('../constants');
const { AI_FORMATS, AI_GROUPS, AI_TOOLS } = require('../ai/constants');

// Every command-line option is declared once here. `parseArgs`, `validateCommandFlags`, the options
// section of `dev help`, and shell completion are all generated from this list.
//
//   key       property on the parsed `options` object
//   names     accepted spellings; the first is the primary one (used by completion and messages)
//   kind      'flag' (sets `value`, default true), 'value' (takes one argument), 'assignment' (--set)
//   default   initial value of `options[key]` (the first definition for a key supplies it)
//   multiple  a 'value' option that may repeat; `options[key]` becomes an array
//   valid     predicate for a 'value' argument (default: non-empty and not starting with '-')
//   invalid   error message when the argument is missing or rejected
//   onlyFor   commands that may use it; any other command is rejected
//   preset    scaffold preset option; only valid with framework commands
//   help      { flags, text, order } line in `dev help`

const FILTER_PATTERN = /^[@A-Za-z0-9._][@A-Za-z0-9._/-]*$/;
const ASSIGNMENT_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

const OPTION_DEFS = [
  { key: 'dryRun', names: ['--dry-run'], kind: 'flag', default: false, help: { flags: '--dry-run', text: 'Print without executing', order: 10 } },
  { key: 'coldBoot', names: ['--cold-boot'], kind: 'flag', default: false, onlyFor: ['android'], help: { flags: '--cold-boot', text: 'Cold boot Android emulator', order: 170 } },
  { key: 'clear', names: ['--clear'], kind: 'flag', default: false, onlyFor: ['history'], help: { flags: '--clear', text: 'Clear history (history only)', order: 190 } },
  {
    key: 'project', names: ['--project'], kind: 'value', default: undefined, invalid: '--project requires a path.', onlyFor: ['history'],
    help: { flags: '--project <path>', text: 'Filter history by project path (history only)', order: 200 },
  },
  { key: 'shutdownAll', names: ['--shutdown-all'], kind: 'flag', default: false, onlyFor: ['ios'], help: { flags: '--shutdown-all', text: 'Shutdown all iOS simulators', order: 180 } },
  { key: 'list', names: ['--list'], kind: 'flag', default: false, onlyFor: ['open'], help: { flags: '--list', text: 'List available openers', order: 110 } },
  {
    key: 'opener', names: ['--with'], kind: 'value', default: undefined, invalid: '--with requires an opener name.', onlyFor: ['open'],
    help: { flags: '--with <opener>', text: 'Select an opener for dev open', order: 100 },
  },
  {
    key: 'editor', names: ['--editor'], kind: 'value', default: undefined, invalid: '--editor requires an application or executable name.', onlyFor: ['open'],
    help: { flags: '--editor <executable>', text: 'Override editor for dev open', order: 90 },
  },
  { key: 'json', names: ['--json'], kind: 'flag', default: false, onlyFor: JSON_COMMANDS, help: { flags: '--json', text: 'Print machine-readable JSON (inspect, doctor, ...)', order: 140 } },
  { key: 'fix', names: ['--fix'], kind: 'flag', default: false, onlyFor: ['lint'], help: { flags: '--fix', text: 'Apply automatic fixes (lint only)', order: 130 } },
  { key: 'yes', names: ['--yes', '-y'], kind: 'flag', default: false, onlyFor: ['trust'], help: { flags: '--yes, -y', text: 'Skip confirmation (trust only)', order: 160 } },
  {
    key: 'filter', names: ['--filter'], kind: 'value', default: undefined,
    valid: (value) => Boolean(value) && FILTER_PATTERN.test(value) && !value.includes('..'),
    invalid: '--filter requires a workspace package name or directory.', onlyFor: FILTER_COMMANDS,
    help: { flags: '--filter <workspace>', text: 'Target one monorepo workspace (run, test, build, ...)', order: 120 },
  },
  {
    key: 'search', names: ['--search'], kind: 'value', default: undefined, invalid: '--search requires text.', onlyFor: ['history'],
    help: { flags: '--search <text>', text: 'Filter history by text (history only)', order: 150 },
  },

  // dev ai
  { key: 'by', names: ['--by'], kind: 'value', default: undefined, valid: (value) => AI_GROUPS.includes(value), invalid: `--by must be one of: ${AI_GROUPS.join(', ')}`, onlyFor: ['ai'], help: { flags: '--by <group>', text: `Group AI usage by ${AI_GROUPS.join(', ')} (ai only)`, order: 210 } },
  { key: 'aiTools', names: ['--tool'], kind: 'value', multiple: true, default: undefined, valid: (value) => AI_TOOLS.includes(value), invalid: `--tool must be one of: ${AI_TOOLS.join(', ')}`, onlyFor: ['ai'], help: { flags: '--tool <id>', text: 'Only these AI tools, repeatable (ai only)', order: 211 } },
  { key: 'models', names: ['--model'], kind: 'value', multiple: true, default: undefined, invalid: '--model requires text.', onlyFor: ['ai'], help: { flags: '--model <text>', text: 'Only models whose name contains the text (ai only)', order: 212 } },
  { key: 'repos', names: ['--repo'], kind: 'value', multiple: true, default: undefined, invalid: '--repo requires text.', onlyFor: ['ai'], help: { flags: '--repo <text>', text: 'Only projects whose folder name contains the text (ai only)', order: 213 } },
  { key: 'since', names: ['--since'], kind: 'value', default: undefined, invalid: '--since requires a date (2026-11-01, today, 7d, 2w, 3m).', onlyFor: ['ai'], help: { flags: '--since <date>, --until <date>', text: 'Period for ai report or --history', order: 214 } },
  { key: 'until', names: ['--until'], kind: 'value', default: undefined, invalid: '--until requires a date (2026-11-01, today, 7d, 2w, 3m).', onlyFor: ['ai'] },
  { key: 'format', names: ['--format'], kind: 'value', default: undefined, valid: (value) => AI_FORMATS.includes(value), invalid: `--format must be one of: ${AI_FORMATS.join(', ')}`, onlyFor: ['ai'], help: { flags: '--format <table|json|csv>', text: 'Output format (ai only)', order: 215 } },
  { key: 'check', names: ['--check'], kind: 'flag', default: false, onlyFor: ['ai'], help: { flags: '--check', text: 'Exit 1 when over the monthly budget (ai only)', order: 216 } },
  { key: 'short', names: ['--short'], kind: 'flag', default: false, onlyFor: ['ai'], help: { flags: '--short', text: 'One line for a status line (ai only)', order: 217 } },
  { key: 'history', names: ['--history'], kind: 'flag', default: false, onlyFor: ['ai'], help: { flags: '--history', text: 'Show daily totals kept beyond the logs (ai only)', order: 218 } },
  { key: 'showTools', names: ['--tools'], kind: 'flag', default: false, onlyFor: ['ai'], help: { flags: '--tools', text: 'List the AI tools whose logs are read (ai only)', order: 219 } },
  { key: 'pricing', names: ['--pricing'], kind: 'value', default: undefined, invalid: '--pricing requires a TOML file.', onlyFor: ['ai'], help: { flags: '--pricing <file>', text: 'Extra price file for models (ai only)', order: 220 } },
  { key: 'claudeDir', names: ['--claude-dir'], kind: 'value', default: undefined, invalid: '--claude-dir requires a folder.', onlyFor: ['ai'], help: { flags: '--claude-dir <dir>, --codex-dir <dir>', text: 'Read logs from another folder (ai only)', order: 221 } },
  { key: 'codexDir', names: ['--codex-dir'], kind: 'value', default: undefined, invalid: '--codex-dir requires a folder.', onlyFor: ['ai'] },
  { key: 'noCache', names: ['--no-cache'], kind: 'flag', default: false, onlyFor: ['ai'], help: { flags: '--no-cache, --no-snapshot', text: 'Skip the scan cache or the daily history file (ai only)', order: 222 } },
  { key: 'noSnapshot', names: ['--no-snapshot'], kind: 'flag', default: false, onlyFor: ['ai'] },
  { key: 'verbose', names: ['--verbose'], kind: 'flag', default: false, onlyFor: ['ai'], help: { flags: '--verbose', text: 'Show scan details (ai only)', order: 223 } },

  // Scaffold presets: only valid with framework commands.
  { key: 'typescript', names: ['--typescript', '--ts'], kind: 'flag', value: true, default: undefined, preset: true, help: { flags: '--typescript, --javascript', text: 'Select project language', order: 20 } },
  { key: 'typescript', names: ['--javascript', '--js'], kind: 'flag', value: false, preset: true },
  ...PACKAGE_MANAGERS.map((manager, index) => ({
    key: 'packageManager', names: [`--${manager}`], kind: 'flag', value: manager, default: undefined, preset: true,
    ...(index === 0 ? { help: { flags: PACKAGE_MANAGERS.map((name) => `--${name}`).join(', '), text: 'Select package manager', order: 30 } } : {}),
  })),
  {
    key: 'packageManager', names: ['--package-manager', '--pm'], kind: 'value', preset: true,
    valid: (value) => PACKAGE_MANAGERS.includes(value),
    invalid: `Package manager must be one of: ${PACKAGE_MANAGERS.join(', ')}`,
  },
  { key: 'git', names: ['--git'], kind: 'flag', value: true, default: undefined, preset: true, help: { flags: '--git, --no-git', text: 'Toggle Git initialization', order: 40 } },
  { key: 'git', names: ['--no-git'], kind: 'flag', value: false, preset: true },
  { key: 'eslint', names: ['--eslint'], kind: 'flag', value: true, default: undefined, preset: true, help: { flags: '--eslint, --no-eslint', text: 'Toggle ESLint where supported', order: 50 } },
  { key: 'eslint', names: ['--no-eslint'], kind: 'flag', value: false, preset: true },
  { key: 'noInstall', names: ['--no-install'], kind: 'flag', value: true, default: false, preset: true, help: { flags: '--no-install', text: 'Scaffold without installing dependencies', order: 60 } },
  { key: 'noInstall', names: ['--install'], kind: 'flag', value: false, preset: true },
  {
    key: 'python', names: ['--python'], kind: 'value', default: undefined, preset: true, invalid: '--python requires an executable name or path.',
    help: { flags: '--python <executable>', text: 'Select Python executable', order: 70 },
  },
  { key: 'values', names: ['--set'], kind: 'assignment', default: undefined, preset: true, help: { flags: '--set <name=value>', text: 'Set a custom recipe input', order: 80 } },
];

const BY_NAME = new Map();
for (const definition of OPTION_DEFS) {
  for (const name of definition.names) BY_NAME.set(name, definition);
}

function defaultOptions() {
  const options = { target: undefined, values: {} };
  for (const definition of OPTION_DEFS) {
    if (definition.key !== 'values' && !(definition.key in options)) options[definition.key] = definition.default;
  }
  return options;
}

function isValidValue(definition, value) {
  if (definition.valid) return definition.valid(value);
  return Boolean(value) && !value.startsWith('-');
}

function applyOption(definition, args, options) {
  if (definition.kind === 'flag') {
    options[definition.key] = definition.value === undefined ? true : definition.value;
    return;
  }
  if (definition.kind === 'assignment') {
    const assignment = args.shift();
    const separator = assignment?.indexOf('=') ?? -1;
    if (separator < 1) throw new Error('--set requires name=value.');
    const name = assignment.slice(0, separator);
    const value = assignment.slice(separator + 1);
    if (!ASSIGNMENT_NAME.test(name) || !value) {
      throw new Error('--set requires a valid name and non-empty value.');
    }
    options.values[name] = value;
    return;
  }
  const value = args.shift();
  if (!isValidValue(definition, value)) throw new Error(definition.invalid);
  if (definition.multiple) options[definition.key] = [...(options[definition.key] || []), value];
  else options[definition.key] = value;
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  const options = defaultOptions();
  const positionals = [];

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      if (!options.target) options.target = arg;
      continue;
    }
    const definition = BY_NAME.get(arg);
    if (!definition) throw new Error(`Unsupported option: ${arg}`);
    applyOption(definition, args, options);
  }
  return { command, options, positionals };
}

function describeOnlyFor(name, commands) {
  return commands.length === 1
    ? `${name} is only supported by the ${commands[0]} command.`
    : `${name} is only supported by: ${commands.join(', ')}.`;
}

function isUsed(options, definition) {
  return Boolean(options[definition.key]);
}

function hasPreset(options) {
  return OPTION_DEFS.some((definition) => {
    if (!definition.preset) return false;
    const current = options[definition.key];
    if (definition.key === 'values') return Object.keys(current || {}).length > 0;
    if (definition.key === 'noInstall') return Boolean(current);
    return current !== undefined;
  });
}

// `definitions` are the framework recipes currently available (built-in plus user recipes).
function validateCommandFlags(command, options, definitions) {
  for (const definition of OPTION_DEFS) {
    if (!definition.onlyFor || !isUsed(options, definition) || definition.onlyFor.includes(command)) continue;
    throw new Error(describeOnlyFor(definition.names[0], definition.onlyFor));
  }
  if (options.editor && options.opener) {
    throw new Error('--editor and --with cannot be used together.');
  }
  if (hasPreset(options) && !definitions[command]) {
    throw new Error('Project preset options can only be used with framework commands.');
  }
}

// The primary spelling of every option, for shell completion.
function completionOptions() {
  return [...new Set(OPTION_DEFS.map((definition) => definition.names[0]))];
}

// Lines for the options section of `dev help`, in display order.
function helpOptions() {
  return OPTION_DEFS.filter((definition) => definition.help)
    .map((definition) => definition.help)
    .sort((left, right) => left.order - right.order);
}

module.exports = {
  OPTION_DEFS,
  completionOptions,
  defaultOptions,
  helpOptions,
  parseArgs,
  validateCommandFlags,
};
