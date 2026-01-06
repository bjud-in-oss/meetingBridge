
import React, { useEffect, useState } from 'react';

interface MicButtonProps {
  isActive: boolean;
  onClick: () => void;
  volumeLevel: number; // 0 to 100
  mode?: 'MIC' | 'SPEAKER';
}

export const MicButton: React.FC<MicButtonProps> = ({ isActive, onClick, volumeLevel, mode = 'MIC' }) => {
  // Smooth out volume for animation
  const [visualVol, setVisualVol] = useState(0);

  useEffect(() => {
    let animationFrame: number;
    const animate = () => {
      // Simple easing
      setVisualVol(prev => prev + (volumeLevel - prev) * 0.2);
      animationFrame = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(animationFrame);
  }, [volumeLevel]);

  // Calculate scales based on volume
  // In Speaker mode, we might not have volume level inputs from the system easily, 
  // so we might just pulse slightly if active or use the same logic if volume data is routed.
  const pulseScale = 1 + (visualVol / 100) * 0.5; 
  
  // Visual Config
  let mainColor, auraColor, icon;

  if (mode === 'MIC') {
    mainColor = isActive ? '#34c759' : '#ff3b30'; // Green : Red
    auraColor = isActive ? 'rgba(52, 199, 89, 0.4)' : 'rgba(255, 59, 48, 0.1)';
    icon = isActive ? '🎙' : '✕';
  } else {
    // SPEAKER MODE
    mainColor = isActive ? '#007AFF' : '#8E8E93'; // Blue : Gray
    auraColor = isActive ? 'rgba(0, 122, 255, 0.4)' : 'rgba(0,0,0,0)';
    icon = isActive ? '🔊' : '🔈';
  }

  return (
    <div style={{ position: 'relative', width: '100px', height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Outer Aura (Echo) */}
      <div style={{
        position: 'absolute',
        width: '100%',
        height: '100%',
        borderRadius: '50%',
        background: auraColor,
        transform: `scale(${isActive ? pulseScale * 1.2 : 1})`,
        transition: 'transform 0.1s linear, background 0.3s',
        opacity: isActive ? 0.6 : 0
      }} />

      {/* Inner Aura */}
      <div style={{
        position: 'absolute',
        width: '100%',
        height: '100%',
        borderRadius: '50%',
        background: auraColor,
        transform: `scale(${isActive ? pulseScale : 1})`,
        transition: 'transform 0.1s linear, background 0.3s',
      }} />

      {/* Button Core */}
      <button
        onClick={onClick}
        style={{
          position: 'relative',
          width: '80px',
          height: '80px',
          borderRadius: '50%',
          background: mainColor,
          border: '4px solid white',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '2rem',
          color: 'white',
          outline: 'none',
          zIndex: 10,
          transition: 'background 0.3s'
        }}
      >
        {icon}
      </button>
    </div>
  );
};
