// SessionStart: plain stdout is added to Claude's context.
try {
  process.stdout.write(require('fs').readFileSync(require('path').join(__dirname, 'rules.md'), 'utf8'));
} catch {}
