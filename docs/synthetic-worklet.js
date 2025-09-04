class SyntheticProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.phase = 0;
        this.freq = 125;
        this.tau = 0;
        this.snrDb = 20;
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'config') {
                this.freq = event.data.freq || 125;
                this.tau = event.data.tau || 0;
                this.snrDb = event.data.snrDb || 20;
            }
        };
    }
    
    process(inputs, outputs, parameters) {
        const output = outputs[0];
        if (!output || output.length < 2) return true;
        
        const leftChannel = output[0];
        const rightChannel = output[1];
        const frameCount = leftChannel.length;
        
        const omega = 2 * Math.PI * this.freq / sampleRate;
        const noiseScale = Math.pow(10, -this.snrDb / 20);
        
        for (let i = 0; i < frameCount; i++) {
            // Left channel
            const leftSignal = Math.sin(omega * this.phase / sampleRate);
            const leftNoise = (Math.random() - 0.5) * 2 * noiseScale;
            leftChannel[i] = leftSignal + leftNoise;
            
            // Right channel (delayed)
            const rightPhase = this.phase - this.tau * sampleRate;
            const rightSignal = Math.sin(omega * rightPhase / sampleRate);
            const rightNoise = (Math.random() - 0.5) * 2 * noiseScale;
            rightChannel[i] = rightSignal + rightNoise;
            
            this.phase++;
        }
        
        return true;
    }
}

registerProcessor('synthetic-processor', SyntheticProcessor);