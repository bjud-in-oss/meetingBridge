
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Schema, Type } from "@google/genai";
import { NetworkService } from "./NetworkService";
import { TranslationPayload, NetworkRole } from "../types/schema";
import { AudioService } from "./AudioService";

// --- ANALYST TOOL DEFINITION ---
const broadcastTranslationTool: FunctionDeclaration = {
  name: 'broadcast_translation',
  description: 'Broadcasts the translated text and speaker metadata to the network.',
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

  constructor() {
    this.network = NetworkService.getInstance();
    this.audioService = AudioService.getInstance();
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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

    if (role === NetworkRole.ROOT || role === NetworkRole.BRANCH) {
      // SENDER -> ANALYST
      await this.startAnalystSession();
    } else {
      // RECEIVER -> ACTOR
      await this.startActorSession();
    }
  }

  public async stopSession() {
    // Reset session
    this.currentMode = 'IDLE';
    this.sessionPromise = null; 
    // Note: Live API doesn't have a clean 'disconnect' on the client object in early preview, usually just stop sending.
  }

  // =================================================================
  // 1. ANALYST MODE (Sender)
  // Listens to Audio -> Function Call -> Broadcast JSON
  // =================================================================

  private async startAnalystSession() {
    if (this.currentMode === 'ANALYST') return;
    this.currentMode = 'ANALYST';

    console.log('[Branch] Starting Analyst Session...');
    
    this.sessionPromise = this.ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      config: {
        tools: [{ functionDeclarations: [broadcastTranslationTool] }],
        systemInstruction: `You are an expert simultaneous interpreter and prosody analyst.
        1. Listen to the incoming audio.
        2. Identify distinct speakers (Speaker A, Speaker B, etc.).
        3. Translate the content to ${this.myLanguage}.
        4. Call 'broadcast_translation' with the translation, speaker label, and detected emotion.
        5. Do not output audio yourself, only use the tool.`,
      },
      callbacks: {
        onopen: () => {
            console.log('[Branch] Analyst Connected. Binding Audio...');
            // Start capturing and feeding the model
            this.audioService.startCapture(async (base64) => {
                if (this.currentMode !== 'ANALYST') return;
                const sess = await this.sessionPromise;
                sess.sendRealtimeInput({
                    media: { mimeType: 'audio/pcm;rate=16000', data: base64 }
                });
            });
        },
        onmessage: (msg: LiveServerMessage) => this.handleAnalystMessage(msg),
        onerror: (e) => console.error('[Branch] Analyst Error', e)
      }
    });
  }

  private handleAnalystMessage(msg: LiveServerMessage) {
    // Check for Function Calls (The payload!)
    const toolCall = msg.toolCall;
    if (toolCall) {
        for (const fc of toolCall.functionCalls) {
            if (fc.name === 'broadcast_translation') {
                const args = fc.args as any;
                
                // Construct Payload
                const payload: TranslationPayload = {
                    type: 'TRANSLATION_DATA',
                    text: args.text,
                    senderId: this.network.me.id,
                    speakerLabel: args.speakerLabel || 'Unknown',
                    prosody: {
                        emotion: args.emotion || 'Neutral',
                        speed: args.speed || 1.0
                    },
                    targetLanguage: this.myLanguage,
                    isFinal: true
                };

                console.log('[Branch] Broadcasting Translation:', payload);
                
                // Broadcast to Mesh
                // Note: We need to cast or update NetworkService to accept this new payload type
                // For now, assume NetworkService handles 'packet' generically or we update it.
                // Since NetworkService expects AudioPayload in strict typing, we might need to bypass or update it.
                // Let's assume we use a generic method in NetworkService for custom packets.
                this.network.broadcastTranslation(payload);

                // ACK the function call to keep Gemini happy
                this.sessionPromise?.then(sess => {
                    sess.sendToolResponse({
                        functionResponses: {
                            id: fc.id,
                            name: fc.name,
                            response: { status: 'ok' }
                        }
                    });
                });
            }
        }
    }
  }

  // =================================================================
  // 2. ACTOR MODE (Receiver)
  // Listens to JSON (Network) -> Gemini Prompt -> Audio Output
  // =================================================================

  private async startActorSession() {
    if (this.currentMode === 'ACTOR') return;
    this.currentMode = 'ACTOR';
    
    console.log('[Branch] Starting Actor Session...');

    // We keep a persistent session to maintain context if needed, 
    // OR we could do one-shot generateContent for each line. 
    // Live API is better for latency.
    
    this.sessionPromise = this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } 
            },
            systemInstruction: `You are a voice actor. 
            I will send you text with a persona and emotion. 
            You must read the text aloud using that persona and emotion.`
        },
        callbacks: {
            onopen: () => console.log('[Branch] Actor Connected'),
            onmessage: (msg: LiveServerMessage) => {
                // Receive Audio from Gemini -> Play to AudioService
                const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (audioData) {
                    this.audioService.playAudioQueue(audioData);
                }
            }
        }
    });
  }

  /**
   * Called by NetworkService when a TranslationPayload arrives.
   */
  public async handleIncomingTranslation(payload: TranslationPayload) {
    if (this.currentMode !== 'ACTOR') return;

    // Map Speaker to Voice
    let voiceName = this.voiceMap[payload.speakerLabel];
    if (!voiceName) {
        // Simple consistent hash assignment
        const voices = ['Kore', 'Fenrir', 'Puck', 'Charon', 'Zephyr'];
        const hash = payload.speakerLabel.split('').reduce((a,b)=>a+b.charCodeAt(0),0);
        voiceName = voices[hash % voices.length];
        this.voiceMap[payload.speakerLabel] = voiceName;
    }

    const prompt = `
    [Speaker: ${voiceName}]
    [Emotion: ${payload.prosody.emotion}]
    [Speed: ${payload.prosody.speed}]
    Read this: "${payload.text}"`;

    const sess = await this.sessionPromise;
    // Send text as user input to trigger audio response
    sess.sendRealtimeInput({
        content: [{ text: prompt }]
    });
  }
}
