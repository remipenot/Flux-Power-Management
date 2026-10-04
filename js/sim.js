/* FLUX — deterministic grid simulation. No DOM, no renderer.
   Attaches GridSim to the global object (window in the page). */
(function (global) {
  "use strict";

  var GRANT = 10000;

  var COST = {
    intake: 1500,
    heater: 4000,
    boiler: 4500,
    turbine: 10000,
    manifold: 800,
    solar: 6500,
    megapack: 16000,
    pole: 400,
    pipe: 350,
    cable: 250,
    house: 2800,
    industry: 0
  };

  var RATING = {
    intake: 400,
    heater: 400,
    boiler: 400,
    turbine: 400,
    solar: 180
  };

  var NAMES = {
    intake: "Prise d'eau",
    heater: "Chauffe-eau",
    boiler: "Chaudière",
    turbine: "Turbine",
    manifold: "Collecteur",
    solar: "Champ solaire",
    megapack: "Megapack",
    pole: "Poteau",
    house: "Maison",
    industry: "Usine"
  };

  var HOUSE_NAMES = [
    "Amandier", "Cèdre", "Tilleul", "Noyer", "Olivier", "Pin",
    "Saule", "Érable", "Hêtre", "If", "Mélèze", "Bouleau",
    "Figuier", "Laurier", "Cyprès", "Chêne"
  ];

  var THERMAL = { intake: 1, manifold: 1, heater: 1, boiler: 1, turbine: 1 };
  var ELECTRIC = {
    turbine: 1, solar: 1, megapack: 1, house: 1, industry: 1, pole: 1
  };

  function sunFactor(hour) {
    var h = ((hour % 24) + 24) % 24;
    if (h < 6 || h > 18) return 0;
    var x = (h - 12) / 6;
    var v = 1 - x * x;
    return v < 0 ? 0 : v;
  }

  function frac(n) {
    var x = Math.sin(n) * 43758.5453;
    return x - Math.floor(x);
  }

  function weatherAt(hour) {
    var day = Math.floor(hour / 24);
    var temps = [8, 3, 14, -6, 1, 11, -11, 5, 16, -2];
    var temp = temps[((day % temps.length) + temps.length) % temps.length];
    var factor = temp < 4 ? 1 + (4 - temp) * 0.04 : 1;
    var label = temp < 0 ? "Journée froide" : temp < 6 ? "Fraîche" : temp > 16 ? "Douce" : "Tempérée";
    return { temp: temp, factor: factor, label: label, day: day };
  }

  function peakName(hour) {
    var h = ((hour % 24) + 24) % 24;
    if (h >= 7 && h < 9) return "Pointe du matin";
    if (h >= 17 && h < 20.5) return "Pointe du soir";
    return "";
  }

  function loadFactor(hour, kind) {
    var h = ((hour % 24) + 24) % 24;
    if (kind === "industry") {
      if (h >= 8 && h < 11) return 1.18;
      if (h >= 14 && h < 17) return 1.12;
      if (h >= 7 && h < 19) return 1;
      if (h >= 5 && h < 22) return 0.62;
      return 0.35;
    }
    if (h < 5 || h >= 23) return 0.5;
    if (h < 7) return 0.7;
    if (h < 9) return 1.25;
    if (h < 17) return 0.62;
    if (h < 20.5) return 1.4;
    if (h < 21) return 1.05;
    return 0.75;
  }

  function appetiteOf(node) {
    if (node.appetite != null) return node.appetite;
    return 0.84 + frac(node.id * 12.9898) * 0.4;
  }

  function spikeKw(node, hour) {
    var h = ((hour % 24) + 24) % 24;
    var slot = Math.floor(hour * 2);
    var f = frac(node.id * 19.17 + slot * 2.41);
    if (h >= 17 && h < 20.5 && f < 0.22) return 1.6;
    if (h >= 7 && h < 9 && f < 0.12) return 1.1;
    return 0;
  }

  function rollRoof(seq) {
    var f = frac(seq * 7.13 + 0.51);
    if (f < 0.42) return 0;
    if (f < 0.72) return 3.4;
    return 6.2;
  }

  function commuteAway(node, hour) {
    var h = ((hour % 24) + 24) % 24;
    var seed = frac(node.id * 4.17);
    var leave = 7.1 + seed * 1.8;
    var back = 16.6 + seed * 2.4;
    var day = Math.floor(hour / 24);
    var outing = ((day + node.id) % 4 === 0) && h >= 20 && h < 21.4;
    return (h >= leave && h < back) || outing;
  }

  function clamp(v, a, b) {
    if (v < a) return a;
    if (v > b) return b;
    return v;
  }

  function blankChannels() {
    return {
      solarToHome: 0,
      solarToVehicle: 0,
      solarToBattery: 0,
      solarToGrid: 0,
      gridToHome: 0,
      gridToVehicle: 0,
      gridToBattery: 0,
      batteryToHome: 0,
      batteryToVehicle: 0
    };
  }

  function create(opts) {
    opts = opts || {};
    var state = {
      money: opts.money == null ? 30000 : opts.money,
      price: opts.price == null ? 0.22 : opts.price,
      hour: opts.hour == null ? 8 : opts.hour,
      growthEvery: opts.growthEvery == null ? 12 : opts.growthEvery,
      growthAcc: 0,
      growthIndex: 0,
      exportableKWh: 0,
      soldKWh: 0,
      revenue: 0,
      generatedKWh: 0,
      consumedKWh: 0,
      dayGeneratedKWh: 0,
      dayConsumedKWh: 0,
      statDay: Math.floor((opts.hour == null ? 8 : opts.hour) / 24),
      autoGrow: opts.autoGrow !== false,
      live: null,
      elapsed: 0,
      nextId: 1,
      houseSeq: 0,
      nodes: [],
      links: [],
      failed: false,
      districts: {
        residential: {
          id: "residential",
          name: "Quartier résidentiel",
          kind: "residential",
          demandKw: 0,
          servedKw: 0,
          count: 0,
          satisfied: false
        },
        industrial: {
          id: "industrial",
          name: "Site industriel",
          kind: "industrial",
          demandKw: 0,
          servedKw: 0,
          count: 0,
          satisfied: false
        }
      }
    };
    if (opts.populate !== false) populate(state);
    return state;
  }

  function populate(state) {
    var spots = [
      [-30, -8], [-18, -8], [-6, -8],
      [-30, 6], [-18, 6], [-6, 6]
    ];
    for (var i = 0; i < spots.length; i++) {
      place(state, {
        type: "house",
        free: true,
        x: spots[i][0],
        z: spots[i][1],
        variant: i % 2 === 0 ? "powerwall" : "vehicle",
        district: "residential",
        soc: i % 2 === 0 ? 6 : 0,
        vehicleSoc: 36,
        plugged: true
      });
    }
    place(state, {
      type: "industry",
      free: true,
      x: 2,
      z: -28,
      district: "industrial",
      baseKw: 100,
      name: "Atelier Nord"
    });
  }

  function costOf(type) {
    return COST[type] || 0;
  }

  function place(state, spec) {
    spec = spec || {};
    var type = spec.type;
    if (!COST.hasOwnProperty(type) && type !== "house" && type !== "industry") {
      return { ok: false, reason: "type" };
    }
    if (type !== "intake" && type !== "heater" && type !== "boiler" && type !== "turbine" &&
        type !== "manifold" && type !== "solar" && type !== "megapack" && type !== "pole" &&
        type !== "house" && type !== "industry") {
      return { ok: false, reason: "type" };
    }
    var pricedHouse = type === "house" && spec.priced === true;
    var free = !pricedHouse && (spec.free === true || type === "house" || type === "industry");
    var cost = free ? 0 : (pricedHouse ? costOf("house") : costOf(type));
    if (state.money + 1e-9 < cost) {
      return { ok: false, reason: "fonds insuffisants", cost: cost, money: state.money };
    }
    state.money -= cost;
    var node = {
      id: state.nextId++,
      type: type,
      x: Number.isFinite(spec.x) ? spec.x : 0,
      z: Number.isFinite(spec.z) ? spec.z : 0,
      rot: Number.isFinite(spec.rot) ? spec.rot : 0,
      enabled: spec.enabled !== false,
      output: clamp(spec.output == null ? 1 : spec.output, 0, 1),
      rating: spec.rating != null ? spec.rating : (RATING[type] || 0),
      kw: 0,
      flow: null,
      costPaid: cost,
      district: spec.district || null,
      name: spec.name || null
    };
    if (type === "megapack") {
      node.capacity = spec.capacity != null ? spec.capacity : 1200;
      node.maxKw = spec.maxKw != null ? spec.maxKw : 400;
      node.soc = clamp(spec.soc != null ? spec.soc : 0, 0, node.capacity);
      node.mode = spec.mode || "auto";
      node.reserve = clamp(spec.reserve != null ? spec.reserve : 0, 0, 0.9);
    }
    if (type === "house") {
      node.variant = spec.variant === "vehicle" ? "vehicle" : "powerwall";
      node.district = spec.district || "residential";
      node.baseKw = spec.baseKw != null ? spec.baseKw : 4;
      state.houseSeq += 1;
      node.roofKw = spec.roofKw != null ? spec.roofKw : rollRoof(state.houseSeq);
      node.name = node.name || (HOUSE_NAMES[(state.houseSeq - 1) % HOUSE_NAMES.length] + " " + state.houseSeq);
      if (node.variant === "powerwall") {
        node.capacity = spec.capacity != null ? spec.capacity : 13.5;
        node.maxKw = spec.maxKw != null ? spec.maxKw : 5;
        node.soc = clamp(spec.soc != null ? spec.soc : 0, 0, node.capacity);
        node.vehicle = null;
      } else {
        node.capacity = 0;
        node.maxKw = 0;
        node.soc = 0;
        node.vehicle = {
          capacity: spec.vehicleCapacity != null ? spec.vehicleCapacity : 75,
          soc: spec.vehicleSoc != null ? spec.vehicleSoc : 30,
          chargeKw: spec.chargeKw != null ? spec.chargeKw : 11,
          plugged: spec.plugged !== false
        };
        node.vehicle.soc = clamp(node.vehicle.soc, 0, node.vehicle.capacity);
      }
    }
    if (type === "industry") {
      node.baseKw = spec.baseKw != null ? spec.baseKw : 100;
      node.district = spec.district || "industrial";
      node.roofKw = 0;
      node.name = node.name || "Atelier Nord";
    }
    if (!node.name) node.name = (NAMES[type] || type) + " " + node.id;
    state.nodes.push(node);
    return { ok: true, id: node.id, node: node, cost: cost };
  }

  function nodeById(state, id) {
    for (var i = 0; i < state.nodes.length; i++) {
      if (state.nodes[i].id === id) return state.nodes[i];
    }
    return null;
  }

  function link(state, spec) {
    spec = spec || {};
    var kind = spec.kind;
    var from = spec.from;
    var to = spec.to;
    if (kind !== "pipe" && kind !== "cable") return { ok: false, reason: "type" };
    if (from === to) return { ok: false, reason: "boucle" };
    var a = nodeById(state, from);
    var b = nodeById(state, to);
    if (!a || !b) return { ok: false, reason: "noeud" };
    if (kind === "pipe") {
      if (!THERMAL[a.type] || !THERMAL[b.type]) return { ok: false, reason: "fluide" };
    } else if (!ELECTRIC[a.type] || !ELECTRIC[b.type]) {
      return { ok: false, reason: "electrique" };
    }
    for (var i = 0; i < state.links.length; i++) {
      var e = state.links[i];
      if (e.kind !== kind) continue;
      if ((e.from === from && e.to === to) || (e.from === to && e.to === from)) {
        return { ok: false, reason: "existe" };
      }
    }
    var cost = spec.free ? 0 : costOf(kind);
    if (state.money + 1e-9 < cost) {
      return { ok: false, reason: "fonds insuffisants", cost: cost, money: state.money };
    }
    state.money -= cost;
    var edge = {
      id: state.nextId++,
      kind: kind,
      from: from,
      to: to,
      flow: 0,
      dir: 0,
      costPaid: cost
    };
    state.links.push(edge);
    return { ok: true, id: edge.id, cost: cost };
  }

  function removeLink(state, id) {
    var i = state.links.findIndex(function (e) { return e.id === id; });
    if (i < 0) return { ok: false, reason: "absent" };
    var e = state.links[i];
    var refund = (e.costPaid || 0) * 0.6;
    state.money += refund;
    state.links.splice(i, 1);
    return { ok: true, refund: refund };
  }

  function removeNode(state, id) {
    var idx = state.nodes.findIndex(function (n) { return n.id === id; });
    if (idx < 0) return { ok: false, reason: "absent" };
    var n = state.nodes[idx];
    if (n.type === "house" || n.type === "industry") return { ok: false, reason: "fixe" };
    var refund = (n.costPaid || 0) * 0.6;
    state.money += refund;
    var kept = [];
    for (var i = 0; i < state.links.length; i++) {
      var e = state.links[i];
      if (e.from === id || e.to === id) state.money += (e.costPaid || 0) * 0.6;
      else kept.push(e);
    }
    state.links = kept;
    state.nodes.splice(idx, 1);
    return { ok: true, refund: refund };
  }

  function setEnabled(state, id, enabled) {
    var n = nodeById(state, id);
    if (!n) return { ok: false, reason: "absent" };
    n.enabled = !!enabled;
    return { ok: true };
  }

  function setOutput(state, id, fraction) {
    var n = nodeById(state, id);
    if (!n) return { ok: false, reason: "absent" };
    if (!(n.type === "turbine" || n.type === "solar" || n.type === "heater" ||
          n.type === "boiler" || n.type === "intake" || n.type === "megapack")) {
      return { ok: false, reason: "fixe" };
    }
    var f = Number(fraction);
    if (!Number.isFinite(f)) return { ok: false, reason: "valeur" };
    n.output = clamp(f, 0, 1);
    return { ok: true, output: n.output };
  }

  function setPrice(state, price) {
    var p = Number(price);
    if (!Number.isFinite(p) || p < 0) return { ok: false, reason: "valeur" };
    state.price = p;
    return { ok: true, price: p };
  }

  function setVehiclePlugged(state, id, plugged) {
    var n = nodeById(state, id);
    if (!n || !n.vehicle) return { ok: false, reason: "absent" };
    n.vehicle.manual = true;
    n.vehicle.plugged = !!plugged;
    n.vehicle.away = !n.vehicle.plugged;
    return { ok: true };
  }

  function setVehicleTrip(state, id, mode) {
    var n = nodeById(state, id);
    if (!n || !n.vehicle) return { ok: false, reason: "absent" };
    if (mode === "auto") {
      n.vehicle.manual = false;
      return { ok: true, mode: "auto" };
    }
    if (mode === "away" || mode === "home") {
      n.vehicle.manual = true;
      n.vehicle.plugged = mode === "home";
      n.vehicle.away = mode === "away";
      return { ok: true, mode: mode };
    }
    return { ok: false, reason: "valeur" };
  }

  function setPackMode(state, id, mode) {
    var n = nodeById(state, id);
    if (!n || n.type !== "megapack") return { ok: false, reason: "absent" };
    if (mode !== "auto" && mode !== "charge" && mode !== "discharge" && mode !== "hold") {
      return { ok: false, reason: "valeur" };
    }
    n.mode = mode;
    return { ok: true, mode: mode };
  }

  function setReserve(state, id, fraction) {
    var n = nodeById(state, id);
    if (!n || n.type !== "megapack") return { ok: false, reason: "absent" };
    var f = Number(fraction);
    if (!Number.isFinite(f)) return { ok: false, reason: "valeur" };
    n.reserve = clamp(f, 0, 0.9);
    return { ok: true, reserve: n.reserve };
  }

  function setRoof(state, id, kw) {
    var n = nodeById(state, id);
    if (!n || n.type !== "house") return { ok: false, reason: "absent" };
    var v = Number(kw);
    if (!Number.isFinite(v)) return { ok: false, reason: "valeur" };
    n.roofKw = clamp(v, 0, 12);
    return { ok: true, roofKw: n.roofKw };
  }

  function setAutoGrow(state, on) {
    state.autoGrow = !!on;
    if (!state.autoGrow) state.growthAcc = 0;
    return { ok: true, autoGrow: state.autoGrow };
  }

  function grant(state, amount) {
    var a = amount == null ? GRANT : Number(amount);
    if (!Number.isFinite(a) || a <= 0) return { ok: false, money: state.money };
    state.money += a;
    return { ok: true, money: state.money, amount: a };
  }

  function sellSurplus(state) {
    var energy = state.exportableKWh;
    if (!(energy > 0)) {
      state.exportableKWh = 0;
      return { ok: true, energy: 0, revenue: 0, money: state.money };
    }
    var revenue = state.price * energy;
    state.money += revenue;
    state.exportableKWh = 0;
    state.soldKWh += energy;
    state.revenue += revenue;
    return { ok: true, energy: energy, revenue: revenue, money: state.money };
  }

  function outPipes(state, id) {
    var list = [];
    for (var i = 0; i < state.links.length; i++) {
      var e = state.links[i];
      if (e.kind === "pipe" && e.from === id) list.push(e);
    }
    return list;
  }

  /* Move a fluid downstream. Holders keep what arrives. Amount is conserved. */
  function route(state, injected, holdTypes) {
    var at = new Map();
    injected.forEach(function (amt, id) { if (amt > 0) at.set(id, amt); });
    var edgeFlow = new Map();
    for (var hop = 0; hop < 64; hop++) {
      var next = new Map();
      var moved = false;
      at.forEach(function (amt, id) {
        if (amt <= 1e-12) return;
        var node = nodeById(state, id);
        var outs = outPipes(state, id);
        if (!node || holdTypes[node.type] || outs.length === 0) {
          next.set(id, (next.get(id) || 0) + amt);
          return;
        }
        var share = amt / outs.length;
        for (var i = 0; i < outs.length; i++) {
          var e = outs[i];
          edgeFlow.set(e.id, (edgeFlow.get(e.id) || 0) + share);
          next.set(e.to, (next.get(e.to) || 0) + share);
          moved = true;
        }
      });
      at = next;
      if (!moved) break;
    }
    return { at: at, edgeFlow: edgeFlow };
  }

  function produceThermal(state) {
    for (var i = 0; i < state.links.length; i++) {
      if (state.links[i].kind === "pipe") {
        state.links[i].flow = 0;
        state.links[i].dir = 0;
      }
    }
    var water = new Map();
    for (var n = 0; n < state.nodes.length; n++) {
      var node = state.nodes[n];
      if (node.type === "intake") {
        node.kw = node.enabled ? node.rating * node.output : 0;
        if (node.kw > 0) water.set(node.id, node.kw);
      }
    }
    var waterRes = route(state, water, { heater: 1, boiler: 1, turbine: 1 });
    var hot = new Map();
    for (var h = 0; h < state.nodes.length; h++) {
      var heater = state.nodes[h];
      if (heater.type !== "heater") continue;
      var got = waterRes.at.get(heater.id) || 0;
      var made = heater.enabled ? Math.min(got, heater.rating * heater.output) : 0;
      heater.kw = made;
      if (made > 0) hot.set(heater.id, made);
    }
    var hotRes = route(state, hot, { boiler: 1, turbine: 1 });
    var steam = new Map();
    for (var b = 0; b < state.nodes.length; b++) {
      var boiler = state.nodes[b];
      if (boiler.type !== "boiler") continue;
      var hotIn = hotRes.at.get(boiler.id) || 0;
      var steamOut = boiler.enabled ? Math.min(hotIn, boiler.rating * boiler.output) : 0;
      boiler.kw = steamOut;
      if (steamOut > 0) steam.set(boiler.id, steamOut);
    }
    var steamRes = route(state, steam, { turbine: 1 });
    for (var t = 0; t < state.nodes.length; t++) {
      var turbine = state.nodes[t];
      if (turbine.type !== "turbine") continue;
      var steamIn = steamRes.at.get(turbine.id) || 0;
      var cap = turbine.enabled ? turbine.rating * turbine.output : 0;
      turbine.kw = Math.min(steamIn, cap);
      turbine.steamIn = steamIn;
    }
    [waterRes, hotRes, steamRes].forEach(function (res) {
      res.edgeFlow.forEach(function (amt, id) {
        var edge = null;
        for (var k = 0; k < state.links.length; k++) {
          if (state.links[k].id === id) { edge = state.links[k]; break; }
        }
        if (edge) {
          edge.flow += amt;
          if (edge.flow > 0.05) edge.dir = 1;
        }
      });
    });
  }

  function produceSolar(state) {
    var sun = sunFactor(state.hour);
    for (var i = 0; i < state.nodes.length; i++) {
      var n = state.nodes[i];
      if (n.type !== "solar") continue;
      n.kw = n.enabled ? n.rating * n.output * sun : 0;
    }
    return sun;
  }

  function findRoot(parent, id) {
    var guard = 0;
    while (parent.get(id) !== id && guard++ < 10000) {
      parent.set(id, parent.get(parent.get(id)));
      id = parent.get(id);
    }
    return id;
  }

  function buildIslands(state) {
    var parent = new Map();
    for (var i = 0; i < state.nodes.length; i++) {
      var n = state.nodes[i];
      if (ELECTRIC[n.type]) parent.set(n.id, n.id);
    }
    function unite(a, b) {
      if (!parent.has(a) || !parent.has(b)) return;
      var ra = findRoot(parent, a);
      var rb = findRoot(parent, b);
      if (ra !== rb) parent.set(ra, rb);
    }
    for (var l = 0; l < state.links.length; l++) {
      var e = state.links[l];
      if (e.kind === "cable") unite(e.from, e.to);
    }
    var groups = new Map();
    parent.forEach(function (_v, id) {
      var r = findRoot(parent, id);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(nodeById(state, id));
    });
    return { parent: parent, groups: groups };
  }

  function houseDemand(node, hour, dt) {
    var kind = node.type === "industry" ? "industry" : "home";
    var weather = weatherAt(hour).factor;
    var appetite = kind === "home" ? appetiteOf(node) : 1;
    var base = (node.baseKw || 0) * loadFactor(hour, kind) * weather * appetite;
    if (kind === "home") base += spikeKw(node, hour);
    var vehicleKw = 0;
    var car = node.vehicle;
    if (car && car.plugged && !car.away && car.soc < car.capacity - 1e-9) {
      var roomKw = (car.capacity - car.soc) / dt;
      vehicleKw = Math.min(car.chargeKw, Math.max(0, roomKw));
    }
    return { homeKw: base, vehicleKw: vehicleKw, demandKw: base + vehicleKw };
  }

  function updateTrips(state, dt) {
    for (var i = 0; i < state.nodes.length; i++) {
      var n = state.nodes[i];
      if (!n.vehicle) continue;
      if (n.vehicle.manual) {
        n.vehicle.away = !n.vehicle.plugged;
        continue;
      }
      var away = commuteAway(n, state.hour);
      n.vehicle.away = away;
      n.vehicle.plugged = !away;
      if (away) n.vehicle.soc = Math.max(0, n.vehicle.soc - Math.min(n.vehicle.soc, 6 * dt));
    }
  }

  function packPower(pk, dt, kind) {
    if (!pk.enabled || pk.mode === "hold") return 0;
    if (kind === "dis" && pk.mode === "charge") return 0;
    if (kind === "chg" && pk.mode === "discharge") return 0;
    var limit = pk.maxKw * (pk.output == null ? 1 : pk.output);
    if (kind === "dis") {
      var floor = pk.capacity * (pk.reserve || 0);
      var above = Math.max(0, pk.soc - floor);
      return Math.min(limit, dt > 0 ? above / dt : 0);
    }
    var room = Math.max(0, pk.capacity - pk.soc);
    return Math.min(limit, dt > 0 ? room / dt : 0);
  }

  function orientCables(state, members, prepById) {
    var member = new Set();
    var balance = new Map();
    var i;
    for (i = 0; i < members.length; i++) {
      var n = members[i];
      member.add(n.id);
      var b = 0;
      if (n.type === "turbine" || n.type === "solar") b += n.kw || 0;
      if (n.type === "megapack") b += (n._discharge || 0) - (n._charge || 0);
      var item = prepById.get(n.id);
      if (item) {
        var imported = item.channels.gridToHome + item.channels.gridToVehicle + item.channels.gridToBattery;
        b += (item.exportKw || 0) - imported;
      }
      balance.set(n.id, b);
    }
    var adj = new Map();
    var edges = [];
    for (i = 0; i < state.links.length; i++) {
      var edge = state.links[i];
      if (edge.kind !== "cable") continue;
      if (!member.has(edge.from) || !member.has(edge.to)) continue;
      edges.push(edge);
      if (!adj.has(edge.from)) adj.set(edge.from, []);
      if (!adj.has(edge.to)) adj.set(edge.to, []);
      adj.get(edge.from).push(edge.to);
      adj.get(edge.to).push(edge.from);
    }
    var dist = new Map();
    var queue = [];
    balance.forEach(function (value, id) {
      if (value > 0.05) {
        dist.set(id, 0);
        queue.push(id);
      }
    });
    var q = 0;
    while (q < queue.length) {
      var id = queue[q++];
      var d0 = dist.get(id);
      var neigh = adj.get(id) || [];
      for (var k = 0; k < neigh.length; k++) {
        var next = neigh[k];
        if (dist.has(next)) continue;
        dist.set(next, d0 + 1);
        queue.push(next);
      }
    }
    for (i = 0; i < edges.length; i++) {
      var e = edges[i];
      if ((e.flow || 0) <= 0.05) {
        e.dir = 0;
        continue;
      }
      var df = dist.has(e.from) ? dist.get(e.from) : 999;
      var dtv = dist.has(e.to) ? dist.get(e.to) : 999;
      if (df < dtv) e.dir = 1;
      else if (dtv < df) e.dir = -1;
      else e.dir = (balance.get(e.from) || 0) >= (balance.get(e.to) || 0) ? 1 : -1;
    }
  }

  function rollDay(state) {
    var day = Math.floor(state.hour / 24);
    if (state.statDay !== day) {
      state.statDay = day;
      state.dayGeneratedKWh = 0;
      state.dayConsumedKWh = 0;
    }
  }

  function step(state, dt) {
    rollDay(state);
    updateTrips(state, dt);
    produceThermal(state);
    var sun = produceSolar(state);
    var prep = [];
    for (var i = 0; i < state.nodes.length; i++) {
      var n = state.nodes[i];
      if (n.type !== "house" && n.type !== "industry") continue;
      var dem = houseDemand(n, state.hour, dt);
      var roof = n.type === "house" ? (n.roofKw || 0) * sun : 0;
      var solar = roof;
      var homeNeed = dem.homeKw;
      var vehNeed = dem.vehicleKw;
      var ch = blankChannels();
      ch.solarToHome = Math.min(solar, homeNeed);
      solar -= ch.solarToHome;
      homeNeed -= ch.solarToHome;
      ch.solarToVehicle = Math.min(solar, vehNeed);
      solar -= ch.solarToVehicle;
      vehNeed -= ch.solarToVehicle;
      var localCharge = 0;
      if (n.variant === "powerwall" && n.capacity > 0 && solar > 0) {
        var roomKw = Math.max(0, (n.capacity - n.soc) / dt);
        localCharge = Math.min(solar, n.maxKw, roomKw);
        solar -= localCharge;
        ch.solarToBattery = localCharge;
      }
      ch.solarToGrid = solar;
      prep.push({
        node: n,
        dem: dem,
        channels: ch,
        residualHome: homeNeed,
        residualVeh: vehNeed,
        exportKw: solar,
        charge: localCharge,
        discharge: 0
      });
    }

    var prepById = new Map();
    for (var p = 0; p < prep.length; p++) prepById.set(prep[p].node.id, prep[p]);

    for (var c = 0; c < state.links.length; c++) {
      if (state.links[c].kind === "cable") {
        state.links[c].flow = 0;
        state.links[c].dir = 0;
      }
    }

    var built = buildIslands(state);
    var exportKw = 0;

    built.groups.forEach(function (members) {
      var external = 0;
      var exportPool = 0;
      var demand = 0;
      var packs = [];
      var loads = [];
      for (var m = 0; m < members.length; m++) {
        var node = members[m];
        if (node.type === "turbine" || node.type === "solar") external += node.kw;
        if (node.type === "megapack") packs.push(node);
        var item = prepById.get(node.id);
        if (item) {
          exportPool += item.exportKw;
          demand += item.residualHome + item.residualVeh;
          loads.push(item);
        }
      }
      packs.sort(function (a, b) { return a.id - b.id; });
      loads.sort(function (a, b) { return a.node.id - b.node.id; });
      var supply = external + exportPool;

      if (supply + 1e-9 >= demand) {
        for (var L = 0; L < loads.length; L++) {
          var load = loads[L];
          load.channels.gridToHome += load.residualHome;
          load.channels.gridToVehicle += load.residualVeh;
          load.residualHome = 0;
          load.residualVeh = 0;
        }
        var left = supply - demand;
        for (var P = 0; P < packs.length; P++) {
          var pack = packs[P];
          var chg = Math.min(left, packPower(pack, dt, "chg"));
          pack._charge = chg;
          pack._discharge = 0;
          left -= chg;
        }
        for (var H = 0; H < loads.length; H++) {
          var pw = loads[H];
          if (pw.node.variant !== "powerwall" || !(pw.node.capacity > 0)) continue;
          var already = pw.charge;
          var room2 = Math.max(0, (pw.node.capacity - pw.node.soc) / dt - already);
          var capKw = Math.max(0, pw.node.maxKw - already);
          var extra = Math.min(left, capKw, room2);
          pw.charge += extra;
          pw.channels.gridToBattery += extra;
          left -= extra;
        }
        exportKw += left;
        for (var e = 0; e < members.length; e++) {
          if (members[e].type === "megapack" && members[e]._charge == null) {
            members[e]._charge = 0;
            members[e]._discharge = 0;
          }
        }
      } else {
        var share = demand > 1e-12 ? supply / demand : 0;
        var unmet = [];
        for (var u = 0; u < loads.length; u++) {
          var ld = loads[u];
          var res = ld.residualHome + ld.residualVeh;
          var got = res * share;
          var toHome = Math.min(got, ld.residualHome);
          var toVeh = Math.min(Math.max(0, got - toHome), ld.residualVeh);
          ld.channels.gridToHome += toHome;
          ld.channels.gridToVehicle += toVeh;
          ld.residualHome -= toHome;
          ld.residualVeh -= toVeh;
          unmet.push(ld);
        }
        var totalUnmet = 0;
        for (var q = 0; q < unmet.length; q++) {
          var itemU = unmet[q];
          var need = itemU.residualHome + itemU.residualVeh;
          var dis = 0;
          if (itemU.node.variant === "powerwall" && itemU.node.capacity > 0) {
            var avail = Math.min(itemU.node.maxKw, Math.max(0, itemU.node.soc / dt));
            dis = Math.min(need, avail);
            var bHome = Math.min(dis, itemU.residualHome);
            var bVeh = dis - bHome;
            itemU.channels.batteryToHome += bHome;
            itemU.channels.batteryToVehicle += bVeh;
            itemU.discharge = dis;
            itemU.residualHome -= bHome;
            itemU.residualVeh -= bVeh;
          }
          totalUnmet += itemU.residualHome + itemU.residualVeh;
        }
        var packAvail = [];
        var availSum = 0;
        for (var k = 0; k < packs.length; k++) {
          var pk = packs[k];
          var can = packPower(pk, dt, "dis");
          packAvail.push(can);
          availSum += can;
          pk._charge = 0;
          pk._discharge = 0;
        }
        var give = Math.min(totalUnmet, availSum);
        if (give > 0 && totalUnmet > 0) {
          var packLeft = give;
          for (var r = 0; r < packs.length; r++) {
            var portion = availSum > 0 ? give * (packAvail[r] / availSum) : 0;
            packs[r]._discharge = portion;
            packLeft -= portion;
          }
          if (packs.length && Math.abs(packLeft) > 1e-6) packs[0]._discharge += packLeft;
          for (var s = 0; s < unmet.length; s++) {
            var ld2 = unmet[s];
            var need2 = ld2.residualHome + ld2.residualVeh;
            if (need2 <= 0) continue;
            var cover = give * (need2 / totalUnmet);
            var h2 = Math.min(cover, ld2.residualHome);
            var v2 = Math.min(Math.max(0, cover - h2), ld2.residualVeh);
            ld2.channels.gridToHome += h2;
            ld2.channels.gridToVehicle += v2;
            ld2.residualHome -= h2;
            ld2.residualVeh -= v2;
          }
        }
      }

      var moved = Math.min(supply, demand);
      if (supply + 1e-9 >= demand) {
        for (var pc = 0; pc < packs.length; pc++) moved += packs[pc]._charge || 0;
        for (var gc = 0; gc < loads.length; gc++) moved += loads[gc].channels.gridToBattery || 0;
      } else {
        for (var pd = 0; pd < packs.length; pd++) moved += packs[pd]._discharge || 0;
      }
      for (var li = 0; li < state.links.length; li++) {
        var edge = state.links[li];
        if (edge.kind !== "cable") continue;
        if (members.some(function (n) { return n.id === edge.from; }) &&
            members.some(function (n) { return n.id === edge.to; })) {
          if (moved > edge.flow) edge.flow = moved;
        }
      }
      orientCables(state, members, prepById);
    });

    for (var pi = 0; pi < prep.length; pi++) {
      var item = prep[pi];
      var node = item.node;
      if (node.variant === "powerwall" && node.capacity > 0) {
        node.soc = clamp(node.soc + (item.charge - item.discharge) * dt, 0, node.capacity);
      }
      var servedHome = item.channels.solarToHome + item.channels.gridToHome + item.channels.batteryToHome;
      var servedVeh = item.channels.solarToVehicle + item.channels.gridToVehicle + item.channels.batteryToVehicle;
      if (node.vehicle && servedVeh > 0) {
        node.vehicle.soc = clamp(node.vehicle.soc + servedVeh * dt, 0, node.vehicle.capacity);
      }
      var served = servedHome + servedVeh;
      var demandKw = item.dem.demandKw;
      var gridImport = item.channels.gridToHome + item.channels.gridToVehicle + item.channels.gridToBattery;
      var gridExport = item.channels.solarToGrid;
      node.kw = served;
      node.flow = {
        solarKw: (node.roofKw || 0) * sun,
        homeKw: item.dem.homeKw,
        vehicleKw: item.dem.vehicleKw,
        demandKw: demandKw,
        servedKw: served,
        servedHomeKw: servedHome,
        servedVehicleKw: servedVeh,
        batteryKw: (item.channels.batteryToHome + item.channels.batteryToVehicle) -
          (item.channels.solarToBattery + item.channels.gridToBattery),
        batterySoc: node.variant === "powerwall" && node.capacity > 0 ? node.soc / node.capacity : null,
        vehicleSoc: node.vehicle ? node.vehicle.soc / node.vehicle.capacity : null,
        away: !!(node.vehicle && node.vehicle.away),
        gridKw: gridImport - gridExport,
        satisfied: served + 1e-6 >= demandKw,
        channels: item.channels
      };
    }

    for (var mi = 0; mi < state.nodes.length; mi++) {
      var pack = state.nodes[mi];
      if (pack.type !== "megapack") continue;
      var chgK = pack._charge || 0;
      var disK = pack._discharge || 0;
      pack.soc = clamp(pack.soc + (chgK - disK) * dt, 0, pack.capacity);
      pack.kw = disK - chgK;
      pack.chargeKw = chgK;
      pack.dischargeKw = disK;
      pack._charge = 0;
      pack._discharge = 0;
      pack.flow = {
        soc: pack.capacity > 0 ? pack.soc / pack.capacity : 0,
        chargeKw: chgK,
        dischargeKw: disK,
        storedKWh: pack.soc
      };
    }

    var roofSum = 0;
    var consumeKw = 0;
    var servedSum = 0;
    for (var si = 0; si < prep.length; si++) {
      var pit = prep[si];
      if (pit.node.type === "house") roofSum += (pit.node.roofKw || 0) * sun;
      consumeKw += pit.dem.demandKw;
      servedSum += pit.node.flow ? pit.node.flow.servedKw : 0;
    }
    var packIn = 0;
    var packOut = 0;
    var thermalKw = 0;
    var solarKw = 0;
    for (var gk = 0; gk < state.nodes.length; gk++) {
      var gn = state.nodes[gk];
      if (gn.type === "turbine") thermalKw += gn.kw || 0;
      if (gn.type === "solar") solarKw += gn.kw || 0;
      if (gn.type === "megapack") {
        packIn += gn.chargeKw || 0;
        packOut += gn.dischargeKw || 0;
      }
    }
    var produceKw = thermalKw + solarKw + roofSum;
    state.live = {
      produceKw: produceKw,
      consumeKw: consumeKw,
      servedKw: servedSum,
      thermalKw: thermalKw,
      solarKw: solarKw,
      roofKw: roofSum,
      packIn: packIn,
      packOut: packOut,
      balanceKw: produceKw - consumeKw,
      weather: weatherAt(state.hour),
      peak: peakName(state.hour)
    };
    state.exportableKWh += exportKw * dt;
    state.generatedKWh += produceKw * dt;
    state.consumedKWh += consumeKw * dt;
    state.dayGeneratedKWh += produceKw * dt;
    state.dayConsumedKWh += consumeKw * dt;
    state.hour += dt;
    state.elapsed += dt;
    if (state.autoGrow !== false && state.growthEvery > 0) {
      state.growthAcc += dt;
      var guard = 0;
      while (state.growthAcc + 1e-9 >= state.growthEvery && guard++ < 10000) {
        state.growthAcc -= state.growthEvery;
        spawnHouse(state);
      }
    }
    refreshDistricts(state);
  }

  function spawnHouse(state) {
    var i = state.growthIndex++;
    var col = i % 4;
    var row = Math.floor(i / 4);
    var variant = i % 2 === 0 ? "powerwall" : "vehicle";
    return place(state, {
      type: "house",
      free: true,
      x: -30 + col * 12,
      z: 22 + row * 14,
      variant: variant,
      district: "residential",
      soc: variant === "powerwall" ? 2 : 0,
      vehicleSoc: 22,
      plugged: true
    });
  }

  function refreshDistricts(state) {
    var ids = ["residential", "industrial"];
    for (var d = 0; d < ids.length; d++) {
      var dist = state.districts[ids[d]];
      var demand = 0;
      var served = 0;
      var count = 0;
      var all = true;
      for (var i = 0; i < state.nodes.length; i++) {
        var n = state.nodes[i];
        if (n.district !== dist.id) continue;
        if (n.type !== "house" && n.type !== "industry") continue;
        count++;
        if (!n.flow) { all = false; continue; }
        demand += n.flow.demandKw;
        served += n.flow.servedKw;
        if (!n.flow.satisfied) all = false;
      }
      dist.count = count;
      dist.demandKw = demand;
      dist.servedKw = served;
      dist.satisfied = count > 0 && all && served + 1e-6 >= demand;
    }
  }

  function tick(state, hours) {
    if (!Number.isFinite(hours) || hours <= 0) return { ok: false };
    var left = hours;
    var steps = 0;
    while (left > 1e-9 && steps < 1000000) {
      var dt = Math.min(0.25, left);
      step(state, dt);
      left -= dt;
      steps++;
    }
    state.failed = false;
    return { ok: true, steps: steps };
  }

  function sameIsland(state, a, b) {
    var built = buildIslands(state);
    if (!built.parent.has(a) || !built.parent.has(b)) return false;
    return findRoot(built.parent, a) === findRoot(built.parent, b);
  }

  function tieDistrict(state, districtId, hubId) {
    var hub = nodeById(state, hubId);
    if (!hub) return { ok: false, reason: "noeud", linked: 0 };
    if (!ELECTRIC[hub.type]) return { ok: false, reason: "electrique", linked: 0 };
    var targets = state.nodes.filter(function (n) {
      return n.district === districtId && (n.type === "house" || n.type === "industry");
    });
    targets.sort(function (a, b) { return a.id - b.id; });
    var linked = 0;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (sameIsland(state, hubId, t.id)) continue;
      var res = link(state, { kind: "cable", from: hubId, to: t.id });
      if (!res.ok) {
        if (res.reason === "existe") continue;
        return { ok: false, reason: res.reason, linked: linked, cost: res.cost, money: state.money };
      }
      linked++;
    }
    return { ok: true, linked: linked };
  }

  function houseCount(state) {
    var n = 0;
    for (var i = 0; i < state.nodes.length; i++) if (state.nodes[i].type === "house") n++;
    return n;
  }

  function advice(state) {
    function has(type) {
      for (var i = 0; i < state.nodes.length; i++) if (state.nodes[i].type === type) return true;
      return false;
    }
    function piped(aType, bType) {
      for (var i = 0; i < state.links.length; i++) {
        var e = state.links[i];
        if (e.kind !== "pipe") continue;
        var a = nodeById(state, e.from);
        var b = nodeById(state, e.to);
        if (a && b && a.type === aType && b.type === bType) return true;
      }
      return false;
    }
    var res = state.districts.residential;
    var ind = state.districts.industrial;
    if (!has("turbine") && !has("solar")) {
      return "Construisez un champ solaire, ou la chaîne eau → chauffe-eau → vapeur → turbine.";
    }
    if (has("intake") || has("heater") || has("boiler") || has("turbine")) {
      if (!has("intake")) return "Il manque la prise d'eau.";
      if (!has("heater")) return "Il manque le chauffe-eau, pour monter l'eau en température.";
      if (!has("boiler")) return "Il manque la chaudière, qui transforme l'eau chaude en vapeur.";
      if (!has("turbine")) return "Il manque la turbine, qui fait de la vapeur de l'électricité.";
      if (!piped("intake", "heater")) return "Tirez un tuyau de la prise d'eau vers le chauffe-eau.";
      if (!piped("heater", "boiler")) return "Tirez un tuyau du chauffe-eau vers la chaudière.";
      if (!piped("boiler", "turbine")) return "Tirez un tuyau de vapeur de la chaudière vers la turbine.";
    }
    var gen = 0;
    for (var i = 0; i < state.nodes.length; i++) {
      var n = state.nodes[i];
      if (n.type === "turbine" || n.type === "solar") gen += n.kw || 0;
    }
    if (gen <= 0.05 && has("solar") && !has("turbine") && sunFactor(state.hour) <= 0) {
      return "Le soleil est couché. Le champ solaire reprendra à l'aube, ou allumez une turbine.";
    }
    if ((res && !res.satisfied) || (ind && !ind.satisfied)) {
      var weather = weatherAt(state.hour);
      var peak = peakName(state.hour);
      if (gen > 0.05 && weather.factor > 1.15) {
        return "Journée froide (" + weather.temp + " °C) : le chauffage augmente la demande. Montez la production ou déchargez un Megapack.";
      }
      if (gen > 0.05 && peak) {
        return peak + " : la demande est plus haute. Un Megapack en décharge aide à passer le pic.";
      }
      return "Tirez des câbles de la production jusqu'aux maisons et à l'usine. Un poteau peut servir de relais.";
    }
    if (state.exportableKWh > 0.5) {
      return "Les quartiers sont alimentés. Le surplus peut être vendu, ou rangé dans un Megapack.";
    }
    if (state.autoGrow === false) {
      return "Le réseau tient. Les maisons automatiques sont coupées : posez-les depuis la palette.";
    }
    return "Le réseau tient. De nouvelles maisons arrivent avec le temps — pensez à les raccorder.";
  }

  var api = {
    GRANT: GRANT,
    COST: COST,
    NAMES: NAMES,
    create: create,
    place: place,
    link: link,
    removeNode: removeNode,
    removeLink: removeLink,
    setEnabled: setEnabled,
    setOutput: setOutput,
    setPrice: setPrice,
    setVehiclePlugged: setVehiclePlugged,
    setVehicleTrip: setVehicleTrip,
    setPackMode: setPackMode,
    setReserve: setReserve,
    setRoof: setRoof,
    setAutoGrow: setAutoGrow,
    weatherAt: weatherAt,
    peakName: peakName,
    setHour: function (state, hour) {
      if (!Number.isFinite(hour)) return { ok: false };
      state.hour = hour;
      return { ok: true };
    },
    grant: grant,
    sellSurplus: sellSurplus,
    tick: tick,
    tieDistrict: tieDistrict,
    node: nodeById,
    houseCount: houseCount,
    sunFactor: sunFactor,
    loadFactor: loadFactor,
    cost: costOf,
    advice: advice,
    district: function (state, id) { return state.districts[id]; }
  };

  global.GridSim = api;
})(typeof window !== "undefined" ? window : globalThis);
