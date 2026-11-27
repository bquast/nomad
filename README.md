# Nomad

A small No Man's Sky style game for the browser and for Meta Quest 3 (WebXR).

- Procedural star systems with 3 to 5 planets. Each planet has a biome: lush, desert, frozen, toxic, barren, exotic or ocean.
- Planets are full spheres with quadtree level of detail. You can fly from the surface to space with no loading screen.
- Walk on foot with a jetpack. Mine trees, plants, rocks and crystals with the laser.
- Scan to mark resources and to discover creature species.
- Fly the ship. Land, take off, use the pulse drive in space, and mine asteroids with the ship laser.
- Craft warp cells and warp to a new star system.
- The game saves to localStorage every 30 seconds and after each warp.

## Run

Serve the folder from any static web server. All files are in the root and three.js r187 (ESM) is a local file. There is no build step and there is no CDN.

```
python3 -m http.server 8000
```

## GitHub Pages (classic)

1. Push this folder to the `master` branch of a new repo.
2. In the repo settings, go to Pages. Set the source to "Deploy from a branch", branch `master`, folder `/ (root)`.

The `.nojekyll` file tells Pages to serve the files as they are.

WebXR needs HTTPS. GitHub Pages gives you HTTPS.

## Controls

| Where | Controls |
|---|---|
| Desktop, on foot | WASD move, mouse look, Space jetpack, Shift sprint, click mine, F scan, E board ship, Tab menu |
| Desktop, in ship | W throttle, S brake, mouse pitch and yaw, A/D roll, Shift boost, Space pulse drive (in space), click laser, E land and exit |
| Quest, on foot | Left stick move (click to sprint), right stick turn, A jetpack, right trigger mine, X scan, B board, Y menu |
| Quest, in ship | Left trigger or left stick up throttle, left stick X yaw, right stick pitch and roll, hold right grip for hand stick, A boost, X pulse drive, right trigger laser, B land and exit |
| Quest, panel | Point at the panel and push the grip to grab and move it. Point and pull the right trigger to push a menu button. |
| Gamepad | Left stick move, right stick look, RT mine, LT throttle, A jetpack or boost, X scan, B interact, Start menu |

## Comfort (VR)

- Flight assist keeps the horizon level in the atmosphere. Yaw turns around the planet's up axis.
- The cockpit has a fixed frame that you can see.
- The comfort vignette closes in when you turn or move fast.
- Snap turn is on by default. You can change it to smooth turn in the menu.

## Files

| File | Contents |
|---|---|
| `index.html` | Start screen and styles |
| `main.js` | Game state, on-foot and ship logic, VR, main loop |
| `planet.js` | Planet parameters, height field, cube-sphere LOD, flora |
| `fauna.js` | Creature species and herds |
| `world.js` | Star system, asteroids, ship model |
| `hud.js` | Canvas HUD (DOM overlay on desktop, grabbable panel in VR) |
| `input.js` | Keyboard, mouse, gamepad and Quest controllers |
| `noise.js` | Seeded random numbers, simplex noise, names |
| `three.module.js`, `three.core.js` | three.js r187 |
