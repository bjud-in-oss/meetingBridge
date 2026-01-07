
import { AudioDevice } from '../types/schema';

export class AudioService {
  private static instance: AudioService;
  private audioContext: AudioContext | null = null;
  
  // Hardware Capture
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  
  // External Input (WebSocket)
  private inputSocket: WebSocket | null = null;
  
  // External Output (WebSocket)
  private outputSocket: WebSocket | null = null;

  // Configuration
  private currentInputDeviceId: string = 'default';
  private currentOutputDeviceId: string = 'default';
  private useExternalInput = false;
  private useExternalOutput = false;

  private readonly SAMPLE_RATE = 16000; // Gemini Native 16k preferred

  private constructor() {}

  public static getInstance(): AudioService {
    if (!AudioService.instance) {
      AudioService.instance = new AudioService();
    }
    return AudioService.instance;
  }

  // =================================================================
  // CONTEXT MANAGEMENT
  // =================================================================

  private getContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: this.SAMPLE_RATE,
      });
      // Apply initial sink ID if set
      if (this.currentOutputDeviceId !== 'default' && 'setSinkId' in this.audioContext) {
          (this.audioContext as any).setSinkId(this.currentOutputDeviceId);
      }
    }
    return this.audioContext;
  }

  /**
   * Must be called from a UI event handler (click/touch) to unlock audio on browsers.
   */
  public async resumeContext(): Promise<void> {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
      console.log('[AudioService] AudioContext resumed');
    }
  }

  // =================================================================
  // DEVICE MANAGEMENT
  // =================================================================

  public async getDevices(): Promise<AudioDevice[]> {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
          console.warn('navigator.mediaDevices not supported');
          return [];
      }
      // Request permission first to get labels
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter(d => d.kind === 'audioinput' || d.kind === 'audiooutput')
        .map(d => ({
          deviceId: d.deviceId,
          label: d.label || `${d.kind} (${d.deviceId.slice(0, 4)}...)`,
          kind: d.kind as 'audioinput' | 'audiooutput'
        }));
    } catch (e) {
      console.error('Failed to enumerate devices', e);
      return [];
    }
  }

  public setInputDevice(deviceId: string) {
    this.currentInputDeviceId = deviceId;
    if (this.mediaStream) {
       // Ideally trigger a restart here if active
    }
  }

  public setOutputDevice(deviceId: string) {
    this.currentOutputDeviceId = deviceId;
    if (this.audioContext && 'setSinkId' in this.audioContext) {
        (this.audioContext as any).setSinkId(deviceId)
            .catch((e: any) => console.warn('setSinkId failed', e));
    }
  }

  public configureExternalIO(
    useInput: boolean, inputUrl: string, 
    useOutput: boolean, outputUrl: string
  ) {
    this.useExternalInput = useInput;
    this.useExternalOutput = useOutput;

    // Handle Input Socket Connection
    if (useInput && inputUrl) {
        if (this.inputSocket) this.inputSocket.close();
        this.inputSocket = new WebSocket(inputUrl);
        this.inputSocket.binaryType = 'arraybuffer';
        this.inputSocket.onopen = () => console.log('[Audio] Ext Input Connected');
        this.inputSocket.onerror = (e) => console.error('[Audio] Ext Input Error', e);
    } else {
        if (this.inputSocket) this.inputSocket.close();
        this.inputSocket = null;
    }

    // Handle Output Socket Connection
    if (useOutput && outputUrl) {
        if (this.outputSocket) this.outputSocket.close();
        this.outputSocket = new WebSocket(outputUrl);
        this.outputSocket.onopen = () => console.log('[Audio] Ext Output Connected');
        this.outputSocket.onerror = (e) => console.error('[Audio] Ext Output Error', e);
    } else {
        if (this.outputSocket) this.outputSocket.close();
        this.outputSocket = null;
    }
  }

  // =================================================================
  // CAPTURE (Hardware OR Socket)
  // =================================================================

  public async startCapture(onData: (base64: string) => void): Promise<void> {
    await this.resumeContext();

    if (this.useExternalInput && this.inputSocket) {
        // SOCKET MODE
        console.log('[Audio] Capturing from WebSocket...');
        this.inputSocket.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
               const base64 = this.arrayBufferToBase64(event.data);
               onData(base64);
            }
        };
    } else {
        // HARDWARE MODE
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert('Audio capture not supported in this environment.');
            return;
        }

        console.log(`[Audio] Capturing from Mic (${this.currentInputDeviceId})...`);
        const ctx = this.getContext();
        
        await this.stopCapture();

        this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
            audio: { 
              deviceId: this.currentInputDeviceId !== 'default' ? { exact: this.currentInputDeviceId } : undefined,
              echoCancellation: true, 
              sampleRate: this.SAMPLE_RATE
            } 
        });

        this.source = ctx.createMediaStreamSource(this.mediaStream);
        this.processor = ctx.createScriptProcessor(4096, 1, 1);

        this.processor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const int16Data = this.floatTo16BitPCM(inputData);
            const base64 = this.arrayBufferToBase64(int16Data.buffer);
            onData(base64);
        };

        this.source.connect(this.processor);
        this.processor.connect(ctx.destination);
    }
  }

  public async stopCapture(): Promise<void> {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    if (this.processor && this.source) {
      this.processor.onaudioprocess = null;
      this.source.disconnect();
      this.processor.disconnect();
      this.processor = null;
      this.source = null;
    }
    if (this.inputSocket) {
        this.inputSocket.onmessage = null;
    }
  }

  // =================================================================
  // PLAYBACK (Speaker OR Socket)
  // =================================================================

  public async playAudioQueue(base64: string): Promise<void> {
    const arrayBuffer = this.base64ToArrayBuffer(base64);

    // 1. External Output Routing
    if (this.useExternalOutput && this.outputSocket && this.outputSocket.readyState === WebSocket.OPEN) {
        this.outputSocket.send(arrayBuffer);
    }

    // 2. Hardware Output Routing
    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
        // Attempt to resume, though auto-play policies might block it if not user-initiated
        await ctx.resume().catch(e => console.warn('Auto-play blocked:', e));
    }

    try {
      const int16Data = new Int16Array(arrayBuffer);
      const float32Data = new Float32Array(int16Data.length);
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

  // =================================================================
  // HELPERS
  // =================================================================

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
