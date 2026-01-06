
export enum NetworkRole {
  ROOT = 'ROOT',
  BRANCH = 'BRANCH',
  LEAF = 'LEAF',
}

export type MeetingMode = 'OPEN_CLASSROOM' | 'LECTURE_ONLY' | 'TEXT_DISTRIBUTION_MODE';

export interface Peer {
  id: string;
  displayName: string;
  role: NetworkRole;
  myLanguage: string;
  parentId: string | null;
  childrenIds: string[];
  isMicLocked: boolean;
}

export interface ProsodyMetadata {
  emotion: 'Neutral' | 'Excited' | 'Solemn' | 'Urgent' | 'Happy';
  speed: number; // 0.5 to 2.0
}

/**
 * The new rich payload for Text Distribution Mode.
 * Replaces raw AudioPayload for the primary communication channel.
 */
export interface TranslationPayload {
  type: 'TRANSLATION_DATA';
  text: string;
  senderId: string; // The origin Peer ID or "ROOT"
  speakerLabel: string; // "Speaker A", "Speaker B", or specific name
  prosody: ProsodyMetadata;
  targetLanguage: string;
  isFinal: boolean;
}

/** Legacy/Fallback for raw audio */
export interface AudioPayload {
  senderId: string;
  originLanguage: string;
  targetLanguage: string;
  audioData: string;
  isTranslation: boolean;
  transcript?: string;
  isFinal?: boolean;
}

export interface MeetingState {
  meetingMode: MeetingMode;
  rootId: string;
}

// --- Audio I/O Types ---

export interface AudioDevice {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
}

export interface AudioSettingsState {
  inputDeviceId: string; // 'default' or specific ID
  outputDeviceId: string; // 'default' or specific ID
  
  useExternalInput: boolean; // If true, listen to WebSocket instead of Mic
  externalInputUrl: string;
  
  useExternalOutput: boolean; // If true, send translation audio to WebSocket
  externalOutputUrl: string;
}
