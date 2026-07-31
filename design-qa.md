# Chatbut design QA

Date: 2026-07-31

Selected direction: Workbench, warm editorial utility

Source reference: `C:\Users\jiannystein\.codex\generated_images\019fb25d-d13e-7951-a232-edef17b2594b\call_mLt8z22LFOJmhpqdzihdvfpy.png`

## Hallmark preflight

- React 19 and Vite 6 application.
- Newsreader Variable display type and Manrope Variable body type.
- Centralized semantic OKLCH palette with warm paper, black ink, orange action,
  and green support states.
- Semantic 4 px-based spacing scale.
- Motion-cut stance: short CSS state transitions only, with reduced-motion
  removal.
- Cached findings: `.hallmark/preflight.json`.

The redesign preserved the selected macrostructure, typography, palette,
spacing, and compact utility density. It extended the system for multi-window
scheduling, explicit browser-local setup, and multi-provider LLM connection
states.

## Interaction checks

- First run contains explicit **Create local configuration** and **Import JSON**
  paths. Bookmark installation and Google Chat actions remain locked until
  setup exists.
- Window, People, Replies, and Safety navigation is keyboard-accessible and
  visibly stateful.
- Bookmark copy specifies: drag once into bookmarks, then click while on the
  Google Chat page.
- Multiple schedule windows, outside-window confirmation, invitation toggles,
  target search, response vaults, delay/cooldown, provider validation, active
  provider selection, debug export/reset, and Stop/Enable states are covered.
- Invalid provider credentials show an actionable non-secret error and are not
  saved.
- Information tooltips disclose off-by-default invitation behavior.
- LLM adaptation remains optional; saved-response mode is complete.

## Responsive and accessibility checks

- Desktop Chrome visual review passed at 1280 CSS pixels.
- Responsive Chrome checks passed at 320, 375, 414, and 768 CSS pixels.
- Measured `scrollWidth === clientWidth` at every required mobile/tablet width.
- Grid tracks carrying flexible content use `minmax(0, 1fr)`.
- Buttons and navigation labels remain readable without accidental wrapping.
- Visible focus, hover, active, disabled, loading, success, warning, and error
  states are defined.
- Reduced-motion rules remove transitions and animation.
- Visible icons use Phosphor; the product mark is a generated raster asset.
- Sampled contrast remains: ink/paper 16.52:1, muted/paper 5.69:1,
  support/support-soft 6.24:1, and light-ink/support 6.95:1.

## Hallmark slop test

The final surface has no generic hero/card-grid structure, gradient text,
decorative browser chrome, fabricated metrics, mixed icon library, unbounded
accent fields, default-purple AI styling, or unsupported visible interaction.
Tokens remain centralized in `app/src/tokens.css`; the `app/src/styles.css`
stamp records the Workbench structure, critique scores, and final gates.

Final result: passed.
