/* Boots the page. Classic script: works from disk, no module loader. */
(function (global) {
  "use strict";

  function boot() {
    if (typeof document === "undefined" || !document.getElementById) return;
    var canvas = document.getElementById("view");
    if (!canvas || typeof global.PowerRender === "undefined" || typeof global.GridSim === "undefined") return;
    try {
      var game = global.PowerRender.attach(canvas);
      global.PowerUI.mount(game);
      global.POWER_GAME = game;
      var last = 0;
      function frame(now) {
        var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
        last = now;
        if (!game.paused) global.GridSim.tick(game.state, dt * game.hoursPerSecond);
        game.sync();
        game.render(dt);
        global.PowerUI.refresh();
        global.requestAnimationFrame(frame);
      }
      game.resize();
      global.requestAnimationFrame(function () {
        game.resize();
        global.requestAnimationFrame(frame);
      });
    } catch (err) {
      var box = document.getElementById("boot-error");
      if (box) {
        box.hidden = false;
        box.textContent = (err && err.stack) || String(err);
      }
      throw err;
    }
  }

  global.POWER_GAME_BOOT = boot;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }
})(typeof window !== "undefined" ? window : globalThis);
