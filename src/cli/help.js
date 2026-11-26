// Copyright (c) 2026 bachbnt

const { BRAND, VERSION, frameworkDefinitions } = require('../config');
const { COMMANDS } = require('./commands');
const { helpOptions } = require('./options');

const SECTIONS = [
  { id: 'project', title: 'Project Lifecycle:', color: 'magenta' },
  { id: 'tools', title: 'Tools:', color: 'magenta' },
  { id: 'openers' },
  { id: 'devices', title: 'Devices:', color: 'blue' },
  { id: 'history', title: 'History:', color: 'cyan' },
];

function printOpeners(pc, openerRegistry) {
  console.log(`\n${pc.bold('Openers:')}`);
  for (const opener of openerRegistry?.values() || []) {
    const aliases = opener.aliases?.length ? ` (${opener.aliases.join(', ')})` : '';
    const source = opener.source === 'user' ? ' [user]' : '';
    console.log(
      `  ${pc.cyan(opener.name.padEnd(20))} ${pc.dim(`${opener.description}${aliases}${source}`)}`
    );
  }
}

// Everything is generated: commands from the registry, options from the option definitions.
function printHelp(pc, definitions = frameworkDefinitions, openerRegistry) {
  console.log(
    `\n${pc.bgCyan(pc.black(` ${BRAND} v${VERSION} `))} ${pc.bold('Development toolkit by bachbnt')}\n`
  );
  console.log(pc.bold('Usage:'));
  console.log('  dev <command> [target] [options]\n');

  console.log(pc.bold('Frameworks:'));
  for (const command of COMMANDS.filter((entry) => entry.section === 'frameworks')) {
    console.log(`  ${pc.green(command.name.padEnd(20))} ${pc.dim(command.description)}`);
  }
  for (const [name, definition] of Object.entries(definitions)) {
    console.log(`  ${pc.green(name.padEnd(20))} ${pc.dim(definition.description)}`);
  }

  for (const section of SECTIONS) {
    if (section.id === 'openers') {
      printOpeners(pc, openerRegistry);
      continue;
    }
    console.log(`\n${pc.bold(section.title)}`);
    const paint = pc[section.color];
    for (const command of COMMANDS.filter((entry) => entry.section === section.id)) {
      console.log(`  ${paint(command.name.padEnd(16))} ${pc.dim(command.description)}`);
    }
  }

  console.log(`\n${pc.bold('Options:')}`);
  const options = helpOptions();
  // Wide enough for the longest flag, so a new option can never push its text out of line.
  const width = Math.max(31, ...options.map(({ flags }) => flags.length));
  for (const { flags, text } of options) {
    console.log(`  ${flags.padEnd(width)} ${pc.dim(text)}`);
  }
  console.log('');
}

module.exports = { printHelp };
