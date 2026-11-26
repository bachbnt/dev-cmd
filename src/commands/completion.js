// Copyright (c) 2026 bachbnt

const { frameworkDefinitions } = require('../config');
const { COMMANDS: REGISTRY } = require('../cli/commands');
const { completionOptions } = require('../cli/options');

// Every registered command plus `help`, generated from the command registry.
const SYSTEM_COMMANDS = [...REGISTRY.map((command) => command.name), 'help'];
const COMMANDS = [...Object.keys(frameworkDefinitions), ...SYSTEM_COMMANDS];
const OPTIONS = completionOptions();

function commandNames(definitions = frameworkDefinitions) {
  return [...Object.keys(definitions), ...SYSTEM_COMMANDS];
}

function openerNames(registry) {
  if (!registry) return [];
  return [...registry.values()].flatMap((opener) => [opener.name, ...(opener.aliases || [])]);
}

function bashCompletion(definitions, openerRegistry) {
  const commands = commandNames(definitions);
  const candidates = [...OPTIONS, ...openerNames(openerRegistry)];
  return `_devcmd_completion() {
  local current
  current="\${COMP_WORDS[COMP_CWORD]}"
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${commands.join(' ')}" -- "\${current}") )
  else
    COMPREPLY=( $(compgen -W "${candidates.join(' ')}" -- "\${current}") )
  fi
}
complete -F _devcmd_completion dev devcmd
`;
}

function zshCompletion(definitions, openerRegistry) {
  const commands = commandNames(definitions);
  const candidates = [...OPTIONS, ...openerNames(openerRegistry)];
  return `#compdef dev devcmd

_devcmd() {
  local -a commands options
  commands=(${commands.map((command) => `'${command}'`).join(' ')})
  options=(${candidates.map((option) => `'${option}'`).join(' ')})

  if (( CURRENT == 2 )); then
    _describe 'command' commands
  else
    _describe 'option' options
    _files
  fi
}

compdef _devcmd dev devcmd
`;
}

function getCompletion(shell, definitions = frameworkDefinitions, openerRegistry) {
  if (shell === 'bash') return bashCompletion(definitions, openerRegistry);
  if (shell === 'zsh') return zshCompletion(definitions, openerRegistry);
  throw new Error('Completion supports: bash, zsh.');
}

module.exports = {
  COMMANDS,
  OPTIONS,
  SYSTEM_COMMANDS,
  commandNames,
  getCompletion,
  openerNames,
};
