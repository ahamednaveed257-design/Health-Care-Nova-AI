# Care Nova AI Usage Guide Video

This folder contains the detailed Care Nova AI walkthrough video used inside the Guide tab.

## Play The Video

Open:

```text
renders/care-nova-ai-usage-guide-v24.webm
```

## What The Video Covers

- 22 carefully paced chapters across the full Care Nova workflow.
- About 5 minutes 26 seconds of cleaner, more deliberate walkthrough content.
- High-detail 1440p source render, browser-reliable 24 FPS motion, 20 Mbps export target, stronger speech normalization, clearer voice EQ with de-essing, quieter ambient bed, brighter section-aware clinical lighting, reduced background texture, stage-aligned panels, an organized bottom action-and-narration tray, smoother focus-pull transitions, larger takeaway captions, clearer chapter labels, stronger result-to-mastery cards, sharper examples, mastery tips, accuracy-quality checks, full three-point chapter guidance, and a stronger closing recap to prevent confusion.
- Each chapter now teaches what to enter, what Care Nova checks, what result the user should save or share, which quality signal improves the next answer, and the next practical action after using that tab.
- Patient profile, memory, routing, specialist agents, safety, and local storage.
- General, Specialist, Atlas, Vitals, Medicine, Labs, Wellness, Visits, Records, Insurance, Safety, and Summary.
- Guided/Expert modes, language selector, online/offline behavior, feedback training, and the best daily workflow.

## Source Files

- `SCRIPT.md` contains the narration outline.
- `DESIGN.md` contains the visual style.
- `index.html` contains the V24 22-chapter animated HyperFrames source preview.
- `render-canvas-webm.cjs` creates the playable local WebM video without FFmpeg and is the render pipeline used for the packaged WebM.
- The renderer runs a layout audit before export and fails if chapter text is too long.
