# Asian Hornet DoA WebAudio App

A real-time web application for detecting and localizing Asian hornet nests using direction-of-arrival (DoA) estimation from stereo microphone input.

## What It Does

This app uses two omnidirectional microphones spaced ~1m apart to detect the characteristic 125 Hz buzz of Asian hornets and determine the direction to the source. It processes stereo audio in real-time using GCC-PHAT correlation analysis entirely in the browser.

## Required Hardware

- **Stereo USB audio interface** (e.g., RØDE AI-Micro)
- **Two omnidirectional microphones** spaced 0.2-2.0m apart
- **Chrome browser** (desktop or Android)
- **HTTPS connection** or localhost (required for microphone access)

## Features

- Real-time direction arrow with confidence indicator
- Adjustable microphone spacing and filter parameters
- Band power meters at 110, 125, 210, and 250 Hz for species identification
- Synthetic test mode for validation without hardware
- Mobile-responsive dark theme for outdoor use

## Usage

### Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start local server:
   ```bash
   npm run dev
   ```

3. Open http://localhost:8000 in Chrome

### Deployment

Deploy to GitHub Pages with a single command:
```bash
npm run deploy
```

Then enable Pages in your repository settings using the `gh-pages` branch.

## Controls

- **Device Selection**: Choose your stereo USB audio interface
- **Mic Spacing**: Set the distance between microphones (0.2-2.0m)
- **Center Frequency**: Adjust the target frequency (default 125 Hz)
- **Q Factor**: Control band-pass filter sharpness
- **Filters**: Optional high-pass and notch filters for noise reduction
- **Synthetic Test**: Generate test signals to validate angle calculations

## Safety Notes

- Use appropriate hearing protection in loud environments
- Maintain safe distance from hornets - this tool is for localization only
- Contact professional pest control for nest removal

## Browser Compatibility

- **Supported**: Chrome desktop/Android with HTTPS or localhost
- **Not supported**: iOS Safari, insecure HTTP contexts

## Limitations

- Requires stereo audio input (mono will show error)
- HTTPS or localhost required for microphone access
- Optimized for Chrome browser only
- No persistent data logging in this version

## Technical Details

- Uses AudioWorklet for low-latency processing
- Implements GCC-PHAT algorithm with quadratic interpolation
- 4096-sample windows (~85ms at 48kHz)
- Hanning windowing and radix-2 FFT
- Mobile-optimized for <25% CPU usage on mid-range Android devices
