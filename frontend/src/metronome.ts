export interface MetronomeEvent {
    isMetronome: boolean;
    metronomeNumerator?: number;
}

type PlayFn = (accent: boolean) => void;

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
    if (!audioContext) {
        const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
            audioContext = new AudioCtx();
        }
    }
    return audioContext;
}

class Metronome {
    private enabled = false;

    constructor(
        private readonly playFn: PlayFn,
        private readonly prepareAudio?: () => void,
    ) {}

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (enabled) {
            this.prepareAudio?.();
        }
    }

    handleEvents(events: MetronomeEvent[]): void {
        if (!this.enabled) {
            return;
        }

        for (const event of events) {
            if (!event.isMetronome) {
                continue;
            }

            try {
                this.playFn(event.metronomeNumerator === 0);
            } catch {
                // Audio failures must not interrupt playback timing.
            }
        }
    }
}

function playClick(accent: boolean): void {
    const context = getAudioContext();
    if (!context) {
        return;
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = accent ? 1800 : 1400;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.25 : 0.15, context.currentTime + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.03);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.035);
}

export function createMetronome(playFn: PlayFn = playClick): Metronome {
    return new Metronome(
        playFn,
        playFn === playClick
            ? () => {
                void getAudioContext()?.resume().catch(() => undefined);
            }
            : undefined,
    );
}

export const metronome = createMetronome();
