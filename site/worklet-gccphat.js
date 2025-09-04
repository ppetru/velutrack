class GCCPHATProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.d = 1.0; // mic spacing in meters
        this.sampleRate = 48000;
        this.windowSize = 4096;
        this.bufferL = new Float32Array(this.windowSize);
        this.bufferR = new Float32Array(this.windowSize);
        this.bufferIndex = 0;
        this.hanningWindow = new Float32Array(this.windowSize);
        
        // Pre-compute Hanning window
        for (let i = 0; i < this.windowSize; i++) {
            this.hanningWindow[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (this.windowSize - 1)));
        }
        
        // FFT working arrays
        this.fftRealL = new Float32Array(this.windowSize);
        this.fftImagL = new Float32Array(this.windowSize);
        this.fftRealR = new Float32Array(this.windowSize);
        this.fftImagR = new Float32Array(this.windowSize);
        this.correlation = new Float32Array(this.windowSize);
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'config') {
                this.d = event.data.d;
            }
        };
    }
    
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || input.length < 2) return true;
        
        const leftChannel = input[0];
        const rightChannel = input[1];
        const frameCount = leftChannel.length;
        
        // Fill circular buffers
        for (let i = 0; i < frameCount; i++) {
            this.bufferL[this.bufferIndex] = leftChannel[i];
            this.bufferR[this.bufferIndex] = rightChannel[i];
            this.bufferIndex = (this.bufferIndex + 1) % this.windowSize;
            
            // Process when buffer is full
            if (this.bufferIndex === 0) {
                this.processGCCPHAT();
            }
        }
        
        return true;
    }
    
    processGCCPHAT() {
        // Apply Hanning window and prepare for FFT
        for (let i = 0; i < this.windowSize; i++) {
            const index = (this.bufferIndex + i) % this.windowSize;
            this.fftRealL[i] = this.bufferL[index] * this.hanningWindow[i];
            this.fftImagL[i] = 0;
            this.fftRealR[i] = this.bufferR[index] * this.hanningWindow[i];
            this.fftImagR[i] = 0;
        }
        
        // Forward FFT
        this.fft(this.fftRealL, this.fftImagL);
        this.fft(this.fftRealR, this.fftImagR);
        
        // Cross-spectrum with PHAT weighting
        for (let i = 0; i < this.windowSize; i++) {
            const realPart = this.fftRealL[i] * this.fftRealR[i] + this.fftImagL[i] * this.fftImagR[i];
            const imagPart = this.fftImagL[i] * this.fftRealR[i] - this.fftRealL[i] * this.fftImagR[i];
            
            // PHAT weighting: normalize by magnitude
            const magnitude = Math.sqrt(realPart * realPart + imagPart * imagPart) + 1e-12;
            this.fftRealL[i] = realPart / magnitude;
            this.fftImagL[i] = imagPart / magnitude;
        }
        
        // Inverse FFT to get correlation
        this.ifft(this.fftRealL, this.fftImagL);
        
        // Copy real part to correlation array
        for (let i = 0; i < this.windowSize; i++) {
            this.correlation[i] = this.fftRealL[i];
        }
        
        // Find peak within allowed lag range
        const maxLag = Math.floor((this.d / 343.0) * this.sampleRate);
        let peakIndex = 0;
        let peakValue = this.correlation[0];
        
        // Search positive lags
        for (let i = 1; i <= Math.min(maxLag, this.windowSize / 2); i++) {
            if (this.correlation[i] > peakValue) {
                peakValue = this.correlation[i];
                peakIndex = i;
            }
        }
        
        // Search negative lags (wrapped around)
        for (let i = Math.max(this.windowSize - maxLag, this.windowSize / 2); i < this.windowSize; i++) {
            if (this.correlation[i] > peakValue) {
                peakValue = this.correlation[i];
                peakIndex = i;
            }
        }
        
        // Quadratic interpolation for sub-sample precision
        let refinedIndex = peakIndex;
        if (peakIndex > 0 && peakIndex < this.windowSize - 1) {
            const y1 = this.correlation[peakIndex - 1];
            const y2 = this.correlation[peakIndex];
            const y3 = this.correlation[peakIndex + 1];
            
            const denom = y1 - 2 * y2 + y3;
            if (Math.abs(denom) > 1e-12) {
                const delta = 0.5 * (y1 - y3) / denom;
                refinedIndex = peakIndex + delta;
            }
        }
        
        // Convert to tau (handle wraparound for negative delays)
        let tau = refinedIndex / this.sampleRate;
        if (refinedIndex > this.windowSize / 2) {
            tau = (refinedIndex - this.windowSize) / this.sampleRate;
        }
        
        // Calculate confidence (z-score based)
        const lagStart = Math.max(0, peakIndex - maxLag);
        const lagEnd = Math.min(this.windowSize, peakIndex + maxLag + 1);
        let sum = 0;
        let sumSq = 0;
        let count = 0;
        
        for (let i = lagStart; i < lagEnd; i++) {
            if (i !== peakIndex) {
                sum += this.correlation[i];
                sumSq += this.correlation[i] * this.correlation[i];
                count++;
            }
        }
        
        let confidence = 0;
        if (count > 0) {
            const mean = sum / count;
            const variance = (sumSq / count) - (mean * mean);
            const std = Math.sqrt(Math.max(variance, 1e-12));
            const zScore = (peakValue - mean) / std;
            confidence = Math.max(0, Math.min(1, zScore / 10)); // Scale and clamp
        }
        
        // Send result
        this.port.postMessage({
            tau: tau,
            confidence: confidence
        });
    }
    
    // Radix-2 FFT implementation
    fft(real, imag) {
        const n = real.length;
        
        // Bit-reverse
        for (let i = 0; i < n; i++) {
            const j = this.reverseBits(i, Math.log2(n));
            if (j > i) {
                [real[i], real[j]] = [real[j], real[i]];
                [imag[i], imag[j]] = [imag[j], imag[i]];
            }
        }
        
        // Cooley-Tukey
        for (let length = 2; length <= n; length <<= 1) {
            const halfLength = length >> 1;
            const wReal = Math.cos(2 * Math.PI / length);
            const wImag = -Math.sin(2 * Math.PI / length);
            
            for (let i = 0; i < n; i += length) {
                let wnReal = 1;
                let wnImag = 0;
                
                for (let j = 0; j < halfLength; j++) {
                    const u = real[i + j];
                    const v = imag[i + j];
                    const s = real[i + j + halfLength];
                    const t = imag[i + j + halfLength];
                    
                    const sReal = s * wnReal - t * wnImag;
                    const sImag = s * wnImag + t * wnReal;
                    
                    real[i + j] = u + sReal;
                    imag[i + j] = v + sImag;
                    real[i + j + halfLength] = u - sReal;
                    imag[i + j + halfLength] = v - sImag;
                    
                    const tempReal = wnReal * wReal - wnImag * wImag;
                    wnImag = wnReal * wImag + wnImag * wReal;
                    wnReal = tempReal;
                }
            }
        }
    }
    
    // Inverse FFT
    ifft(real, imag) {
        // Conjugate
        for (let i = 0; i < real.length; i++) {
            imag[i] = -imag[i];
        }
        
        // Forward FFT
        this.fft(real, imag);
        
        // Conjugate and normalize
        const n = real.length;
        for (let i = 0; i < n; i++) {
            real[i] /= n;
            imag[i] = -imag[i] / n;
        }
    }
    
    reverseBits(num, bits) {
        let result = 0;
        for (let i = 0; i < bits; i++) {
            result = (result << 1) | (num & 1);
            num >>= 1;
        }
        return result;
    }
}

registerProcessor('gccphat-processor', GCCPHATProcessor);