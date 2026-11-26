// Copyright (c) 2026 bachbnt

// Uninstalling apps is automatic on macOS only. Elsewhere DevCmd prints the official command and
// leaves running it to the person.

const HINTS = {
  win32: ['winget uninstall <name>', 'or: Settings > Apps > Installed apps'],
  linux: ['flatpak uninstall <app>', 'snap remove <app>', 'sudo apt remove <package>'],
};

function platformSupport(platform = process.platform) {
  if (platform === 'darwin') return { automatic: true, hints: [] };
  return { automatic: false, hints: HINTS[platform] || [] };
}

module.exports = { platformSupport };
