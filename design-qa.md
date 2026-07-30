# Chatbut design QA

Date: 2026-07-30

Selected direction: Workbench, warm editorial utility
Source reference: `C:\Users\jiannystein\.codex\generated_images\019fb25d-d13e-7951-a232-edef17b2594b\call_mLt8z22LFOJmhpqdzihdvfpy.png`

## Comparison

The selected source and current implementation were placed side by side at the
same panel dimensions in
`app/design-comparison-final.png`. The comparison confirms the intended
left-rail workbench, compact masthead, warm paper surface, black/orange/green
palette, schedule-led hierarchy, and persistent Google Chat overlay preview.
The implementation adds the necessary install strip without changing the
reference's main composition.

## Interaction checks

- Window, People, Replies, and Safety navigation is keyboard-accessible and
  visibly stateful.
- The bookmarklet link retains a real `javascript:` URL after React renders and
  exposes a drag payload suitable for Chrome's bookmarks bar.
- AI adaptation can be switched off; saved response vaults remain usable.
- Independent 1:1 and Space invitation toggles are present and default off.
- Information tooltips use an 800 ms hover delay and immediate keyboard-focus
  disclosure.
- New/open/save, schedule, delay, vault, targeting, key visibility, language,
  debug, and stop/enable states have explicit disabled/focus behavior.

## Layout and accessibility

- Desktop Chrome visual review passed at 1422 × 1070.
- Existing responsive visual captures cover 320, 375, 414, and 768 CSS pixels.
- Both `html` and `body` use `overflow-x: clip`.
- Grid tracks that can carry flexible content use `minmax(0, 1fr)`.
- Buttons and navigation labels do not wrap.
- Reduced-motion rules remove animation and transition effects.
- All visible icons come from one library; the logo is a generated raster asset.
- Key sampled contrast ratios: ink/paper 16.52:1, muted/paper 5.69:1,
  support/support-soft 6.24:1, and light-ink/support 6.95:1.

## Hallmark review

The 58-gate slop test was applied to the final configurator and injected
overlay. No generic hero/card-grid structure, gradient text, decorative browser
chrome, fabricated metric, mixed icon library, unbounded accent field, or
unsupported interaction state remains. The design tokens are centralized in
`app/src/tokens.css`; the CSS stamp records the macrostructure, critique scores,
contrast, structural, responsive, and mobile passes.

final result: passed
