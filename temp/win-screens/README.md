# Win screens

Temporary mockup of the end-of-song screens for every dance stage. Each screen sits on one of the six stages from [`packages/stages`](../../packages/stages) (Skyline Sanctuary, Coral Dome, Open Reef, Emerald Falls, Club Aquarium, Sugarsand Sunset), used as-is so the win screens always match the dance stages. Like the main app, it renders in-engine at a **640×480 buffer stretched to 16:9**.

## What each screen shows

| Result | Stage | Scores |
| --- | --- | --- |
| **Player 1 wins** | The blue dancer steps up to centre stage under a blue light column, on a glowing blue halo, with confetti in their colours; Player 2 steps back | "PLAYER 1 WINS!" in blue; Player 1's score turns gold and pops a size up, Player 2's dims a little |
| **Player 2 wins** | The same for the purple dancer | "PLAYER 2 WINS!" in purple |
| **Tie** | Both dancers stay side by side on gold halos with gold confetti | "IT'S A TIE!" in gold; both scores read "TIED" |
| **Solo** | The one dancer takes centre stage under a light column | "SONG COMPLETE!" with a single score under "FINAL SCORE" |

Two-player screens open with "And the winner is…" while the scores count up, and the result ("PLAYER 1 WINS!", etc.) pops in the moment they finish. The title and the scores are free-standing text over the stage, with no bubble behind them: each dancer gets a column with their number orb and name over a big score in their colour. The text uses the title screen's font (Inter, with the "aerodance." wordmark's shadows on the headline and scores) and the buttons use the stages' glossy name-card pill; the button orbs take each stage's accent colours. The dancers walk to their spots over 1.6 s, eased at both ends so the step starts and stops gently. Play again replays the reveal; Menu only shows a note in the mockup.

## Controls

- **1–6** or **← →**: switch stage.
- **M**: cycle the result (Player 1 wins → Player 2 wins → Tie → Solo).
- **R** or **Enter**: replay the reveal with new placeholder scores.
- URL: `#<stage>/<p1|p2|tie|solo>`, for example `#club/p2` or `#beach/solo`.

## View

From the repository root:

```sh
npx vite --config temp/win-screens/vite.config.js
```

Open http://localhost:5178. The root `npm run build` also writes it to `dist/win-screens/`, so production and PR previews serve it at `/win-screens/`.

## Code

- `client/src/results.js`: the result modes, `tempResults()` (placeholder scores shaped to the requested outcome) and `winnerOf()`. Real scoring should return the same `[{ name, score }]` shape.
- `client/src/WinStage.jsx`: the dancers rearranged for the result, the halo, light column and confetti.
- `client/src/WinHud.jsx`: the title, scores, buttons and mock controls, drawn in the stages' HUD layer.
- `client/src/App.jsx`: hosts the stage (lazy-loaded, with its post-processing settings and the white transition veil) like the dance demo's `Scene.jsx`.
