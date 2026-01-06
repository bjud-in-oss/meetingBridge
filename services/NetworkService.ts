
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
  public me: Peer = {
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
  public onRawPeerJoin: (peerId: string) => void = () => {};
  public onRawPeerLeave: (peerId: string) => void = () => {};

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
    
    if (forceRoot) {
      this.me.role = NetworkRole.ROOT;
      this.me.id = this.room.getPeers()[0] || 'root-placeholder'; 
    }

    const [sendPacket, getPacket] = this.room.makeAction('packet');
    
    getPacket((packet: any, peerId: string) => {
      this.handlePacket(packet, peerId);
    });

    this.room.onPeerJoin((peerId) => {
      console.log(`[Net] Peer joined: ${peerId}`);
      this.onRawPeerJoin(peerId);
      this.announceSelf();
    });

    this.room.onPeerLeave((peerId) => {
      this.onRawPeerLeave(peerId);
      this.handlePeerDisconnect(peerId);
    });

    if (!forceRoot) {
      this.startDiscoveryPhase();
    }

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
      senderId: 'self',
      payload: payload
    };

    const [sendPacket] = this.room.makeAction('packet');
    sendPacket(packet);
  }

  private startDiscoveryPhase() {
    console.log('[Net] Starting Discovery Phase...');
    
    this.me.role = NetworkRole.LEAF;
    this.me.parentId = null;

    this.discoveryTimeout = setTimeout(() => {
      this.evaluateTopology();
    }, 5000);
  }

  private evaluateTopology() {
    console.log('[Net] Evaluating Topology...', this.potentialParents);

    let foundLanguageBranch = false;
    
    for (const [peerId, info] of this.potentialParents.entries()) {
      if (info.role === NetworkRole.BRANCH && info.language === this.me.myLanguage) {
        this.connectToParent(peerId);
        foundLanguageBranch = true;
        break;
      }
    }

    if (foundLanguageBranch) return;

    if (this.rootPeerId) {
      console.log('[Net] No language branch found. Upgrading to BRANCH.');
      this.me.role = NetworkRole.BRANCH;
      this.connectToParent(this.rootPeerId); 
      
      this.announceSelf();
    } else {
      console.warn('[Net] No Root found. Waiting...');
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
    
    const [sendPacket] = this.room!.makeAction('packet');
    sendPacket(packet, targetPeerId);
    
    this.onPeerUpdate({ ...this.me });
  }

  // =========================================================================
  // PACKET HANDLING
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
    this.potentialParents.set(peerId, payload);
    
    if (payload.role === NetworkRole.ROOT) {
      this.rootPeerId = peerId;
    }
  }

  private handleConnectionReq(senderPeerId: string, payload: AnnouncementPayload) {
    if (this.me.childrenIds.includes(senderPeerId)) return;

    console.log(`[Net] Accepting Child: ${senderPeerId}`);
    this.me.childrenIds.push(senderPeerId);
    this.onPeerUpdate({ ...this.me });
  }

  private handlePeerDisconnect(peerId: string) {
    if (this.me.parentId === peerId) {
      console.warn('[Net] Parent lost. Restarting discovery.');
      this.me.parentId = null;
      this.startDiscoveryPhase();
    }

    if (this.me.childrenIds.includes(peerId)) {
      this.me.childrenIds = this.me.childrenIds.filter(id => id !== peerId);
    }

    if (this.rootPeerId === peerId) {
      this.rootPeerId = null;
    }
  }

  // =========================================================================
  // AUDIO ROUTING
  // =========================================================================

  public broadcastAudio(audioPayload: AudioPayload) {
    const packet: NetworkPacket = {
      type: 'AUDIO',
      senderId: this.me.id || 'self',
      payload: audioPayload
    };

    if (this.me.role === NetworkRole.LEAF && this.me.parentId) {
      this.sendDirect(packet, this.me.parentId);
    } 
    else if (this.me.role === NetworkRole.BRANCH) {
      if (this.me.parentId) this.sendDirect(packet, this.me.parentId);
      // NOTE: Branch -> Children is now handled by LanguageBranchService explicitly
    } 
    else if (this.me.role === NetworkRole.ROOT) {
      this.sendToChildren(packet);
    }
  }

  /**
   * Specifically for Branches to send translated or passed-through audio to their Leaves.
   */
  public broadcastToChildren(audioPayload: AudioPayload) {
    const packet: NetworkPacket = {
      type: 'AUDIO',
      senderId: audioPayload.senderId,
      payload: audioPayload
    };
    this.sendToChildren(packet);
  }

  private handleAudio(senderId: string, payload: AudioPayload) {
    // 1. Play locally / Process
    this.onAudioReceived(payload);

    // 2. Forwarding Logic
    const packet: NetworkPacket = { type: 'AUDIO', senderId: payload.senderId, payload };

    if (this.me.role === NetworkRole.BRANCH) {
      // Leaf -> Branch -> Root (Upload path)
      // If audio came from DOWN (a Leaf), send UP (to Root)
      if (this.me.childrenIds.includes(senderId) && this.me.parentId) {
        this.sendDirect(packet, this.me.parentId);
      }
      // NOTE: Root -> Branch -> Leaves (Download path) is now INTERCEPTED by LanguageBranchService.
      // We do NOT auto-forward here anymore.
    }
    else if (this.me.role === NetworkRole.ROOT) {
      // Root -> Branches (Hub functionality)
      this.me.childrenIds.forEach(childId => {
        if (childId !== senderId) { 
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
    this.me.childrenIds.forEach(childId => {
      sendPacket(packet, childId);
    });
  }
}
