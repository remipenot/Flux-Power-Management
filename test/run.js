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

(function tariffPriorityAndForecast() {
  assert(GridSim.tariffFactor(1) === 1, "night tariff stays 1");
  assert(GridSim.tariffFactor(12) === 0.65, "midday tariff is 0.65");
  assert(GridSim.tariffFactor(18) === 1.8, "evening peak tariff is 1.8");
  assert(GridSim.tariffFactor(8) === 1.8, "morning peak tariff is 1.8");

  var peakSale = fresh({ hour: 18, price: 1 });
  chain(peakSale);
  GridSim.tick(peakSale, 0.2);
  var peakEnergy = peakSale.exportableKWh;
  var moneyBefore = peakSale.money;
  var peakSold = GridSim.sellSurplus(peakSale);
  assert(peakEnergy > 0, "peak hour still meters surplus");
  assert(Math.abs(peakSold.revenue - peakEnergy * 1.8) < 1e-6, "peak sale pays 1.8, got " + peakSold.revenue);
  assert(peakSale.money === moneyBefore + peakSold.revenue, "peak revenue is credited once");
  assert(peakSold.factor === 1.8, "sale reports the tariff factor");

  var cast = GridSim.forecast(fresh({ hour: 8 }));
  assert(cast.tomorrow.temp === GridSim.weatherAt(32).temp, "tomorrow matches the next day");

  var short = fresh({ hour: 12 });
  var solar = must(GridSim.place(short, { type: "solar", x: 0, z: 0 }), "priority solar");
  var first = must(GridSim.place(short, {
    type: "house", roofKw: 0, capacity: 0, appetite: 1, baseKw: 200, x: 12, z: 0
  }), "priority house");
  var second = must(GridSim.place(short, {
    type: "house", roofKw: 0, capacity: 0, appetite: 1, baseKw: 200, x: 20, z: 0
  }), "ordinary house");
  must(GridSim.link(short, { kind: "cable", from: solar.id, to: first.id }), "priority cable");
  must(GridSim.link(short, { kind: "cable", from: solar.id, to: second.id }), "ordinary cable");
  GridSim.node(short, first.id).appetite = 1;
  GridSim.node(short, second.id).appetite = 1;
  GridSim.tick(short, 0.05);
  var evenA = GridSim.node(short, first.id).flow.servedKw;
  var evenB = GridSim.node(short, second.id).flow.servedKw;
  assert(Math.abs(evenA - evenB) < 1, "without a priority flag the two houses share, " + evenA + " vs " + evenB);
  assert(!GridSim.node(short, first.id).flow.satisfied, "the pair is actually short of power");
  var denied = GridSim.setPriority(short, solar.id, true);
  assert(!denied.ok, "only a house can be priority");
  must(GridSim.setPriority(short, first.id, true), "mark priority");
  GridSim.tick(short, 0.05);
  var pri = GridSim.node(short, first.id).flow.servedKw;
  var rest = GridSim.node(short, second.id).flow.servedKw;
  assert(pri > rest + 5, "the priority house is served first, " + pri + " vs " + rest);
  assert(pri > evenA, "priority raises that house above the equal share");

  var dark = fresh({ hour: 12 });
  var lone = must(GridSim.place(dark, { type: "house", roofKw: 0, capacity: 0, x: 0, z: 0 }), "dark house");
  var purse = dark.money;
  GridSim.tick(dark, 0.5);
  assert(dark.dayShortH > 0, "an unserved house counts against the day's reliability");
  assert(dark.money === purse, "a shortfall still does not take money");
  assert(GridSim.node(dark, lone.id).flow && !GridSim.node(dark, lone.id).flow.satisfied, "the lone house stays short");
})();

(function storageLogics() {
  var backed = fresh({ hour: 0 });
  var car = must(GridSim.place(backed, {
    type: "house", variant: "vehicle", roofKw: 0, appetite: 1, vehicleSoc: 50, v2l: "auto", x: 0, z: 0
  }), "v2l house");
  var before = GridSim.node(backed, car.id).vehicle.soc;
  GridSim.tick(backed, 0.25);
  var fed = GridSim.node(backed, car.id);
  assert(fed.flow.satisfied, "V2L auto keeps an isolated house on");
  assert(fed.flow.v2lKw > 0.5, "V2L delivers kilowatts, got " + fed.flow.v2lKw);
  assert(fed.vehicle.soc < before, "the car battery falls while it feeds the house");
  assert((fed.flow.channels.vehicleToHome || 0) > 0.5, "the house flow shows vehicle-to-home");

  var guarded = fresh({ hour: 0 });
  var low = must(GridSim.place(guarded, {
    type: "house", variant: "vehicle", roofKw: 0, appetite: 1, vehicleSoc: 10, v2l: "auto", x: 0, z: 0
  }), "reserve car");
  var lowBefore = GridSim.node(guarded, low.id).vehicle.soc;
  GridSim.tick(guarded, 0.25);
  var heldCar = GridSim.node(guarded, low.id);
  assert(heldCar.flow.v2lKw === 0, "V2L stops at the commute reserve");
  assert(Math.abs(heldCar.vehicle.soc - lowBefore) < 1e-6, "reserve charge is not spent");
  assert(!heldCar.flow.satisfied, "a car below its reserve cannot carry the house");

  var noon = fresh({ hour: 12 });
  var gone = must(GridSim.place(noon, {
    type: "house", variant: "vehicle", roofKw: 0, vehicleSoc: 60, v2l: "boost", x: 4, z: 0
  }), "away v2l");
  GridSim.tick(noon, 0.05);
  var awayCar = GridSim.node(noon, gone.id);
  assert(awayCar.vehicle.away, "boost does not cancel the commute");
  assert(awayCar.flow.v2lKw === 0, "an absent car does not feed the house");

  var share = fresh({ hour: 0 });
  var donor = must(GridSim.place(share, {
    type: "house", variant: "vehicle", roofKw: 0, appetite: 1, vehicleSoc: 60, v2l: "boost", x: 0, z: 0
  }), "boost donor");
  var neighbor = must(GridSim.place(share, {
    type: "house", variant: "powerwall", capacity: 0, roofKw: 0, appetite: 1, x: 8, z: 0
  }), "boost neighbor");
  must(GridSim.link(share, { kind: "cable", from: donor.id, to: neighbor.id }), "v2l cable");
  GridSim.tick(share, 0.25);
  assert(GridSim.node(share, donor.id).flow.satisfied, "the donor house stays on");
  assert(GridSim.node(share, neighbor.id).flow.satisfied, "V2L boost carries the neighbor");
  assert(share.links[0].energy === "storage", "the shared cable is tagged as storage, " + share.links[0].energy);

  var locked = fresh({ hour: 0 });
  var wall = must(GridSim.place(locked, {
    type: "house", variant: "powerwall", soc: 13.5, roofKw: 0, appetite: 1, mode: "hold", x: 0, z: 0
  }), "held wall");
  var soc = GridSim.node(locked, wall.id).soc;
  GridSim.tick(locked, 0.25);
  var heldWall = GridSim.node(locked, wall.id);
  assert(!heldWall.flow.satisfied, "a Powerwall on hold does not cover the house");
  assert(Math.abs(heldWall.soc - soc) < 1e-6, "hold keeps the state of charge");

  var peak = fresh({ hour: 18 });
  var plant = chain(peak);
  var shave = must(GridSim.place(peak, {
    type: "house", variant: "powerwall", soc: 13.5, roofKw: 0, appetite: 1, baseKw: 4, x: 12, z: 0
  }), "shave house");
  must(GridSim.link(peak, { kind: "cable", from: plant.turbine, to: shave.id }), "shave cable");
  GridSim.tick(peak, 0.25);
  var shaved = GridSim.node(peak, shave.id);
  var exported = peak.exportableKWh;
  assert(shaved.flow.satisfied && shaved.flow.batteryKw > 0.5, "at peak the Powerwall carries the house");
  assert(Math.abs(shaved.flow.gridKw) < 0.2, "peak shaving stops the house importing, grid " + shaved.flow.gridKw);

  var flat = fresh({ hour: 18 });
  var plant2 = chain(flat);
  var quiet = must(GridSim.place(flat, {
    type: "house", variant: "powerwall", soc: 13.5, roofKw: 0, appetite: 1, baseKw: 4, mode: "hold", x: 12, z: 0
  }), "flat house");
  must(GridSim.link(flat, { kind: "cable", from: plant2.turbine, to: quiet.id }), "flat cable");
  GridSim.tick(flat, 0.25);
  assert(flat.exportableKWh + 0.4 < exported, "peak shaving frees generation to sell, " + flat.exportableKWh + " vs " + exported);

  assert(GridSim.criticalPeak(18) === false, "a mild evening is not a critical peak");
  assert(GridSim.criticalPeak(90) === true, "a freezing evening is a critical peak");
  assert(GridSim.tariffFactor(90) === 1.8, "the base peak factor stays 1.8");
  var crisis = fresh({ hour: 90, price: 1 });
  chain(crisis);
  GridSim.tick(crisis, 0.2);
  var crisisEnergy = crisis.exportableKWh;
  var crisisSale = GridSim.sellSurplus(crisis);
  assert(crisisSale.critical === true, "the sale reports the critical peak");
  assert(Math.abs(crisisSale.revenue - crisisEnergy * 2.4) < 1e-6, "critical peak pays 2.4, got " + crisisSale.revenue);

  var books = fresh({ hour: 12 });
  var ids = chain(books);
  var payer = must(GridSim.place(books, {
    type: "house", variant: "powerwall", capacity: 0, roofKw: 0, appetite: 1, x: 14, z: 0
  }), "paying house");
  must(GridSim.link(books, { kind: "cable", from: ids.turbine, to: payer.id }), "bill cable");
  var purse = books.money;
  GridSim.tick(books, 0.25);
  assert(books.ledger.bills > 0, "served houses pay the utility");
  assert(books.ledger.fuel > 0, "the thermal chain has a fuel cost");
  assert(books.money !== purse, "bills and fuel move the balance");
  assert(books.history.length >= 1, "the day keeps a production trace");
  var board = GridSim.systems(books);
  var thermal = null;
  for (var i = 0; i < board.length; i++) if (board[i].id === "thermal") thermal = board[i];
  assert(thermal && thermal.online && thermal.usedKw > 100, "the thermal system reports live output");
  var worth = GridSim.surplusValue(books);
  assert(worth.kWh > 0 && worth.atPeak > worth.now, "midday surplus is worth more if kept for the peak");
  assert(!GridSim.setV2L(books, payer.id, "auto").ok, "a Powerwall house cannot enter V2L");
  var modeHouse = must(GridSim.place(books, {
    type: "house", variant: "powerwall", soc: 4, roofKw: 0, x: 24, z: 4
  }), "mode house");
  must(GridSim.setStorageMode(books, modeHouse.id, "hold"), "powerwall mode");
  assert(GridSim.node(books, modeHouse.id).mode === "hold", "hold mode sticks");
  var modeCar = must(GridSim.place(books, {
    type: "house", variant: "vehicle", roofKw: 0, vehicleSoc: 40, x: 28, z: 8
  }), "mode car");
  must(GridSim.setV2L(books, modeCar.id, "boost"), "v2l mode");
  assert(GridSim.node(books, modeCar.id).vehicle.v2l === "boost", "boost mode sticks");
})();

if (failures) {
  console.error(failures + " assertion(s) failed");
  process.exit(1);
}
console.log("ok — shipped GridSim passed thermal, cable, powerwall, vehicle, solar, megapack, growth, price, grant");
