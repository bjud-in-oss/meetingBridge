
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality } from "@google/genai";
import { NetworkService } from "./NetworkService";
import { AudioPayload, NetworkRole } from "../types/schema";

export class LanguageBranchService {
  private network: NetworkService;
  private ai: GoogleGenAI;
  private session: Promise<LiveSession> | null = null;
  private isConnected = false;

  private myLanguage: string = 'en-US';
  
  // Audio Context for potential decoding/encoding (Placeholder for logic)
  // In a real browser env, we need AudioContext to decode Opus -> PCM for Gemini
  // and PCM -> Opus for Network.
  
  constructor() {
    this.network = NetworkService.getInstance();
    
    // Initialize Gemini with API Key
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    // Bind to Network Audio
    const originalHandler = this.network.onAudioReceived;
    this.network.onAudioReceived = (payload) => {
      // Call original handler (so we can hear it locally if we want)
      if (originalHandler) originalHandler(payload);
      
      // Process for Branch Logic
      this.processIncomingNetworkAudio(payload);
    };
  }

  public setLanguage(lang: string) {
    this.myLanguage = lang;
  }

  public async startTranslationSession() {
    if (this.isConnected) return;

    try {
      this.session = this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction: `You are a professional simultaneous interpreter. 
          Translate the incoming audio stream into ${this.myLanguage}. 
          Do not reply to the content, only translate it. 
          If there is silence, stay silent.`,
        },
        callbacks: {
          onopen: () => {
            console.log('[Branch] Gemini Live Connected');
            this.isConnected = true;
          },
          onmessage: (msg: LiveServerMessage) => this.handleGeminiMessage(msg),
          onclose: () => {
            console.log('[Branch] Gemini Live Closed');
            this.isConnected = false;
          },
          onerror: (err) => {
            console.error('[Branch] Gemini Error', err);
          }
        }
      });
      
      await this.session;
    } catch (e) {
      console.error('[Branch] Failed to connect to Gemini', e);
    }
  }

  /**
   * Main Logic: Decides whether to Passthrough or Translate
   */
  private async processIncomingNetworkAudio(payload: AudioPayload) {
    // Only act if I am a BRANCH
    if (this.network.me.role !== NetworkRole.BRANCH) return;

    // Ignore my own audio (loopback protection)
    if (payload.senderId === this.network.me.id || payload.senderId === 'self') return;

    // 1. PASSTHROUGH
    // If audio is already in my language, or if I am not connected to Gemini
    if (payload.targetLanguage === this.myLanguage) {
      this.network.broadcastToChildren(payload);
      return;
    }

    // 2. TRANSLATION
    // Send to Gemini
    if (this.session) {
      const pcmData = await this.decodeOpusToPCM(payload.audioData);
      
      const sess = await this.session;
      sess.sendRealtimeInput({
        media: {
          mimeType: 'audio/pcm;rate=16000',
          data: pcmData // Send raw PCM base64
        }
      });
    }
  }

  private async handleGeminiMessage(msg: LiveServerMessage) {
    // Gemini sends back translated audio
    const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    
    if (audioData) {
      // audioData is PCM 24kHz from Gemini usually, need to encode to Opus for network
      // For this prototype, we'll send it as is or wrap it.
      // Assuming AudioPayload supports the format we send.
      
      const opusData = await this.encodePCMToOpus(audioData);

      const translatedPayload: AudioPayload = {
        senderId: 'translator-' + this.network.me.id, // Mark as translated by me
        originLanguage: 'mixed', // Source unknown at this point
        targetLanguage: this.myLanguage,
        audioData: opusData,
        isTranslation: true
      };

      this.network.broadcastToChildren(translatedPayload);
    }
  }

  // =================================================================
  // HELPER STUBS (Audio Transcoding)
  // =================================================================
  
  // NOTE: In a real implementation, these would use AudioContext or WebAssembly (libopus).
  // Gemini Live requires Linear PCM 16kHz. 
  // Trystero/WebRTC usually works with Opus.
  
  private async decodeOpusToPCM(base64Opus: string): Promise<string> {
    // Placeholder: Return input assuming it might already be compatible or handled elsewhere
    // In production: decodeBase64(opus) -> PCM Float32 -> Int16 -> Base64
    return base64Opus; 
  }

  private async encodePCMToOpus(base64PCM: string): Promise<string> {
    // Placeholder: Return input
    return base64PCM;
  }
}
