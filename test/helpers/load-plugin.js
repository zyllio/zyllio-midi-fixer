const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadPlugin(options = {}) {
  const registered = [];
  const context = {
    console,
    window: {},
    zySdk: {
      services: {
        registry: {
          registerAction: (metadata, ActionClass) => {
            registered.push({ metadata, ActionClass });
          }
        }
      }
    }
  };
  Object.assign(context, options.context);

  context.globalThis = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "src", "plugin.js"), "utf8");
  vm.runInContext(source, context, {
    filename: "src/plugin.js",
    importModuleDynamically: options.importModuleDynamically
  });

  return {
    cleanMidi: context.window.cleanMidi,
    registered,
    context
  };
}

module.exports = {
  loadPlugin
};
