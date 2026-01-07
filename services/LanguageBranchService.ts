
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Schema, Type } from "@google/genai";
import { NetworkService } from "./NetworkService";
import { TranslationPayload, NetworkRole, AudioPayload } from "../types/schema";
import { AudioService } from "./AudioService";

// --- ANALYST TOOL DEFINITION ---
const broadcastTranslationTool: FunctionDeclaration = {
  name: 'broadcast_translation',
  description: 'Broadcasts the translated text and speaker metadata to the network. Call this for EVERY speech segment detected.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      text: { type: Type.STRING, description: 'The translated text in the target language.' },
      speakerLabel: { type: Type.STRING, description: 'The identified speaker (e.g. "Speaker A", "John").' },
      emotion: { type: Type.STRING, description: 'The emotional tone of the speaker (e.g. "Happy", "Serious").' },
      speed: { type: Type.NUMBER, description: 'The speed of speech relative to normal (0.5 to 2.0).' }
    },
    required: ['text', 'speakerLabel', 'emotion']
  }
};

export class LanguageBranchService {
  private static instance: LanguageBranchService;
  private network: NetworkService;
  private audioService: AudioService;
  private ai: GoogleGenAI;
  
  private sessionPromise: Promise<any> | null = null;
  private myLanguage: string = 'en-US';
  private currentMode: 'ANALYST' | 'ACTOR' | 'IDLE' = 'IDLE';

  private voiceMap: Record<string, string> = {
    'Speaker A': 'Kore',
    'Speaker B': 'Fenrir',
    'Speaker C': 'Puck',
    'Speaker D': 'Charon'
  };

  private constructor() {
    this.network = NetworkService.getInstance();
    this.audioService = AudioService.getInstance();
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  public static getInstance(): LanguageBranchService {
    if (!LanguageBranchService.instance) {
      LanguageBranchService.instance = new LanguageBranchService();
    }
    return LanguageBranchService.instance;
  }

  public setLanguage(lang: string) {
    this.myLanguage = lang;
  }

  // FIX: Allow anyone to start an Analyst session if they toggle Mic ON.
  // We ignore the NetworkRole restriction for now to ensure functionality.
  public async startSession() {
    await this.stopSession();
    await this.startAnalystSession();
  }

  public async stopSession() {
    this.currentMode = 'IDLE';
    this.sessionPromise = null;
    await this.audioService.stopCapture();
    
    // Fall back to Actor mode to keep listening for incoming TTS
    await this.startActorSession();
  }

  // =================================================================
  // 1. ANALYST MODE (Sender)
  // =================================================================

  private async startAnalystSession() {
    this.currentMode = 'ANALYST';
    console.log('[Branch] Starting Analyst Session...');
    
    this.sessionPromise = this.ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      config: {
        responseModalities: [Modality.AUDIO],
        tools: [{ functionDeclarations: [broadcastTranslationTool] }],
        systemInstruction: `You are a real-time speech translator.
        1. Listen to audio.
        2. Translate to ${this.myLanguage}.
        3. Call 'broadcast_translation' with the result.
        4. Do NOT speak the translation yourself unless asked.`,
      },
      callbacks: {
        onopen: () => {
            console.log('[Branch] Analyst Connected.');
            this.audioService.startCapture((base64) => {
                if (this.currentMode !== 'ANALYST') return;

                // 1. Broadcast Raw Audio (Passthrough) for immediate feedback
                const audioPayload: AudioPayload = {
                    senderId: this.network.me.id || 'ROOT',
                    originLanguage: this.myLanguage,
                    targetLanguage: 'raw',
                    audioData: base64,
                    isTranslation: false
                };
                this.network.broadcastAudio(audioPayload);
                
                // 2. Send to Gemini for Intelligence
                this.sessionPromise?.then(sess => {
                    if (this.currentMode !== 'ANALYST') return;
                    try {
                        sess.sendRealtimeInput({
                            media: { mimeType: 'audio/pcm;rate=16000', data: base64 }
                        });
                    } catch (err) {}
                });
            });
        },
        onmessage: (msg: LiveServerMessage) => this.handleAnalystMessage(msg),
        onerror: (e) => {
             console.error('[Branch] Analyst Error', e);
        },
        onclose: () => console.log('[Branch] Analyst Closed')
      }
    });
  }

  private handleAnalystMessage(msg: LiveServerMessage) {
    const toolCall = msg.toolCall;
    if (toolCall) {
        for (const fc of toolCall.functionCalls) {
            if (fc.name === 'broadcast_translation') {
                const args = fc.args as any;
                const payload: TranslationPayload = {
                    type: 'TRANSLATION_DATA',
                    text: args.text,
                    senderId: this.network.me.id || 'ROOT',
                    speakerLabel: args.speakerLabel || 'Me',
                    prosody: { emotion: args.emotion || 'Neutral', speed: 1.0 },
                    targetLanguage: this.myLanguage,
                    isFinal: true
                };

                this.network.broadcastTranslation(payload);

                this.sessionPromise?.then(sess => {
                    sess.sendToolResponse({
                        functionResponses: {
                            id: fc.id,
                            name: fc.name,
                            response: { status: 'ok' }
                        }
                    });
                }).catch(() => {});
            }
        }
    }
  }

  // =================================================================
  // 2. ACTOR MODE (Receiver)
  // =================================================================

  private async startActorSession() {
    this.currentMode = 'ACTOR';
    console.log('[Branch] Starting Actor Session...');
    
    this.sessionPromise = this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
            systemInstruction: `You are a text-to-speech engine. Read exactly what I send you.`
        },
        callbacks: {
            onopen: () => console.log('[Branch] Actor Connected'),
            onmessage: (msg: LiveServerMessage) => {
                const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (audioData) this.audioService.playAudioQueue(audioData);
            },
            onerror: (e) => console.error('[Branch] Actor Error', e),
            onclose: () => console.log('[Branch] Actor Closed')
        }
    });
  }

  // =================================================================
  // INCOMING HANDLING
  // =================================================================

  public async handleIncomingTranslation(payload: TranslationPayload) {
    if (this.currentMode === 'ACTOR') {
        // Use Gemini for High Quality TTS
        const prompt = `Say this with ${payload.prosody.emotion} emotion: "${payload.text}"`;
        this.sessionPromise?.then(sess => {
            try { sess.sendRealtimeInput({ content: [{ text: prompt }] }); } catch(e) {}
        });
    } else {
        // Fallback: Use Browser Native TTS if we are busy acting as an Analyst (Speaking)
        // This prevents interrupting the input stream session.
        this.speakWithBrowser(payload.text);
    }
  }

  private speakWithBrowser(text: string) {
      if ('speechSynthesis' in window) {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = this.myLanguage; 
          window.speechSynthesis.speak(utterance);
      }
  }
}
