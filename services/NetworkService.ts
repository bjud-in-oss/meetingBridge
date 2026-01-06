import { joinRoom, Room } from 'trystero';
import { NetworkRole, Peer, AudioPayload } from '../types/schema';

// Internal packet types for control messages vs audio
type PacketType = 'ANNOUNCE' | 'CONNECTION_REQ' | 'CONNECTION_ACK' | 'AUDIO';

interface NetworkPacket {
  type: PacketType;
  senderId: string;
  payload?: any;
}

interface AnnouncementPayload {
  role: NetworkRole;
  language: string;
}

export class NetworkService {
  private static instance: NetworkService;
  private room: Room | null = null;
  private appId = 'p2p-translation-tree-v1';
  
  // My State
  private me: Peer = {
    id: '',
    displayName: 'Anonymous',
    role: NetworkRole.LEAF,
    myLanguage: 'en-US',
    parentId: null,
    childrenIds: [],
    isMicLocked: false,
  };

  // Topology State
  private rootPeerId: string | null = null;
  private potentialParents: Map<string, AnnouncementPayload> = new Map();
  private discoveryTimeout: any = null;

  // Callbacks
  public onAudioReceived: (payload: AudioPayload) => void = () => {};
  public onPeerUpdate: (peer: Peer) => void = () => {};

  private constructor() {}

  public static getInstance(): NetworkService {
    if (!NetworkService.instance) {
      NetworkService.instance = new NetworkService();
    }
    return NetworkService.instance;
  }

  /**
   * Initialize the network connection
   * @param roomId The meeting ID
   * @param displayName User's name
   * @param language User's language
   * @param forceRoot If true, this user effectively starts the meeting as Host
   */
  public connect(roomId: string, displayName: string, language: string, forceRoot: boolean = false) {
    this.room = joinRoom({ appId: this.appId }, roomId);
    
    this.me.displayName = displayName;
    this.me.myLanguage = language;
    
    // If I am the creator, I am ROOT immediately.
    if (forceRoot) {
      this.me.role = NetworkRole.ROOT;
      this.me.id = this.room.getPeers()[0] || 'root-placeholder'; // Trystero ID isn't immediate, but selfId is handled internally usually. 
      // Note: Trystero doesn't give 'me' an ID easily until interaction, 
      // but for this logic we assume we get an ID or generate a random one for logical purposes
      // mapped to the Trystero peer ID.
      // For simplicity in Trystero: we use the library's `onPeerJoin` to trigger initial exchanges.
    }

    // 1. Listen for raw data
    const [sendPacket, getPacket] = this.room.makeAction('packet');
    
    getPacket((packet: any, peerId: string) => {
      this.handlePacket(packet, peerId);
    });

    // 2. Peer Lifecycle
    this.room.onPeerJoin((peerId) => {
      console.log(`[Net] Peer joined: ${peerId}`);
      this.announceSelf();
    });

    this.room.onPeerLeave((peerId) => {
      this.handlePeerDisconnect(peerId);
    });

    // 3. Start Discovery Phase (if not Root)
    if (!forceRoot) {
      this.startDiscoveryPhase();
    }

    // Initial announcement
    setTimeout(() => this.announceSelf(), 500);
  }

  // =========================================================================
  // DISCOVERY & TOPOLOGY FORMATION
  // =========================================================================

  private announceSelf() {
    if (!this.room) return;
    
    const payload: AnnouncementPayload = {
      role: this.me.role,
      language: this.me.myLanguage
    };

    const packet: NetworkPacket = {
      type: 'ANNOUNCE',
      senderId: 'self', // Receiver knows my ID via Trystero
      payload: payload
    };

    // Broadcast existence to everyone (Mesh Lite) so they know I exist
    // But we will ONLY send audio to specific parents/children.
    const [sendPacket] = this.room.makeAction('packet');
    sendPacket(packet); // Broadcast
  }

  private startDiscoveryPhase() {
    console.log('[Net] Starting Discovery Phase...');
    
    // Reset state
    this.me.role = NetworkRole.LEAF;
    this.me.parentId = null;

    // Wait 5 seconds to collect Announcements
    this.discoveryTimeout = setTimeout(() => {
      this.evaluateTopology();
    }, 5000);
  }

  private evaluateTopology() {
    console.log('[Net] Evaluating Topology...', this.potentialParents);

    // 1. Look for a BRANCH that matches my language
    let foundLanguageBranch = false;
    
    for (const [peerId, info] of this.potentialParents.entries()) {
      if (info.role === NetworkRole.BRANCH && info.language === this.me.myLanguage) {
        this.connectToParent(peerId);
        foundLanguageBranch = true;
        break;
      }
    }

    if (foundLanguageBranch) return;

    // 2. If no Language Branch, I must UPGRADE to BRANCH and connect to ROOT
    if (this.rootPeerId) {
      console.log('[Net] No language branch found. Upgrading to BRANCH.');
      this.me.role = NetworkRole.BRANCH;
      this.connectToParent(this.rootPeerId); // Connect to Root
      
      // Announce new role so others can find me
      this.announceSelf();
    } else {
      console.warn('[Net] No Root found. Waiting...');
      // Retry discovery later? Or keep waiting for an ANNOUNCE.
    }
  }

  private connectToParent(targetPeerId: string) {
    this.me.parentId = targetPeerId;
    console.log(`[Net] Connecting to Parent: ${targetPeerId}`);
    
    const packet: NetworkPacket = {
      type: 'CONNECTION_REQ',
      senderId: 'self',
      payload: { role: this.me.role, language: this.me.myLanguage }
    };
    
    // Direct message to parent
    const [sendPacket] = this.room!.makeAction('packet');
    sendPacket(packet, targetPeerId);
    
    this.onPeerUpdate({ ...this.me });
  }

  // =========================================================================
  // PACKET HANDLING (THE SWITCHBOARD)
  // =========================================================================

  private handlePacket(packet: NetworkPacket, senderPeerId: string) {
    switch (packet.type) {
      case 'ANNOUNCE':
        this.handleAnnouncement(senderPeerId, packet.payload);
        break;
      case 'CONNECTION_REQ':
        this.handleConnectionReq(senderPeerId, packet.payload);
        break;
      case 'AUDIO':
        this.handleAudio(senderPeerId, packet.payload);
        break;
    }
  }

  private handleAnnouncement(peerId: string, payload: AnnouncementPayload) {
    // Track potential parents
    this.potentialParents.set(peerId, payload);
    
    if (payload.role === NetworkRole.ROOT) {
      this.rootPeerId = peerId;
    }

    // If I was waiting for a root to upgrade, and I see one now:
    if (this.me.role === NetworkRole.LEAF && !this.me.parentId && this.discoveryTimeout === null) {
       // Re-evaluate if we need to upgrade (simple debounce logic omitted for brevity)
    }
  }

  private handleConnectionReq(senderPeerId: string, payload: AnnouncementPayload) {
    // Someone wants to be my child
    if (this.me.childrenIds.includes(senderPeerId)) return;

    console.log(`[Net] Accepting Child: ${senderPeerId}`);
    this.me.childrenIds.push(senderPeerId);
    
    // We could send an ACK here if we wanted strictly confirmed connections
    this.onPeerUpdate({ ...this.me });
  }

  private handlePeerDisconnect(peerId: string) {
    // If Parent died
    if (this.me.parentId === peerId) {
      console.warn('[Net] Parent lost. Restarting discovery.');
      this.me.parentId = null;
      this.startDiscoveryPhase();
    }

    // If Child died
    if (this.me.childrenIds.includes(peerId)) {
      this.me.childrenIds = this.me.childrenIds.filter(id => id !== peerId);
    }

    // If Root died (and I am a Branch)
    if (this.rootPeerId === peerId) {
      this.rootPeerId = null;
      // In a real app, we might hold an election for new Root.
      // Here, we just wait/fail.
    }
  }

  // =========================================================================
  // AUDIO ROUTING
  // =========================================================================

  /**
   * Public method to send audio from Microphone
   */
  public broadcastAudio(audioPayload: AudioPayload) {
    const packet: NetworkPacket = {
      type: 'AUDIO',
      senderId: this.me.id || 'self',
      payload: audioPayload
    };

    // Routing Logic for Originator
    if (this.me.role === NetworkRole.LEAF && this.me.parentId) {
      // Leaf -> Up to Branch
      this.sendDirect(packet, this.me.parentId);
    } 
    else if (this.me.role === NetworkRole.BRANCH) {
      // Branch -> Up to Root
      if (this.me.parentId) this.sendDirect(packet, this.me.parentId);
      // Branch -> Down to Children (if I am the source, e.g. interpreter)
      this.sendToChildren(packet);
    } 
    else if (this.me.role === NetworkRole.ROOT) {
      // Root -> Down to all Branches
      this.sendToChildren(packet);
    }
  }

  /**
   * Internal handler for incoming audio
   */
  private handleAudio(senderId: string, payload: AudioPayload) {
    // 1. Play the audio locally
    this.onAudioReceived(payload);

    // 2. Forwarding Logic (The Switchboard)
    const packet: NetworkPacket = { type: 'AUDIO', senderId: payload.senderId, payload };

    if (this.me.role === NetworkRole.BRANCH) {
      // If audio came from DOWN (a Leaf), send UP (to Root)
      if (this.me.childrenIds.includes(senderId) && this.me.parentId) {
        this.sendDirect(packet, this.me.parentId);
      }
      // If audio came from UP (Root), send DOWN (to Leaves)
      else if (senderId === this.me.parentId) {
        this.sendToChildren(packet);
      }
    }
    else if (this.me.role === NetworkRole.ROOT) {
      // If audio came from a Branch, forward to ALL OTHER Branches
      // Note: We simply send to all children. Trystero isn't a true multicast, 
      // so we iterate.
      this.me.childrenIds.forEach(childId => {
        if (childId !== senderId) { // Don't echo back to sender
          this.sendDirect(packet, childId);
        }
      });
    }
  }

  private sendDirect(packet: NetworkPacket, targetId: string) {
    if (!this.room) return;
    const [sendPacket] = this.room.makeAction('packet');
    sendPacket(packet, targetId);
  }

  private sendToChildren(packet: NetworkPacket) {
    if (!this.room) return;
    const [sendPacket] = this.room.makeAction('packet');
    // Send to each child individually to maintain Tree structure logic
    this.me.childrenIds.forEach(childId => {
      sendPacket(packet, childId);
    });
  }
}