# Project: Asian Hornet DoA WebAudio App

## 0) Summary (what to build)

A single-page, static web app that runs **entirely in the browser** (Chrome desktop + Android) to detect and **point** toward a 125 Hz buzz source (Asian hornet nest) using a **stereo** USB audio interface and two omni mics \~1.0 m apart. The app band-passes the 125 Hz region, estimates **inter-mic delay τ** with **GCC-PHAT** in an **AudioWorklet**, converts τ → **angle θ** using θ = asin(c·τ/d), and displays:

* A live **direction arrow**, **τ** in ms, and a **confidence** metric
* Narrow-band **power meters** at ≈110, 125, 210, and 250 Hz as species hints
* Robust mic permission, device selection, and error feedback

Deliverables: Static assets only (HTML/CSS/JS). No backend. Include a **synthetic test mode** for validation without hardware.

---

## 1) Goals & Non-Goals

**Goals**

* Real-time DoA (10–20 FPS UI updates) with low CPU use on Android Chrome
* Clean, mobile-first UI; readable outdoors
* Work with class-compliant 2-ch USB interfaces (e.g., RØDE AI-Micro)
* Explicit controls for mic spacing, filter settings, channel swap
* Clear status/errors for permissions and insecure contexts

**Non-Goals (v1)**

* iOS Safari support
* Persistent recording/logging
* ML classification beyond band-power hints

---

## 2) User Stories

1. As a user, I can select my **2-channel USB mic** and press **Start** to see a DoA arrow and band meters.
2. As a user, I can **adjust mic spacing d**, **band center f₀**, **Q**, toggle **HPF**, **50/100 Hz notch**, and **swap L/R**.
3. As a user, I can see **status** messages if permissions fail or the page isn’t secure (HTTPS/localhost).
4. As a user, I can switch to **Synthetic Test Mode** to verify angle calculation without hardware by injecting two 125 Hz tones with a known delay.
5. As a user, I can deploy the site to GitHub Pages with a **single command**.

---

## 3) Functional Requirements

* **Audio acquisition** with `getUserMedia({ audio: { channelCount: {ideal:2}, sampleRate:{ideal:48000}, echoCancellation:false, noiseSuppression:false, autoGainControl:false } })`
* **Device selection** via `enumerateDevices()`; refresh labels after permission granted.
* **Pre-filters** (Biquad):

  * HPF @ 75 Hz (Q≈0.707) (toggle)
  * Notch @ 50 Hz (Q≈20) (toggle)
  * Notch @ 100 Hz (Q≈15) (toggle)
* **DoA band-pass** (per channel; applied before worklet):

  * Band-pass center f₀ (default 125 Hz), adjustable; Q default 8
* **Meters** (combined L+R, analyser RMS over narrow bands):

  * 110, 125 (or f₀), 210, 250 Hz with Q≈10
* **GCC-PHAT** implementation in an **AudioWorkletProcessor**

  * Window size N = 4096 at 48 kHz (≈85 ms)
  * Hanning window; radix-2 FFT (in-worklet, no external libs)
  * Cross-spectrum, PHAT weighting, IFFT to correlation
  * Limit search lags to |lag| ≤ floor((d/c)\*fs); peak with quadratic interpolation
  * Confidence metric: normalized peak prominence vs local distribution
* **Math**: θ = asin( (c·τ)/d ), with c = 343 m/s; τ from peak lag / fs
* **UI**

  * Canvas arrow (vertical center = “straight ahead”), confidence bar
  * Live readouts: θ (°), τ (ms), confidence (%), sample rate, channels
  * Status panel with explicit errors & suggestions
* **Synthetic Test Mode**

  * Generates two sine waves: L(t)=sin(2πf t), R(t)=sin(2πf (t−τₛ)).
  * Controls: f (default 125 Hz), τₛ slider (±3 ms), SNR slider (white noise), enable/disable.
  * Routes generator into the same chain that feeds the worklet to validate angle.

---

## 4) Technical Architecture

* **Pure static app** (no bundler required; vanilla JS + modules). If you prefer TS, compile to `site/` and keep sources in `src/`.
* **Audio graph**

  ```
  MediaStreamSource → [HPF?] → [Notch 50?] → [Notch 100?] → ChannelSplitter
      → (L) Bandpass(f0,Q) → Merger ch0 ┐
      → (R) Bandpass(f0,Q) → Merger ch1 ┘ → AudioWorkletNode (no audio out)
  + For meters: (L)→Gain 0.5 + (R)→Gain 0.5 → Bandpass(center) → Analyser
  + Synthetic mode: replace MediaStreamSource with ScriptProcessor/AudioWorklet synth
  ```
* **Worklet contract**

  * Processor name: `"gccphat-processor"`
  * Input: 2 channels
  * Messages in: `{ type:'config', d:number }` (mic spacing meters)
  * Messages out: `{ tau:number, confidence:number }` where `tau` in seconds

---

## 5) Performance Targets

* UI update loop ≤ 16 ms per frame (60 FPS ideal; acceptable 20–30 FPS).
* Worklet compute ≤ frame chunk budget; no audio output so glitches are benign but CPU should stay <25% on midrange Android.
* Memory allocations minimized (reuse typed arrays).

---

## 6) Error Handling & Edge Cases

* **Insecure context**: Detect `!isSecureContext`. Show actionable message: “Use HTTPS or localhost”.
* **NotAllowedError**: User denied mic. Explain how to enable.
* **NotFoundError**: No mic. Suggest plugging USB and reloading.
* **OverconstrainedError**: Fallback to default constraints; prompt to pick device.
* **NotReadableError**: Mic busy; close other apps.
* **1-channel inputs**: Detect `channelCount`; show error: requires stereo.
* **Saturation**: If `|τ|` ≈ `(d/c)`, clamp θ to ±90°; set confidence low; suggest checking spacing/LR.
* **Device relabeling**: Refresh list after permission to reveal labels.

---

## 7) UI/UX Requirements

* Dark, high-contrast theme; big touch targets.
* Controls:

  * Device `<select>`
  * Number inputs: spacing d (m; default 1.00; 0.2–2.0), f₀ (Hz), Q
  * Checkboxes: HPF 75, Notch 50, Notch 100, Swap L/R, Synthetic Mode
  * Synthetic controls (visible only when enabled): τ slider (±3.0 ms), SNR slider (dB), freq (Hz)
  * Start/Stop buttons
* Visuals:

  * Canvas arrow; confidence bar under arrow
  * 4 horizontal **band meters** (110/125/210/250)
* Status panel:

  * “Mic permission state: …”
  * Error messages with hints

---

## 8) File/Repo Layout

```
repo-root/
  site/
    index.html
    app.js
    worklet-gccphat.js   (emitted at runtime via blob or as a static module)
    style.css
    icons/               (optional)
    assets/              (optional)
  scripts/
    ghpages-deploy.sh
  package.json
  README.md
```

**Note:** You can inline CSS/JS in `index.html` to keep it one file. If split, ensure **relative** paths work under GitHub Pages project subpaths.

---

## 9) Module Contracts (JS)

```ts
// app.js
type AppState = {
  d: number;             // mic spacing (m)
  f0: number;            // band center (Hz)
  Q: number;             // band Q
  useHPF: boolean;
  useNotch50: boolean;
  useNotch100: boolean;
  swapLR: boolean;
  synthetic: boolean;
  synth: { freq:number; tau:number; snrDb:number; enabled:boolean; };
};

function initUI(): void;
function listDevices(): Promise<void>;
function startAudio(): Promise<void>;
function stopAudio(): void;
function setStatus(msg:string, type:'info'|'ok'|'error'): void;
```

```ts
// worklet-gccphat.js (AudioWorkletProcessor)
interface ConfigMsg { type:'config'; d:number; }
interface ResultMsg { tau:number; confidence:number; }
```

---

## 10) Algorithms (details)

* Window length **N=4096**; Hanning window.
* FFT: iterative radix-2 (implement in worklet) or use split-radix; avoid GC.
* PHAT weighting: `G = X * conj(Y) / |X * conj(Y)|` (epsilon to avoid div-by-0).
* IFFT → correlation; examine only `lag ∈ [-L,+L]` where `L=floor((d/c)*fs)`.
* **Quadratic peak interpolation** around best index `i`:
  `δ = 0.5*(y[i-1]-y[i+1])/(y[i-1]-2y[i]+y[i+1])` → refined index `i+δ`.
* τ = (i+δ)/fs (wrap negatives from circular IFFT).
* Confidence (simple & fast): z-score of peak vs mean±std within the allowed lag window; squash to \[0,1] with scale factor.

---

## 11) Synthetic Test Mode

* Generate stereo 125 Hz sines in an **AudioWorklet** or **AudioWorkletNode with AudioParam**:

  * L = sin(2π f t) + whiteNoise(SNR)
  * R = sin(2π f (t−τₛ)) + whiteNoise(SNR)
* τₛ slider in ±3 ms; show expected θ alongside measured θ; display error (°).

---

## 12) Acceptance Tests

1. **Permissions**

   * Opening from `file://` shows error to use HTTPS/localhost.
   * On HTTPS or `http://localhost`, pressing Start prompts for mic.
2. **Device handling**

   * After grant, device labels populate; switching device restarts stream.
3. **DoA**

   * With Synthetic Mode τₛ=0 → θ≈0°.
   * With τₛ positive (sound arrives Right later) → θ correct sign & within ±2°.
   * Clamp behavior at large τₛ (beyond `d/c`): θ pegged ±90°, low confidence.
4. **Meters**

   * Inject 125 Hz in synthetic mode → 125 meter > 110/210/250.
   * Change f₀ → meters update accordingly.
5. **Stability**

   * 2+ hours run on Android Chrome without memory growth > 30 MB.
6. **CPU**

   * Midrange Android (e.g., Snapdragon 7xx/8xx): <25% CPU.

---

## 13) Accessibility & Internationalization

* Keyboard focus for controls; ARIA labels for meters/angle.
* Numbers formatted with fixed decimals; units shown.
* English strings centralized for easy future i18n.

---

## 14) GitHub Pages: **One-Command Deploy**

Use the `gh-pages` NPM package. `npm run deploy` publishes `site/` to the `gh-pages` branch.

### `package.json`

```json
{
  "name": "hornet-doa-web",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "npx http-server site -p 8000 --cors",
    "deploy": "gh-pages -d site -b gh-pages -m \"Deploy $(date -u +'%Y-%m-%dT%H:%M:%SZ')\""
  },
  "dependencies": {},
  "devDependencies": {
    "gh-pages": "^6.1.1",
    "http-server": "^14.1.1"
  }
}
```

### `scripts/ghpages-deploy.sh` (optional convenience)

```bash
#!/usr/bin/env bash
set -euo pipefail
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Init git & add remote first: git init && git remote add origin <repo-url>"
  exit 1
fi
npm run deploy
echo "✅ Deployed to GitHub Pages (branch: gh-pages). Enable Pages in repo settings → 'gh-pages' branch."
```

**Usage**

1. Create repo and set origin:

```bash
git init
git remote add origin git@github.com:<your-username>/<repo>.git
```

2. Put all site files under `site/`.
3. Run **one command**:

```bash
npm run deploy
```

4. On GitHub, Settings → Pages → **Source: `gh-pages` branch** → save.
   Site URL: `https://<your-username>.github.io/<repo>/`

*(Because all asset paths are relative, it’ll work under the `/repo/` subpath.)*

---

## 15) README (key points to include)

* What it does, required hardware, safe usage notes
* How to run locally (`npm run dev` → [http://localhost:8000](http://localhost:8000))
* How to deploy (`npm run deploy`)
* Limitations (needs HTTPS/localhost; stereo; Chrome recommended)

---

## 16) Nice-to-Haves (leave hooks)

* CSV logging of θ/τ/confidence/band-powers @ 2 Hz
* “Baseline” capture button to subtract ambient
* Second harmonic band (230–270 Hz) auto-boost for SNR

---

## 17) Definition of Done

* All acceptance tests pass on Chrome desktop & Android.
* Single HTML page + JS/CSS in `site/` runs standalone.
* Lint-clean, no console errors, no top-level awaits outside modules.
* `npm run deploy` publishes to live Pages URL.

