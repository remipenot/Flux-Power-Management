/* Evaluate every script the page ships with window defined and no Node module/require. */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var root = path.join(__dirname, "..");
var html = fs.readFileSync(path.join(root, "index.html"), "utf8");
var scripts = [];
var re = /<script\s+src="([^"]+)"><\/script>/g;
var match;
while ((match = re.exec(html))) scripts.push(match[1]);
if (scripts.length < 4) {
  console.error("index.html scripts not found");
  process.exit(1);
}

var sandbox = {
  console: console,
  window: null,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

if ("module" in sandbox || "require" in sandbox || "exports" in sandbox) {
  console.error("realm leaked Node module objects");
  process.exit(1);
}

scripts.forEach(function (rel) {
  var file = path.join(root, rel);
  var code = fs.readFileSync(file, "utf8");
  try {
    vm.runInContext(code, sandbox, { filename: rel });
    console.log("loaded " + rel);
  } catch (err) {
    console.error("THROW in " + rel);
    console.error(err && err.stack || err);
    process.exit(1);
  }
});

if (!sandbox.THREE || typeof sandbox.THREE.WebGLRenderer !== "function") {
  console.error("THREE.WebGLRenderer missing");
  process.exit(1);
}
if (!sandbox.GridSim || typeof sandbox.GridSim.tick !== "function" || typeof sandbox.GridSim.create !== "function") {
  console.error("GridSim entry missing");
  process.exit(1);
}
if (!sandbox.PowerRender || typeof sandbox.PowerRender.attach !== "function") {
  console.error("PowerRender entry missing");
  process.exit(1);
}
if (!sandbox.PowerUI || typeof sandbox.PowerUI.mount !== "function") {
  console.error("PowerUI entry missing");
  process.exit(1);
}
if (typeof sandbox.POWER_GAME_BOOT !== "function") {
  console.error("POWER_GAME_BOOT missing");
  process.exit(1);
}
console.log("ok — browser realm installed GridSim, PowerRender, PowerUI, POWER_GAME_BOOT");
