
import React, { useState } from 'react';
import { useMeetingStore } from './stores/useMeetingStore';
import { LoginScreen } from './components/LoginScreen';
import { TreeVisualizer } from './components/TreeVisualizer';
import { TranscriptFeed } from './components/TranscriptFeed';
import { MicButton } from './components/MicButton';

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
        </div>
        
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button 
            onClick={() => setShowDebug(!showDebug)}
            style={{
              background: 'none',
              border: '1px solid #ddd',
              color: '#666',
              padding: '0.4rem 0.8rem',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.8rem'
            }}
          >
            {showDebug ? 'Hide Info' : 'Info'}
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
          <div style={{ marginBottom: '1rem', flexShrink: 0 }}>
             <TreeVisualizer />
          </div>
        )}

        <TranscriptFeed />

        {/* BOTTOM CONTROLS */}
        <div style={{
          marginTop: 'auto',
          display: 'flex',
          justifyContent: 'center',
          paddingTop: '1rem'
        }}>
          <MicButton 
            isActive={isMicOn}
            onClick={toggleMic}
            volumeLevel={volumeLevel}
          />
        </div>
        
        <div style={{ textAlign: 'center', marginTop: '1rem', color: '#999', fontSize: '0.8rem' }}>
           {isMicOn ? 'Listening...' : 'Tap to speak'}
        </div>
      </main>
    </div>
  );
};
