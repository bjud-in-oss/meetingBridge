
import React, { useState } from 'react';
import { useMeetingStore } from './stores/useMeetingStore';
import { LoginScreen } from './components/LoginScreen';
import { TreeVisualizer } from './components/TreeVisualizer';
import { TranscriptFeed } from './components/TranscriptFeed';
import { MicButton } from './components/MicButton';
import { AudioSettings } from './components/AudioSettings';
import { NetworkRole } from './types/schema';

export const App = () => {
  const connectionStatus = useMeetingStore(state => state.connectionStatus);
  const isMicOn = useMeetingStore(state => state.isMicOn);
  const volumeLevel = useMeetingStore(state => state.volumeLevel);
  const toggleMic = useMeetingStore(state => state.toggleMic);
  const leaveMeeting = useMeetingStore(state => state.leaveMeeting);
  const treeState = useMeetingStore(state => state.treeState);

  const [showDebug, setShowDebug] = useState(false);

  if (connectionStatus === 'IDLE' || connectionStatus === 'CONNECTING') {
    if (connectionStatus === 'CONNECTING') {
      return (
        <div style={{ 
          height: '100vh', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          fontFamily: 'system-ui' 
        }}>
          <h2>Connecting to Tree Network...</h2>
        </div>
      );
    }
    return <LoginScreen />;
  }

  // Determine Role Mode
  const isListener = treeState?.role === NetworkRole.LEAF;
  const buttonMode = isListener ? 'SPEAKER' : 'MIC';
  
  const getStatusText = () => {
    if (isListener) {
      return isMicOn ? 'Receiving Audio & Translating...' : 'Tap to Join Audio Stream';
    }
    return isMicOn ? 'Listening & Analyzing...' : 'Tap to Start Speaking';
  };

  return (
    <div style={{ 
      fontFamily: 'system-ui, -apple-system, sans-serif', 
      maxWidth: '600px', 
      margin: '0 auto', 
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'white'
    }}>
      {/* HEADER */}
      <header style={{ 
        padding: '1rem', 
        borderBottom: '1px solid #eee', 
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'center',
        background: '#fff'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.2rem' }}>🌳 Translator</h1>
          <span style={{ 
              background: '#e3f2fd', 
              color: '#0d47a1', 
              padding: '2px 8px', 
              borderRadius: '12px',
              fontSize: '0.75rem'
            }}>
            {treeState?.myLanguage}
          </span>
          <span style={{ 
              background: '#f5f5f5', 
              color: '#666', 
              padding: '2px 8px', 
              borderRadius: '12px',
              fontSize: '0.75rem',
              marginLeft: '4px'
            }}>
            {treeState?.role}
          </span>
        </div>
        
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button 
            onClick={() => setShowDebug(!showDebug)}
            style={{
              background: showDebug ? '#e3f2fd' : 'none',
              border: '1px solid #ddd',
              color: showDebug ? '#0d47a1' : '#666',
              padding: '0.4rem 0.8rem',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.8rem'
            }}
          >
            Settings
          </button>
          <button 
            onClick={leaveMeeting}
            style={{
              background: 'none',
              border: '1px solid #ff3b30',
              color: '#ff3b30',
              padding: '0.4rem 0.8rem',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.8rem'
            }}
          >
            Exit
          </button>
        </div>
      </header>

      <main style={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        padding: '1rem',
        overflow: 'hidden',
        position: 'relative'
      }}>
        
        {showDebug && (
          <div style={{ 
            marginBottom: '1rem', 
            flexShrink: 0, 
            maxHeight: '40vh', 
            overflowY: 'auto',
            borderBottom: '1px solid #eee',
            paddingBottom: '1rem'
          }}>
             <AudioSettings />
             <div style={{ marginTop: '1rem' }}>
                <TreeVisualizer />
             </div>
          </div>
        )}

        <TranscriptFeed />

        {/* BOTTOM CONTROLS */}
        <div style={{
          marginTop: 'auto',
          display: 'flex',
          justifyContent: 'center',
          paddingTop: '1rem',
          flexDirection: 'column',
          alignItems: 'center'
        }}>
          <MicButton 
            isActive={isMicOn}
            onClick={toggleMic}
            volumeLevel={volumeLevel}
            mode={buttonMode}
          />
          <div style={{ marginTop: '1rem', color: '#999', fontSize: '0.9rem', fontWeight: 500 }}>
             {getStatusText()}
          </div>
        </div>
      </main>
    </div>
  );
};
