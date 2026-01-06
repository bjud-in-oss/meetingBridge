
import { create } from 'zustand';
import { NetworkService } from '../services/NetworkService';
import { LanguageBranchService } from '../services/LanguageBranchService';
import { AudioService } from '../services/AudioService';
import { NetworkRole, Peer, AudioPayload } from '../types/schema';

interface MeetingState {
  connectionStatus: 'IDLE' | 'CONNECTING' | 'CONNECTED';
  treeState: Peer | null;
  peers: string[]; // List of peer IDs in the room
  isMicOn: boolean;

  joinMeeting: (roomId: string, displayName: string, language: string, forceRoot: boolean) => void;
  toggleMic: () => Promise<void>;
  leaveMeeting: () => void;
}

export const useMeetingStore = create<MeetingState>((set, get) => ({
  connectionStatus: 'IDLE',
  treeState: null,
  peers: [],
  isMicOn: false,

  joinMeeting: (roomId, displayName, language, forceRoot) => {
    set({ connectionStatus: 'CONNECTING' });

    const net = NetworkService.getInstance();
    
    // Instantiate Branch Logic
    // Note: LanguageBranchService hooks into NetworkService.onAudioReceived in its constructor
    const branchService = new LanguageBranchService();
    branchService.setLanguage(language);

    // --- SUBSCRIPTIONS ---

    // 1. Audio Received -> Play it
    // NOTE: LanguageBranchService chains this, so this still fires for local playback
    net.onAudioReceived = (payload: AudioPayload) => {
      const audio = AudioService.getInstance();
      audio.playAudioQueue(payload.audioData);
    };

    // 2. Peer Topology Updates -> Update my tree state
    net.onPeerUpdate = (me: Peer) => {
      set({ treeState: { ...me } });

      // If I just became a Branch, start the Translation Engine
      if (me.role === NetworkRole.BRANCH) {
        branchService.startTranslationSession();
      }
    };

    // 3. Raw Peer List Updates -> UI list
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
      set({ isMicOn: false });
    } else {
      if (!treeState) return;

      // Start capturing Mic
      await audio.startCapture((base64Opus: string) => {
        // Construct standard payload
        const payload: AudioPayload = {
          senderId: treeState.id || 'unknown',
          originLanguage: treeState.myLanguage,
          targetLanguage: treeState.myLanguage,
          audioData: base64Opus,
          isTranslation: false
        };

        // Broadcast to mesh (logic handles Up/Down routing)
        net.broadcastAudio(payload);
      });

      set({ isMicOn: true });
    }
  },

  leaveMeeting: () => {
    // Hard reset for P2P stability
    window.location.reload();
  }
}));
