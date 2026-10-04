/* Perspective scene for FLUX. Reads GridSim state; does not simulate. */
(function (global) {
  "use strict";

  var UP = { x: 0, y: 1, z: 0 };

  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function grassTexture(THREE) {
    var canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    var g = canvas.getContext("2d");
    g.fillStyle = "#3e6b46";
    g.fillRect(0, 0, 512, 512);
    var rnd = mulberry(11);
    var i;
    for (i = 0; i < 5000; i++) {
      g.fillStyle = rnd() < 0.5 ? "rgba(96,150,78,0.35)" : "rgba(28,68,40,0.30)";
      g.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 3, 1 + rnd() * 2);
    }
    var tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(16, 16);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  function signTexture(THREE, text) {
    var canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    var g = canvas.getContext("2d");
    g.fillStyle = "#1a232b";
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = "#f4efe6";
    g.font = "600 54px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 256, 66);
    var tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function mat(THREE, color, opts) {
    opts = opts || {};
    return new THREE.MeshStandardMaterial({
      color: color,
      roughness: opts.roughness == null ? 0.7 : opts.roughness,
      metalness: opts.metalness == null ? 0.04 : opts.metalness,
      emissive: opts.emissive == null ? 0x000000 : opts.emissive,
      emissiveIntensity: opts.emissiveIntensity || 0,
      map: opts.map || null,
      transparent: !!opts.transparent,
      opacity: opts.opacity == null ? 1 : opts.opacity,
      side: opts.side
    });
  }

  function box(THREE, w, h, d, material, x, y, z) {
    var mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function makeCar(THREE, id) {
    var colors = [0xf5f5f2, 0x17191c, 0xc5362f];
    var paint = mat(THREE, colors[Math.abs(id) % 3], { roughness: 0.32, metalness: 0.62 });
    var glass = mat(THREE, 0x10161c, { roughness: 0.08, metalness: 0.45 });
    var rubber = mat(THREE, 0x141414, { roughness: 0.7 });
    var g = new THREE.Group();
    g.add(box(THREE, 4.15, 0.55, 1.85, paint, 0, 0.58, 0));
    g.add(box(THREE, 2.15, 0.48, 1.65, glass, -0.15, 1.05, 0));
    var geo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 14);
    [[-1.25, 0.32, 0.82], [1.25, 0.32, 0.82], [-1.25, 0.32, -0.82], [1.25, 0.32, -0.82]].forEach(function (p) {
      var w = new THREE.Mesh(geo, rubber);
      w.rotation.x = Math.PI / 2;
      w.position.set(p[0], p[1], p[2]);
      g.add(w);
    });
    g.position.set(4.7, 0, 1.35);
    g.name = "car";
    return g;
  }

  function makeHouse(THREE, node) {
    var g = new THREE.Group();
    var walls = [0xf4f0e6, 0xf7f7f4, 0xe6dfd2, 0xfbfaf6];
    var wall = mat(THREE, walls[node.id % walls.length], { roughness: 0.62 });
    var trim = mat(THREE, 0x2a3036, { roughness: 0.4, metalness: 0.25 });
    var glassMat = mat(THREE, 0x14202b, {
      roughness: 0.12, metalness: 0.35, emissive: 0xffb36b, emissiveIntensity: 0
    });
    var panel = mat(THREE, 0x163155, {
      roughness: 0.22, metalness: 0.55, emissive: 0x123a66, emissiveIntensity: 0.18
    });
    g.add(box(THREE, 6.1, 0.18, 5.6, mat(THREE, 0xd8d0c3, { roughness: 0.85 }), 0, 0.09, 0));
    g.add(box(THREE, 5.4, 3.05, 4.7, wall, 0, 1.7, 0));
    g.add(box(THREE, 5.7, 0.22, 5.05, trim, 0, 3.3, 0));
    var roof = new THREE.Group();
    roof.name = "roof";
    var i;
    for (i = -1; i <= 1; i++) roof.add(box(THREE, 1.45, 0.06, 3.3, panel, i * 1.65, 3.46, 0.05));
    g.add(roof);
    var front = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.72, 0.06), glassMat);
    front.position.set(0.45, 2.25, 2.38);
    g.add(front);
    var side = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.72, 2.2), glassMat);
    side.position.set(2.72, 2.25, 0.15);
    g.add(side);
    g.add(box(THREE, 0.86, 1.7, 0.08, trim, -1.55, 0.95, 2.4));
    if (node.variant === "powerwall") {
      g.add(box(THREE, 0.22, 1.28, 0.86, mat(THREE, 0xf7f7f5, { roughness: 0.3, metalness: 0.08 }), -2.82, 1.4, -0.55));
      var ledMat = mat(THREE, 0x3cbe6e, { emissive: 0x3cbe6e, emissiveIntensity: 0.2, roughness: 0.4 });
      var led = box(THREE, 0.06, 0.08, 0.08, ledMat, -2.96, 1.9, -0.25);
      led.name = "led";
      g.add(led);
      g.userData.led = ledMat;
    } else {
      g.add(makeCar(THREE, node.id));
    }
    addBeacon(THREE, g, 4.3);
    g.userData.glass = glassMat;
    return g;
  }

  function makeIndustry(THREE, node) {
    var g = new THREE.Group();
    var shell = mat(THREE, 0x8b97a3, { roughness: 0.45, metalness: 0.55 });
    var dark = mat(THREE, 0x2c343c, { roughness: 0.5, metalness: 0.4 });
    var glassMat = mat(THREE, 0x1a2832, { roughness: 0.15, metalness: 0.4, emissive: 0xffb36b, emissiveIntensity: 0 });
    g.add(box(THREE, 18, 0.3, 12, mat(THREE, 0xb7b1a6, { roughness: 0.9 }), 0, 0.15, 0));
    g.add(box(THREE, 16, 6.2, 9.5, shell, 0, 3.3, 0));
    g.add(box(THREE, 16.2, 0.35, 2.2, dark, 0, 6.5, 0));
    g.add(box(THREE, 3.2, 2.4, 0.12, dark, -4, 1.5, 4.8));
    var band = new THREE.Mesh(new THREE.BoxGeometry(10, 0.9, 0.08), glassMat);
    band.position.set(2.2, 3.6, 4.8);
    g.add(band);
    var stack = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 4.2, 12), dark);
    stack.position.set(6.2, 7.4, -2.4);
    g.add(stack);
    var sign = new THREE.Mesh(
      new THREE.PlaneGeometry(6.2, 1.5),
      new THREE.MeshBasicMaterial({ map: signTexture(THREE, "ATELIER"), toneMapped: true })
    );
    sign.position.set(-1.5, 5.3, 4.82);
    g.add(sign);
    addBeacon(THREE, g, 8.2);
    g.userData.glass = glassMat;
    g.userData.nodeName = node.name;
    return g;
  }

  function makeIntake(THREE) {
    var g = new THREE.Group();
    var concrete = mat(THREE, 0x9aa3ab, { roughness: 0.8 });
    var water = mat(THREE, 0x1f7f9c, { roughness: 0.15, metalness: 0.2, emissive: 0x0c4a5e, emissiveIntensity: 0.25 });
    g.add(box(THREE, 4.2, 1.1, 3.2, concrete, 0, 0.55, 0));
    var basin = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.2, 0.7, 20), water);
    basin.position.set(-0.2, 1.2, 0);
    g.add(basin);
    var pump = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 1.4, 12), mat(THREE, 0x3e4c57, { metalness: 0.6, roughness: 0.35 }));
    pump.position.set(1.5, 1.5, 0.8);
    pump.name = "rotor";
    g.add(pump);
    addBeacon(THREE, g, 2.6);
    return g;
  }

  function makeHeater(THREE) {
    var g = new THREE.Group();
    var body = mat(THREE, 0x3a2e2c, { roughness: 0.55, metalness: 0.25 });
    var glowMat = mat(THREE, 0xff5a1f, { emissive: 0xff5a1f, emissiveIntensity: 0.15, roughness: 0.4 });
    g.add(box(THREE, 3.6, 2.4, 2.8, body, 0, 1.2, 0));
    var mouth = box(THREE, 1.1, 0.8, 0.08, glowMat, 0, 1.15, 1.42);
    mouth.name = "glow";
    g.add(mouth);
    var stack = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 2.6, 10), mat(THREE, 0x2a2424, { roughness: 0.6 }));
    stack.position.set(1.1, 3.4, -0.6);
    g.add(stack);
    var puffMat = mat(THREE, 0xd9dee3, { transparent: true, opacity: 0.35, roughness: 1 });
    var puff = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), puffMat);
    puff.position.set(1.1, 5, -0.6);
    puff.name = "puff";
    g.add(puff);
    g.userData.glow = glowMat;
    g.userData.puff = puffMat;
    addBeacon(THREE, g, 5.4);
    return g;
  }

  function makeBoiler(THREE) {
    var g = new THREE.Group();
    var steel = mat(THREE, 0xd5dbe1, { metalness: 0.75, roughness: 0.28 });
    var drum = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 4.4, 20), steel);
    drum.rotation.z = Math.PI / 2;
    drum.position.y = 1.7;
    g.add(drum);
    g.add(box(THREE, 0.3, 1.1, 1.4, mat(THREE, 0x5c676e, { metalness: 0.4, roughness: 0.45 }), -1.4, 0.55, 0));
    g.add(box(THREE, 0.3, 1.1, 1.4, mat(THREE, 0x5c676e, { metalness: 0.4, roughness: 0.45 }), 1.4, 0.55, 0));
    var dome = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), steel);
    dome.position.set(0.4, 2.7, 0);
    g.add(dome);
    var puffMat = mat(THREE, 0xf2f5f7, { transparent: true, opacity: 0.4, roughness: 1 });
    var puff = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), puffMat);
    puff.position.set(0.4, 3.5, 0);
    puff.name = "puff";
    g.add(puff);
    g.userData.puff = puffMat;
    addBeacon(THREE, g, 3.8);
    return g;
  }

  function makeTurbine(THREE) {
    var g = new THREE.Group();
    var hall = mat(THREE, 0x24323f, { roughness: 0.5, metalness: 0.35 });
    g.add(box(THREE, 8.2, 3.3, 4.4, hall, 0, 1.65, 0));
    g.add(box(THREE, 8.2, 0.16, 4.5, mat(THREE, 0x3aa0c8, { emissive: 0x1a6e90, emissiveIntensity: 0.45, metalness: 0.3, roughness: 0.35 }), 0, 3.15, 0));
    var steel = mat(THREE, 0xc5cdd3, { metalness: 0.82, roughness: 0.25 });
    var drum = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 3.4, 22), steel);
    drum.rotation.z = Math.PI / 2;
    drum.position.set(0, 1.45, 2.55);
    g.add(drum);
    var rotor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.98, 0.98, 0.14, 22),
      mat(THREE, 0x2a3138, { metalness: 0.5, roughness: 0.4 })
    );
    rotor.rotation.z = Math.PI / 2;
    rotor.position.set(1.85, 1.45, 2.55);
    rotor.name = "rotor";
    g.add(rotor);
    addBeacon(THREE, g, 4.1);
    return g;
  }

  function makeSolar(THREE) {
    var g = new THREE.Group();
    var frame = mat(THREE, 0xd5dbdf, { metalness: 0.7, roughness: 0.32 });
    var panel = mat(THREE, 0x14345c, { metalness: 0.4, roughness: 0.2, emissive: 0x0c2a4e, emissiveIntensity: 0.22 });
    var r, c;
    for (r = 0; r < 3; r++) {
      for (c = 0; c < 5; c++) {
        var px = (c - 2) * 2.45;
        var pz = (r - 1) * 2.3;
        var p = box(THREE, 2.15, 0.07, 1.15, panel, px, 1.2, pz);
        p.rotation.x = -0.58;
        g.add(p);
        var post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.05, 6), frame);
        post.position.set(px, 0.52, pz + 0.4);
        g.add(post);
      }
    }
    addBeacon(THREE, g, 2.2);
    return g;
  }

  function makeMegapack(THREE) {
    var g = new THREE.Group();
    var shell = mat(THREE, 0xf4f5f2, { roughness: 0.38, metalness: 0.12 });
    var vent = mat(THREE, 0x1c1e22, { roughness: 0.5, metalness: 0.3 });
    var skid = mat(THREE, 0x2a2d31, { roughness: 0.6, metalness: 0.4 });
    var i;
    for (i = 0; i < 2; i++) {
      var x = (i - 0.5) * 3.5;
      g.add(box(THREE, 3.2, 2.5, 1.55, shell, x, 1.4, 0));
      g.add(box(THREE, 3.22, 0.12, 1.57, skid, x, 0.12, 0));
      var v;
      for (v = 0; v < 4; v++) g.add(box(THREE, 2.6, 0.06, 0.04, vent, x, 0.7 + v * 0.38, 0.8));
    }
    var ledMat = mat(THREE, 0x3cbe6e, { emissive: 0x3cbe6e, emissiveIntensity: 0.4 });
    g.add(box(THREE, 0.1, 0.1, 0.04, ledMat, -1.2, 2.35, 0.8));
    g.userData.led = ledMat;
    addBeacon(THREE, g, 3.3);
    return g;
  }

  function makePole(THREE) {
    var g = new THREE.Group();
    var steel = mat(THREE, 0x8d969c, { metalness: 0.7, roughness: 0.35 });
    var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 5.2, 8), steel);
    mast.position.y = 2.6;
    g.add(mast);
    g.add(box(THREE, 2.4, 0.1, 0.1, steel, 0, 4.9, 0));
    addBeacon(THREE, g, 5.5);
    return g;
  }

  function makeManifold(THREE) {
    var g = new THREE.Group();
    g.add(box(THREE, 1.6, 0.9, 1.1, mat(THREE, 0x6e7c88, { metalness: 0.55, roughness: 0.35 }), 0, 0.5, 0));
    var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 10), mat(THREE, 0xc0392b, { roughness: 0.4, metalness: 0.3 }));
    cap.position.y = 1.15;
    g.add(cap);
    addBeacon(THREE, g, 1.8);
    return g;
  }

  function addBeacon(THREE, group, y) {
    var material = new THREE.MeshStandardMaterial({
      color: 0xc4a574, emissive: 0xc4a574, emissiveIntensity: 0.8, roughness: 0.4
    });
    var beacon = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), material);
    beacon.position.y = y;
    beacon.name = "beacon";
    group.add(beacon);
    group.userData.beacon = material;
  }

  function buildNode(THREE, node) {
    var group;
    if (node.type === "house") group = makeHouse(THREE, node);
    else if (node.type === "industry") group = makeIndustry(THREE, node);
    else if (node.type === "intake") group = makeIntake(THREE);
    else if (node.type === "heater") group = makeHeater(THREE);
    else if (node.type === "boiler") group = makeBoiler(THREE);
    else if (node.type === "turbine") group = makeTurbine(THREE);
    else if (node.type === "solar") group = makeSolar(THREE);
    else if (node.type === "megapack") group = makeMegapack(THREE);
    else if (node.type === "pole") group = makePole(THREE);
    else if (node.type === "manifold") group = makeManifold(THREE);
    else {
      group = new THREE.Group();
      group.add(box(THREE, 1, 1, 1, mat(THREE, 0xffffff), 0, 0.5, 0));
    }
    group.userData.nodeId = node.id;
    group.position.set(node.x, 0, node.z);
    return group;
  }

  function beadCount(len) {
    var n = Math.round((len || 8) / 3.2);
    if (n < 3) n = 3;
    if (n > 10) n = 10;
    return n;
  }

  function pipeColor(fromType) {
    if (fromType === "intake") return 0x2b7ea8;
    if (fromType === "heater") return 0xd4652f;
    if (fromType === "boiler") return 0xe7eef2;
    if (fromType === "manifold") return 0x8aa0b4;
    return 0x66717a;
  }

  function linkCurve(THREE, edge, a, b) {
    var cable = edge.kind === "cable";
    var y = cable ? 3.35 : 0.42;
    var start = new THREE.Vector3(a.x, y, a.z);
    var end = new THREE.Vector3(b.x, cable ? 3.35 : 0.42, b.z);
    var mid = start.clone().lerp(end, 0.5);
    mid.y = cable ? y - 0.85 : 0.72;
    return new THREE.QuadraticBezierCurve3(start, mid, end);
  }

  function buildLink(THREE, edge, a, b) {
    var curve = linkCurve(THREE, edge, a, b);
    var cable = edge.kind === "cable";
    var geo = new THREE.TubeGeometry(curve, 24, cable ? 0.2 : 0.28, 6, false);
    var color = cable ? 0x31404c : pipeColor(a.type);
    var material = new THREE.MeshStandardMaterial({
      color: color,
      roughness: cable ? 0.35 : 0.32,
      metalness: cable ? 0.25 : 0.45,
      emissive: cable ? 0xc5e6ff : color,
      emissiveIntensity: cable ? 0.45 : 0.08
    });
    var mesh = new THREE.Mesh(geo, material);
    mesh.userData.linkId = edge.id;
    mesh.userData.curve = curve;
    mesh.userData.baseEmissive = cable ? 0xc5e6ff : color;
    var line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(28)),
      new THREE.LineBasicMaterial({ color: cable ? 0xd7f1ff : color })
    );
    line.userData.linkId = edge.id;
    mesh.add(line);
    mesh.userData.line = line;
    mesh.userData.lineColor = cable ? 0xd7f1ff : color;
    mesh.userData.length = curve.getLength();
    var pick = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 12, cable ? 0.72 : 0.46, 5, false),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
    );
    pick.userData.linkId = edge.id;
    mesh.add(pick);
    return mesh;
  }

  function dress(THREE, scene) {
    var ground = new THREE.Mesh(
      new THREE.CircleGeometry(120, 48),
      mat(THREE, 0x3e6b46, { roughness: 0.95, map: grassTexture(THREE) })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    var roadMat = mat(THREE, 0x34383d, { roughness: 0.82 });
    scene.add(box(THREE, 46, 0.05, 3.4, roadMat, -16, 0.03, -1));
    scene.add(box(THREE, 3.3, 0.05, 62, roadMat, 8, 0.035, 14));
    scene.add(box(THREE, 3.2, 0.05, 24, roadMat, 2, 0.04, -18));

    var yard = mat(THREE, 0xc9c2b4, { roughness: 0.9 });
    scene.add(box(THREE, 34, 0.06, 24, yard, 34, 0.03, 28));
    scene.add(box(THREE, 22, 0.05, 16, mat(THREE, 0xb3aa9e, { roughness: 0.95 }), 2, 0.04, -28));

    var plots = [[-30, -8], [-18, -8], [-6, -8], [-30, 6], [-18, 6], [-6, 6]];
    var plotMat = mat(THREE, 0x4e7d52, { roughness: 1 });
    plots.forEach(function (p) {
      scene.add(box(THREE, 8.2, 0.04, 7.2, plotMat, p[0], 0.02, p[1]));
    });

    var water = mat(THREE, 0x1a7490, {
      roughness: 0.12, metalness: 0.15, emissive: 0x0a3e4e, emissiveIntensity: 0.2
    });
    var river = box(THREE, 180, 0.04, 16, water, 0, 0.015, -52);
    scene.add(river);

    var hillMat = mat(THREE, 0x6d8b74, { roughness: 0.95 });
    [[-78, -30, 22], [70, -36, 26], [-60, 55, 18], [78, 48, 20]].forEach(function (h) {
      var hill = new THREE.Mesh(new THREE.SphereGeometry(h[2], 18, 12), hillMat);
      hill.scale.y = 0.45;
      hill.position.set(h[0], h[2] * 0.15, h[1]);
      scene.add(hill);
    });

    var trunk = mat(THREE, 0x5a4636, { roughness: 0.9 });
    var leaf = mat(THREE, 0x2f6a3e, { roughness: 0.85 });
    var trees = [
      [-44, -16], [-44, 0], [-44, 18], [-24, -20], [-12, 18],
      [14, -18], [14, 14], [48, -14], [52, 8], [-50, 30], [18, 46], [-8, 52]
    ];
    trees.forEach(function (p, idx) {
      var tree = new THREE.Group();
      var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 1.6, 6), trunk);
      stem.position.y = 0.8;
      tree.add(stem);
      var crown = new THREE.Mesh(new THREE.SphereGeometry(1.15 + (idx % 3) * 0.15, 10, 8), leaf);
      crown.position.y = 2.1;
      tree.add(crown);
      tree.position.set(p[0], 0, p[1]);
      scene.add(tree);
    });

    var lampMat = mat(THREE, 0x22262b, { metalness: 0.5, roughness: 0.4 });
    var bulbMat = mat(THREE, 0xffe1a8, { emissive: 0xffc56a, emissiveIntensity: 0.7 });
    [[-38, -1], [-20, -1], [0, -1], [8, 8], [8, 24]].forEach(function (p) {
      var lamp = new THREE.Group();
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.2, 6), lampMat);
      pole.position.y = 2.1;
      lamp.add(pole);
      var bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), bulbMat);
      bulb.position.y = 4.25;
      lamp.add(bulb);
      lamp.position.set(p[0], 0, p[1]);
      scene.add(lamp);
    });
  }

  function attach(canvas) {
    var THREE = global.THREE;
    if (!THREE) throw new Error("THREE missing");
    var renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "default"
    });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;

    var scene = new THREE.Scene();
    var night = new THREE.Color(0x10182a);
    var day = new THREE.Color(0xc5d6e6);
    var coldSky = new THREE.Color(0x8ea6bf);
    var bg = night.clone();
    scene.background = bg;
    scene.fog = new THREE.Fog(bg.clone(), 70, 210);

    var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    var rig = { yaw: 0.62, pitch: 0.72, dist: 78, target: new THREE.Vector3(-6, 0, -6) };
    var wish = { yaw: rig.yaw, pitch: rig.pitch, dist: rig.dist, target: rig.target.clone() };
    var vel = { x: 0, z: 0, yaw: 0, pitch: 0 };
    var velStamp = 0;

    var hemi = new THREE.HemisphereLight(0xd5e4f5, 0x3c4a34, 0.72);
    scene.add(hemi);
    var sunLight = new THREE.DirectionalLight(0xfff2d4, 1.15);
    sunLight.position.set(36, 48, 18);
    scene.add(sunLight);
    var fill = new THREE.DirectionalLight(0x9eb4d6, 0.28);
    fill.position.set(-24, 18, -10);
    scene.add(fill);
    scene.add(new THREE.AmbientLight(0xf0e6d4, 0.18));

    dress(THREE, scene);

    var state = global.GridSim.create();
    var nodeMeshes = new Map();
    var linkMeshes = new Map();
    var nodePick = [];
    var linkPick = [];
    var couriers = [];
    var courierGeo = new THREE.SphereGeometry(0.46, 10, 8);
    var courierMatCable = new THREE.MeshBasicMaterial({ color: 0xf7fbff, fog: false, toneMapped: false });
    var courierMatPipe = new THREE.MeshBasicMaterial({ color: 0xffe1c2, fog: false, toneMapped: false });

    var ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.4, 0.07, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xf6f1e6 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.12;
    ring.visible = false;
    scene.add(ring);

    var pendingRing = new THREE.Mesh(
      new THREE.TorusGeometry(2.4, 0.07, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xe3b341 })
    );
    pendingRing.rotation.x = Math.PI / 2;
    pendingRing.position.y = 0.14;
    pendingRing.visible = false;
    scene.add(pendingRing);

    var hoverRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.7, 0.055, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0xf6f1e6, transparent: true, opacity: 0.95, depthWrite: false })
    );
    hoverRing.rotation.x = Math.PI / 2;
    hoverRing.position.y = 0.2;
    hoverRing.visible = false;
    hoverRing.raycast = function () {};
    scene.add(hoverRing);

    var guideGeo = new THREE.TorusGeometry(1.35, 0.12, 8, 28);
    var guides = [];

    var preview = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: 0xe3b341, transparent: true, opacity: 0.92, depthWrite: false })
    );
    preview.frustumCulled = false;
    preview.visible = false;
    preview.raycast = function () {};
    scene.add(preview);
    var previewKey = "";

    var ghost = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.2, 2.2),
      new THREE.MeshBasicMaterial({ color: 0xf6f1e6, transparent: true, opacity: 0.35, depthWrite: false })
    );
    ghost.visible = false;
    ghost.position.y = 0.6;
    scene.add(ghost);

    var raycaster = new THREE.Raycaster();
    var pointer = new THREE.Vector2();
    var groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    var scratch = new THREE.Vector3();

    function applyCamera() {
      var cp = Math.cos(rig.pitch);
      var sp = Math.sin(rig.pitch);
      var sy = Math.sin(rig.yaw);
      var cy = Math.cos(rig.yaw);
      camera.position.set(
        rig.target.x + rig.dist * cp * sy,
        rig.target.y + rig.dist * sp,
        rig.target.z + rig.dist * cp * cy
      );
      camera.up.set(UP.x, UP.y, UP.z);
      camera.lookAt(rig.target);
      camera.updateMatrixWorld(true);
    }

    function clampPitch(p) { return Math.max(0.18, Math.min(1.32, p)); }
    function clampDist(d) { return Math.max(14, Math.min(160, d)); }
    function clampTarget(v) {
      v.y = 0;
      v.x = Math.max(-110, Math.min(110, v.x));
      v.z = Math.max(-110, Math.min(110, v.z));
      return v;
    }
    function dampAngle(cur, goal, k) {
      var d = goal - cur;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return cur + d * k;
    }
    function takeDt() {
      var now = (global.performance && global.performance.now) ? global.performance.now() : Date.now();
      var dt = velStamp ? (now - velStamp) / 1000 : 0.016;
      velStamp = now;
      return Math.max(0.008, Math.min(0.05, dt));
    }
    function stopCoast() { vel.x = 0; vel.z = 0; vel.yaw = 0; vel.pitch = 0; }
    function cancelGlide() {
      game.gliding = false;
      wish.target.copy(rig.target);
      wish.dist = rig.dist;
      wish.yaw = rig.yaw;
      wish.pitch = rig.pitch;
    }
    function relaxCamera(dt) {
      dt = Math.min(0.05, Math.max(0, dt || 0));
      if (game.dragging) return;
      if (game.gliding) {
        var k = 1 - Math.exp(-dt / 0.14);
        rig.yaw = dampAngle(rig.yaw, wish.yaw, k);
        rig.pitch += (wish.pitch - rig.pitch) * k;
        rig.dist += (wish.dist - rig.dist) * k;
        rig.target.lerp(wish.target, k);
        if (rig.target.distanceTo(wish.target) < 0.08 && Math.abs(rig.dist - wish.dist) < 0.08) {
          rig.target.copy(wish.target);
          rig.dist = wish.dist;
          rig.pitch = wish.pitch;
          rig.yaw = wish.yaw;
          game.gliding = false;
        }
        return;
      }
      var speed = Math.hypot(vel.x, vel.z);
      if (speed > 0.35) {
        rig.target.x += vel.x * dt;
        rig.target.z += vel.z * dt;
        clampTarget(rig.target);
        wish.target.copy(rig.target);
        var damp = Math.exp(-dt / 0.26);
        vel.x *= damp;
        vel.z *= damp;
        if (Math.hypot(vel.x, vel.z) < 0.35) { vel.x = 0; vel.z = 0; }
      }
      if (Math.abs(vel.yaw) > 0.02 || Math.abs(vel.pitch) > 0.02) {
        rig.yaw += vel.yaw * dt;
        rig.pitch = clampPitch(rig.pitch + vel.pitch * dt);
        wish.yaw = rig.yaw;
        wish.pitch = rig.pitch;
        var dampA = Math.exp(-dt / 0.18);
        vel.yaw *= dampA;
        vel.pitch *= dampA;
      }
    }

    function resize() {
      var w = Math.max(2, Math.floor(canvas.clientWidth || global.innerWidth || 2));
      var h = Math.max(2, Math.floor(canvas.clientHeight || global.innerHeight || 2));
      renderer.setPixelRatio(1);
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      game.surface.width = canvas.width;
      game.surface.height = canvas.height;
    }

    function dropMesh(map, id, list) {
      var mesh = map.get(id);
      if (!mesh) return;
      scene.remove(mesh);
      var idx = list.indexOf(mesh);
      if (idx >= 0) list.splice(idx, 1);
      mesh.traverse(function (child) {
        if (child.geometry && child.geometry !== courierGeo) child.geometry.dispose();
        if (child.material && child.material !== courierMatCable && child.material !== courierMatPipe) {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      });
      map.delete(id);
    }

    function sync() {
      var alive = new Set();
      var i;
      for (i = 0; i < state.nodes.length; i++) {
        var node = state.nodes[i];
        alive.add(node.id);
        var group = nodeMeshes.get(node.id);
        if (!group) {
          group = buildNode(THREE, node);
          scene.add(group);
          nodePick.push(group);
          nodeMeshes.set(node.id, group);
        }
        group.position.set(node.x, 0, node.z);
        var glass = group.userData.glass;
        if (glass) {
          var flow = node.flow;
          var fed = flow && flow.servedKw > 0.15;
          var ok = flow && flow.satisfied;
          glass.emissiveIntensity = ok ? 1.6 : fed ? 0.55 : 0.02;
        }
        if (group.userData.beacon) {
          var color = 0xc4a574;
          if (node.type === "house" || node.type === "industry") {
            color = node.flow && node.flow.satisfied ? 0x7dcea0 : 0xe07a5f;
          } else if ((node.kw || 0) > 0.2 || (node.dischargeKw || 0) > 0.2) color = 0xf0d48a;
          group.userData.beacon.color.setHex(color);
          group.userData.beacon.emissive.setHex(color);
        }
        if (group.userData.led) {
          var soc = node.capacity ? node.soc / node.capacity : (node.flow && node.flow.soc) || 0;
          group.userData.led.emissiveIntensity = 0.15 + soc * 1.1;
        }
        var roofMesh = group.getObjectByName("roof");
        if (roofMesh) roofMesh.visible = (node.roofKw || 0) > 0.2;
        var carMesh = group.getObjectByName("car");
        if (carMesh) carMesh.visible = !(node.vehicle && node.vehicle.away);
        if (group.userData.glow) group.userData.glow.emissiveIntensity = (node.kw || 0) > 1 ? 0.9 : 0.08;
        var puff = group.getObjectByName("puff");
        if (puff) {
          var hot = (node.kw || 0) > 1;
          puff.visible = hot;
          if (hot) {
            var phase = ((game.clockMs || 0) / 1000 + node.id * 0.37) % 1.6;
            puff.position.y = (node.type === "heater" ? 4.6 : 3.1) + phase;
            puff.scale.setScalar(0.6 + phase * 0.8);
            if (group.userData.puff) group.userData.puff.opacity = 0.4 * (1 - phase / 1.6);
          }
        }
      }
      Array.from(nodeMeshes.keys()).forEach(function (id) {
        if (!alive.has(id)) dropMesh(nodeMeshes, id, nodePick);
      });

      var linkAlive = new Set();
      for (i = 0; i < state.links.length; i++) {
        var edge = state.links[i];
        linkAlive.add(edge.id);
        var a = global.GridSim.node(state, edge.from);
        var b = global.GridSim.node(state, edge.to);
        if (!a || !b) continue;
        var mesh = linkMeshes.get(edge.id);
        if (!mesh) {
          mesh = buildLink(THREE, edge, a, b);
          scene.add(mesh);
          linkPick.push(mesh);
          linkMeshes.set(edge.id, mesh);
        }
        var on = (edge.flow || 0) > 0.2;
        var chosen = game.selectedLink === edge.id;
        var base = mesh.userData.baseEmissive || 0xc5e6ff;
        mesh.material.emissive.setHex(chosen ? 0xe3b341 : base);
        if (edge.kind === "cable") mesh.material.emissiveIntensity = chosen ? 1.2 : on ? 0.95 : 0.42;
        else mesh.material.emissiveIntensity = chosen ? 0.95 : on ? 0.4 : 0.08;
        if (mesh.userData.line) {
          mesh.userData.line.material.color.setHex(chosen ? 0xe3b341 : (on ? 0xffffff : mesh.userData.lineColor));
        }
        mesh.userData.dir = edge.dir || 0;
      }
      Array.from(linkMeshes.keys()).forEach(function (id) {
        if (!linkAlive.has(id)) dropMesh(linkMeshes, id, linkPick);
      });

      var selected = game.selected != null ? global.GridSim.node(state, game.selected) : null;
      if (selected) {
        ring.visible = true;
        ring.position.set(selected.x, 0.12, selected.z);
      } else ring.visible = false;
      var pend = game.tool && game.tool.pending != null ? global.GridSim.node(state, game.tool.pending) : null;
      if (pend) {
        pendingRing.visible = true;
        pendingRing.position.set(pend.x, 0.14, pend.z);
      } else pendingRing.visible = false;

      var jobs = [];
      linkMeshes.forEach(function (mesh, id) {
        var edge = null;
        for (var k = 0; k < state.links.length; k++) if (state.links[k].id === id) edge = state.links[k];
        if (!edge || (edge.flow || 0) <= 0.2 || !edge.dir || !mesh.userData.curve) return;
        var count = beadCount(mesh.userData.length);
        var pipe = edge.kind === "pipe";
        for (var b = 0; b < count; b++) jobs.push({ host: mesh, phase: b / count, pipe: pipe });
      });
      if (jobs.length > 420) jobs.length = 420;
      while (couriers.length < jobs.length) {
        var dot = new THREE.Mesh(courierGeo, courierMatCable);
        scene.add(dot);
        couriers.push(dot);
      }
      while (couriers.length > jobs.length) {
        var extra = couriers.pop();
        scene.remove(extra);
      }
      for (i = 0; i < couriers.length; i++) {
        var job = jobs[i];
        couriers[i].userData.host = job.host;
        couriers[i].userData.phase = job.phase;
        couriers[i].material = job.pipe ? courierMatPipe : courierMatCable;
        couriers[i].visible = true;
      }
    }

    function animateBits(dt) {
      nodeMeshes.forEach(function (group) {
        var nodeId = group.userData.nodeId;
        var node = global.GridSim.node(state, nodeId);
        var rotor = group.getObjectByName("rotor");
        if (rotor && node && (node.kw || 0) > 0.5) rotor.rotateY(dt * Math.min(8, node.kw * 0.02));
      });
      var t = (game.clockMs || 0) / 1000;
      var mote = rig.dist / 78;
      if (mote < 0.75) mote = 0.75;
      if (mote > 1.2) mote = 1.2;
      var speed = 4.8;
      for (var i = 0; i < couriers.length; i++) {
        var host = couriers[i].userData.host;
        if (!host || !host.userData.curve || !host.userData.dir) {
          couriers[i].visible = false;
          continue;
        }
        var len = host.userData.length || 1;
        if (len < 0.5) len = 0.5;
        var u = (t * speed / len + (couriers[i].userData.phase || 0)) % 1;
        if (u < 0) u += 1;
        if (host.userData.dir < 0) u = 1 - u;
        couriers[i].position.copy(host.userData.curve.getPoint(u));
        couriers[i].scale.setScalar(mote);
        couriers[i].visible = true;
      }
      var sun = global.GridSim.sunFactor(state.hour);
      bg.copy(night).lerp(day, Math.min(1, sun * 1.05 + 0.08));
      if (state.live && state.live.weather && state.live.weather.temp < 0) bg.lerp(coldSky, 0.28);
      scene.background = bg;
      scene.fog.color.copy(bg);
      hemi.intensity = 0.32 + sun * 0.5;
      sunLight.intensity = 0.18 + sun * 1.2;
      sunLight.position.set(28, 18 + sun * 46, 14);
      fill.intensity = 0.18 + (1 - sun) * 0.22;
    }

    function ndc(clientX, clientY) {
      var rect = canvas.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    }

    function groundAt(clientX, clientY) {
      applyCamera();
      ndc(clientX, clientY);
      raycaster.setFromCamera(pointer, camera);
      var hit = scratch.clone();
      if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
      return { x: hit.x, z: hit.z };
    }

    function hitList(list) {
      var hits = raycaster.intersectObjects(list, true);
      for (var i = 0; i < hits.length; i++) {
        var obj = hits[i].object;
        while (obj) {
          if (obj.userData && obj.userData.nodeId != null) return { nodeId: obj.userData.nodeId };
          if (obj.userData && obj.userData.linkId != null) return { linkId: obj.userData.linkId };
          obj = obj.parent;
        }
      }
      return null;
    }

    function pick(clientX, clientY) {
      applyCamera();
      ndc(clientX, clientY);
      raycaster.setFromCamera(pointer, camera);
      return hitList(nodePick) || hitList(linkPick);
    }

    function screenBasis() {
      applyCamera();
      var right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      var screenUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      right.y = 0;
      screenUp.y = 0;
      if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
      else right.normalize();
      if (screenUp.lengthSq() < 1e-8) {
        camera.getWorldDirection(screenUp);
        screenUp.y = 0;
        if (screenUp.lengthSq() < 1e-8) screenUp.set(0, 0, -1);
        else screenUp.normalize();
      } else screenUp.normalize();
      return { right: right, screenUp: screenUp };
    }

    function panBy(dx, dy) {
      cancelGlide();
      var basis = screenBasis();
      var scale = rig.dist * 0.00145;
      rig.target.addScaledVector(basis.right, dx * scale);
      rig.target.addScaledVector(basis.screenUp, dy * scale);
      clampTarget(rig.target);
      wish.target.copy(rig.target);
      wish.dist = rig.dist;
      wish.yaw = rig.yaw;
      wish.pitch = rig.pitch;
    }

    // Grab: the ground point under the cursor follows the pointer.
    function panGrab(x0, y0, x1, y1) {
      cancelGlide();
      applyCamera();
      var a = groundAt(x0, y0);
      var b = groundAt(x1, y1);
      if (!a || !b) return;
      var mx = a.x - b.x;
      var mz = a.z - b.z;
      rig.target.x += mx;
      rig.target.z += mz;
      clampTarget(rig.target);
      wish.target.copy(rig.target);
      applyCamera();
      var dt = takeDt();
      vel.x = mx / dt;
      vel.z = mz / dt;
      vel.yaw = 0;
      vel.pitch = 0;
      var speed = Math.hypot(vel.x, vel.z);
      var cap = 90;
      if (speed > cap) { vel.x *= cap / speed; vel.z *= cap / speed; }
    }

    var FLUID = { intake: 1, manifold: 1, heater: 1, boiler: 1, turbine: 1 };
    var ELECTRIC = { turbine: 1, solar: 1, megapack: 1, house: 1, industry: 1, pole: 1 };

    function acceptsType(type, mode) {
      if (mode === "pipe") return !!FLUID[type];
      if (mode === "cable") return !!ELECTRIC[type];
      return true;
    }

    function nearestNode(clientX, clientY, mode) {
      var best = null;
      var bestD = 46;
      var nodes = state.nodes;
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (mode && !acceptsType(node.type, mode)) continue;
        var p = game.project(node.x, 2.2, node.z);
        if (p.behind) continue;
        var d = Math.hypot(p.x - clientX, p.y - clientY);
        if (d < bestD) best = { id: node.id, x: node.x, z: node.z, d: d, type: node.type };
        if (best && best.id === node.id) bestD = best.d;
      }
      return best;
    }

    function nearestLink(clientX, clientY) {
      var best = null;
      var bestD = 28;
      for (var i = 0; i < state.links.length; i++) {
        var edge = state.links[i];
        var mesh = linkMeshes.get(edge.id);
        var curve = mesh && mesh.userData.curve;
        if (!curve) continue;
        for (var s = 0; s <= 8; s++) {
          var p3 = curve.getPoint(s / 8);
          var p = game.project(p3.x, p3.y, p3.z);
          if (p.behind) continue;
          var d = Math.hypot(p.x - clientX, p.y - clientY);
          if (d < bestD) { bestD = d; best = edge.id; }
        }
      }
      return best;
    }

    function linkTone(kind, fromId, toId) {
      if (fromId === toId) return "bad";
      var a = global.GridSim.node(state, fromId);
      var b = global.GridSim.node(state, toId);
      if (!a || !b) return "bad";
      if (!acceptsType(a.type, kind) || !acceptsType(b.type, kind)) return "bad";
      for (var i = 0; i < state.links.length; i++) {
        var e = state.links[i];
        if (e.kind !== kind) continue;
        if ((e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId)) return "bad";
      }
      if (state.money + 1e-9 < global.GridSim.cost(kind)) return "bad";
      return "ok";
    }

    function showGuides(nodes, mode) {
      var pendingId = game.tool && game.tool.pending;
      var i;
      for (i = 0; i < nodes.length; i++) {
        var g = guides[i];
        if (!g) {
          g = new THREE.Mesh(guideGeo, new THREE.MeshBasicMaterial({
            color: 0xf6f1e6, transparent: true, opacity: 0.8, depthWrite: false
          }));
          g.rotation.x = Math.PI / 2;
          g.raycast = function () {};
          scene.add(g);
          guides.push(g);
        }
        g.visible = true;
        g.position.set(nodes[i].x, 0.16, nodes[i].z);
        var col = nodes[i].id === pendingId ? 0xe3b341 : (mode === "pipe" ? 0x7ec8e3 : 0xd7f1ff);
        g.material.color.setHex(col);
      }
      for (; i < guides.length; i++) guides[i].visible = false;
    }

    function drawPreview(from, end, mode, tone) {
      var key = from.x.toFixed(2) + "," + from.z.toFixed(2) + "," + end.x.toFixed(2) + "," + end.z.toFixed(2) + mode + tone;
      if (key === previewKey && preview.visible) return;
      previewKey = key;
      var cable = mode === "cable";
      var y = cable ? 3.35 : 0.42;
      var start = new THREE.Vector3(from.x, y, from.z);
      var stop = new THREE.Vector3(end.x, cable ? y : 0.42, end.z);
      var mid = start.clone().lerp(stop, 0.5);
      mid.y = cable ? y - 0.85 : 0.72;
      if (preview.geometry) preview.geometry.dispose();
      preview.geometry = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(start, mid, stop), 18, cable ? 0.24 : 0.28, 6, false);
      preview.material.color.setHex(tone === "ok" ? 0x8fd0a8 : tone === "bad" ? 0xe07a5f : 0xe3b341);
      preview.visible = true;
    }

    function updateOverlay() {
      var tool = game.tool || {};
      var mode = tool.mode;
      var linking = mode === "pipe" || mode === "cable";
      if (linking) {
        var marks = [];
        for (var i = 0; i < state.nodes.length; i++) {
          if (acceptsType(state.nodes[i].type, mode)) marks.push(state.nodes[i]);
        }
        showGuides(marks, mode);
      } else {
        for (var g = 0; g < guides.length; g++) guides[g].visible = false;
      }
      var ptr = game.pointer;
      if (!ptr || !ptr.ok) {
        preview.visible = false;
        hoverRing.visible = false;
        return;
      }
      var near = nearestNode(ptr.x, ptr.y, linking ? mode : null);
      if (linking && tool.pending != null) {
        var from = global.GridSim.node(state, tool.pending);
        if (!from) {
          preview.visible = false;
          previewKey = "";
        } else if (near && near.id !== from.id) {
          drawPreview(from, near, mode, linkTone(mode, from.id, near.id));
        } else {
          var spot = groundAt(ptr.x, ptr.y);
          if (spot && Math.hypot(spot.x - from.x, spot.z - from.z) > 1.2) drawPreview(from, spot, mode, "idle");
          else { preview.visible = false; previewKey = ""; }
        }
      } else {
        preview.visible = false;
        previewKey = "";
      }
      var hoverId = null;
      if (linking && near) hoverId = near.id;
      if (!linking) {
        var hit = pick(ptr.x, ptr.y);
        if (hit && hit.nodeId != null) hoverId = hit.nodeId;
        else if (near && near.d < 32) hoverId = near.id;
      }
      if (hoverId != null) {
        var node = global.GridSim.node(state, hoverId);
        if (node) {
          hoverRing.visible = true;
          hoverRing.position.set(node.x, 0.22, node.z);
          var tone = "idle";
          if (linking && tool.pending != null && node.id !== tool.pending) tone = linkTone(mode, tool.pending, node.id);
          hoverRing.material.color.setHex(tone === "ok" ? 0x8fd0a8 : tone === "bad" ? 0xe07a5f : 0xf6f1e6);
          hoverRing.scale.setScalar(1 + Math.sin(game.clockMs * 0.006) * 0.05);
        }
      } else hoverRing.visible = false;
    }

    function orbitBy(dx, dy) {
      cancelGlide();
      var dyaw = -dx * 0.0052;
      var dpitch = -dy * 0.0036;
      rig.yaw += dyaw;
      rig.pitch = clampPitch(rig.pitch + dpitch);
      wish.yaw = rig.yaw;
      wish.pitch = rig.pitch;
      var dt = takeDt();
      vel.yaw = Math.max(-1.5, Math.min(1.5, dyaw / dt));
      vel.pitch = Math.max(-1.1, Math.min(1.1, dpitch / dt));
      vel.x = 0;
      vel.z = 0;
    }

    function zoomBy(deltaY, clientX, clientY) {
      cancelGlide();
      stopCoast();
      applyCamera();
      var oldDist = rig.dist;
      var next = clampDist(oldDist * Math.exp((deltaY || 0) * 0.00105));
      if (clientX != null && clientY != null && oldDist > 1) {
        var point = groundAt(clientX, clientY);
        if (point) {
          var t = 1 - next / oldDist;
          rig.target.x += (point.x - rig.target.x) * t;
          rig.target.z += (point.z - rig.target.z) * t;
          clampTarget(rig.target);
        }
      }
      rig.dist = next;
      wish.dist = rig.dist;
      wish.target.copy(rig.target);
      wish.yaw = rig.yaw;
      wish.pitch = rig.pitch;
      applyCamera();
    }

    function focusOn(x, z) {
      stopCoast();
      wish.target.set(x, 0, z);
      clampTarget(wish.target);
      wish.dist = Math.max(22, Math.min(46, rig.dist));
      wish.pitch = Math.min(1.05, Math.max(0.58, rig.pitch));
      game.gliding = true;
    }

    function resetView() {
      stopCoast();
      wish.yaw = 0.62;
      wish.pitch = 0.72;
      wish.dist = 78;
      wish.target.set(-6, 0, -6);
      game.gliding = true;
    }

    var game = {
      state: state,
      canvas: canvas,
      frames: 0,
      paused: false,
      hoursPerSecond: 0.02,
      selected: null,
      selectedLink: null,
      dragging: false,
      gliding: false,
      pointer: { x: 0, y: 0, ok: false },
      onFrame: null,
      tool: { mode: "select", type: null, pending: null },
      surface: { width: 0, height: 0 },
      clockMs: 0,
      resize: resize,
      sync: sync,
      render: function (dt) {
        var step = Math.min(0.05, Math.max(0, dt || 0));
        game.clockMs += step * 1000;
        if (typeof game.onFrame === "function") game.onFrame(step);
        relaxCamera(step);
        animateBits(step);
        updateOverlay();
        applyCamera();
        renderer.render(scene, camera);
        game.frames += 1;
      },
      groundAt: groundAt,
      pick: pick,
      nearestNode: nearestNode,
      nearestLink: nearestLink,
      panBy: panBy,
      panGrab: panGrab,
      orbitBy: orbitBy,
      zoomBy: zoomBy,
      focusOn: focusOn,
      resetView: resetView,
      stopCoast: stopCoast,
      cancelGlide: cancelGlide,
      navState: function () {
        applyCamera();
        var fwd = new THREE.Vector3();
        camera.getWorldDirection(fwd);
        var right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        var up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        return {
          tx: rig.target.x, tz: rig.target.z, dist: rig.dist, yaw: rig.yaw, pitch: rig.pitch,
          fx: fwd.x, fy: fwd.y, fz: fwd.z,
          rx: right.x, ry: right.y, rz: right.z,
          ux: up.x, uy: up.y, uz: up.z
        };
      },
      setGhost: function (x, z, visible) {
        ghost.visible = !!visible;
        if (visible) ghost.position.set(x, 0.6, z);
      },
      project: function (x, y, z) {
        applyCamera();
        var v = new THREE.Vector3(x, y, z);
        v.project(camera);
        var rect = canvas.getBoundingClientRect();
        return {
          x: (v.x * 0.5 + 0.5) * rect.width + rect.left,
          y: (-v.y * 0.5 + 0.5) * rect.height + rect.top,
          behind: v.z > 1
        };
      },
      cameraInfo: function () {
        applyCamera();
        var dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        return {
          fov: camera.fov,
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
          dirY: dir.y,
          isPerspective: camera.isPerspectiveCamera === true
        };
      },
      gl: function () { return renderer.getContext(); },
      lookNode: function (id) {
        var group = nodeMeshes.get(id);
        if (!group) return null;
        var roof = group.getObjectByName("roof");
        var car = group.getObjectByName("car");
        return { roof: roof ? roof.visible : null, car: car ? car.visible : null };
      },
      lookLink: function (id) {
        var mesh = linkMeshes.get(id);
        if (!mesh) return null;
        var dots = 0;
        var arrows = 0;
        mesh.traverse(function (child) {
          if (child.name === "flow-arrow") arrows += 1;
        });
        for (var i = 0; i < couriers.length; i++) {
          var host = couriers[i].userData.host;
          if (host && host.userData.linkId === id && couriers[i].visible) dots += 1;
        }
        return { dir: mesh.userData.dir || 0, dots: dots, arrows: arrows };
      },
      lookCouriers: function () {
        var out = [];
        for (var i = 0; i < couriers.length; i++) {
          var c = couriers[i];
          if (!c.visible) continue;
          var host = c.userData.host;
          out.push({
            x: c.position.x,
            y: c.position.y,
            z: c.position.z,
            dir: host ? (host.userData.dir || 0) : 0,
            linkId: host ? (host.userData.linkId || 0) : 0,
            phase: c.userData.phase || 0
          });
        }
        return out;
      }
    };

    global.GridSim.tick(state, 0.05);
    resize();
    sync();
    applyCamera();
    return game;
  }

  global.PowerRender = { attach: attach };
})(typeof window !== "undefined" ? window : globalThis);
