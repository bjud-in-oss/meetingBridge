
import { joinRoom, Room } from 'trystero';
import { NetworkRole, Peer, AudioPayload, TranslationPayload } from '../types/schema';
import { LanguageBranchService } from './LanguageBranchService'; 

// Internal packet types
type PacketType = 'ANNOUNCE' | 'CONNECTION_REQ' | 'CONNECTION_ACK' | 'AUDIO' | 'TRANSLATION_DATA';

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
  private appId = 'p2p-translation-tree-v2';
  
  public me: Peer = {
    id: '',
    displayName: 'Anonymous',
    role: NetworkRole.LEAF,
    myLanguage: 'en-US',
    parentId: null,
    childrenIds: [],
    isMicLocked: false,
  };

  private potentialParents: Map<string, AnnouncementPayload> = new Map();
  private rootPeerId: string | null = null;
  
  private heartbeatInterval: any = null;
  private discoveryInterval: any = null;
  private connectionRetryInterval: any = null;

  // Callbacks
  public onAudioReceived: (payload: AudioPayload) => void = () => {};
  public onTranslationReceived: (payload: TranslationPayload) => void = () => {};
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

  public connect(roomId: string, displayName: string, language: string, forceRoot: boolean = false) {
    if (this.room) this.leave();
    this.room = joinRoom({ appId: this.appId }, roomId);
    this.me.displayName = displayName;
    this.me.myLanguage = language;
    this.me.childrenIds = [];
    this.me.parentId = null;
    this.me.role = forceRoot ? NetworkRole.ROOT : NetworkRole.LEAF;

    if (forceRoot) {
      this.me.id = 'ROOT-' + Math.random().toString(36).substr(2, 5); 
    }

    const [sendPacket, getPacket] = this.room.makeAction('packet');
    getPacket((packet: any, peerId: string) => {
      this.handlePacket(packet, peerId);
    });

    this.room.onPeerJoin((peerId) => {
      this.onRawPeerJoin(peerId);
      this.broadcastAnnouncement();
    });

    this.room.onPeerLeave((peerId) => {
      this.onRawPeerLeave(peerId);
      this.handlePeerDisconnect(peerId);
    });

    if (forceRoot) this.startHeartbeat();
    else this.startDiscoveryPhase();
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

  // --- HEARTBEAT & DISCOVERY ---
  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.me.role === NetworkRole.ROOT || this.me.role === NetworkRole.BRANCH) {
        this.broadcastAnnouncement();
      }
    }, 2000);
  }
  private stopHeartbeat() { if (this.heartbeatInterval) clearInterval(this.heartbeatInterval); }
  private broadcastAnnouncement() {
    if (!this.room) return;
    this.sendPacket({ type: 'ANNOUNCE', senderId: this.getMyId(), payload: { role: this.me.role, language: this.me.myLanguage } });
  }
  private startDiscoveryPhase() {
    this.me.parentId = null;
    this.potentialParents.clear();
    this.onPeerUpdate({ ...this.me });
    this.stopDiscovery();
    this.discoveryInterval = setInterval(() => {
        if (this.me.parentId) { this.stopDiscovery(); return; }
        this.evaluatePotentialParents();
    }, 1000);
  }
  private stopDiscovery() { if (this.discoveryInterval) clearInterval(this.discoveryInterval); }
  private evaluatePotentialParents() {
    let targetId: string | null = null;
    for (const [peerId, info] of this.potentialParents.entries()) {
      if (info.role === NetworkRole.BRANCH && info.language === this.me.myLanguage) { targetId = peerId; break; }
    }
    if (!targetId && this.rootPeerId) targetId = this.rootPeerId;
    if (targetId) { this.attemptConnection(targetId); this.stopDiscovery(); }
  }
  private attemptConnection(targetId: string) {
    this.stopConnectionRetry();
    const sendReq = () => {
        if (this.me.parentId === targetId) { this.stopConnectionRetry(); return; }
        this.sendPacket({ type: 'CONNECTION_REQ', senderId: this.getMyId(), payload: { role: this.me.role, language: this.me.myLanguage } }, targetId);
    };
    sendReq();
    this.connectionRetryInterval = setInterval(sendReq, 1000);
  }
  private stopConnectionRetry() { if (this.connectionRetryInterval) clearInterval(this.connectionRetryInterval); }

  // --- PACKET ROUTING ---

  private handlePacket(packet: NetworkPacket, senderPeerId: string) {
    if (!this.me.id) this.me.id = 'self';

    switch (packet.type) {
      case 'ANNOUNCE': this.handleAnnouncement(senderPeerId, packet.payload); break;
      case 'CONNECTION_REQ': this.handleConnectionReq(senderPeerId, packet.payload); break;
      case 'CONNECTION_ACK': this.handleConnectionAck(senderPeerId); break;
      case 'AUDIO': this.handleAudio(senderPeerId, packet.payload); break;
      case 'TRANSLATION_DATA': this.handleTranslationData(packet.payload); break;
    }
  }

  // --- HANDLERS ---
  private handleAnnouncement(peerId: string, payload: AnnouncementPayload) {
    this.potentialParents.set(peerId, payload);
    if (payload.role === NetworkRole.ROOT) this.rootPeerId = peerId;
  }
  private handleConnectionReq(childPeerId: string, payload: AnnouncementPayload) {
    if (this.me.role === NetworkRole.LEAF) return;
    if (!this.me.childrenIds.includes(childPeerId)) {
      this.me.childrenIds.push(childPeerId);
      this.onPeerUpdate({ ...this.me });
    }
    this.sendPacket({ type: 'CONNECTION_ACK', senderId: this.getMyId() }, childPeerId);
  }
  private handleConnectionAck(parentId: string) {
    if (this.me.parentId === parentId) return;
    this.me.parentId = parentId;
    this.stopConnectionRetry();
    this.stopDiscovery();
    if (parentId === this.rootPeerId && this.me.role !== NetworkRole.ROOT) {
       this.me.role = NetworkRole.BRANCH;
       this.startHeartbeat();
    }
    this.onPeerUpdate({ ...this.me });
  }
  private handlePeerDisconnect(peerId: string) {
    if (this.me.parentId === peerId) { this.me.parentId = null; this.startDiscoveryPhase(); this.onPeerUpdate({ ...this.me }); }
    if (this.me.childrenIds.includes(peerId)) { this.me.childrenIds = this.me.childrenIds.filter(id => id !== peerId); this.onPeerUpdate({ ...this.me }); }
    if (this.rootPeerId === peerId) this.rootPeerId = null;
    this.potentialParents.delete(peerId);
  }

  // --- AUDIO & TRANSLATION ROUTING ---

  public broadcastAudio(payload: AudioPayload) {
      this.routeData('AUDIO', payload);
  }

  public broadcastTranslation(payload: TranslationPayload) {
      // 1. Send to network
      this.routeData('TRANSLATION_DATA', payload);
      
      // 2. IMPORTANT: Echo back to myself so I see the transcript too
      this.onTranslationReceived(payload);
  }

  private routeData(type: PacketType, payload: any) {
     const packet: NetworkPacket = { type, senderId: this.getMyId(), payload };
     
     if (this.me.role === NetworkRole.LEAF && this.me.parentId) {
         this.sendPacket(packet, this.me.parentId);
     } else if (this.me.role === NetworkRole.BRANCH || this.me.role === NetworkRole.ROOT) {
         this.me.childrenIds.forEach(id => this.sendPacket(packet, id));
     }
  }

  private handleAudio(senderId: string, payload: AudioPayload) {
      this.onAudioReceived(payload);
  }

  private handleTranslationData(payload: TranslationPayload) {
      // 1. Process locally (Text-to-Speech via BranchService happens via callback)
      this.onTranslationReceived(payload);

      // 2. Forward Downstream if Branch
      if (this.me.role === NetworkRole.BRANCH || this.me.role === NetworkRole.ROOT) {
          this.routeData('TRANSLATION_DATA', payload);
      }
  }

  // --- HELPERS ---
  private sendPacket(packet: NetworkPacket, targetId?: string) {
    if (!this.room) return;
    const [send] = this.room.makeAction('packet');
    try {
        if (targetId) send(packet, targetId);
        else send(packet); // Broadcast
    } catch(e) {}
  }

  private getMyId(): string { return this.me.id || 'unknown-self'; }
}
