
import React from 'react';
import { useMeetingStore } from './stores/useMeetingStore';
import { LoginScreen } from './components/LoginScreen';
import { TreeVisualizer } from './components/TreeVisualizer';
import { NetworkRole } from './types/schema';

export const App = () => {
  const connectionStatus = useMeetingStore(state => state.connectionStatus);
  const isMicOn = useMeetingStore(state => state.isMicOn);
  const toggleMic = useMeetingStore(state => state.toggleMic);
  const leaveMeeting = useMeetingStore(state => state.leaveMeeting);
  const treeState = useMeetingStore(state => state.treeState);

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
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: '800px', margin: '0 auto', paddingBottom: '100px' }}>
      {/* HEADER */}
      <header style={{ 
        padding: '1rem 2rem', 
        borderBottom: '1px solid #eee', 
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h1 style={{ margin: 0, fontSize: '1.2rem' }}>🌳 P2P Translator</h1>
        <button 
          onClick={leaveMeeting}
          style={{
            background: 'none',
            border: '1px solid #ff3b30',
            color: '#ff3b30',
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Disconnect
        </button>
      </header>

      <main style={{ padding: '2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <span style={{ 
            background: '#e3f2fd', 
            color: '#0d47a1', 
            padding: '4px 12px', 
            borderRadius: '16px',
            fontSize: '0.9rem'
          }}>
            {treeState?.myLanguage}
          </span>
        </div>

        <TreeVisualizer />
      </main>

      {/* FOOTER CONTROLS */}
      <footer style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'white',
        borderTop: '1px solid #ddd',
        padding: '1.5rem',
        display: 'flex',
        justifyContent: 'center',
        boxShadow: '0 -4px 20px rgba(0,0,0,0.05)'
      }}>
        <button
          onClick={toggleMic}
          style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: isMicOn ? '#ff3b30' : '#34c759',
            border: '4px solid white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '2rem',
            color: 'white',
            transition: 'all 0.2s',
            transform: isMicOn ? 'scale(1.1)' : 'scale(1)'
          }}
        >
          {isMicOn ? '⏹' : '🎙'}
        </button>
      </footer>
    </div>
  );
};
