
import { create } from 'zustand';
import { NetworkService } from '../services/NetworkService';
import { LanguageBranchService } from '../services/LanguageBranchService';
import { AudioService } from '../services/AudioService';
import { NetworkRole, Peer, AudioPayload, TranslationPayload, AudioSettingsState } from '../types/schema';

export interface TranscriptItem {
  id: string;
  senderId: string;
  text: string;
  speakerLabel?: string;
  emotion?: string;
  isTranslation: boolean;
  timestamp: number;
}

interface MeetingState {
  connectionStatus: 'IDLE' | 'CONNECTING' | 'CONNECTED';
  treeState: Peer | null;
  peers: string[]; 
  isMicOn: boolean;
  
  transcripts: TranscriptItem[];
  volumeLevel: number; 
  
  audioSettings: AudioSettingsState;

  joinMeeting: (roomId: string, displayName: string, language: string, forceRoot: boolean) => void;
  toggleMic: () => Promise<void>;
  leaveMeeting: () => void;
  updateAudioSettings: (settings: Partial<AudioSettingsState>) => void;
}

export const useMeetingStore = create<MeetingState>((set, get) => ({
  connectionStatus: 'IDLE',
  treeState: null,
  peers: [],
  isMicOn: false,
  transcripts: [],
  volumeLevel: 0,
  
  audioSettings: {
      inputDeviceId: 'default',
      outputDeviceId: 'default',
      useExternalInput: false,
      externalInputUrl: 'ws://localhost:8080/audio-in',
      useExternalOutput: false,
      externalOutputUrl: 'ws://localhost:8080/audio-out'
  },

  joinMeeting: (roomId, displayName, language, forceRoot) => {
    // 1. Resume Audio Context immediately on user interaction (Click Join)
    AudioService.getInstance().resumeContext();
    
    set({ connectionStatus: 'CONNECTING' });

    const net = NetworkService.getInstance();
    const branchService = LanguageBranchService.getInstance();
    branchService.setLanguage(language);

    // --- SETUP CALLBACKS ---

    // A. Handle Local Translations (ACTOR MODE OUTPUT)
    branchService.onTranslationGenerated = (translatedText: string) => {
        set(state => ({
            transcripts: [...state.transcripts, {
                id: Math.random().toString(36).substr(2, 9),
                senderId: 'translator-local',
                text: translatedText,
                speakerLabel: 'Interpreter',
                isTranslation: true,
                timestamp: Date.now()
            }]
        }));
    };

    // B. Raw Audio Received (Legacy/Passthrough)
    net.onAudioReceived = (payload: AudioPayload) => {
       // DISABLED for Translation Mode
    };

    // C. Structured Translation Received (Text Distribution Mode)
    net.onTranslationReceived = (payload: TranslationPayload) => {
        console.log('[Store] Translation Received:', payload);
        
        // 1. Visual Transcript (Source Text)
        set(state => ({
            transcripts: [...state.transcripts, {
                id: Math.random().toString(36).substr(2, 9),
                senderId: payload.senderId,
                text: payload.text || '...', 
                speakerLabel: payload.speakerLabel,
                emotion: payload.prosody.emotion,
                isTranslation: true,
                timestamp: Date.now()
            }]
        }));

        // 2. Act it out (TTS) via BranchService
        branchService.handleIncomingTranslation(payload);
    };

    // D. Topology Updates
    net.onPeerUpdate = (me: Peer) => {
      set({ treeState: { ...me } });
      
      // STABILIZATION FIX: Only switch sessions if strictly necessary
      // This prevents onPeerUpdate (triggered by network heartbeats) from killing active sessions
      const micOn = get().isMicOn;
      
      // If Mic is ON, we ensure Analyst session is running (idempotent)
      if (micOn) {
          branchService.startSession();
      } 
      // If Mic is OFF, we ensure Actor session is running (idempotent)
      else {
          branchService.stopSession();
      }
    };

    net.onRawPeerJoin = (peerId) => {
      set((state) => ({ peers: state.peers.includes(peerId) ? state.peers : [...state.peers, peerId] }));
    };

    net.onRawPeerLeave = (peerId) => {
      set((state) => ({ peers: state.peers.filter(id => id !== peerId) }));
    };

    net.connect(roomId, displayName, language, forceRoot);

    set({ connectionStatus: 'CONNECTED', treeState: net.me });
  },

  toggleMic: async () => {
    const { isMicOn, treeState } = get();
    // CRITICAL: Resume Audio Context on User Interaction
    await AudioService.getInstance().resumeContext();

    const branchService = LanguageBranchService.getInstance(); 
    
    if (isMicOn) {
      // User is turning MIC OFF -> Become Listener (Actor)
      set({ isMicOn: false, volumeLevel: 0 });
      await branchService.stopSession(); 
    } else {
      // User is turning MIC ON -> Become Speaker (Analyst)
      if (!treeState) return;
      set({ isMicOn: true });
      await branchService.startSession(); 
    }
  },

  updateAudioSettings: (settings) => {
      set(state => ({ audioSettings: { ...state.audioSettings, ...settings } }));
  },

  leaveMeeting: () => {
    window.location.reload();
  }
}));
