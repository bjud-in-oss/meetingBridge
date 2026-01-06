
import React, { useEffect, useState } from 'react';
import { useMeetingStore } from '../stores/useMeetingStore';
import { AudioService } from '../services/AudioService';
import { AudioDevice } from '../types/schema';

export const AudioSettings = () => {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  
  // Use a safer selector pattern
  const audioSettings = useMeetingStore(state => state.audioSettings);
  const updateAudioSettings = useMeetingStore(state => state.updateAudioSettings);

  useEffect(() => {
    // Safety call
    AudioService.getInstance().getDevices().then(setDevices);
  }, []);

  const handleDeviceChange = (kind: 'input' | 'output', deviceId: string) => {
    updateAudioSettings({
        [kind === 'input' ? 'inputDeviceId' : 'outputDeviceId']: deviceId
    });
    
    if (kind === 'input') AudioService.getInstance().setInputDevice(deviceId);
    else AudioService.getInstance().setOutputDevice(deviceId);
  };

  const handleExternalChange = (key: string, value: any) => {
    if (!audioSettings) return;
    const newSettings = { ...audioSettings, [key]: value };
    updateAudioSettings(newSettings);
    
    // Apply changes immediately
    AudioService.getInstance().configureExternalIO(
        newSettings.useExternalInput, newSettings.externalInputUrl,
        newSettings.useExternalOutput, newSettings.externalOutputUrl
    );
  };

  const inputs = devices.filter(d => d.kind === 'audioinput');
  const outputs = devices.filter(d => d.kind === 'audiooutput');

  if (!audioSettings) return <div>Loading Settings...</div>;

  return (
    <div style={{
        background: '#fff',
        padding: '1rem',
        borderRadius: '8px',
        border: '1px solid #ddd',
        marginBottom: '1rem'
    }}>
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Audio I/O Configuration</h3>
        
        {/* INPUT SECTION */}
        <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 'bold', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Microphone Source</div>
            
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <button 
                    onClick={() => handleExternalChange('useExternalInput', false)}
                    style={{ 
                        flex: 1, padding: '0.5rem', cursor: 'pointer',
                        background: !audioSettings.useExternalInput ? '#007AFF' : '#eee',
                        color: !audioSettings.useExternalInput ? 'white' : '#333',
                        border: 'none', borderRadius: '4px'
                    }}
                >
                    Hardware Mic
                </button>
                <button 
                    onClick={() => handleExternalChange('useExternalInput', true)}
                    style={{ 
                        flex: 1, padding: '0.5rem', cursor: 'pointer',
                        background: audioSettings.useExternalInput ? '#007AFF' : '#eee',
                        color: audioSettings.useExternalInput ? 'white' : '#333',
                        border: 'none', borderRadius: '4px'
                    }}
                >
                    WebSocket Stream
                </button>
            </div>

            {!audioSettings.useExternalInput ? (
                <select 
                    value={audioSettings.inputDeviceId} 
                    onChange={(e) => handleDeviceChange('input', e.target.value)}
                    style={{ width: '100%', padding: '0.5rem' }}
                >
                    <option value="default">Default Microphone</option>
                    {inputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
                </select>
            ) : (
                <input 
                    type="text" 
                    value={audioSettings.externalInputUrl}
                    onChange={(e) => handleExternalChange('externalInputUrl', e.target.value)}
                    placeholder="ws://localhost:8080/input"
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px' }}
                />
            )}
        </div>

        {/* OUTPUT SECTION */}
        <div>
            <div style={{ fontWeight: 'bold', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Audio Output</div>
            
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <button 
                    onClick={() => handleExternalChange('useExternalOutput', false)}
                    style={{ 
                        flex: 1, padding: '0.5rem', cursor: 'pointer',
                        background: !audioSettings.useExternalOutput ? '#34c759' : '#eee',
                        color: !audioSettings.useExternalOutput ? 'white' : '#333',
                        border: 'none', borderRadius: '4px'
                    }}
                >
                    Speaker
                </button>
                <button 
                    onClick={() => handleExternalChange('useExternalOutput', true)}
                    style={{ 
                        flex: 1, padding: '0.5rem', cursor: 'pointer',
                        background: audioSettings.useExternalOutput ? '#34c759' : '#eee',
                        color: audioSettings.useExternalOutput ? 'white' : '#333',
                        border: 'none', borderRadius: '4px'
                    }}
                >
                    WebSocket Send
                </button>
            </div>

            {!audioSettings.useExternalOutput ? (
                <select 
                    value={audioSettings.outputDeviceId} 
                    onChange={(e) => handleDeviceChange('output', e.target.value)}
                    style={{ width: '100%', padding: '0.5rem' }}
                >
                    <option value="default">Default Speaker</option>
                    {outputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
                </select>
            ) : (
                <input 
                    type="text" 
                    value={audioSettings.externalOutputUrl}
                    onChange={(e) => handleExternalChange('externalOutputUrl', e.target.value)}
                    placeholder="ws://localhost:8080/output"
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px' }}
                />
            )}
        </div>
    </div>
  );
};
