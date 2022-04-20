const universal = require('@electron/universal');
const args = process.argv;

universal.makeUniversalApp({
  x64AppPath: args[2],
  arm64AppPath: args[3],
  outAppPath: args[4],
  force: true
});
