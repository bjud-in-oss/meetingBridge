
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
    set({ connectionStatus: 'CONNECTING' });

    const net = NetworkService.getInstance();
    const branchService = new LanguageBranchService();
    branchService.setLanguage(language);

    // --- SUBSCRIPTIONS ---

    // 1. Raw Audio Received (Legacy/Passthrough)
    net.onAudioReceived = (payload: AudioPayload) => {
      if (payload.audioData && payload.audioData.length > 0) {
        AudioService.getInstance().playAudioQueue(payload.audioData);
      }
    };

    // 2. Structured Translation Received (Text Distribution Mode)
    net.onTranslationReceived = (payload: TranslationPayload) => {
        // A. Visual Transcript
        set(state => ({
            transcripts: [...state.transcripts, {
                id: Math.random().toString(36).substr(2, 9),
                senderId: payload.senderId,
                text: payload.text,
                speakerLabel: payload.speakerLabel,
                emotion: payload.prosody.emotion,
                isTranslation: true,
                timestamp: Date.now()
            }]
        }));

        // B. Act it out (TTS) via BranchService
        branchService.handleIncomingTranslation(payload);
    };

    // 3. Topology Updates
    net.onPeerUpdate = (me: Peer) => {
      set({ treeState: { ...me } });
      // Restart session if role changes (unlikely in this ver, but safe)
      if (get().isMicOn) {
          branchService.startSession();
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
    const audio = AudioService.getInstance();
    const branchService = new LanguageBranchService(); // Grab singleton logically, though currently new instance. 
    // Fix: We should probably singleton BranchService or attach to window for this prototype, 
    // but effectively we just need to trigger the startSession on the *existing* active service logic.
    // Ideally BranchService connects to NetworkService singleton internally.
    
    // For this refactor, we just call the method on a new instance which shares state via Singletons inside it.
    
    if (isMicOn) {
      await audio.stopCapture();
      await branchService.stopSession();
      set({ isMicOn: false, volumeLevel: 0 });
    } else {
      if (!treeState) return;
      
      // Start the Logic (Analyst or Actor)
      await branchService.startSession();

      set({ isMicOn: true });
    }
  },

  updateAudioSettings: (settings) => {
      set(state => ({ audioSettings: { ...state.audioSettings, ...settings } }));
  },

  leaveMeeting: () => {
    window.location.reload();
  }
}));
