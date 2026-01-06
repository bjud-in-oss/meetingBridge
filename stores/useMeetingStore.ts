
import { create } from 'zustand';
import { NetworkService } from '../services/NetworkService';
import { LanguageBranchService } from '../services/LanguageBranchService';
import { AudioService } from '../services/AudioService';
import { NetworkRole, Peer, AudioPayload } from '../types/schema';

export interface TranscriptItem {
  id: string;
  senderId: string;
  text: string;
  isTranslation: boolean;
  timestamp: number;
}

interface MeetingState {
  connectionStatus: 'IDLE' | 'CONNECTING' | 'CONNECTED';
  treeState: Peer | null;
  peers: string[]; // List of peer IDs in the room
  isMicOn: boolean;
  
  transcripts: TranscriptItem[];
  volumeLevel: number; // 0-100 for UI visualization

  joinMeeting: (roomId: string, displayName: string, language: string, forceRoot: boolean) => void;
  toggleMic: () => Promise<void>;
  leaveMeeting: () => void;
}

export const useMeetingStore = create<MeetingState>((set, get) => ({
  connectionStatus: 'IDLE',
  treeState: null,
  peers: [],
  isMicOn: false,
  transcripts: [],
  volumeLevel: 0,

  joinMeeting: (roomId, displayName, language, forceRoot) => {
    set({ connectionStatus: 'CONNECTING' });

    const net = NetworkService.getInstance();
    
    // Instantiate Branch Logic
    const branchService = new LanguageBranchService();
    branchService.setLanguage(language);

    // --- SUBSCRIPTIONS ---

    // 1. Audio/Data Received
    net.onAudioReceived = (payload: AudioPayload) => {
      // Play Audio if exists
      if (payload.audioData && payload.audioData.length > 0) {
        const audio = AudioService.getInstance();
        audio.playAudioQueue(payload.audioData);
      }

      // Handle Transcript
      if (payload.transcript) {
        set(state => ({
          transcripts: [...state.transcripts, {
            id: Math.random().toString(36).substr(2, 9),
            senderId: payload.senderId,
            text: payload.transcript || '',
            isTranslation: payload.isTranslation,
            timestamp: Date.now()
          }]
        }));
      }
    };

    // 2. Peer Topology Updates
    net.onPeerUpdate = (me: Peer) => {
      set({ treeState: { ...me } });
      if (me.role === NetworkRole.BRANCH) {
        branchService.startTranslationSession();
      }
    };

    // 3. Raw Peer List Updates
    net.onRawPeerJoin = (peerId) => {
      set((state) => ({ 
        peers: state.peers.includes(peerId) ? state.peers : [...state.peers, peerId] 
      }));
    };

    net.onRawPeerLeave = (peerId) => {
      set((state) => ({ 
        peers: state.peers.filter(id => id !== peerId) 
      }));
    };

    // --- CONNECT ---
    net.connect(roomId, displayName, language, forceRoot);

    set({ 
      connectionStatus: 'CONNECTED',
      treeState: net.me 
    });
  },

  toggleMic: async () => {
    const { isMicOn, treeState } = get();
    const audio = AudioService.getInstance();
    const net = NetworkService.getInstance();

    if (isMicOn) {
      await audio.stopCapture();
      set({ isMicOn: false, volumeLevel: 0 });
    } else {
      if (!treeState) return;

      // Start capturing Mic
      await audio.startCapture((base64Opus: string) => {
        // Calculate rough volume for UI
        const vol = calculateApproxVolume(base64Opus);
        set({ volumeLevel: vol });

        // Construct standard payload
        const payload: AudioPayload = {
          senderId: treeState.id || 'unknown',
          originLanguage: treeState.myLanguage,
          targetLanguage: treeState.myLanguage,
          audioData: base64Opus,
          isTranslation: false
        };

        // Broadcast to mesh
        net.broadcastAudio(payload);
      });

      set({ isMicOn: true });
    }
  },

  leaveMeeting: () => {
    window.location.reload();
  }
}));

// Helper to estimate volume from Base64 (assuming 16-bit PCM inside or similar enough for visual)
// Note: This is a hack because we don't have access to the Raw float data here easily without changing AudioService signature significantly.
function calculateApproxVolume(base64: string): number {
  if (!base64) return 0;
  // This is very rough, just checking string length or byte variation is not accurate for Opus, 
  // but if the AudioService sends RAW Int16 (which it does in this prototype), this works perfectly.
  // In `AudioService.ts`, we implemented `startCapture` sending `int16Data` encoded as base64.
  // So we CAN decode it here to check volume.
  
  try {
    const bin = atob(base64);
    let sum = 0;
    // Check every 10th sample to save CPU
    for (let i = 0; i < bin.length; i += 20) {
      // Little Endian Int16
      const byte1 = bin.charCodeAt(i);
      const byte2 = bin.charCodeAt(i + 1) || 0;
      const val = (byte2 << 8) | byte1;
      const signedVal = val >= 32768 ? val - 65536 : val;
      sum += Math.abs(signedVal);
    }
    const avg = sum / (bin.length / 20);
    // Normalize 0-32768 to 0-100
    const normalized = Math.min(100, (avg / 1000) * 100); 
    return normalized;
  } catch (e) {
    return 0;
  }
}
