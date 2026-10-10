<p align="center">
  English
  &nbsp;·&nbsp;
  <a href="README.fr.md"><strong>Français</strong></a>
</p>

<p align="center">
  <strong>This game was made with Grok Build and Grok 4.7 high.</strong>
</p>

<p align="center">
  <img src="docs/banner.png" alt="FLUX — build the current, keep the city lit" width="100%">
</p>

<p align="center">
  <img src="docs/city-ui.png" alt="The district, the plant, and the dashboard on the first morning" width="100%">
  <br>
  <em>First morning. The roofs carry the district. The plant is still waiting for its cable.</em>
</p>

---

Water comes in, heats, becomes steam, then electricity. The sun does the rest while it is up. Your job is to carry that current to the houses and the workshop, and to sell it when there is more than they need.

The city does not stop when it is hungry. It shows you.

| Generate | Carry | Hold |
| --- | --- | --- |
| Thermal chain, solar farm, roofs that do not land on every house. | Pipes run downstream. Points travel on the cables, the way the current is going. | District and plant supplied, or not. Cold and peaks show up in the numbers. |

The play screen opens in French. **FR** and **EN** sit under the FLUX mark. Add `?lang=en` to open in English.

## The day

At **1×**, a day takes about twenty minutes. In the morning, cars leave. In the evening they come back lower and plug in. A cold day draws more, especially at peak hours.

The board follows production, consumption, and the balance, live. Money is in **Canadian dollars**. Surplus sells at the price you set. If a build costs more than you have, a grant makes it affordable.

Houses can arrive on their own. The button stops that: you place them yourself, Powerwall or car.

## In hand

A click on a Megapack opens real controls. **In service** cuts the battery. **Max power** caps the kilowatts. Auto, Charge, Discharge, and Hold change what it does, and the reserve keeps it from emptying too far. The turbine, the solar farm, and the thermal chain share that cap.

Houses come in four shapes, with an address, and windows that light only when power is there — and mostly at night. Cars leave in the morning. The sun crosses the sky. Below zero, snow falls. Surplus sells for more at peak than during the day: the price next to the clock is the price right now. A **priority** house is served ahead of the others when power runs short.

| Gesture | Effect |
| --- | --- |
| Drag | Moves the map, the ground under the cursor |
| Right click | Orbits the district |
| Wheel | Zooms toward the cursor |
| Cable or pipe | Snaps, then chains. Escape finishes |
| Double-click, or F | Frames the selection |
| Arrows, ZQSD | Moves across the map |

## Open

From the game folder:

```bash
python3 -m http.server 8080
```

Then [http://127.0.0.1:8080](http://127.0.0.1:8080). The page also opens directly: the scripts are classic, with nothing to install.

English from the first frame: [http://127.0.0.1:8080/?lang=en](http://127.0.0.1:8080/?lang=en).
