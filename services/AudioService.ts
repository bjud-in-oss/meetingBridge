
export interface IAudioService {
  startCapture(onData: (base64: string) => void): Promise<void>;
  stopCapture(): Promise<void>;
  playAudioQueue(base64: string): Promise<void>;
}

export class AudioService implements IAudioService {
  private static instance: AudioService;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  
  // VAD Settings
  private readonly VAD_THRESHOLD = 0.02; // RMS threshold
  private readonly SAMPLE_RATE = 16000;

  private constructor() {
    // Initialize AudioContext on user interaction usually, keeping it null for now
  }

  public static getInstance(): AudioService {
    if (!AudioService.instance) {
      AudioService.instance = new AudioService();
    }
    return AudioService.instance;
  }

  private getContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: this.SAMPLE_RATE,
      });
    }
    return this.audioContext;
  }

  public async startCapture(onData: (base64: string) => void): Promise<void> {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') await ctx.resume();

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: this.SAMPLE_RATE
        } 
      });

      this.source = ctx.createMediaStreamSource(this.mediaStream);
      
      // Buffer size 4096 = ~256ms latency at 16kHz
      this.processor = ctx.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        
        // 1. VAD Check
        if (this.isSilence(inputData)) return;

        // 2. Convert Float32 to Int16
        const int16Data = this.floatTo16BitPCM(inputData);

        // 3. Base64 Encode
        const base64 = this.arrayBufferToBase64(int16Data.buffer);
        
        onData(base64);
      };

      this.source.connect(this.processor);
      this.processor.connect(ctx.destination); // Connect to destination to keep alive (muted by default usually?)
    } catch (err) {
      console.error('[AudioService] Capture failed', err);
      throw err;
    }
  }

  public async stopCapture(): Promise<void> {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    if (this.processor && this.source) {
      this.source.disconnect(this.processor);
      this.processor.disconnect();
      this.processor = null;
      this.source = null;
    }
  }

  public async playAudioQueue(base64: string): Promise<void> {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') await ctx.resume();

    try {
      const arrayBuffer = this.base64ToArrayBuffer(base64);
      const int16Data = new Int16Array(arrayBuffer);
      const float32Data = new Float32Array(int16Data.length);

      // Convert Int16 -> Float32
      for (let i = 0; i < int16Data.length; i++) {
        float32Data[i] = int16Data[i] / 32768.0;
      }

      const buffer = ctx.createBuffer(1, float32Data.length, this.SAMPLE_RATE);
      buffer.copyToChannel(float32Data, 0);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
    } catch (e) {
      console.error('[AudioService] Playback error', e);
    }
  }

  // --- Helpers ---

  private isSilence(data: Float32Array): boolean {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    const rms = Math.sqrt(sum / data.length);
    return rms < this.VAD_THRESHOLD;
  }

  private floatTo16BitPCM(input: Float32Array): Int16Array {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return output;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary_string = atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
