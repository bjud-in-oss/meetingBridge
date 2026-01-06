
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
  private appId = 'p2p-translation-tree-v2'; // Bumped version to avoid mismatched protocol cache
  
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
  private potentialParents: Map<string, AnnouncementPayload> = new Map();
  private rootPeerId: string | null = null;
  
  // Timers & Intervals
  private heartbeatInterval: any = null;
  private discoveryInterval: any = null;
  private connectionRetryInterval: any = null;

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
   */
  public connect(roomId: string, displayName: string, language: string, forceRoot: boolean = false) {
    // Cleanup previous session if exists
    if (this.room) {
      this.leave();
    }

    this.room = joinRoom({ appId: this.appId }, roomId);
    
    // Default State
    this.me.displayName = displayName;
    this.me.myLanguage = language;
    this.me.childrenIds = [];
    this.me.parentId = null;
    this.me.role = NetworkRole.LEAF;

    if (forceRoot) {
      this.me.role = NetworkRole.ROOT;
      // Note: Trystero doesn't give us our ID immediately in all transports, 
      // but we use 'self' for senderId usually or wait for first packet. 
      // We will assume `this.room.getPeers()` helps or rely on self-announcement loop.
    }

    // Packet Listener
    const [sendPacket, getPacket] = this.room.makeAction('packet');
    getPacket((packet: any, peerId: string) => {
      this.handlePacket(packet, peerId);
    });

    // Peer Events
    this.room.onPeerJoin((peerId) => {
      console.log(`[Net] Peer joined: ${peerId}`);
      this.onRawPeerJoin(peerId);
      // Immediately announce existence to the new peer
      this.broadcastAnnouncement();
    });

    this.room.onPeerLeave((peerId) => {
      this.onRawPeerLeave(peerId);
      this.handlePeerDisconnect(peerId);
    });

    // START MECHANISMS
    if (forceRoot) {
      this.startHeartbeat();
    } else {
      this.startDiscoveryPhase();
    }
  }

  public leave() {
    this.stopHeartbeat();
    this.stopDiscovery();
    this.stopConnectionRetry();
    if (this.room) {
      this.room.leave();
      this.room = null;
    }
  }

  // =========================================================================
  // HEARTBEAT (Pulse)
  // =========================================================================

  private startHeartbeat() {
    this.stopHeartbeat();
    // Only ROOT and BRANCH nodes need to advertise availability
    this.heartbeatInterval = setInterval(() => {
      if (this.me.role === NetworkRole.ROOT || this.me.role === NetworkRole.BRANCH) {
        this.broadcastAnnouncement();
      }
    }, 2000); // 2 seconds pulse
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
  }

  private broadcastAnnouncement() {
    if (!this.room) return;
    
    const payload: AnnouncementPayload = {
      role: this.me.role,
      language: this.me.myLanguage
    };

    const packet: NetworkPacket = {
      type: 'ANNOUNCE',
      senderId: this.getMyId(), // Helper to get ID
      payload: payload
    };

    // Broadcast to everyone
    const [sendPacket] = this.room.makeAction('packet');
    sendPacket(packet);
  }

  // =========================================================================
  // DISCOVERY & CONNECTION (Handshake)
  // =========================================================================

  private startDiscoveryPhase() {
    console.log('[Net] Starting Discovery...');
    this.me.parentId = null;
    this.potentialParents.clear();
    this.onPeerUpdate({ ...this.me });

    // Every 1 second, check if we found a suitable parent in our potentialParents map
    this.stopDiscovery();
    this.discoveryInterval = setInterval(() => {
      // If we are already connected, stop looking (unless we lost connection, handled elsewhere)
      if (this.me.parentId) {
        this.stopDiscovery();
        return;
      }
      this.evaluatePotentialParents();
    }, 1000);
  }

  private stopDiscovery() {
    if (this.discoveryInterval) clearInterval(this.discoveryInterval);
  }

  private evaluatePotentialParents() {
    // 1. Look for a BRANCH in my language
    let targetId: string | null = null;

    for (const [peerId, info] of this.potentialParents.entries()) {
      if (info.role === NetworkRole.BRANCH && info.language === this.me.myLanguage) {
        targetId = peerId;
        break;
      }
    }

    // 2. If no Branch, look for ROOT (and upgrade myself later if needed)
    if (!targetId && this.rootPeerId) {
      // If I connect to Root directly, I might become a Branch
      targetId = this.rootPeerId;
    }

    if (targetId) {
      this.attemptConnection(targetId);
      this.stopDiscovery(); // Stop searching while we attempt to connect
    }
  }

  private attemptConnection(targetId: string) {
    console.log(`[Net] Attempting connection to ${targetId}...`);
    let retryCount = 0;
    const maxRetries = 10;

    this.stopConnectionRetry();
    
    const sendReq = () => {
      if (this.me.parentId === targetId) {
        this.stopConnectionRetry(); // Success, we are connected
        return;
      }

      if (retryCount >= maxRetries) {
        console.warn('[Net] Connection Failed after retries. Restarting Discovery.');
        this.stopConnectionRetry();
        this.startDiscoveryPhase();
        return;
      }

      console.log(`[Net] Sending CONNECTION_REQ (Attempt ${retryCount + 1})`);
      const packet: NetworkPacket = {
        type: 'CONNECTION_REQ',
        senderId: this.getMyId(),
        payload: { role: this.me.role, language: this.me.myLanguage }
      };
      
      const [sendPacket] = this.room!.makeAction('packet');
      sendPacket(packet, targetId);
      
      retryCount++;
    };

    // Send immediately, then every 1s
    sendReq();
    this.connectionRetryInterval = setInterval(sendReq, 1000);
  }

  private stopConnectionRetry() {
    if (this.connectionRetryInterval) clearInterval(this.connectionRetryInterval);
  }

  // =========================================================================
  // PACKET HANDLING
  // =========================================================================

  private handlePacket(packet: NetworkPacket, senderPeerId: string) {
    // Update my ID if I receive a packet and I don't know my ID yet (Trystero quirk workarounds)
    if (!this.me.id) {
       // Ideally we use getPeers, but for now we assume we are just valid if we receive data
       this.me.id = 'self'; // Placeholder, usually handled by store using proper ID if available
    }

    switch (packet.type) {
      case 'ANNOUNCE':
        this.handleAnnouncement(senderPeerId, packet.payload);
        break;
      case 'CONNECTION_REQ':
        this.handleConnectionReq(senderPeerId, packet.payload);
        break;
      case 'CONNECTION_ACK':
        this.handleConnectionAck(senderPeerId);
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

  /**
   * Parent receives REQ.
   * If accepted, adds child and sends ACK.
   */
  private handleConnectionReq(childPeerId: string, payload: AnnouncementPayload) {
    // If we are LEAF, we can't accept children (unless we upgrade? For now, ignore)
    if (this.me.role === NetworkRole.LEAF) {
      // Logic for auto-upgrade could go here, but keeping strict for now.
      // If I am connected to Root, I could become a branch.
      // Simplification: Only Root accepts connections initially, or existing Branches.
      return; 
    }

    if (!this.me.childrenIds.includes(childPeerId)) {
      console.log(`[Net] Accepting Child: ${childPeerId}`);
      this.me.childrenIds.push(childPeerId);
      this.onPeerUpdate({ ...this.me });
    }

    // Always send ACK, even if already added (idempotent)
    const ackPacket: NetworkPacket = {
      type: 'CONNECTION_ACK',
      senderId: this.getMyId()
    };
    const [sendPacket] = this.room!.makeAction('packet');
    sendPacket(ackPacket, childPeerId);
  }

  /**
   * Child receives ACK.
   * Connection confirmed.
   */
  private handleConnectionAck(parentId: string) {
    if (this.me.parentId === parentId) return; // Already done

    console.log(`[Net] Connection Confirmed with Parent: ${parentId}`);
    this.me.parentId = parentId;
    this.stopConnectionRetry();
    this.stopDiscovery();
    
    // If I connected to Root and I am not Root, check if I need to be a Branch
    if (parentId === this.rootPeerId && this.me.role !== NetworkRole.ROOT) {
       // Am I the first of my language? If so, become BRANCH.
       // This logic can be more complex, but let's assume if we connected to Root directly, we act as Branch.
       this.me.role = NetworkRole.BRANCH;
       this.startHeartbeat(); // Start advertising as Branch
    }

    this.onPeerUpdate({ ...this.me });
  }

  private handlePeerDisconnect(peerId: string) {
    // If Parent disconnects
    if (this.me.parentId === peerId) {
      console.warn('[Net] Parent lost. Restarting discovery.');
      this.me.parentId = null;
      this.startDiscoveryPhase();
      this.onPeerUpdate({ ...this.me });
    }

    // If Child disconnects
    if (this.me.childrenIds.includes(peerId)) {
      this.me.childrenIds = this.me.childrenIds.filter(id => id !== peerId);
      this.onPeerUpdate({ ...this.me });
    }

    if (this.rootPeerId === peerId) {
      this.rootPeerId = null;
    }
    
    this.potentialParents.delete(peerId);
  }

  // =========================================================================
  // AUDIO ROUTING
  // =========================================================================

  public broadcastAudio(audioPayload: AudioPayload) {
    if (!this.room) return;
    
    // Safety check: Do not send if isolated
    if (this.me.role === NetworkRole.LEAF && !this.me.parentId) {
      // console.warn('Cannot broadcast audio: No parent connected');
      return;
    }

    const packet: NetworkPacket = {
      type: 'AUDIO',
      senderId: this.getMyId(),
      payload: audioPayload
    };

    if (this.me.role === NetworkRole.LEAF && this.me.parentId) {
      this.sendDirect(packet, this.me.parentId);
    } 
    else if (this.me.role === NetworkRole.BRANCH) {
      if (this.me.parentId) this.sendDirect(packet, this.me.parentId);
      // Branch -> Children handled by LanguageBranchService usually, 
      // but if this is raw microphone audio from the Branch user itself:
      this.sendToChildren(packet);
    } 
    else if (this.me.role === NetworkRole.ROOT) {
      this.sendToChildren(packet);
    }
  }

  public broadcastToChildren(audioPayload: AudioPayload) {
    const packet: NetworkPacket = {
      type: 'AUDIO',
      senderId: audioPayload.senderId,
      payload: audioPayload
    };
    this.sendToChildren(packet);
  }

  private handleAudio(senderId: string, payload: AudioPayload) {
    // 1. Play locally
    this.onAudioReceived(payload);

    // 2. Routing Logic
    const packet: NetworkPacket = { type: 'AUDIO', senderId: payload.senderId, payload };

    if (this.me.role === NetworkRole.BRANCH) {
      // Upload: Leaf -> Branch -> Root
      if (this.me.childrenIds.includes(senderId) && this.me.parentId) {
        this.sendDirect(packet, this.me.parentId);
      }
      // Note: Download (Root -> Branch -> Leaf) is intercepted by LanguageBranchService for translation
    }
    else if (this.me.role === NetworkRole.ROOT) {
      // Hub: Forward to all other branches
      this.me.childrenIds.forEach(childId => {
        if (childId !== senderId) { 
          this.sendDirect(packet, childId);
        }
      });
    }
  }

  // --- Low Level Helpers ---

  private sendDirect(packet: NetworkPacket, targetId: string) {
    if (!this.room) return;
    try {
      const [sendPacket] = this.room.makeAction('packet');
      sendPacket(packet, targetId);
    } catch(e) {
      console.error('Send failed', e);
    }
  }

  private sendToChildren(packet: NetworkPacket) {
    if (!this.room) return;
    const [sendPacket] = this.room.makeAction('packet');
    this.me.childrenIds.forEach(childId => {
      // Trystero broadcast (sending to multiple targets loop or use broadcast if available)
      // makeAction without targetId broadcasts to all, but we want specific children?
      // Actually, Trystero broadcast goes to everyone in room. We should be careful to save bandwidth.
      // But for simplicity in this tree, we iterate.
      try {
        sendPacket(packet, childId);
      } catch (e) {
        console.error('Send child failed', e);
      }
    });
  }

  private getMyId(): string {
    // Trystero peer ID lookup or fallback
    return this.me.id || 'unknown-self';
  }
}
