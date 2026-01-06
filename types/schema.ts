
export enum NetworkRole {
  ROOT = 'ROOT',
  BRANCH = 'BRANCH',
  LEAF = 'LEAF',
}

export type MeetingMode = 'OPEN_CLASSROOM' | 'LECTURE_ONLY';

export interface Peer {
  id: string;
  displayName: string;
  role: NetworkRole;
  /** The language code this peer speaks/listens to (e.g., 'sv-SE', 'es-ES') */
  myLanguage: string;
  /** The ID of the upstream node (Branch or Root) this peer sends audio TO. Null if Root. */
  parentId: string | null;
  /** The IDs of downstream nodes (Branches or Leaves) this peer sends audio DOWN to. */
  childrenIds: string[];
  /** If true, this peer is prevented from broadcasting audio (Sermon Mode) */
  isMicLocked: boolean;
}

export interface AudioPayload {
  /** ID of the original speaker */
  senderId: string;
  /** Language code of the original audio */
  originLanguage: string;
  /** Language code of the audioData. If isTranslation is false, matches originLanguage. */
  targetLanguage: string;
  /** Base64 encoded Opus audio data */
  audioData: string;
  /** Whether this payload contains translated audio or original source audio */
  isTranslation: boolean;
  /** Optional transcript of the audio chunk */
  transcript?: string;
  /** Indicates if this transcript segment is finalized */
  isFinal?: boolean;
}

export interface MeetingState {
  meetingMode: MeetingMode;
  /** The ID of the Root node (Meeting Host) */
  rootId: string;
}
