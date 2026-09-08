interface CountInOptions {
    bpm: number;
    beats: number;
    onFinished: () => void;
}

class CountIn {
    private audioContext: AudioContext | null = null;
    private noiseBuffer: AudioBuffer | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private countingIn = false;

    private getAudioContext(): AudioContext | null {
        if (!this.audioContext) {
            const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (AudioCtx) {
                this.audioContext = new AudioCtx();
            }
        }
        return this.audioContext;
    }

    private getNoiseBuffer(context: AudioContext): AudioBuffer {
        if (!this.noiseBuffer) {
            const length = Math.floor(context.sampleRate * 0.1);
            this.noiseBuffer = context.createBuffer(1, length, context.sampleRate);
            const data = this.noiseBuffer.getChannelData(0);
            for (let index = 0; index < length; index++) {
                data[index] = Math.random() * 2 - 1;
            }
        }
        return this.noiseBuffer;
    }

    private playClick(context: AudioContext, when: number, accent: boolean): void {
        const noise = context.createBufferSource();
        noise.buffer = this.getNoiseBuffer(context);
        const filter = context.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = accent ? 4000 : 3000;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(accent ? 0.4 : 0.25, when + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.02);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(context.destination);
        noise.start(when);
        noise.stop(when + 0.025);
    }

    async start({ bpm, beats, onFinished }: CountInOptions): Promise<void> {
        if (this.countingIn) {
            return;
        }

        const context = this.getAudioContext();
        if (!context) {
            onFinished();
            return;
        }

        await context.resume();
        const beatMs = 60000 / bpm;
        const now = context.currentTime;
        this.countingIn = true;

        for (let index = 0; index < beats; index++) {
            this.playClick(context, now + (index * beatMs) / 1000, index === 0);
        }

        this.timer = setTimeout(() => {
            this.timer = null;
            this.countingIn = false;
            onFinished();
        }, beats * beatMs);
    }

    cancel(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.countingIn = false;
    }
}

export const countIn = new CountIn();
