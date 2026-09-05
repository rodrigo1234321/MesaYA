// Web Audio API Synthesizer for Waiter Chime Alert

let audioCtx: AudioContext | null = null;

export function unlockAudio(): boolean {
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return false;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return true;
  } catch (e) {
    console.warn('No se pudo inicializar AudioContext:', e);
    return false;
  }
}

export function getAudioState(): 'running' | 'suspended' | 'unsupported' {
  if (!audioCtx) {
    return 'suspended';
  }
  return audioCtx.state as 'running' | 'suspended';
}

export function playChimeAlert() {
  if (!audioCtx) {
    unlockAudio();
  }

  if (!audioCtx) return;

  try {
    const now = audioCtx.currentTime;

    // Two-tone pleasant notification chime (Tone 1: 587.33 Hz (D5), Tone 2: 880 Hz (A5))
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15);

    gain1.gain.setValueAtTime(0.01, now);
    gain1.gain.linearRampToValueAtTime(0.3, now + 0.05);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);

    osc1.start(now);
    osc1.stop(now + 0.6);

    // Second bell tone for extra clarity in noisy environments
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(880, now + 0.18);

    gain2.gain.setValueAtTime(0.01, now + 0.18);
    gain2.gain.linearRampToValueAtTime(0.25, now + 0.22);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);

    osc2.start(now + 0.18);
    osc2.stop(now + 0.8);
  } catch (e) {
    console.warn('Error al reproducir chime:', e);
  }
}
