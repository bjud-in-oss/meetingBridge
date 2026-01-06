
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Schema, Type } from "@google/genai";
import { NetworkService } from "./NetworkService";
import { TranslationPayload, NetworkRole } from "../types/schema";
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

  /**
   * Called by the store when toggling mic/connection.
   * Decides role based on NetworkRole.
   */
  public async startSession() {
    const role = this.network.me.role;

    // Stop any existing session first to avoid conflicts
    await this.stopSession();

    if (role === NetworkRole.ROOT || role === NetworkRole.BRANCH) {
      // SENDER -> ANALYST
      await this.startAnalystSession();
    } else {
      // RECEIVER -> ACTOR
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
    
    // Create the session promise
    this.sessionPromise = this.ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      config: {
        // Ensure we explicitly ask for AUDIO modality even if we suppress output, to satisfy API requirements
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
            // Start capturing audio from hardware/socket
            this.audioService.startCapture((base64) => {
                // STRICT CHECK: If we are not in Analyst mode, stop immediately.
                if (this.currentMode !== 'ANALYST') return;
                
                // Capture local reference to promise
                const currentSessionPromise = this.sessionPromise;
                if (!currentSessionPromise) return;

                // Use the promise to ensure session is ready before sending
                currentSessionPromise.then(sess => {
                    // DOUBLE CHECK: Session might have closed while promise was resolving
                    if (this.currentMode !== 'ANALYST') return;
                    
                    try {
                        sess.sendRealtimeInput({
                            media: { mimeType: 'audio/pcm;rate=16000', data: base64 }
                        });
                    } catch (err) {
                        // Suppress "WebSocket is already in CLOSING or CLOSED state" errors
                        // indicating the session died unexpectedly.
                        console.warn('Recoverable error sending audio chunk:', err);
                    }
                }).catch(e => {
                    console.warn('Session promise rejected:', e);
                });
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
      // If the socket closes unexpectedly, we should stop sending audio
      // We don't necessarily want to fully stop (IDLE) if it's a temp flake,
      // but for now, let's just stop the audio pump to prevent error spam.
      this.sessionPromise = null;
      // We do NOT set currentMode = IDLE here automatically, 
      // because we might want to auto-reconnect logic later. 
      // For now, this effectively stops the audio loop from doing work.
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

                // Broadcast to network AND local store
                this.network.broadcastTranslation(payload);

                // ACK
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
            systemInstruction: `You are a Text-to-Speech engine.
            I will send you text prompts.
            Read them aloud immediately with the requested emotion.
            Do not add conversational filler.`
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

  /**
   * Called by NetworkService when a TranslationPayload arrives.
   */
  public async handleIncomingTranslation(payload: TranslationPayload) {
    // If I'm the one who sent it (Analyst), I don't need to act it out.
    if (this.currentMode !== 'ACTOR') return;

    let voiceName = this.voiceMap[payload.speakerLabel];
    if (!voiceName) {
        const voices = ['Kore', 'Fenrir', 'Puck', 'Charon', 'Zephyr'];
        // Simple consistent hash
        const hash = payload.speakerLabel.split('').reduce((a,b)=>a+b.charCodeAt(0),0);
        voiceName = voices[hash % voices.length];
        this.voiceMap[payload.speakerLabel] = voiceName;
    }

    const prompt = `[Speaker: ${voiceName}] [Emotion: ${payload.prosody.emotion}] Say: "${payload.text}"`;

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
