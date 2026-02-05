document.addEventListener('DOMContentLoaded', () => {
    const visualizerToggle = document.getElementById('visualizerToggle');
    const debugToggle = document.getElementById('debugToggle');
    const exportBtn = document.getElementById('exportBtn');
    const importBtn = document.getElementById('importBtn');
    const fileInput = document.getElementById('fileInput');
    const statusMessage = document.getElementById('statusMessage');

    // Load current visualizer setting (default to true)
    chrome.storage.sync.get(['timestampVisualizerEnabled'], (result) => {
        const isVisualizerEnabled = result.timestampVisualizerEnabled !== false;
        updateToggleUI(visualizerToggle, isVisualizerEnabled);
    });

    // Load current debug setting
    chrome.storage.sync.get(['debugLogging'], (result) => {
        const isDebugEnabled = result.debugLogging || false;
        updateToggleUI(debugToggle, isDebugEnabled);
    });

    // Toggle visualizer
    visualizerToggle.addEventListener('click', () => {
        chrome.storage.sync.get(['timestampVisualizerEnabled'], (result) => {
            const newState = result.timestampVisualizerEnabled !== false ? false : true;
            chrome.storage.sync.set({ timestampVisualizerEnabled: newState }, () => {
                updateToggleUI(visualizerToggle, newState);
            });
        });
    });

    // Toggle debug logging
    debugToggle.addEventListener('click', () => {
        chrome.storage.sync.get(['debugLogging'], (result) => {
            const newState = !result.debugLogging;
            chrome.storage.sync.set({ debugLogging: newState }, () => {
                updateToggleUI(debugToggle, newState);
            });
        });
    });

    // Export timestamps
    exportBtn.addEventListener('click', () => {
        chrome.storage.local.get(['timestamps'], (result) => {
            const timestamps = result.timestamps || {};
            const exportData = {
                exportDate: new Date().toISOString(),
                timestamps: timestamps
            };
            
            const dataStr = JSON.stringify(exportData, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(dataBlob);
            
            const link = document.createElement('a');
            link.href = url;
            link.download = `kick-vod-timestamps-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            
            showStatus('✓ Timestamps exported successfully!', 'success');
        });
    });

    // Import timestamps
    importBtn.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importedData = JSON.parse(e.target.result);
                const timestamps = importedData.timestamps || {};
                
                if (Object.keys(timestamps).length === 0) {
                    showStatus('⚠ No timestamps found in file', 'error');
                    return;
                }

                // Merge with existing timestamps
                chrome.storage.local.get(['timestamps'], (result) => {
                    const existingTimestamps = result.timestamps || {};
                    const mergedTimestamps = { ...existingTimestamps, ...timestamps };
                    
                    chrome.storage.local.set({ timestamps: mergedTimestamps }, () => {
                        const count = Object.keys(timestamps).length;
                        showStatus(`✓ Imported ${count} VOD(s)!`, 'success');
                    });
                });
            } catch (error) {
                showStatus('✗ Invalid file format', 'error');
                console.error('Import error:', error);
            }
        };
        reader.readAsText(file);
        
        // Reset file input
        event.target.value = '';
    });

    function updateToggleUI(toggleElement, isEnabled) {
        if (isEnabled) {
            toggleElement.classList.add('enabled');
        } else {
            toggleElement.classList.remove('enabled');
        }
    }

    function showStatus(message, type) {
        statusMessage.textContent = message;
        statusMessage.className = `status-message ${type}`;
        setTimeout(() => {
            statusMessage.className = 'status-message';
        }, 3000);
    }
});
