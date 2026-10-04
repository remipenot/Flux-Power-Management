/* Drive the real page: select both house kinds, refuse a build, grant, then place it. */
"use strict";

var path = require("path");
var fs = require("fs");
var childProcess = require("child_process");

var root = path.join(__dirname, "..");
var scratch = process.env.FLUX_SCRATCH || "/tmp/grok-goal-a44bf782d283/implementer";
var pw = require("/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");

function rgbClose(actual, hex) {
  var m = String(actual).match(/\d+/g);
  if (!m) return false;
  var want = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  return Math.abs(Number(m[0]) - want[0]) < 12 && Math.abs(Number(m[1]) - want[1]) < 12 && Math.abs(Number(m[2]) - want[2]) < 12;
}

(async function () {
  var server = childProcess.spawn("python3", ["-m", "http.server", "8766", "--bind", "127.0.0.1"], { cwd: root, stdio: "ignore" });
  var browser = await pw.chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
  });
  try {
    await new Promise(function (r) { setTimeout(r, 300); });
    var page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    var errors = [];
    page.on("pageerror", function (err) { errors.push(String(err)); });
    await page.goto("http://127.0.0.1:8766/index.html", { waitUntil: "load" });
    await page.waitForFunction(function () { return window.POWER_GAME && window.POWER_GAME.frames > 3; });

    async function openHouse(variant) {
      var point = await page.evaluate(function (variant) {
        var node = window.POWER_GAME.state.nodes.filter(function (n) { return n.type === "house" && n.variant === variant; })[0];
        var p = window.POWER_GAME.project(node.x, 1.8, node.z);
        return { x: p.x, y: p.y, behind: p.behind, name: node.name, id: node.id };
      }, variant);
      if (point.behind) throw new Error(variant + " house is behind the camera");
      var top = await page.evaluate(function (p) {
        var el = document.elementFromPoint(p.x, p.y);
        return el ? (el.id || el.tagName) : "none";
      }, point);
      if (top !== "VIEW" && top !== "view") {
        throw new Error(variant + " click hits " + top + " at " + point.x + "," + point.y);
      }
      await page.mouse.click(point.x, point.y);
      return point;
    }

    var pwHouse = await openHouse("powerwall");
    await page.screenshot({ path: path.join(scratch, "flow-powerwall.png") });
    var power = await page.evaluate(function () {
      var card = document.getElementById("flow-card");
      function bg(sel) { return getComputedStyle(document.querySelector(sel)).backgroundColor; }
      return {
        hidden: card.hidden,
        mode: card.className,
        title: document.getElementById("flow-title").textContent,
        sub: document.getElementById("flow-sub").textContent,
        solar: bg(".fnode.solar .bubble"),
        home: bg(".fnode.home .bubble"),
        storage: bg(".mode-battery .fnode.storage .bubble"),
        grid: bg(".fnode.grid .bubble"),
        kwSolar: document.getElementById("kw-solar").textContent,
        kwHome: document.getElementById("kw-home").textContent,
        kwGrid: document.getElementById("kw-grid").textContent,
        kwStorage: document.getElementById("kw-storage").textContent,
        note: document.getElementById("flow-note").textContent
      };
    });
    if (power.hidden) throw new Error("powerwall card hidden");
    if (power.sub !== "Powerwall") throw new Error("sub " + power.sub);
    if (!/kW/.test(power.kwSolar + power.kwHome + power.kwGrid + power.kwStorage)) throw new Error("missing kW " + JSON.stringify(power));
    if (!rgbClose(power.solar, "#f5c518")) throw new Error("solar color " + power.solar);
    if (!rgbClose(power.home, "#3d7ee8")) throw new Error("home color " + power.home);
    if (!rgbClose(power.storage, "#34c759")) throw new Error("battery color " + power.storage);
    if (!rgbClose(power.grid, "#9aa3ad")) throw new Error("grid color " + power.grid);
    console.log("powerwall panel", power.title, power.kwSolar, power.kwHome, power.kwStorage, power.kwGrid);

    var car = await openHouse("vehicle");
    await page.screenshot({ path: path.join(scratch, "flow-vehicle.png") });
    var vehicle = await page.evaluate(function () {
      var card = document.getElementById("flow-card");
      return {
        hidden: card.hidden,
        mode: card.className,
        sub: document.getElementById("flow-sub").textContent,
        label: document.getElementById("storage-label").textContent,
        note: document.getElementById("flow-note").textContent,
        kw: document.getElementById("kw-storage").textContent
      };
    });
    if (vehicle.hidden || vehicle.sub !== "Véhicule") throw new Error("vehicle card " + JSON.stringify(vehicle));
    if (!/%/.test(vehicle.label)) throw new Error("vehicle label " + vehicle.label);
    if (vehicle.mode.indexOf("mode-vehicle") < 0) throw new Error("mode " + vehicle.mode);
    console.log("vehicle panel", car.name, vehicle.label, vehicle.note);

    await page.evaluate(function () { window.POWER_GAME.state.money = 100; window.PowerUI.refresh(); });
    await page.click("[data-type='turbine']");
    var spot = await page.evaluate(function () {
      var p = window.POWER_GAME.project(10, 0, 0);
      var el = document.elementFromPoint(p.x, p.y);
      return { x: p.x, y: p.y, top: el ? (el.id || el.tagName) : "none" };
    });
    if (spot.top.toLowerCase() !== "view") throw new Error("build click hits " + spot.top);
    await page.mouse.click(spot.x, spot.y);
    var denied = await page.evaluate(function () {
      return {
        turbines: window.POWER_GAME.state.nodes.filter(function (n) { return n.type === "turbine"; }).length,
        toast: document.getElementById("toast").textContent,
        money: window.POWER_GAME.state.money
      };
    });
    if (denied.turbines !== 0) throw new Error("broke the bank " + JSON.stringify(denied));
    if (!/insuffisant/i.test(denied.toast)) throw new Error("toast " + denied.toast);
    console.log("refused build", denied.toast);

    var before = Number(await page.getAttribute("#balance", "data-value"));
    await page.click("#grant");
    var after = Number(await page.getAttribute("#balance", "data-value"));
    if (after !== before + 10000) throw new Error("grant ui " + before + " -> " + after);
    await page.mouse.click(spot.x, spot.y);
    var built = await page.evaluate(function () {
      return window.POWER_GAME.state.nodes.some(function (n) { return n.type === "turbine"; });
    });
    if (!built) throw new Error("grant did not unlock the turbine");
    await page.screenshot({ path: path.join(scratch, "built.png") });
    console.log("turbine placed after grant");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    var box = await page.locator("#grant").boundingBox();
    if (!box || box.y + box.height > 844 || box.x < 0) throw new Error("grant offscreen " + JSON.stringify(box));
    await page.screenshot({ path: path.join(scratch, "mobile.png") });
    console.log("mobile grant", JSON.stringify(box));
    if (errors.length) throw new Error(errors.join("\n"));
    console.log("interact ok");
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }
})().catch(function (err) {
  console.error(err && err.stack || err);
  process.exit(1);
});
