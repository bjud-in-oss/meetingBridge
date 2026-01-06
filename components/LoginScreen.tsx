
import React, { useState } from 'react';
import { useMeetingStore } from '../stores/useMeetingStore';

const LANGUAGES = [
  { code: 'en-US', name: 'English' },
  { code: 'sv-SE', name: 'Svenska' },
  { code: 'es-ES', name: 'Español' },
  { code: 'fr-FR', name: 'Français' },
  { code: 'de-DE', name: 'Deutsch' },
  { code: 'ja-JP', name: 'Japanese' },
];

export const LoginScreen = () => {
  const joinMeeting = useMeetingStore(state => state.joinMeeting);
  
  const [name, setName] = useState('');
  const [lang, setLang] = useState('en-US');
  const [isHost, setIsHost] = useState(false);
  const [roomId] = useState('global-tree-room-v1');

  const handleJoin = () => {
    if (!name.trim()) return;
    joinMeeting(roomId, name, lang, isHost);
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#f0f2f5',
      fontFamily: 'system-ui, sans-serif'
    }}>
      <div style={{
        background: 'white',
        padding: '2rem',
        borderRadius: '16px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
        width: '100%',
        maxWidth: '400px'
      }}>
        <h1 style={{ textAlign: 'center', marginBottom: '1.5rem', color: '#1a1a1a' }}>Join Translation Tree</h1>
        
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Display Name</label>
          <input 
            type="text" 
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            style={{
              width: '100%',
              padding: '0.75rem',
              borderRadius: '8px',
              border: '1px solid #ddd',
              fontSize: '1rem',
              boxSizing: 'border-box'
            }}
          />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Your Language</label>
          <select 
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            style={{
              width: '100%',
              padding: '0.75rem',
              borderRadius: '8px',
              border: '1px solid #ddd',
              fontSize: '1rem',
              backgroundColor: 'white',
              boxSizing: 'border-box'
            }}
          >
            {LANGUAGES.map(l => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input 
            type="checkbox" 
            id="hostToggle"
            checked={isHost}
            onChange={(e) => setIsHost(e.target.checked)}
            style={{ width: '1.2rem', height: '1.2rem' }}
          />
          <label htmlFor="hostToggle" style={{ cursor: 'pointer', userSelect: 'none' }}>
            Start as Meeting Host (ROOT)
          </label>
        </div>

        <button 
          onClick={handleJoin}
          disabled={!name}
          style={{
            width: '100%',
            padding: '1rem',
            background: name ? '#007AFF' : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '1.1rem',
            fontWeight: 600,
            cursor: name ? 'pointer' : 'not-allowed',
            transition: 'background 0.2s'
          }}
        >
          Connect
        </button>
      </div>
    </div>
  );
};
