class HornetDoAApp {
    constructor() {
        this.state = {
            d: 1.0,
            f0: 125,
            Q: 8,
            useHPF: false,
            useNotch50: false,
            useNotch100: false,
            swapLR: false,
            synthetic: false,
            synth: {
                freq: 125,
                tau: 0,
                snrDb: 20,
                enabled: false
            }
        };
        
        this.audioContext = null;
        this.stream = null;
        this.workletNode = null;
        this.sourceNode = null;
        this.isRunning = false;
        this.devices = [];
        this.selectedDeviceId = null;
        
        // Audio graph nodes
        this.filters = {};
        this.meters = {};
        this.analysers = {};
        
        this.initUI();
        this.setupCanvas();
    }
    
    async init() {
        if (!window.isSecureContext) {
            this.setStatus('⚠️ Insecure context. Use HTTPS or localhost.', 'error');
            return;
        }
        
        await this.listDevices();
    }
    
    initUI() {
        // Device selection
        const deviceSelect = document.getElementById('deviceSelect');
        deviceSelect.addEventListener('change', (e) => {
            this.selectedDeviceId = e.target.value;
        });
        
        // Control inputs
        document.getElementById('micSpacing').addEventListener('input', (e) => {
            this.state.d = parseFloat(e.target.value);
            if (this.workletNode) {
                this.workletNode.port.postMessage({ type: 'config', d: this.state.d });
            }
        });
        
        document.getElementById('centerFreq').addEventListener('input', (e) => {
            this.state.f0 = parseInt(e.target.value);
            this.updateFilters();
        });
        
        document.getElementById('qFactor').addEventListener('input', (e) => {
            this.state.Q = parseFloat(e.target.value);
            this.updateFilters();
        });
        
        // Checkboxes
        document.getElementById('useHPF').addEventListener('change', (e) => {
            this.state.useHPF = e.target.checked;
            this.updateFilters();
        });
        
        document.getElementById('useNotch50').addEventListener('change', (e) => {
            this.state.useNotch50 = e.target.checked;
            this.updateFilters();
        });
        
        document.getElementById('useNotch100').addEventListener('change', (e) => {
            this.state.useNotch100 = e.target.checked;
            this.updateFilters();
        });
        
        document.getElementById('swapLR').addEventListener('change', (e) => {
            this.state.swapLR = e.target.checked;
            this.reconnectAudioGraph();
        });
        
        document.getElementById('syntheticMode').addEventListener('change', (e) => {
            this.state.synthetic = e.target.checked;
            document.getElementById('syntheticControls').classList.toggle('visible', e.target.checked);
            if (this.isRunning) {
                this.stopAudio();
                setTimeout(() => this.startAudio(), 100);
            }
        });
        
        // Synthetic controls
        document.getElementById('synthFreq').addEventListener('input', (e) => {
            this.state.synth.freq = parseInt(e.target.value);
            this.updateSyntheticParams();
        });
        
        document.getElementById('synthDelay').addEventListener('input', (e) => {
            this.state.synth.tau = parseFloat(e.target.value) / 1000; // Convert ms to seconds
            document.getElementById('synthDelayValue').textContent = e.target.value;
            this.updateSyntheticParams();
        });
        
        document.getElementById('synthSNR').addEventListener('input', (e) => {
            this.state.synth.snrDb = parseInt(e.target.value);
            document.getElementById('synthSNRValue').textContent = e.target.value;
            this.updateSyntheticParams();
        });
        
        // Start/Stop buttons
        document.getElementById('startBtn').addEventListener('click', () => this.startAudio());
        document.getElementById('stopBtn').addEventListener('click', () => this.stopAudio());
    }
    
    async listDevices() {
        try {
            this.devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = this.devices.filter(device => device.kind === 'audioinput');
            
            const deviceSelect = document.getElementById('deviceSelect');
            deviceSelect.innerHTML = '';
            
            if (audioInputs.length === 0) {
                deviceSelect.innerHTML = '<option>No audio inputs found</option>';
                this.setStatus('No microphones detected. Please connect a USB audio interface.', 'error');
                return;
            }
            
            audioInputs.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || `Device ${device.deviceId.slice(0, 8)}`;
                deviceSelect.appendChild(option);
            });
            
            this.selectedDeviceId = audioInputs[0].deviceId;
            this.setStatus(`Found ${audioInputs.length} audio device(s). Ready to start.`, 'ok');
        } catch (error) {
            this.setStatus(`Device enumeration failed: ${error.message}`, 'error');
        }
    }
    
    async startAudio() {
        try {
            if (this.isRunning) return;
            
            this.setStatus('Starting audio...', 'info');
            
            // Create audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 48000
            });
            
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
            // Load worklets
            await this.audioContext.audioWorklet.addModule('worklet-gccphat.js');
            
            if (this.state.synthetic) {
                await this.audioContext.audioWorklet.addModule('synthetic-worklet.js');
                this.setupSyntheticSource();
            } else {
                await this.setupMicrophoneSource();
            }
            
            this.setupAudioGraph();
            this.isRunning = true;
            
            document.getElementById('startBtn').disabled = true;
            document.getElementById('stopBtn').disabled = false;
            document.getElementById('sampleRateValue').textContent = `${this.audioContext.sampleRate / 1000}`;
            
            this.setStatus('Audio started successfully', 'ok');
            this.startVisualization();
            
        } catch (error) {
            this.handleAudioError(error);
            this.stopAudio();
        }
    }
    
    async setupMicrophoneSource() {
        const constraints = {
            audio: {
                deviceId: this.selectedDeviceId ? { exact: this.selectedDeviceId } : undefined,
                channelCount: { ideal: 2 },
                sampleRate: { ideal: 48000 },
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        };
        
        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Check if we actually got stereo
        const track = this.stream.getAudioTracks()[0];
        const settings = track.getSettings();
        
        if (settings.channelCount < 2) {
            throw new Error('Stereo input required. Current device provides only mono.');
        }
        
        this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
        
        // Refresh device list to show labels
        setTimeout(() => this.listDevices(), 100);
    }
    
    setupSyntheticSource() {
        // Create synthetic audio worklet for test signals
        this.sourceNode = new AudioWorkletNode(this.audioContext, 'synthetic-processor', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2]
        });
        this.updateSyntheticParams();
    }
    
    setupAudioGraph() {
        // Create channel splitter
        const splitter = this.audioContext.createChannelSplitter(2);
        const merger = this.audioContext.createChannelMerger(2);
        
        this.sourceNode.connect(splitter);
        
        // Create filter chains for each channel
        this.setupFilterChain(splitter, 0, merger, 0);
        this.setupFilterChain(splitter, 1, merger, 1);
        
        // Create worklet for GCC-PHAT
        this.workletNode = new AudioWorkletNode(this.audioContext, 'gccphat-processor');
        this.workletNode.port.postMessage({ type: 'config', d: this.state.d });
        
        this.workletNode.port.onmessage = (event) => {
            const { tau, confidence } = event.data;
            this.updateDoADisplay(tau, confidence);
        };
        
        merger.connect(this.workletNode);
        
        // Setup meters
        this.setupMeters();
    }
    
    setupFilterChain(splitter, inputChannel, merger, outputChannel) {
        let currentNode = splitter;
        const finalChannel = this.state.swapLR ? (1 - outputChannel) : outputChannel;
        
        // HPF @ 75Hz
        if (this.state.useHPF) {
            const hpf = this.audioContext.createBiquadFilter();
            hpf.type = 'highpass';
            hpf.frequency.value = 75;
            hpf.Q.value = 0.707;
            currentNode.connect(hpf, inputChannel);
            currentNode = hpf;
        }
        
        // Notch @ 50Hz
        if (this.state.useNotch50) {
            const notch50 = this.audioContext.createBiquadFilter();
            notch50.type = 'notch';
            notch50.frequency.value = 50;
            notch50.Q.value = 20;
            currentNode.connect(notch50, inputChannel);
            currentNode = notch50;
        }
        
        // Notch @ 100Hz
        if (this.state.useNotch100) {
            const notch100 = this.audioContext.createBiquadFilter();
            notch100.type = 'notch';
            notch100.frequency.value = 100;
            notch100.Q.value = 15;
            currentNode.connect(notch100, inputChannel);
            currentNode = notch100;
        }
        
        // Band-pass for DoA
        const bandpass = this.audioContext.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.value = this.state.f0;
        bandpass.Q.value = this.state.Q;
        
        this.filters[`bandpass${outputChannel}`] = bandpass;
        
        if (currentNode === splitter) {
            currentNode.connect(bandpass, inputChannel);
        } else {
            currentNode.connect(bandpass);
        }
        
        bandpass.connect(merger, 0, finalChannel);
    }
    
    setupMeters() {
        const frequencies = [110, 125, 210, 250];
        const sourceForMeters = this.audioContext.createGain();
        sourceForMeters.gain.value = 0.5;
        
        this.sourceNode.connect(sourceForMeters);
        
        frequencies.forEach(freq => {
            const bandpass = this.audioContext.createBiquadFilter();
            bandpass.type = 'bandpass';
            bandpass.frequency.value = freq;
            bandpass.Q.value = 10;
            
            const analyser = this.audioContext.createAnalyser();
            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.8;
            
            sourceForMeters.connect(bandpass);
            bandpass.connect(analyser);
            
            this.analysers[`meter${freq}`] = analyser;
        });
    }
    
    updateFilters() {
        if (!this.audioContext) return;
        
        Object.values(this.filters).forEach(filter => {
            if (filter.type === 'bandpass') {
                filter.frequency.value = this.state.f0;
                filter.Q.value = this.state.Q;
            }
        });
    }
    
    reconnectAudioGraph() {
        if (!this.isRunning) return;
        
        this.stopAudio();
        setTimeout(() => this.startAudio(), 100);
    }
    
    updateSyntheticParams() {
        if (this.sourceNode && this.sourceNode.port) {
            this.sourceNode.port.postMessage({
                type: 'config',
                freq: this.state.synth.freq,
                tau: this.state.synth.tau,
                snrDb: this.state.synth.snrDb
            });
        }
    }
    
    updateDoADisplay(tau, confidence) {
        const c = 343; // Speed of sound m/s
        const maxTau = this.state.d / c;
        
        // Clamp tau to physical limits
        const clampedTau = Math.max(-maxTau, Math.min(maxTau, tau));
        
        // Calculate angle
        const sinTheta = (c * clampedTau) / this.state.d;
        const theta = Math.asin(Math.max(-1, Math.min(1, sinTheta))) * (180 / Math.PI);
        
        // Reduce confidence if at limits
        let finalConfidence = confidence;
        if (Math.abs(tau) >= maxTau * 0.95) {
            finalConfidence *= 0.3;
        }
        
        // Update displays
        document.getElementById('angleValue').textContent = `${theta.toFixed(1)}°`;
        document.getElementById('delayValue').textContent = `${(tau * 1000).toFixed(3)}`;
        document.getElementById('confidenceValue').textContent = `${(finalConfidence * 100).toFixed(0)}%`;
        
        // Update canvas arrow
        this.drawDirection(theta, finalConfidence);
    }
    
    setupCanvas() {
        this.canvas = document.getElementById('directionCanvas');
        this.ctx = this.canvas.getContext('2d');
        
        // Set high DPI
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);
        
        this.drawDirection(0, 0);
    }
    
    drawDirection(angle, confidence) {
        const canvas = this.canvas;
        const ctx = this.ctx;
        const centerX = canvas.width / (2 * window.devicePixelRatio);
        const centerY = canvas.height / (2 * window.devicePixelRatio);
        const radius = Math.min(centerX, centerY) - 20;
        
        // Clear
        ctx.clearRect(0, 0, centerX * 2, centerY * 2);
        
        // Draw compass circle
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.stroke();
        
        // Draw angle marks
        ctx.strokeStyle = '#777';
        ctx.lineWidth = 1;
        for (let i = 0; i < 360; i += 30) {
            const rad = (i - 90) * Math.PI / 180;
            const x1 = centerX + Math.cos(rad) * (radius - 10);
            const y1 = centerY + Math.sin(rad) * (radius - 10);
            const x2 = centerX + Math.cos(rad) * radius;
            const y2 = centerY + Math.sin(rad) * radius;
            
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }
        
        // Draw direction arrow
        if (confidence > 0.1) {
            const arrowRad = (angle - 90) * Math.PI / 180;
            const arrowLength = radius * 0.7;
            const arrowX = centerX + Math.cos(arrowRad) * arrowLength;
            const arrowY = centerY + Math.sin(arrowRad) * arrowLength;
            
            // Arrow color based on confidence
            const alpha = Math.min(1, confidence * 2);
            ctx.strokeStyle = `rgba(0, 255, 0, ${alpha})`;
            ctx.fillStyle = `rgba(0, 255, 0, ${alpha})`;
            ctx.lineWidth = 4;
            
            // Arrow line
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(arrowX, arrowY);
            ctx.stroke();
            
            // Arrow head
            const headSize = 15;
            const headAngle = Math.PI / 6;
            ctx.beginPath();
            ctx.moveTo(arrowX, arrowY);
            ctx.lineTo(
                arrowX - headSize * Math.cos(arrowRad - headAngle),
                arrowY - headSize * Math.sin(arrowRad - headAngle)
            );
            ctx.lineTo(
                arrowX - headSize * Math.cos(arrowRad + headAngle),
                arrowY - headSize * Math.sin(arrowRad + headAngle)
            );
            ctx.closePath();
            ctx.fill();
        }
        
        // Draw confidence indicator
        ctx.fillStyle = `rgba(0, 255, 0, ${confidence})`;
        ctx.fillRect(centerX - 50, centerY + radius + 10, 100 * confidence, 10);
        
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1;
        ctx.strokeRect(centerX - 50, centerY + radius + 10, 100, 10);
    }
    
    startVisualization() {
        if (!this.isRunning) return;
        
        // Update meters
        Object.entries(this.analysers).forEach(([meterName, analyser]) => {
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Float32Array(bufferLength);
            analyser.getFloatTimeDomainData(dataArray);
            
            // Calculate RMS
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i] * dataArray[i];
            }
            const rms = Math.sqrt(sum / bufferLength);
            const db = 20 * Math.log10(rms + 1e-10);
            const normalizedLevel = Math.max(0, Math.min(1, (db + 60) / 60));
            
            const meterId = meterName.replace('meter', 'meter');
            const meterElement = document.getElementById(meterId);
            if (meterElement) {
                meterElement.style.height = `${normalizedLevel * 100}%`;
            }
        });
        
        requestAnimationFrame(() => this.startVisualization());
    }
    
    stopAudio() {
        this.isRunning = false;
        
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        this.sourceNode = null;
        this.workletNode = null;
        this.filters = {};
        this.analysers = {};
        
        document.getElementById('startBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
        
        // Reset displays
        document.getElementById('angleValue').textContent = '--°';
        document.getElementById('delayValue').textContent = '-- ms';
        document.getElementById('confidenceValue').textContent = '--%';
        document.getElementById('sampleRateValue').textContent = '-- kHz';
        
        // Reset meters
        ['meter110', 'meter125', 'meter210', 'meter250'].forEach(id => {
            const meter = document.getElementById(id);
            if (meter) meter.style.height = '0%';
        });
        
        this.drawDirection(0, 0);
        this.setStatus('Audio stopped', 'info');
    }
    
    handleAudioError(error) {
        let message = 'Audio error: ' + error.message;
        let suggestions = '';
        
        switch (error.name) {
            case 'NotAllowedError':
                suggestions = ' Click the microphone icon in your browser to grant permission.';
                break;
            case 'NotFoundError':
                suggestions = ' Please connect a USB microphone and reload the page.';
                break;
            case 'OverconstrainedError':
                suggestions = ' Try selecting a different audio device.';
                break;
            case 'NotReadableError':
                suggestions = ' Close other apps that might be using the microphone.';
                break;
        }
        
        this.setStatus(message + suggestions, 'error');
    }
    
    setStatus(message, type = 'info') {
        const statusPanel = document.getElementById('statusPanel');
        const statusDiv = document.createElement('div');
        statusDiv.className = `status ${type}`;
        statusDiv.textContent = message;
        
        statusPanel.innerHTML = '';
        statusPanel.appendChild(statusDiv);
    }
}

// Initialize app
const app = new HornetDoAApp();

// Wait for DOM and initialize
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});