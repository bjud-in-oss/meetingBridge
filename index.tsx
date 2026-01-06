
import React from 'react';
import { createRoot } from 'react-dom/client';
import { NetworkRole } from './types/schema';

const App = () => {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: '800px', margin: '0 auto' }}>
      <h1>P2P Translation App</h1>
      <div style={{ background: '#f5f5f5', padding: '1.5rem', borderRadius: '8px', border: '1px solid #ddd' }}>
        <h2>System Architecture: Bidirectional Tree</h2>
        <p>Initializing new topology structure...</p>
        <ul style={{ lineHeight: '1.6' }}>
          <li><strong>{NetworkRole.ROOT}</strong>: Meeting Host (Hub)</li>
          <li><strong>{NetworkRole.BRANCH}</strong>: Language Host (Translator/Relay)</li>
          <li><strong>{NetworkRole.LEAF}</strong>: Regular User (Participant)</li>
        </ul>
        <div style={{ marginTop: '1rem', padding: '0.5rem', background: '#e0e0e0', borderRadius: '4px', fontSize: '0.9em' }}>
          <code>src/types/schema.ts</code> loaded successfully.
        </div>
      </div>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
