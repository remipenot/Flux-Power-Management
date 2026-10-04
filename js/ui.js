/* DOM for FLUX. All sim calls go through GridSim. */
(function (global) {
  "use strict";

  var game = null;
  var toastTimer = 0;

  var REASONS = {
    "fonds insuffisants": "Fonds insuffisants pour cette construction.",
    fluide: "Un tuyau ne relie que la prise d'eau, le chauffe-eau, la chaudière, le collecteur et la turbine.",
    electrique: "Un câble ne relie que les équipements électriques.",
    existe: "Ce lien existe déjà.",
    boucle: "Reliez deux équipements différents.",
    noeud: "Équipement introuvable.",
    type: "Construction inconnue.",
    fixe: "Les maisons et l'usine restent en place.",
    absent: "Rien à retirer ici."
  };

  function $(id) { return document.getElementById(id); }

  function money(n) {
    return Math.round(n).toLocaleString("fr-CA") + "\u00a0$";
  }

  function kw(n) {
    var v = Math.abs(Number(n) || 0);
    if (v >= 100) return v.toFixed(0) + " kW";
    if (v >= 10) return v.toFixed(1) + " kW";
    return v.toFixed(2) + " kW";
  }

  function clock(hour) {
    var day = Math.floor(hour / 24) + 1;
    var h = Math.floor(((hour % 24) + 24) % 24);
    var m = Math.floor((((hour % 24) + 24) % 1) * 60);
    return "Jour " + day + " · " + String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }

  function dayPart(hour) {
    var h = ((hour % 24) + 24) % 24;
    if (h < 5 || h >= 21) return "Nuit";
    if (h < 8) return "Aube";
    if (h < 11) return "Matin";
    if (h < 14) return "Midi";
    if (h < 18) return "Après-midi";
    return "Soir";
  }

  function toast(message) {
    var el = $("toast");
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3200);
  }

  function report(res) {
    if (res && res.ok) return;
    toast(REASONS[(res && res.reason) || ""] || "Action impossible.");
  }

  function paintEconomy() {
    var state = game.state;
    var balance = $("balance");
    balance.dataset.value = String(state.money);
    balance.textContent = money(state.money);
    var price = $("price");
    if (document.activeElement !== price) price.value = String(Math.round(state.price * 1000) / 1000);
    var kwh = state.exportableKWh;
    $("surplus").textContent = (kwh >= 10 ? kwh.toFixed(0) : kwh.toFixed(1)) + " kWh";
    $("house-count").textContent = global.GridSim.houseCount(state) + " maisons";
    paintStats();
    paintGrow();
  }

  function paintStats() {
    var live = game.state.live;
    var prod = $("stat-prod");
    var use = $("stat-use");
    var bal = $("stat-bal");
    if (!prod || !live) return;
    prod.textContent = kw(live.produceKw);
    use.textContent = kw(live.consumeKw);
    var gap = live.balanceKw || 0;
    bal.textContent = (gap >= 0 ? "+" : "−") + kw(gap);
    bal.classList.toggle("ok", gap >= -0.05);
    bal.classList.toggle("bad", gap < -0.05);
    var weather = live.weather || {};
    $("stat-weather").textContent = (weather.temp > 0 ? "+" : "") + weather.temp + " °C";
    $("stat-peak").textContent = live.peak || (weather.label || "Hors pointe");
    var packs = live.packOut > 0.05 ? "décharge " + kw(live.packOut) : live.packIn > 0.05 ? "charge " + kw(live.packIn) : "au repos";
    $("stat-detail").textContent =
      "Thermique " + kw(live.thermalKw) + " · Fermes " + kw(live.solarKw) +
      " · Toits " + kw(live.roofKw) + " · Batteries " + packs +
      " · Servi " + kw(live.servedKw) +
      " · Aujourd'hui " + (game.state.dayGeneratedKWh || 0).toFixed(0) + " produits / " +
      (game.state.dayConsumedKWh || 0).toFixed(0) + " kWh consommés";
  }

  function paintGrow() {
    var btn = $("auto-grow");
    if (!btn) return;
    var on = game.state.autoGrow !== false;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = on ? "Maisons auto : oui" : "Maisons auto : non";
  }

  function paintDistricts() {
    ["residential", "industrial"].forEach(function (id) {
      var d = global.GridSim.district(game.state, id);
      var el = $("chip-" + id);
      var pct = d.demandKw > 0.05 ? Math.round(100 * Math.min(1, d.servedKw / d.demandKw)) : 0;
      var label = d.satisfied ? "satisfait" : "sous-alimenté";
      el.textContent = d.name + " · " + label + " · " + pct + "%";
      el.classList.toggle("ok", !!d.satisfied);
      el.classList.toggle("bad", !d.satisfied);
    });
    $("clock").textContent = clock(game.state.hour);
    var live = game.state.live;
    var weather = live && live.weather;
    var peak = live && live.peak;
    var extra = weather ? " · " + weather.temp + " °C" : "";
    $("daypart").textContent = dayPart(game.state.hour) + extra + (peak ? " · " + peak : "");
  }

  function findLink(id) {
    var links = game.state.links;
    for (var i = 0; i < links.length; i++) if (links[i].id === id) return links[i];
    return null;
  }

  function showLink(edge) {
    $("help-card").hidden = true;
    $("flow-card").hidden = true;
    $("machine-card").hidden = true;
    var card = $("link-card");
    card.hidden = false;
    var a = global.GridSim.node(game.state, edge.from);
    var b = global.GridSim.node(game.state, edge.to);
    $("link-title").textContent = edge.kind === "pipe" ? "Tuyau" : "Câble";
    var fromName = a ? a.name : "?";
    var toName = b ? b.name : "?";
    var upstream = fromName;
    var downstream = toName;
    if (edge.kind === "cable" && edge.dir < 0) {
      upstream = toName;
      downstream = fromName;
    }
    $("link-ends").textContent = upstream + " → " + downstream;
    var flow = edge.flow || 0;
    $("link-flow").textContent = flow > 0.05 ? kw(flow) + " en transit" : "Pas de flux pour l'instant";
    if (flow <= 0.05) {
      $("link-note").textContent = edge.kind === "pipe"
        ? "Aucun fluide ne circule dans ce tuyau."
        : "Aucun courant ne circule dans ce câble.";
    } else if (edge.kind === "pipe") {
      $("link-note").textContent = "Le fluide va de " + fromName + " vers " + toName + ".";
    } else {
      $("link-note").textContent = "Le courant va de " + upstream + " vers " + downstream + ".";
    }
  }

  function showFlow(node) {
    $("help-card").hidden = true;
    $("machine-card").hidden = true;
    $("link-card").hidden = true;
    var card = $("flow-card");
    card.hidden = false;
    var vehicle = node.variant === "vehicle";
    card.classList.toggle("mode-vehicle", vehicle);
    card.classList.toggle("mode-battery", !vehicle);
    $("flow-title").textContent = node.name;
    $("flow-sub").textContent = vehicle ? "Véhicule" : "Powerwall";
    var flow = node.flow || {
      solarKw: 0, servedHomeKw: 0, homeKw: 0, gridKw: 0, batteryKw: 0,
      batterySoc: 0, vehicleKw: 0, servedVehicleKw: 0, vehicleSoc: 0,
      satisfied: false, channels: {}
    };
    $("kw-solar").textContent = kw(flow.solarKw);
    $("kw-home").textContent = kw(flow.servedHomeKw);
    var grid = flow.gridKw || 0;
    $("kw-grid").textContent = kw(grid);
    $("grid-dir").textContent = grid > 0.05 ? "Réseau · import" : grid < -0.05 ? "Réseau · export" : "Réseau";
    var away = !!(node.vehicle && node.vehicle.away);
    if (vehicle) {
      $("kw-storage").textContent = kw(flow.servedVehicleKw || 0);
      var carPct = Math.round((flow.vehicleSoc || 0) * 100);
      $("storage-label").textContent = away ? carPct + " % · en route" : carPct + " %";
      $("soc-ring").style.setProperty("--soc", String(carPct));
    } else {
      $("kw-storage").textContent = kw(flow.batteryKw || 0);
      var pct = Math.round((flow.batterySoc || 0) * 100);
      $("storage-label").textContent = pct + " %";
      $("soc-ring").style.setProperty("--soc", String(pct));
    }
    var pill = $("flow-state");
    pill.textContent = flow.satisfied ? "Alimentée" : "Besoin " + kw(flow.demandKw || 0);
    pill.classList.toggle("ok", !!flow.satisfied);
    pill.classList.toggle("bad", !flow.satisfied);
    var channels = flow.channels || {};
    card.querySelectorAll("#flow-svg path").forEach(function (path) {
      var key = path.getAttribute("data-ch");
      path.classList.toggle("on", (channels[key] || 0) > 0.05);
    });
    var note = "";
    if (vehicle && away) note = "La voiture est partie. Elle reviendra moins chargée, puis se branchera.";
    else if (!vehicle && (flow.batteryKw || 0) > 0.05) note = "La batterie de la maison couvre le manque du réseau.";
    else if (!vehicle && (flow.batteryKw || 0) < -0.05) note = "Le surplus recharge le Powerwall.";
    else if (vehicle && (flow.vehicleKw || 0) > 0.05) note = "La voiture est rentrée et recharge (" + kw(flow.vehicleKw) + ").";
    else if ((flow.gridKw || 0) < -0.05) note = "La maison renvoie du courant vers le réseau.";
    else note = flow.satisfied ? "La maison suit le réseau." : "Cette maison n'est pas assez alimentée.";
    if ((node.roofKw || 0) > 0.2) note += " Toit solaire " + node.roofKw.toFixed(1) + " kW.";
    else note += " Pas de panneaux sur le toit.";
    $("flow-note").textContent = note;
    var roofBtn = $("roof-cycle");
    if (roofBtn) {
      roofBtn.textContent = (node.roofKw || 0) > 0.2 ? "Toit " + node.roofKw.toFixed(1) + " kW" : "Ajouter un toit";
    }
    ["car-home", "car-away", "car-auto"].forEach(function (id) {
      var btn = $(id);
      if (btn) btn.hidden = !vehicle;
    });
    if (vehicle && node.vehicle) {
      var manual = !!node.vehicle.manual;
      $("car-auto").classList.toggle("on", !manual);
      $("car-away").classList.toggle("on", manual && away);
      $("car-home").classList.toggle("on", manual && !away);
    }
  }

  function machineBlurb(node) {
    if (node.type === "turbine" || node.type === "solar") return kw(node.kw) + " électriques";
    if (node.type === "heater") return kw(node.kw) + " de chaleur";
    if (node.type === "boiler") return kw(node.kw) + " de vapeur";
    if (node.type === "intake") return kw(node.kw) + " d'eau";
    if (node.type === "megapack") {
      var soc = node.capacity ? Math.round(100 * node.soc / node.capacity) : 0;
      return soc + " % · " + (node.soc || 0).toFixed(0) + " kWh · " +
        ((node.dischargeKw || 0) > 0.1 ? "décharge " + kw(node.dischargeKw) : (node.chargeKw || 0) > 0.1 ? "charge " + kw(node.chargeKw) : "en attente");
    }
    if (node.type === "industry" && node.flow) {
      return kw(node.flow.servedKw) + " servis sur " + kw(node.flow.demandKw);
    }
    return node.flow && node.flow.satisfied ? "Raccordé" : "En attente de câble";
  }

  function machineEffect(node) {
    var pct = Math.round((node.output == null ? 1 : node.output) * 100);
    if (!node.enabled) {
      if (node.type === "megapack") return "Hors service : le Megapack ne charge ni ne décharge.";
      return "Hors service : cet équipement ne produit plus rien.";
    }
    if (node.type === "megapack") {
      var cap = Math.round((node.maxKw || 400) * (node.output == null ? 1 : node.output));
      var reserve = Math.round((node.reserve || 0) * 100);
      if (node.mode === "hold") return "Conserver : la réserve ne bouge pas, même en surplus ou en manque.";
      if (node.mode === "charge") return "Charger seulement, jusqu'à " + cap + " kW. Il ne secourt pas le quartier.";
      if (node.mode === "discharge") return "Décharger seulement, jusqu'à " + cap + " kW, en gardant " + reserve + " %.";
      return "Automatique : il absorbe le surplus et couvre les manques, jusqu'à " + cap + " kW, réserve " + reserve + " %.";
    }
    var rating = Math.round(node.rating || 0);
    return "Plafond à " + pct + " % de " + rating + " kW. En ce moment : " + kw(node.kw || 0) + ".";
  }

  function showMachine(node) {
    $("help-card").hidden = true;
    $("flow-card").hidden = true;
    $("link-card").hidden = true;
    var card = $("machine-card");
    card.hidden = false;
    $("m-name").textContent = node.name;
    $("m-kind").textContent = global.GridSim.NAMES[node.type] || node.type;
    $("m-kw").textContent = machineBlurb(node);
    var manageable = node.type === "intake" || node.type === "heater" || node.type === "boiler" || node.type === "turbine" || node.type === "solar" || node.type === "megapack";
    $("m-enabled-wrap").hidden = !manageable;
    var enabled = $("m-enabled");
    if (document.activeElement !== enabled) enabled.checked = !!node.enabled;
    $("m-output-wrap").hidden = !manageable;
    var slider = $("m-output");
    if (document.activeElement !== slider) {
      slider.value = String(Math.round((node.output == null ? 1 : node.output) * 100));
      $("m-output-val").textContent = slider.value + "%";
    }
    var pack = node.type === "megapack";
    var modes = $("m-mode-wrap");
    var reserveWrap = $("m-reserve-wrap");
    if (modes) modes.hidden = !pack;
    if (reserveWrap) reserveWrap.hidden = !pack;
    if (pack) {
      document.querySelectorAll("#m-mode-wrap [data-mode]").forEach(function (btn) {
        btn.classList.toggle("on", btn.dataset.mode === (node.mode || "auto"));
      });
      var reserve = $("m-reserve");
      if (reserve && document.activeElement !== reserve) {
        reserve.value = String(Math.round((node.reserve || 0) * 100));
        $("m-reserve-val").textContent = reserve.value + "%";
      }
    }
    var effect = $("m-effect");
    if (effect) effect.textContent = manageable ? machineEffect(node) : "";
    $("m-soc").textContent = node.type === "industry"
      ? (node.flow && node.flow.satisfied ? "Le site industriel est satisfait." : "Le site industriel manque de puissance.")
      : "";
    var electric = node.type === "turbine" || node.type === "solar" || node.type === "megapack" || node.type === "pole";
    $("tie-res").hidden = !electric;
    $("tie-ind").hidden = !electric;
  }

  function showSelection() {
    if (game.selectedLink != null && game.selected == null) {
      var edge = findLink(game.selectedLink);
      if (edge) {
        showLink(edge);
        return;
      }
      game.selectedLink = null;
    }
    $("link-card").hidden = true;
    var node = game.selected != null ? global.GridSim.node(game.state, game.selected) : null;
    if (!node) {
      $("flow-card").hidden = true;
      $("machine-card").hidden = true;
      $("help-card").hidden = false;
      $("advice").textContent = global.GridSim.advice(game.state);
      return;
    }
    if (node.type === "house") showFlow(node);
    else showMachine(node);
  }

  function setTool(mode, type, variant) {
    game.tool.mode = mode;
    game.tool.type = type || null;
    game.tool.variant = variant || null;
    game.tool.pending = null;
    game.setGhost(0, 0, false);
    document.querySelectorAll(".palette .tool").forEach(function (btn) {
      if (!btn.dataset.tool) return;
      var on = btn.dataset.tool === mode && (mode !== "place" || (btn.dataset.type === type && (btn.dataset.variant || "") === (variant || "")));
      btn.classList.toggle("on", on);
    });
    paintGrow();
  }

  function snap(v) { return Math.round(v / 2) * 2; }

  var FLUID = { intake: 1, manifold: 1, heater: 1, boiler: 1, turbine: 1 };
  var ELECTRIC = { turbine: 1, solar: 1, megapack: 1, house: 1, industry: 1, pole: 1 };

  function accepts(node, mode) {
    if (!node) return false;
    if (mode === "pipe") return !!FLUID[node.type];
    if (mode === "cable") return !!ELECTRIC[node.type];
    return true;
  }

  function endpointNear(edge, clientX, clientY) {
    var a = global.GridSim.node(game.state, edge.from);
    var b = global.GridSim.node(game.state, edge.to);
    if (!a || !b) return null;
    var pa = game.project(a.x, 2.2, a.z);
    var pb = game.project(b.x, 2.2, b.z);
    var da = (pa.x - clientX) * (pa.x - clientX) + (pa.y - clientY) * (pa.y - clientY);
    var db = (pb.x - clientX) * (pb.x - clientX) + (pb.y - clientY) * (pb.y - clientY);
    return da <= db ? a.id : b.id;
  }

  function resolveAnchor(clientX, clientY, mode) {
    var hit = game.pick(clientX, clientY);
    if (hit && hit.nodeId != null) {
      var node = global.GridSim.node(game.state, hit.nodeId);
      if (accepts(node, mode)) return node.id;
      return { reject: true };
    }
    var near = game.nearestNode(clientX, clientY, mode);
    if (near) return near.id;
    var linkId = hit && hit.linkId != null ? hit.linkId : game.nearestLink(clientX, clientY);
    if (linkId != null) {
      var edge = findLink(linkId);
      if (edge && edge.kind === mode) return endpointNear(edge, clientX, clientY);
    }
    return null;
  }

  function pickAny(clientX, clientY) {
    var hit = game.pick(clientX, clientY);
    if (hit && hit.nodeId != null) return hit;
    if (hit && hit.linkId != null) return hit;
    var near = game.nearestNode(clientX, clientY, null);
    if (near && near.d < 36) return { nodeId: near.id };
    var linkId = game.nearestLink(clientX, clientY);
    if (linkId != null) return { linkId: linkId };
    return null;
  }

  function onClick(clientX, clientY) {
    var tool = game.tool;
    if (tool.mode === "place") {
      var spot = game.groundAt(clientX, clientY);
      if (!spot) return;
      var x = Math.max(-70, Math.min(70, snap(spot.x)));
      var z = Math.max(-70, Math.min(70, snap(spot.z)));
      var spec = { type: tool.type, x: x, z: z };
      if (tool.type === "house") {
        spec.variant = tool.variant === "vehicle" ? "vehicle" : "powerwall";
        spec.priced = true;
        spec.district = "residential";
      }
      report(global.GridSim.place(game.state, spec));
      game.sync();
      paintEconomy();
      return;
    }
    if (tool.mode === "pipe" || tool.mode === "cable") {
      var anchor = resolveAnchor(clientX, clientY, tool.mode);
      if (anchor && anchor.reject) {
        toast(tool.mode === "pipe" ? REASONS.fluide : REASONS.electrique);
        return;
      }
      if (anchor == null) {
        if (tool.pending != null) {
          tool.pending = null;
          toast("Tracé annulé.");
        } else {
          toast(tool.mode === "pipe"
            ? "Cliquez une machine à fluide : prise, chauffe-eau, chaudière, collecteur ou turbine."
            : "Cliquez un équipement électrique, un poteau, une maison ou l'usine.");
        }
        return;
      }
      if (tool.pending == null) {
        tool.pending = anchor;
        var up = global.GridSim.node(game.state, anchor);
        toast((up ? up.name : "Départ") + " — cliquez la suite. Échap termine.");
        return;
      }
      if (tool.pending === anchor) {
        tool.pending = null;
        toast("Tracé terminé.");
        return;
      }
      var res = global.GridSim.link(game.state, { kind: tool.mode, from: tool.pending, to: anchor });
      if (res.ok) {
        tool.pending = anchor;
        var dest = global.GridSim.node(game.state, anchor);
        toast("Relié vers " + (dest ? dest.name : "la suite") + ". Cliquez encore, ou Échap.");
      } else report(res);
      game.sync();
      paintEconomy();
      return;
    }
    var hit = pickAny(clientX, clientY);
    if (tool.mode === "demolish") {
      if (hit && hit.linkId != null) {
        if (game.selectedLink === hit.linkId) game.selectedLink = null;
        report(global.GridSim.removeLink(game.state, hit.linkId));
      } else if (hit && hit.nodeId != null) report(global.GridSim.removeNode(game.state, hit.nodeId));
      else toast("Cliquez un équipement ou une liaison à retirer.");
      if (game.selected != null && !global.GridSim.node(game.state, game.selected)) game.selected = null;
      if (game.selectedLink != null && !findLink(game.selectedLink)) game.selectedLink = null;
      game.sync();
      paintEconomy();
      showSelection();
      return;
    }
    if (hit && hit.nodeId != null) {
      game.selected = hit.nodeId;
      game.selectedLink = null;
    } else if (hit && hit.linkId != null) {
      game.selected = null;
      game.selectedLink = hit.linkId;
    } else {
      game.selected = null;
      game.selectedLink = null;
    }
    showSelection();
  }

  function mount(next) {
    game = next;
    document.querySelectorAll("[data-type]").forEach(function (btn) {
      var cost = global.GridSim.cost(btn.dataset.type);
      var slot = btn.querySelector(".cost");
      if (slot) slot.textContent = cost ? cost.toLocaleString("fr-FR") : "";
    });
    document.querySelectorAll("[data-cost]").forEach(function (slot) {
      var cost = global.GridSim.cost(slot.getAttribute("data-cost"));
      slot.textContent = cost ? cost.toLocaleString("fr-FR") : "";
    });
    document.querySelectorAll(".palette .tool").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.id === "auto-grow") {
          var next = game.state.autoGrow === false;
          global.GridSim.setAutoGrow(game.state, next);
          paintGrow();
          toast(next
            ? "Les nouvelles maisons se construisent toutes seules."
            : "Construction automatique coupée. Posez les maisons vous-même.");
          if ($("help-card") && !$("help-card").hidden) $("advice").textContent = global.GridSim.advice(game.state);
          return;
        }
        setTool(btn.dataset.tool, btn.dataset.type, btn.dataset.variant || null);
      });
    });
    $("grant").addEventListener("click", function () {
      global.GridSim.grant(game.state);
      paintEconomy();
      toast("Apport de " + money(global.GridSim.GRANT) + ".");
    });
    $("sell").addEventListener("click", function () {
      var sale = global.GridSim.sellSurplus(game.state);
      paintEconomy();
      toast(sale.energy > 0
        ? "Vente de " + sale.energy.toFixed(1) + " kWh · " + money(sale.revenue)
        : "Pas de surplus à vendre pour l'instant.");
    });
    $("price").addEventListener("change", function () {
      var res = global.GridSim.setPrice(game.state, parseFloat($("price").value));
      if (!res.ok) $("price").value = String(game.state.price);
      paintEconomy();
    });
    document.querySelectorAll("[data-speed]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var speed = parseFloat(btn.dataset.speed);
        game.paused = speed === 0;
        if (speed > 0) game.hoursPerSecond = speed;
        document.querySelectorAll("[data-speed]").forEach(function (other) {
          other.classList.toggle("on", other === btn);
        });
      });
    });
    function nudge() {
      global.GridSim.tick(game.state, 0.0001);
      game.sync();
      paintEconomy();
      showSelection();
    }
    $("m-enabled").addEventListener("change", function () {
      if (game.selected == null) return;
      global.GridSim.setEnabled(game.state, game.selected, $("m-enabled").checked);
      nudge();
    });
    $("m-output").addEventListener("input", function () {
      $("m-output-val").textContent = $("m-output").value + "%";
      if (game.selected == null) return;
      global.GridSim.setOutput(game.state, game.selected, parseFloat($("m-output").value) / 100);
      var node = global.GridSim.node(game.state, game.selected);
      if (node && $("m-effect")) $("m-effect").textContent = machineEffect(node);
    });
    document.querySelectorAll("#m-mode-wrap [data-mode]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (game.selected == null) return;
        global.GridSim.setPackMode(game.state, game.selected, btn.dataset.mode);
        nudge();
      });
    });
    $("m-reserve").addEventListener("input", function () {
      $("m-reserve-val").textContent = $("m-reserve").value + "%";
      if (game.selected == null) return;
      global.GridSim.setReserve(game.state, game.selected, parseFloat($("m-reserve").value) / 100);
      var node = global.GridSim.node(game.state, game.selected);
      if (node && $("m-effect")) $("m-effect").textContent = machineEffect(node);
    });
    $("roof-cycle").addEventListener("click", function () {
      if (game.selected == null) return;
      var node = global.GridSim.node(game.state, game.selected);
      if (!node || node.type !== "house") return;
      var next = (node.roofKw || 0) < 0.2 ? 3.4 : node.roofKw < 4 ? 6.2 : 0;
      global.GridSim.setRoof(game.state, node.id, next);
      nudge();
    });
    $("car-home").addEventListener("click", function () {
      if (game.selected == null) return;
      global.GridSim.setVehicleTrip(game.state, game.selected, "home");
      nudge();
    });
    $("car-away").addEventListener("click", function () {
      if (game.selected == null) return;
      global.GridSim.setVehicleTrip(game.state, game.selected, "away");
      nudge();
    });
    $("car-auto").addEventListener("click", function () {
      if (game.selected == null) return;
      global.GridSim.setVehicleTrip(game.state, game.selected, "auto");
      nudge();
    });
    $("tie-res").addEventListener("click", function () {
      if (game.selected == null) return;
      var res = global.GridSim.tieDistrict(game.state, "residential", game.selected);
      report(res);
      if (res.ok) toast(res.linked ? res.linked + " maisons raccordées." : "Le quartier est déjà sur ce réseau.");
      game.sync();
      paintEconomy();
    });
    $("tie-ind").addEventListener("click", function () {
      if (game.selected == null) return;
      var res = global.GridSim.tieDistrict(game.state, "industrial", game.selected);
      report(res);
      if (res.ok) toast(res.linked ? "Usine raccordée." : "L'usine est déjà sur ce réseau.");
      game.sync();
      paintEconomy();
    });
    $("link-remove").addEventListener("click", function () {
      if (game.selectedLink == null) return;
      var id = game.selectedLink;
      var res = global.GridSim.removeLink(game.state, id);
      report(res);
      if (res.ok) {
        game.selectedLink = null;
        toast("Liaison retirée.");
      }
      game.sync();
      paintEconomy();
      showSelection();
    });

    var canvas = game.canvas;
    var drag = null;
    var pointers = {};
    function pointerCount() { return Object.keys(pointers).length; }
    function pointerDistance() {
      var ids = Object.keys(pointers);
      if (ids.length < 2) return 0;
      var a = pointers[ids[0]];
      var b = pointers[ids[1]];
      return Math.hypot(a.x - b.x, a.y - b.y);
    }
    function pointerMid() {
      var ids = Object.keys(pointers);
      var a = pointers[ids[0]];
      var b = pointers[ids[1]];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    function paintCursor(grabbing) {
      canvas.classList.toggle("grabbing", !!grabbing);
      canvas.classList.toggle("linking", !grabbing && (game.tool.mode === "pipe" || game.tool.mode === "cable"));
      canvas.classList.toggle("removing", !grabbing && game.tool.mode === "demolish");
    }
    function trackPointer(event) {
      game.pointer.x = event.clientX;
      game.pointer.y = event.clientY;
      game.pointer.ok = true;
    }
    canvas.addEventListener("contextmenu", function (event) { event.preventDefault(); });
    canvas.addEventListener("pointerdown", function (event) {
      pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
      trackPointer(event);
      game.stopCoast();
      if (game.cancelGlide) game.cancelGlide();
      drag = {
        x0: event.clientX, y0: event.clientY,
        x: event.clientX, y: event.clientY,
        moved: 0, button: event.button, alt: event.altKey,
        id: event.pointerId, active: false, pinch: 0
      };
      if (pointerCount() >= 2) {
        drag.pinch = pointerDistance();
        drag.active = true;
        drag.moved = 24;
        game.dragging = true;
      }
      try { canvas.setPointerCapture(event.pointerId); } catch (err) { /* already captured */ }
    });
    canvas.addEventListener("pointermove", function (event) {
      if (pointers[event.pointerId]) pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
      trackPointer(event);
      if (game.tool.mode === "place") {
        var spot = game.groundAt(event.clientX, event.clientY);
        if (spot) game.setGhost(snap(spot.x), snap(spot.z), true);
      } else game.setGhost(0, 0, false);
      if (!drag || (drag.id !== event.pointerId && pointerCount() < 2)) {
        paintCursor(false);
        return;
      }
      if (pointerCount() >= 2 && drag.pinch) {
        var dist = pointerDistance();
        var ratio = dist / drag.pinch;
        if (dist > 8 && Math.abs(ratio - 1) > 0.012) {
          var mid = pointerMid();
          game.zoomBy(-Math.log(ratio) / 0.00105, mid.x, mid.y);
          drag.pinch = dist;
        }
        drag.moved = 40;
        drag.active = true;
        game.dragging = true;
        paintCursor(true);
        return;
      }
      drag.moved = Math.abs(event.clientX - drag.x0) + Math.abs(event.clientY - drag.y0);
      if (drag.moved < 5) return;
      var orbit = drag.button === 2 || (drag.button === 0 && (drag.alt || event.altKey));
      if (!drag.active) {
        drag.active = true;
        game.dragging = true;
        game.stopCoast();
      }
      if (orbit) game.orbitBy(event.clientX - drag.x, event.clientY - drag.y);
      else if (drag.button === 0 || drag.button === 1) game.panGrab(drag.x, drag.y, event.clientX, event.clientY);
      drag.x = event.clientX;
      drag.y = event.clientY;
      paintCursor(true);
    });
    canvas.addEventListener("pointerup", function (event) {
      delete pointers[event.pointerId];
      if (!drag || drag.id !== event.pointerId && pointerCount() > 0) {
        if (pointerCount() === 0) { drag = null; game.dragging = false; paintCursor(false); }
        return;
      }
      var moved = drag.moved;
      var button = drag.button;
      drag = null;
      game.dragging = false;
      paintCursor(false);
      if (moved < 6 && button === 0 && pointerCount() === 0) onClick(event.clientX, event.clientY);
    });
    canvas.addEventListener("pointercancel", function (event) {
      delete pointers[event.pointerId];
      drag = null;
      game.dragging = false;
      paintCursor(false);
    });
    canvas.addEventListener("dblclick", function (event) {
      if (game.tool.mode !== "select") return;
      var hit = pickAny(event.clientX, event.clientY);
      if (!hit || hit.nodeId == null) return;
      var node = global.GridSim.node(game.state, hit.nodeId);
      if (!node) return;
      game.selected = node.id;
      game.selectedLink = null;
      game.focusOn(node.x, node.z);
      showSelection();
    });
    canvas.addEventListener("wheel", function (event) {
      event.preventDefault();
      var dy = event.deltaY;
      if (event.deltaMode === 1) dy *= 16;
      else if (event.deltaMode === 2) dy *= 400;
      game.zoomBy(dy, event.clientX, event.clientY);
    }, { passive: false });
    var held = {};
    window.addEventListener("keydown", function (event) {
      if (event.target && event.target.matches && event.target.matches("input, textarea")) return;
      held[event.code] = true;
      if (event.code === "Space") {
        event.preventDefault();
        game.paused = !game.paused;
        document.querySelectorAll("[data-speed]").forEach(function (btn) {
          var speed = parseFloat(btn.dataset.speed);
          btn.classList.toggle("on", game.paused ? speed === 0 : speed === game.hoursPerSecond);
        });
      } else if (event.code === "Escape") {
        if (game.tool.pending != null) {
          game.tool.pending = null;
          toast("Tracé annulé.");
        } else setTool("select");
      } else if (event.code === "ArrowUp" || event.code === "ArrowDown" || event.code === "ArrowLeft" || event.code === "ArrowRight") {
        event.preventDefault();
      } else if (event.code === "Home") {
        game.resetView();
      } else if (event.code === "KeyF" && game.selected != null) {
        var focused = global.GridSim.node(game.state, game.selected);
        if (focused) game.focusOn(focused.x, focused.z);
      }
    });
    window.addEventListener("keyup", function (event) { held[event.code] = false; });
    window.addEventListener("blur", function () { held = {}; });
    game.onFrame = function (dt) {
      var el = document.activeElement;
      if (el && el.matches && el.matches("input, textarea")) return;
      var px = 0;
      var py = 0;
      if (held.KeyA || held.KeyQ || held.ArrowLeft) px -= 1;
      if (held.KeyD || held.ArrowRight) px += 1;
      if (held.KeyW || held.KeyZ || held.ArrowUp) py += 1;
      if (held.KeyS || held.ArrowDown) py -= 1;
      var speed = 520 * dt;
      if (px || py) {
        game.stopCoast();
        game.panBy(px * speed, py * speed);
      }
    };
    window.addEventListener("resize", function () { game.resize(); });
    paintEconomy();
    showSelection();
  }

  function refresh() {
    if (!game) return;
    paintEconomy();
    paintDistricts();
    if (!$("flow-card").hidden || !$("machine-card").hidden || !$("help-card").hidden || !$("link-card").hidden) showSelection();
  }

  global.PowerUI = { mount: mount, refresh: refresh };
})(typeof window !== "undefined" ? window : globalThis);
