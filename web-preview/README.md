# web-preview

Runs the **web** design prototype (`../fayr-design.browser.jsx`, React-DOM) in a
browser so the live-logic **Verifier** screen can be exercised. The shippable app
is the React Native code under `../src/` — this folder is a preview harness, not
part of the app bundle. `react-dom` and `esbuild` are devDependencies used only
here; Metro never bundles them for the RN app.

> **Which prototype file?** `../fayr-design.browser.jsx` — see `entry.jsx`, which
> imports it. It is the current, backend-wired design and the source of truth for
> the RN redesign. `../FayrAppV3.jsx` is an **older frozen snapshot**: it was
> copied into `fayr-design.browser.jsx` on 2026-07-25 (commit `1c75207`) and has
> not changed since, while the newer file received nine further days of work
> (backend campaign/task/wallet wiring, withdrawals, the refund timeline,
> profile). Do not build against `FayrAppV3.jsx`.

## Run

```sh
npm run web:preview      # builds bundle.js and serves at http://localhost:8000
```

Or manually:

```sh
npm run web:preview:build          # one-shot bundle
npx esbuild web-preview/entry.jsx --bundle --outfile=web-preview/bundle.js \
  --loader:.jsx=jsx --loader:.js=jsx --format=iife --watch   # rebuild on change
python3 -m http.server 8000 --directory web-preview
```

Open the URL, then use the right-hand screen menu → **Verifier (live logic)**.

## What the Verifier proves

It drives the real `taskflow` state machine through `src/bridge.js` with
simulated-but-structurally-real evidence (the native WebView fetch can't run in a
browser). You can watch: order→delivery→reviewed→hold→refund, the refund computed
as real integer paise (not the baked `maxBack`), and the gates a timer can't
enforce — **Order returned** blocks payout, the return window blocks early
release, and **review DELETED mid-hold** regresses HOLDING→REVIEWED.

`bundle.js` is generated — do not edit or commit it.
