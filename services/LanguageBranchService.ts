
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Schema, Type } from "@google/genai";
import { NetworkService } from "./NetworkService";
import { TranslationPayload, NetworkRole, AudioPayload } from "../types/schema";
import { AudioService } from "./AudioService";

// --- ANALYST TOOL DEFINITION ---
const broadcastTranslationTool: FunctionDeclaration = {
  name: 'broadcast_translation',
  description: 'Broadcasts the transcribed/translated text and speaker metadata to the network.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      text: { type: Type.STRING, description: 'The text content of what was said.' },
      speakerLabel: { type: Type.STRING, description: 'The identified speaker label.' },
      emotion: { type: Type.STRING, description: 'The detected emotional tone (e.g. Joy, Anger, Sorrow, Excitement, Neutral).' },
      speed: { type: Type.NUMBER, description: 'Speech speed relative to normal (0.5 - 2.0).' }
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
    // START SPEAKING (Analyst Mode)
    // Guard: Prevent re-initialization if already in Analyst mode
    if (this.currentMode === 'ANALYST') return;

    await this.cleanupSession();
    await this.startAnalystSession();
  }

  public async stopSession() {
    // STOP SPEAKING -> START LISTENING (Actor Mode)
    // Guard: Prevent re-initialization if already in Actor mode
    if (this.currentMode === 'ACTOR') return;
    
    await this.cleanupSession();
    await this.startActorSession();
  }

  private async cleanupSession() {
    this.currentMode = 'IDLE';
    await this.audioService.stopCapture();

    if (this.sessionPromise) {
        try {
            const session = await this.sessionPromise;
            if (session && typeof session.close === 'function') {
                session.close();
            }
        } catch (e) {
            console.warn('[Branch] Error closing session', e);
        }
        this.sessionPromise = null;
    }
  }

  // =================================================================
  // 1. ANALYST MODE (Sender/Microphone Active)
  // =================================================================

  private async startAnalystSession() {
    if (this.currentMode === 'ANALYST') return;
    this.currentMode = 'ANALYST';
    console.log('[Branch] Starting Analyst Session...');
    
    this.sessionPromise = this.ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      config: {
        responseModalities: [Modality.AUDIO],
        tools: [{ functionDeclarations: [broadcastTranslationTool] }],
        systemInstruction: `You are an expert Speech Analyst.
        1. Listen to the user's audio stream intently.
        2. Transcribe the speech accurately.
        3. DETECT EMOTION: Be very sensitive to the speaker's tone (Happy, Sad, Urgent, Bored).
        4. Call 'broadcast_translation' immediately after every phrase.
        5. Do NOT speak yourself. Your only output is the tool call.`,
      },
      callbacks: {
        onopen: () => {
            console.log('[Branch] Analyst Connected.');
            this.audioService.startCapture((base64) => {
                if (this.currentMode !== 'ANALYST') return;
                
                // Intelligence
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
        onerror: (e) => console.error('[Branch] Analyst Error', e),
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
                    speakerLabel: args.speakerLabel || 'Speaker',
                    prosody: { emotion: args.emotion || 'Neutral', speed: 1.0 },
                    targetLanguage: 'source', // We send source text, receiver translates
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
  // 2. ACTOR MODE (Receiver/Listener)
  // =================================================================

  private async startActorSession() {
    if (this.currentMode === 'ACTOR') return;
    this.currentMode = 'ACTOR';
    console.log('[Branch] Starting Actor Session...');
    
    this.sessionPromise = this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
            systemInstruction: `You are a professional Voice Actor and Synchronous Interpreter.
            Your Task:
            1. I will send you text (which may be in any language).
            2. You MUST translate it immediately into ${this.myLanguage}.
            3. Speak the TRANSLATION aloud.
            4. ACT out the text. Use dynamic pitch, speed, and tone to match the requested emotion.
            5. NEVER repeat the source text. NEVER say "The translation is...". JUST ACT.
            6. If the input is already in ${this.myLanguage}, just act it out with high quality.
            `
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
    // 1. Prevent Self-Echo
    if (payload.senderId === this.network.me.id) return;

    if (this.currentMode === 'ACTOR') {
        // 2. FORCE TRANSLATION TO MY LANGUAGE
        const prompt = `
        [INSTRUCTION]
        Source Text: "${payload.text}"
        Target Language: ${this.myLanguage}
        Required Emotion: ${payload.prosody.emotion}
        Task: Translate the source text to the target language and speak it with the required emotion.
        `;
        
        this.sessionPromise?.then(sess => {
            try { sess.sendRealtimeInput({ content: [{ text: prompt }] }); } catch(e) {}
        });
    }
  }
}
