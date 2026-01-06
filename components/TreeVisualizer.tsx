
import React from 'react';
import { useMeetingStore } from '../stores/useMeetingStore';
import { NetworkRole } from '../types/schema';

export const TreeVisualizer = () => {
  const treeState = useMeetingStore(state => state.treeState);
  const peers = useMeetingStore(state => state.peers);

  if (!treeState) return <div>Loading Topology...</div>;

  const getRoleColor = (role: NetworkRole) => {
    switch (role) {
      case NetworkRole.ROOT: return '#9C27B0'; // Purple
      case NetworkRole.BRANCH: return '#FF9800'; // Orange
      case NetworkRole.LEAF: return '#4CAF50'; // Green
      default: return '#9E9E9E';
    }
  };

  const NodeCard = ({ label, id, role, isMe = false }: { label: string, id: string | null, role?: NetworkRole, isMe?: boolean }) => (
    <div style={{
      border: `2px solid ${isMe ? '#007AFF' : '#eee'}`,
      background: role ? getRoleColor(role) + '15' : '#f9f9f9', // 15 = low opacity hex
      padding: '1rem',
      borderRadius: '8px',
      textAlign: 'center',
      minWidth: '200px',
      marginBottom: '1rem'
    }}>
      <div style={{ fontSize: '0.8rem', color: '#666', textTransform: 'uppercase', letterSpacing: '1px' }}>{label}</div>
      <div style={{ fontWeight: 'bold', fontSize: '1.1rem', margin: '0.25rem 0' }}>
        {id ? id.substring(0, 8) : 'Not Connected'}
      </div>
      {role && (
        <span style={{ 
          background: getRoleColor(role), 
          color: 'white', 
          padding: '2px 8px', 
          borderRadius: '12px', 
          fontSize: '0.75rem' 
        }}>
          {role}
        </span>
      )}
    </div>
  );

  return (
    <div style={{ width: '100%', maxWidth: '600px', margin: '0 auto' }}>
      <h3 style={{ textAlign: 'center', color: '#444' }}>Topology View</h3>
      
      {/* PARENT SECTION */}
      <div style={{ display: 'flex', justifyContent: 'center', opacity: treeState.parentId ? 1 : 0.5 }}>
        <NodeCard 
          label="Upstream Parent" 
          id={treeState.parentId || "No Parent (Root)"} 
          role={undefined} // We don't know parent's role easily without looking it up, keeping simple
        />
      </div>

      <div style={{ textAlign: 'center', fontSize: '1.5rem', color: '#ccc' }}>
        {treeState.parentId ? '⬆' : '⭐'}
      </div>

      {/* ME SECTION */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <NodeCard 
          label="Me" 
          id={treeState.id} 
          role={treeState.role} 
          isMe={true} 
        />
      </div>

      <div style={{ textAlign: 'center', fontSize: '1.5rem', color: '#ccc' }}>⬇</div>

      {/* CHILDREN SECTION */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        gap: '1rem', 
        flexWrap: 'wrap',
        background: '#f5f5f5',
        padding: '1rem',
        borderRadius: '8px',
        minHeight: '100px'
      }}>
        {treeState.childrenIds.length === 0 ? (
          <div style={{ color: '#999', fontStyle: 'italic', alignSelf: 'center' }}>No Downstream Connections</div>
        ) : (
          treeState.childrenIds.map(childId => (
            <div key={childId} style={{ 
              background: 'white', 
              padding: '0.5rem 1rem', 
              borderRadius: '6px', 
              border: '1px solid #ddd',
              boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
            }}>
              Customer: {childId.substring(0, 6)}...
            </div>
          ))
        )}
      </div>

      <div style={{ marginTop: '2rem', fontSize: '0.9rem', color: '#666', textAlign: 'center' }}>
        Total Peers in Room: {peers.length + 1} (including you)
      </div>
    </div>
  );
};
