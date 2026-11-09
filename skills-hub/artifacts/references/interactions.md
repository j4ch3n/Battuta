# Interactions that explain

Name what the reader learns by advancing a step or changing an input. A replay
reveals state transitions; a scenario shows a consequence; an assumption control
shows sensitivity. Navigation alone is not a causal explanation.

Keep stable structure, a meaningful resting state, and one underlying event/state
model for graph, captions and badges. Label illustrative, recorded and live data
honestly. No autoplay. Supply labeled keyboard controls, pause/reset, text
alternatives and reduced-motion behavior. Keep conclusions readable without JS.

Use Mermaid for static diagrams, live-diagram for flowchart/state-machine status
and replay, and Anime.js only for author-owned motion. Do not let Anime.js mutate
live-diagram's graph SVG or create another replay clock. Do not override its SVG
width: the library uses that width for zoom.

Click handlers may update a local explanation, not silently execute a workflow.
Persisted feedback, telemetry, sockets, polling or external actions need separate
scope and authorization. Treat input/comments as data. Keep strict Mermaid
security and SVG text labels; never insert untrusted HTML into overlays.
