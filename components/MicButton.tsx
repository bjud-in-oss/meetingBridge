
import React, { useEffect, useState } from 'react';

interface MicButtonProps {
  isActive: boolean;
  onClick: () => void;
  volumeLevel: number; // 0 to 100
}

export const MicButton: React.FC<MicButtonProps> = ({ isActive, onClick, volumeLevel }) => {
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
  const baseScale = 1;
  const pulseScale = 1 + (visualVol / 100) * 0.5; // Up to 1.5x scale
  
  const auraColor = isActive ? 'rgba(52, 199, 89, 0.4)' : 'rgba(0,0,0,0)';
  const mainColor = isActive ? '#34c759' : '#ff3b30';

  return (
    <div style={{ position: 'relative', width: '100px', height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Outer Aura (Echo) */}
      <div style={{
        position: 'absolute',
        width: '100%',
        height: '100%',
        borderRadius: '50%',
        background: auraColor,
        transform: `scale(${pulseScale * 1.2})`,
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
        transform: `scale(${pulseScale})`,
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
        {isActive ? '🎙' : '✕'}
      </button>
    </div>
  );
};
