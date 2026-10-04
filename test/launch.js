/* Launch the real page twice and check the drawing surface plus the grant control. */
"use strict";

var fs = require("fs");
var path = require("path");
var http = require("http");
var childProcess = require("child_process");

var root = path.join(__dirname, "..");
var scratch = process.env.FLUX_SCRATCH || "/tmp/grok-goal-a44bf782d283/implementer";
fs.mkdirSync(scratch, { recursive: true });

function loadPlaywright() {
  try { return require("playwright"); } catch (e) { /* local install optional */ }
  var cached = "/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright";
  return require(cached);
}

function failEnv(message) {
  fs.writeFileSync(path.join(scratch, "launch-env.txt"), message + "\n");
  var err = new Error(message);
  err.env = true;
  throw err;
}

function startServer() {
  return new Promise(function (resolve, reject) {
    var proc = childProcess.spawn("python3", ["-m", "http.server", "8765", "--bind", "127.0.0.1"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"]
    });
    var log = "";
    proc.stdout.on("data", function (b) { log += b.toString(); });
    proc.stderr.on("data", function (b) { log += b.toString(); });
    proc.on("exit", function (code) {
      if (!proc.expected && code) reject(new Error("http.server exited " + code + "\n" + log));
    });
    setTimeout(function () { resolve(proc); }, 400);
  });
}

function sample(page) {
  return page.evaluate(function () {
    var game = window.POWER_GAME;
    var canvas = document.querySelector("canvas");
    var gl = game && game.gl ? game.gl() : null;
    if (!gl) return { error: "no-gl" };
    gl.finish();
    var w = gl.drawingBufferWidth;
    var h = gl.drawingBufferHeight;
    var pix = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pix);
    var painted = 0;
    var samples = 0;
    var minX = w;
    var minY = h;
    var maxX = 0;
    var maxY = 0;
    var step = 2;
    var y, x, i, r, g, b, a;
    for (y = 0; y < h; y += step) {
      for (x = 0; x < w; x += step) {
        i = (y * w + x) * 4;
        r = pix[i];
        g = pix[i + 1];
        b = pix[i + 2];
        a = pix[i + 3];
        samples++;
        if (a > 0 && (r > 8 || g > 8 || b > 8)) {
          painted++;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    return {
      error: null,
      canvas: { width: canvas.width, height: canvas.height },
      surface: game.surface,
      buffer: { w: w, h: h },
      paintedRatio: samples ? painted / samples : 0,
      bounds: { minX: minX, minY: minY, maxX: maxX, maxY: maxY },
      frames: game.frames,
      cam: game.cameraInfo(),
      balance: document.getElementById("balance").getAttribute("data-value")
    };
  });
}

async function runOnce(browser, url, index, log) {
  var page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  var errors = [];
  page.on("pageerror", function (err) { errors.push("pageerror: " + err.message); });
  page.on("console", function (msg) {
    if (msg.type() === "error") errors.push("console: " + msg.text());
  });
  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(function () {
    return window.POWER_GAME && window.POWER_GAME.frames > 3 && window.POWER_GAME.surface.width > 100;
  }, null, { timeout: 20000 });
  await page.evaluate(function () { window.POWER_GAME.render(0.016); });
  var before = await sample(page);
  var balanceBefore = await page.getAttribute("#balance", "data-value");
  await page.click("#grant");
  var balanceAfter = await page.getAttribute("#balance", "data-value");
  var shot = path.join(scratch, "launch-" + index + ".png");
  await page.screenshot({ path: shot, fullPage: false });
  await page.close();
  var result = {
    index: index,
    url: url,
    errors: errors,
    before: before,
    balanceBefore: Number(balanceBefore),
    balanceAfter: Number(balanceAfter)
  };
  log.push(JSON.stringify(result, null, 2));
  if (errors.length) throw new Error("page errors:\n" + errors.join("\n"));
  if (!before || before.error) throw new Error("pixel readback failed: " + (before && before.error));
  if (before.canvas.width !== before.surface.width || before.canvas.height !== before.surface.height) {
    throw new Error("canvas " + before.canvas.width + "x" + before.canvas.height + " != surface " + before.surface.width + "x" + before.surface.height);
  }
  if (before.canvas.width < 640 || before.canvas.height < 480) throw new Error("surface too small");
  if (!(before.paintedRatio > 0.5)) throw new Error("painted fraction " + before.paintedRatio);
  var bw = before.bounds.maxX - before.bounds.minX;
  var bh = before.bounds.maxY - before.bounds.minY;
  if (bw < before.buffer.w * 0.7 || bh < before.buffer.h * 0.7) {
    throw new Error("painted bounds " + bw + "x" + bh + " of " + before.buffer.w + "x" + before.buffer.h);
  }
  var cam = before.cam;
  if (!cam.isPerspective || !(cam.y > 8) || !(cam.dirY < -0.15 && cam.dirY > -0.95)) {
    throw new Error("camera is not a perspective view " + JSON.stringify(cam));
  }
  if (!(result.balanceAfter === result.balanceBefore + 10000)) {
    throw new Error("grant " + result.balanceBefore + " -> " + result.balanceAfter);
  }
  console.log("launch " + index + " ok painted=" + before.paintedRatio.toFixed(3) + " " + before.canvas.width + "x" + before.canvas.height + " balance " + result.balanceBefore + " -> " + result.balanceAfter);
  return result;
}

(async function () {
  var server;
  var browser;
  try {
    var pw = loadPlaywright();
    server = await startServer();
    try {
      browser = await pw.chromium.launch({
        headless: true,
        args: [
          "--use-gl=angle",
          "--use-angle=swiftshader",
          "--enable-webgl",
          "--ignore-gpu-blocklist",
          "--enable-unsafe-swiftshader"
        ]
      });
    } catch (err) {
      failEnv("browser failed to launch: " + (err && err.stack || err));
    }
    var log = [];
    await runOnce(browser, "http://127.0.0.1:8765/index.html", 1, log);
    await runOnce(browser, "http://127.0.0.1:8765/index.html", 2, log);
    var filePage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    var fileErrors = [];
    filePage.on("pageerror", function (err) { fileErrors.push(String(err)); });
    await filePage.goto("file://" + path.join(root, "index.html"), { waitUntil: "load" });
    await filePage.waitForFunction(function () {
      return window.POWER_GAME && window.POWER_GAME.frames > 2;
    }, null, { timeout: 20000 });
    log.push("file:// frames=" + await filePage.evaluate(function () { return window.POWER_GAME.frames; }) + " errors=" + fileErrors.join(" | "));
    if (fileErrors.length) throw new Error("file:// errors " + fileErrors.join("\n"));
    await filePage.close();
    fs.writeFileSync(path.join(scratch, "launch.log"), log.join("\n\n"));
    console.log("launches passed");
  } catch (err) {
    var text = (err && err.stack) || String(err);
    try { fs.writeFileSync(path.join(scratch, "launch.log"), text); } catch (e) { /* ignore */ }
    console.error(text);
    process.exitCode = err && err.env ? 2 : 1;
  } finally {
    if (browser) await browser.close();
    if (server) {
      server.expected = true;
      server.kill("SIGTERM");
    }
  }
})();
