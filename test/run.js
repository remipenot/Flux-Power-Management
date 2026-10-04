/* Loads the shipped browser simulation and drives it the way the game does. */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var root = path.join(__dirname, "..");
var simPath = path.join(root, "js", "sim.js");
var code = fs.readFileSync(simPath, "utf8");
if (/\brequire\s*\(/.test(code) || /\bmodule\.exports\b/.test(code)) {
  throw new Error("sim.js must stay a classic browser script");
}

var sandbox = { console: console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "js/sim.js" });
var GridSim = sandbox.GridSim;
if (!GridSim || typeof GridSim.tick !== "function") {
  throw new Error("GridSim.tick missing from shipped script");
}

var failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures += 1;
    console.error("FAIL: " + msg);
  }
}

function must(res, msg) {
  assert(res && res.ok, msg + (res && res.reason ? " (" + res.reason + ")" : ""));
  return res;
}

function chain(state, skip) {
  var types = ["intake", "heater", "boiler", "turbine"];
  var ids = {};
  types.forEach(function (type, i) {
    if (skip === type) return;
    var placed = must(GridSim.place(state, { type: type, x: i * 4, z: 0 }), "place " + type);
    ids[type] = placed.id;
  });
  for (var i = 0; i < types.length - 1; i++) {
    var pipeName = types[i] + "-" + types[i + 1];
    if (!ids[types[i]] || !ids[types[i + 1]]) continue;
    if (skip === "pipe:" + pipeName) continue;
    must(GridSim.link(state, { kind: "pipe", from: ids[types[i]], to: ids[types[i + 1]] }), "pipe " + pipeName);
  }
  return ids;
}

function fresh(extra) {
  var opts = { money: 1e9, populate: false, hour: 0, growthEvery: 0, price: 0.2 };
  if (extra) {
    Object.keys(extra).forEach(function (k) { opts[k] = extra[k]; });
  }
  return GridSim.create(opts);
}

(function thermalChain() {
  var good = fresh();
  var ids = chain(good);
  GridSim.tick(good, 1);
  var full = GridSim.node(good, ids.turbine).kw;
  assert(full > 0, "connected heat → water → steam chain produces power, got " + full);

  ["intake", "heater", "boiler", "turbine", "pipe:intake-heater", "pipe:heater-boiler", "pipe:boiler-turbine"].forEach(function (skip) {
    var broken = fresh();
    var b = chain(broken, skip);
    GridSim.tick(broken, 1);
    var kw = b.turbine ? GridSim.node(broken, b.turbine).kw : 0;
    assert(kw === 0, "missing " + skip + " must deliver 0, got " + kw);
  });

  GridSim.setOutput(good, ids.turbine, 0.5);
  GridSim.tick(good, 1);
  var half = GridSim.node(good, ids.turbine).kw;
  assert(Math.abs(half - full * 0.5) < 1e-6, "turbine output scales, full " + full + " half " + half);

  GridSim.setEnabled(good, ids.heater, false);
  GridSim.setOutput(good, ids.turbine, 1);
  GridSim.tick(good, 1);
  assert(GridSim.node(good, ids.turbine).kw === 0, "disabled heater stops the chain");
  GridSim.setEnabled(good, ids.heater, true);
})();

(function cablesAndHouses() {
  var state = fresh();
  var ids = chain(state);
  var a = must(GridSim.place(state, {
    type: "house", variant: "powerwall", soc: 0, capacity: 0, roofKw: 0, x: 10, z: 4, district: "residential"
  }), "house A");
  var b = must(GridSim.place(state, {
    type: "house", variant: "powerwall", soc: 0, capacity: 0, roofKw: 0, x: 16, z: 4, district: "residential"
  }), "house B");
  must(GridSim.link(state, { kind: "cable", from: ids.turbine, to: a.id }), "cable");
  GridSim.tick(state, 1);
  var ha = GridSim.node(state, a.id);
  var hb = GridSim.node(state, b.id);
  assert(ha.flow.servedKw > 0 && ha.flow.gridKw > 0, "cabled house receives grid power");
  assert(ha.flow.satisfied, "cabled house is satisfied");
  assert(hb.flow.servedKw < 1e-6 && Math.abs(hb.flow.gridKw) < 1e-6, "uncabled house receives nothing");
  assert(!hb.flow.satisfied, "uncabled house is unsatisfied");

  var money = state.money;
  GridSim.setEnabled(state, ids.turbine, false);
  GridSim.tick(state, 1);
  assert(!GridSim.node(state, a.id).flow.satisfied, "house is unsatisfied when generation stops");
  assert(state.money === money, "undersupply does not take money or end the run");
  assert(state.failed !== true, "undersupply does not end the run");
  var again = GridSim.tick(state, 1);
  assert(again.ok, "simulation keeps running while short");
})();

(function powerwallVersusVehicle() {
  var state = fresh({ hour: 0 });
  var pw = must(GridSim.place(state, {
    type: "house", variant: "powerwall", soc: 13.5, roofKw: 0, x: 0, z: 0
  }), "powerwall house");
  var car = must(GridSim.place(state, {
    type: "house", variant: "vehicle", roofKw: 0, vehicleSoc: 20, plugged: true, x: 8, z: 0
  }), "vehicle house");
  var before = GridSim.node(state, pw.id).soc;
  GridSim.tick(state, 1);
  var power = GridSim.node(state, pw.id);
  var vehicle = GridSim.node(state, car.id);
  assert(power.flow.satisfied, "powerwall covers the house from stored charge");
  assert(power.soc < before, "powerwall state of charge falls, soc " + power.soc);
  assert(power.flow.batteryKw > 0, "powerwall discharges, batteryKw " + power.flow.batteryKw);
  assert(vehicle.flow.vehicleKw > 0, "vehicle draws a charge");
  assert(vehicle.flow.demandKw > power.flow.demandKw, "vehicle house demands more while charging");
  assert(!vehicle.flow.satisfied, "vehicle house is not covered without a supply");
  var chargingDemand = vehicle.flow.demandKw;
  GridSim.setVehiclePlugged(state, car.id, false);
  GridSim.tick(state, 0.25);
  vehicle = GridSim.node(state, car.id);
  assert(vehicle.flow.vehicleKw === 0, "unplugged vehicle stops charging");
  assert(vehicle.flow.demandKw < chargingDemand, "demand drops when the vehicle is not charging");
})();

(function solarSecondSource() {
  var day = fresh({ hour: 12 });
  var solar = must(GridSim.place(day, { type: "solar", x: 0, z: 0 }), "solar");
  var plant = must(GridSim.place(day, { type: "industry", x: 12, z: 0, baseKw: 80 }), "industry");
  GridSim.tick(day, 0.25);
  assert(GridSim.node(day, solar.id).kw > 0, "solar produces at noon");
  assert(GridSim.node(day, plant.id).flow.servedKw < 1e-6, "solar without a cable does not reach the plant");
  must(GridSim.link(day, { kind: "cable", from: solar.id, to: plant.id }), "solar cable");
  GridSim.tick(day, 0.25);
  var served = GridSim.node(day, plant.id);
  assert(served.flow.demandKw > 0 && served.flow.satisfied, "cabled solar satisfies the plant at noon");
  GridSim.setHour(day, 0);
  GridSim.tick(day, 0.25);
  assert(GridSim.node(day, solar.id).kw === 0, "solar is dark at night");
  assert(!GridSim.node(day, plant.id).flow.satisfied, "plant is unsatisfied when solar is down");
})();

(function megapack() {
  var state = fresh({ hour: 12 });
  var solar = must(GridSim.place(state, { type: "solar", x: 0, z: 0 }), "solar");
  var pack = must(GridSim.place(state, { type: "megapack", x: 6, z: 0, soc: 0 }), "megapack");
  var plant = must(GridSim.place(state, {
    type: "industry", x: 20, z: 0, district: "industrial", baseKw: 100
  }), "industry");
  must(GridSim.link(state, { kind: "cable", from: solar.id, to: pack.id }), "pack cable");
  GridSim.tick(state, 1);
  var charged = GridSim.node(state, pack.id).soc;
  assert(charged > 50, "megapack charges from surplus, soc " + charged);
  assert(!GridSim.district(state, "industrial").satisfied, "industry starts unsatisfied while isolated");

  GridSim.setEnabled(state, solar.id, false);
  must(GridSim.link(state, { kind: "cable", from: pack.id, to: plant.id }), "industry cable");
  GridSim.tick(state, 0.5);
  var after = GridSim.node(state, pack.id);
  var district = GridSim.district(state, "industrial");
  assert(after.soc < charged, "megapack discharges, soc " + after.soc);
  assert(after.dischargeKw > 0, "megapack discharge power is live");
  assert(district.satisfied, "discharge takes the industrial site from unsatisfied to satisfied");
  assert(district.servedKw + 1e-6 >= district.demandKw, "delivered power covers industrial demand");

  var dry = fresh({ hour: 12 });
  var lone = must(GridSim.place(dry, { type: "industry", district: "industrial", baseKw: 100, x: 0, z: 0 }), "dry");
  GridSim.tick(dry, 0.5);
  assert(!GridSim.district(dry, "industrial").satisfied, "without stored energy the site stays unsatisfied");
  assert(GridSim.node(dry, lone.id).flow.servedKw < 1e-6, "unsupplied industry draws nothing");
})();

(function growthAndSaleAndGrant() {
  var grown = GridSim.create({ money: 0, populate: false, hour: 8, growthEvery: 3 });
  var before = GridSim.houseCount(grown);
  GridSim.tick(grown, 3);
  assert(GridSim.houseCount(grown) === before + 1, "time adds a house");
  GridSim.tick(grown, 6);
  assert(GridSim.houseCount(grown) === before + 3, "growth keeps adding houses");
  assert(grown.failed !== true, "growth does not end the run");

  var live = GridSim.create();
  var seeded = GridSim.houseCount(live);
  assert(seeded >= 4, "a fresh game already has a neighborhood");
  assert(live.nodes.some(function (n) { return n.type === "industry"; }), "a fresh game has industry");
  GridSim.tick(live, live.growthEvery);
  assert(GridSim.houseCount(live) === seeded + 1, "the shipped create() grows houses over time");

  var seller = fresh({ hour: 0, price: 0.05 });
  chain(seller);
  GridSim.tick(seller, 1);
  var energy = seller.exportableKWh;
  assert(energy > 0, "surplus is metered, kWh " + energy);
  var moneyBefore = seller.money;
  GridSim.setPrice(seller, 2);
  var sale = GridSim.sellSurplus(seller);
  assert(sale.energy === energy, "sell reports the metered surplus");
  assert(sale.revenue === seller.price * sale.energy, "revenue is price times energy");
  assert(seller.money === moneyBefore + sale.revenue, "money increases by price × energy sold");
  assert(seller.exportableKWh === 0, "surplus meter clears after the sale");

  var broken = fresh();
  chain(broken, "pipe:boiler-turbine");
  GridSim.tick(broken, 1);
  assert(broken.exportableKWh < 1e-6, "a broken chain has nothing to sell");

  var cost = GridSim.cost("megapack");
  var poor = GridSim.create({ money: cost - 1, populate: false, growthEvery: 0 });
  var denied = GridSim.place(poor, { type: "megapack", x: 0, z: 0 });
  assert(!denied.ok && denied.reason === "fonds insuffisants", "build over the balance is refused");
  assert(poor.money === cost - 1, "refused build does not take money");
  assert(!poor.nodes.some(function (n) { return n.type === "megapack"; }), "refused build places nothing");
  var gifted = GridSim.grant(poor);
  assert(gifted.ok && poor.money === cost - 1 + GridSim.GRANT, "grant raises the balance");
  var bought = GridSim.place(poor, { type: "megapack", x: 2, z: 2 });
  assert(bought.ok, "the same build succeeds after the grant");
  assert(poor.money === cost - 1 + GridSim.GRANT - cost, "the build then spends the balance");
})();

(function playerSession() {
  var state = GridSim.create({ money: 30000, populate: false, hour: 0, growthEvery: 0, price: 0.22 });
  var home = must(GridSim.place(state, {
    type: "house", variant: "powerwall", soc: 0, roofKw: 0, x: -10, z: -6, district: "residential"
  }), "home");
  var works = must(GridSim.place(state, {
    type: "industry", x: 24, z: -4, baseKw: 100, district: "industrial"
  }), "works");
  var ids = chain(state);
  must(GridSim.link(state, { kind: "cable", from: ids.turbine, to: home.id }), "home cable");
  must(GridSim.link(state, { kind: "cable", from: ids.turbine, to: works.id }), "works cable");
  GridSim.tick(state, 1);
  assert(GridSim.district(state, "residential").satisfied, "residential neighborhood is satisfied once cabled");
  assert(GridSim.district(state, "industrial").satisfied, "industrial site is satisfied once cabled");
  assert(state.exportableKWh > 0, "leftover generation is surplus");
  var before = state.money;
  var sale = GridSim.sellSurplus(state);
  assert(state.money === before + state.price * sale.energy, "session sale credits price × kWh");
  assert(typeof GridSim.advice(state) === "string" && GridSim.advice(state).length > 0, "advice is player text");
})();

(function paceWeatherTripsAndPacks() {
  var roofs = fresh({ hour: 8 });
  var zeros = 0;
  var panels = 0;
  var i;
  for (i = 0; i < 24; i++) {
    var placed = must(GridSim.place(roofs, { type: "house", x: (i % 8) * 4, z: Math.floor(i / 8) * 4 }), "roof house");
    if (placed.node.roofKw === 0) zeros++;
    else if (placed.node.roofKw > 0) panels++;
  }
  assert(zeros > 0 && panels > 0, "roofs are mixed, bare " + zeros + " panels " + panels);
  var pinned = must(GridSim.place(roofs, { type: "house", roofKw: 0, x: 40, z: 40 }), "pinned roof");
  assert(pinned.node.roofKw === 0, "explicit roofKw 0 stays bare");

  var paused = GridSim.create({ money: 0, populate: false, hour: 8, growthEvery: 3, autoGrow: false });
  var count = GridSim.houseCount(paused);
  GridSim.tick(paused, 12);
  assert(GridSim.houseCount(paused) === count, "auto growth off adds no house");
  GridSim.setAutoGrow(paused, true);
  GridSim.tick(paused, 3);
  assert(GridSim.houseCount(paused) === count + 1, "auto growth on adds a house");

  var buyer = fresh({ money: 2800 });
  var bought = GridSim.place(buyer, { type: "house", priced: true, x: 0, z: 0 });
  assert(bought.ok && buyer.money === 0, "a manual house costs CAD " + buyer.money);

  var noon = fresh({ hour: 12 });
  var gone = must(GridSim.place(noon, {
    type: "house", variant: "vehicle", roofKw: 0, vehicleSoc: 40, plugged: true, x: 0, z: 0
  }), "noon car");
  GridSim.tick(noon, 0.05);
  var goneNode = GridSim.node(noon, gone.id);
  assert(goneNode.vehicle.away && goneNode.flow.vehicleKw === 0, "a car is away at noon and does not charge");

  var night = fresh({ hour: 0 });
  var homeCar = must(GridSim.place(night, {
    type: "house", variant: "vehicle", roofKw: 0, vehicleSoc: 20, plugged: true, x: 0, z: 0
  }), "night car");
  GridSim.tick(night, 0.25);
  var homeNode = GridSim.node(night, homeCar.id);
  assert(!homeNode.vehicle.away && homeNode.flow.vehicleKw > 0, "a plugged car at night is home and charging");

  var mild = fresh({ hour: 12 });
  var mildHouse = must(GridSim.place(mild, { type: "house", roofKw: 0, appetite: 1, x: 0, z: 0 }), "mild");
  GridSim.tick(mild, 0.05);
  var mildKw = GridSim.node(mild, mildHouse.id).flow.homeKw;
  var cold = fresh({ hour: 84 });
  var coldHouse = must(GridSim.place(cold, { type: "house", roofKw: 0, appetite: 1, x: 0, z: 0 }), "cold");
  GridSim.tick(cold, 0.05);
  var coldKw = GridSim.node(cold, coldHouse.id).flow.homeKw;
  assert(coldKw > mildKw * 1.2, "a cold day draws more, mild " + mildKw + " cold " + coldKw);
  var peak = fresh({ hour: 18 });
  var peakHouse = must(GridSim.place(peak, { type: "house", roofKw: 0, appetite: 1, x: 0, z: 0 }), "peak");
  GridSim.tick(peak, 0.05);
  var peakKw = GridSim.node(peak, peakHouse.id).flow.homeKw;
  assert(peakKw > mildKw, "evening peak draws more than midday, peak " + peakKw + " mild " + mildKw);

  var forward = fresh({ hour: 12 });
  var farm = must(GridSim.place(forward, { type: "solar", x: 0, z: 0 }), "dir solar");
  var load = must(GridSim.place(forward, { type: "house", roofKw: 0, x: 20, z: 0 }), "dir house");
  must(GridSim.link(forward, { kind: "cable", from: farm.id, to: load.id }), "forward cable");
  GridSim.tick(forward, 0.25);
  assert(forward.links[0].dir === 1 && forward.links[0].flow > 0.05, "power flows from the solar farm toward the house");
  var backward = fresh({ hour: 12 });
  var farm2 = must(GridSim.place(backward, { type: "solar", x: 0, z: 0 }), "dir solar 2");
  var load2 = must(GridSim.place(backward, { type: "house", roofKw: 0, x: 20, z: 0 }), "dir house 2");
  must(GridSim.link(backward, { kind: "cable", from: load2.id, to: farm2.id }), "reverse cable");
  GridSim.tick(backward, 0.25);
  assert(backward.links[0].dir === -1, "a reversed cable points back toward the source, dir " + backward.links[0].dir);

  var feed = fresh({ hour: 12 });
  var roof = must(GridSim.place(feed, { type: "house", roofKw: 12, baseKw: 0.4, capacity: 0, x: 0, z: 0 }), "export house");
  var pole = must(GridSim.place(feed, { type: "pole", x: 12, z: 0 }), "export pole");
  var pack = must(GridSim.place(feed, { type: "megapack", x: 24, z: 0, soc: 0 }), "export pack");
  var toPole = must(GridSim.link(feed, { kind: "cable", from: roof.id, to: pole.id }), "house to pole");
  var toPack = must(GridSim.link(feed, { kind: "cable", from: pole.id, to: pack.id }), "pole to pack");
  GridSim.tick(feed, 0.25);
  var hop1 = null;
  var hop2 = null;
  feed.links.forEach(function (edge) {
    if (edge.id === toPole.id) hop1 = edge;
    if (edge.id === toPack.id) hop2 = edge;
  });
  assert(hop1.flow > 0.05 && hop1.dir === 1, "a house feeding a pole sends current outward, dir " + hop1.dir + " flow " + hop1.flow);
  assert(hop2.flow > 0.05 && hop2.dir === 1, "that current continues into the megapack, dir " + hop2.dir + " flow " + hop2.flow);
  assert(GridSim.node(feed, pack.id).chargeKw > 0.05, "the megapack is actually charging from the house");

  var night = fresh({ hour: 0 });
  var battery = must(GridSim.place(night, { type: "megapack", x: 0, z: 0, soc: 400 }), "night pack");
  var nightHome = must(GridSim.place(night, { type: "house", roofKw: 0, capacity: 0, x: 16, z: 0 }), "night house");
  must(GridSim.link(night, { kind: "cable", from: nightHome.id, to: battery.id }), "night cable stored toward the house");
  GridSim.tick(night, 0.25);
  var back = night.links[0];
  assert(back.flow > 0.05 && back.dir === -1, "megapack discharge runs toward the house, dir " + back.dir + " flow " + back.flow);
  assert(GridSim.node(night, nightHome.id).flow.satisfied, "the house is fed by the megapack");

  var held = fresh({ hour: 12 });
  var sun = must(GridSim.place(held, { type: "solar", x: 0, z: 0 }), "pack solar");
  var pack = must(GridSim.place(held, { type: "megapack", x: 8, z: 0, soc: 0 }), "pack controls");
  must(GridSim.link(held, { kind: "cable", from: sun.id, to: pack.id }), "pack link");
  assert(GridSim.setOutput(held, pack.id, 0).ok, "megapack setpoint is accepted");
  GridSim.tick(held, 1);
  assert(GridSim.node(held, pack.id).soc < 1e-6, "output 0 does not charge the megapack");
  GridSim.setOutput(held, pack.id, 1);
  GridSim.setEnabled(held, pack.id, false);
  GridSim.tick(held, 1);
  assert(GridSim.node(held, pack.id).soc < 1e-6, "a megapack hors service does not charge");
  GridSim.setEnabled(held, pack.id, true);
  GridSim.setPackMode(held, pack.id, "hold");
  GridSim.tick(held, 1);
  assert(GridSim.node(held, pack.id).soc < 1e-6, "hold mode does not charge");
  GridSim.setPackMode(held, pack.id, "auto");
  GridSim.tick(held, 1);
  assert(GridSim.node(held, pack.id).soc > 20, "auto mode charges again, soc " + GridSim.node(held, pack.id).soc);

  var live = fresh({ hour: 12 });
  chain(live);
  GridSim.tick(live, 0.25);
  assert(live.live && live.live.produceKw > 0 && live.live.consumeKw === 0, "live stats report production");
  assert(live.consumedKWh === 0 && live.generatedKWh > 0, "energy totals follow the tick");
})();

if (failures) {
  console.error(failures + " assertion(s) failed");
  process.exit(1);
}
console.log("ok — shipped GridSim passed thermal, cable, powerwall, vehicle, solar, megapack, growth, price, grant");
