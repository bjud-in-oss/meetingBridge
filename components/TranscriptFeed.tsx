
import React, { useEffect, useRef } from 'react';
import { useMeetingStore } from '../stores/useMeetingStore';

export const TranscriptFeed = () => {
  const transcripts = useMeetingStore(state => state.transcripts);
  const myId = useMeetingStore(state => state.treeState?.id);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: '1rem',
      background: '#f8f9fa',
      borderRadius: '12px',
      margin: '1rem 0',
      border: '1px solid #e9ecef',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.75rem',
      height: '300px' // fallback
    }}>
      {transcripts.length === 0 && (
        <div style={{ textAlign: 'center', color: '#adb5bd', marginTop: '2rem' }}>
          No speech detected yet...
        </div>
      )}
      
      {transcripts.map((msg, idx) => {
        const isMe = msg.senderId === myId || msg.senderId === 'self';
        const isTranslator = msg.senderId.startsWith('translator-');
        
        return (
          <div key={idx} style={{
            alignSelf: isMe ? 'flex-end' : 'flex-start',
            maxWidth: '80%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: isMe ? 'flex-end' : 'flex-start'
          }}>
            {!isMe && (
              <span style={{ fontSize: '0.75rem', color: '#6c757d', marginBottom: '2px', marginLeft: '4px' }}>
                {isTranslator ? 'Interpreter' : msg.senderId.substring(0, 6)}
              </span>
            )}
            <div style={{
              background: isMe ? '#007AFF' : (isTranslator ? '#FF9500' : 'white'),
              color: isMe ? 'white' : (isTranslator ? 'white' : '#212529'),
              padding: '0.75rem 1rem',
              borderRadius: '12px',
              borderBottomRightRadius: isMe ? '2px' : '12px',
              borderBottomLeftRadius: isMe ? '12px' : '2px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
              fontSize: '1rem',
              lineHeight: '1.4'
            }}>
              {msg.text}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
};
