# Live-panel reference

A complete content-driven system example powered by the existing live-panel
HTML runtime: stable layout, deterministic `seek(time)`, simulated counters,
status and log. `index.html` supplies accessible play/pause, scrubbing and a text
alternative; animation is opt-in. No services, model calls or live data are used.

Adapt, replace, remove or extend any part. `system.json` demonstrates semantic
rows and relationships; `config.json` is the ready-made runtime example. An
optional dependency-free helper can recompute its layout without hand-written
coordinates:

```sh
python3 scaffold.py --spec system.json --out config.json
```

The supplied example already runs, without generation or a build pipeline.
The helper and semantic example are private authoring files, not HTTP resources.
If using the helper, keep the text alternative in `index.html` aligned with the
system. `panel.html` is the reusable live-panel runtime; it loads `config.json`.
Preserve simulation/source labels and check keyboard controls, narrow screens,
pause, reduced motion and configuration failures. Use the artifacts skill for
sharing and delivery verification. This guide is not served.
