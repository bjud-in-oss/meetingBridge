
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

  // Voice Mapping for "Actor" Mode
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

  public async startSession() {
    const role = this.network.me.role;
    await this.stopSession();

    if (role === NetworkRole.ROOT || role === NetworkRole.BRANCH) {
      await this.startAnalystSession();
    } else {
      await this.startActorSession();
    }
  }

  public async stopSession() {
    this.currentMode = 'IDLE';
    this.sessionPromise = null;
    await this.audioService.stopCapture();
  }

  // =================================================================
  // 1. ANALYST MODE (Sender)
  // Listens to Audio -> Function Call -> Broadcast JSON
  // =================================================================

  private async startAnalystSession() {
    this.currentMode = 'ANALYST';
    console.log('[Branch] Starting Analyst Session...');
    
    this.sessionPromise = this.ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      config: {
        responseModalities: [Modality.AUDIO],
        tools: [{ functionDeclarations: [broadcastTranslationTool] }],
        systemInstruction: `You are a real-time speech translator engine.
        1. Listen to the incoming audio stream continuously.
        2. Whenever you hear speech, translate it to ${this.myLanguage}.
        3. IMMEDIATELY call the 'broadcast_translation' function with the translation.
        4. Detect the speaker (Speaker A/B) and emotion.
        5. DO NOT output text or audio yourself. ONLY call the function.
        6. Keep calling the function as the conversation progresses.`,
      },
      callbacks: {
        onopen: () => {
            console.log('[Branch] Analyst Connected via WebSocket.');
            
            this.audioService.startCapture((base64) => {
                if (this.currentMode !== 'ANALYST') return;

                // 1. PASSTHROUGH AUDIO (Broadcast Original Sound)
                const audioPayload: AudioPayload = {
                    senderId: this.network.me.id || 'ROOT',
                    originLanguage: this.myLanguage,
                    targetLanguage: 'raw',
                    audioData: base64,
                    isTranslation: false
                };
                this.network.broadcastAudio(audioPayload);
                
                // 2. SEND TO GEMINI FOR TRANSLATION
                const currentSessionPromise = this.sessionPromise;
                if (!currentSessionPromise) return;

                currentSessionPromise.then(sess => {
                    if (this.currentMode !== 'ANALYST') return;
                    try {
                        sess.sendRealtimeInput({
                            media: { mimeType: 'audio/pcm;rate=16000', data: base64 }
                        });
                    } catch (err) {
                        console.warn('Recoverable error sending audio chunk:', err);
                    }
                }).catch(e => console.warn('Session promise rejected:', e));
            });
        },
        onmessage: (msg: LiveServerMessage) => this.handleAnalystMessage(msg),
        onerror: (e) => {
            console.error('[Branch] Analyst Error', e);
            this.cleanupSession();
        },
        onclose: () => {
            console.log('[Branch] Analyst Closed');
            this.cleanupSession();
        }
      }
    });
  }

  private cleanupSession() {
      this.sessionPromise = null;
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
                    speakerLabel: args.speakerLabel || 'Speaker',
                    prosody: {
                        emotion: args.emotion || 'Neutral',
                        speed: args.speed || 1.0
                    },
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
  // Listens to JSON (Network) -> Gemini Prompt -> Audio Output
  // =================================================================

  private async startActorSession() {
    this.currentMode = 'ACTOR';
    console.log('[Branch] Starting Actor Session...');
    
    this.sessionPromise = this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } 
            },
            systemInstruction: `You are a professional voice actor.
            When I send you text, read it aloud immediately with the requested emotion.
            Do not say "Sure" or "Here is the reading". Just read the text.`
        },
        callbacks: {
            onopen: () => console.log('[Branch] Actor Connected'),
            onmessage: (msg: LiveServerMessage) => {
                const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (audioData) {
                    this.audioService.playAudioQueue(audioData);
                }
            },
            onerror: (e) => {
                console.error('[Branch] Actor Error', e);
                this.cleanupSession();
            },
            onclose: () => {
                console.log('[Branch] Actor Closed');
                this.cleanupSession();
            }
        }
    });
  }

  public async handleIncomingTranslation(payload: TranslationPayload) {
    if (this.currentMode !== 'ACTOR') return;

    let voiceName = this.voiceMap[payload.speakerLabel];
    if (!voiceName) {
        const voices = ['Kore', 'Fenrir', 'Puck', 'Charon', 'Zephyr'];
        const hash = payload.speakerLabel.split('').reduce((a,b)=>a+b.charCodeAt(0),0);
        voiceName = voices[hash % voices.length];
        this.voiceMap[payload.speakerLabel] = voiceName;
    }

    // Explicitly prompt for reading to ensure audio generation
    const prompt = `Please read this: "${payload.text}"`;

    this.sessionPromise?.then(sess => {
        try {
            sess.sendRealtimeInput({
                content: [{ text: prompt }]
            });
        } catch(e) {
            console.warn('Failed to send text to Actor:', e);
        }
    }).catch(() => {});
  }
}
