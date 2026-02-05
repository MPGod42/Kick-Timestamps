function timestampVisualizerFunction()
{
    // Initialize debug logging
    let debugLogging = false;
    
    // Load debug setting
    chrome.storage.sync.get(['debugLogging'], (result) => {
        debugLogging = result.debugLogging || false;
    });

    // Check if visualizer is enabled (default to true)
    chrome.storage.sync.get(['timestampVisualizerEnabled'], (result) => {
        if (result.timestampVisualizerEnabled === false) {
            debugLog("[Timestamp Visualizer] Visualizer is disabled, aborting");
            return;
        }
        
        debugLog("[Timestamp Visualizer] Visualizer is enabled, starting");
        initializeVisualizer();
    });
    
    // Helper function for debug logging
    const debugLog = (message, ...args) => {
        if (debugLogging) {
            console.log(message, ...args);
        }
    };

    function initializeVisualizer() {
    
    // Track processed elements to avoid duplicates
    const processedElements = new WeakSet();
    
    // Helper function to extract video UUID from URL
    const getVideoId = (url) => {
        const match = url.match(/\/videos\/([^/?]+)(?:\?|\/|$)/);
        return match?.[1]?.trim() || '';
    };
    
    // Helper function to convert time string (HH:MM:SS) to seconds
    const timeStringToSeconds = (timeString) => {
        const parts = timeString.split(':').map(p => parseInt(p, 10));
        if (parts.length === 3) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
        return 0;
    };
    
    // Function to process video links
    const processVideoLinks = () => {
        debugLog("[Timestamp Visualizer] processVideoLinks called");
        const videoLinks = document.querySelectorAll('.group\\/card > a[href*="/videos/"]');
        debugLog("[Timestamp Visualizer] Found", videoLinks.length, 'video links');
        
        videoLinks.forEach((linkElement) => {
            // Skip if already processed
            if (processedElements.has(linkElement)) {
                debugLog("[Timestamp Visualizer] Skipping already processed element");
                return;
            }
            
            const href = linkElement.getAttribute('href');
            const videoId = getVideoId(href);
            debugLog("[Timestamp Visualizer] Processing video:", videoId, "from href:", href);
            
            if (!videoId) {
                debugLog("[Timestamp Visualizer] No video ID found, skipping");
                return;
            }
            
            // Check if we have a saved timestamp for this VOD
            chrome.storage.local.get(['timestamps'], (result) => {
                const timestamps = result.timestamps || {};
                const savedTime = timestamps[videoId];
                debugLog("[Timestamp Visualizer] Retrieved saved time for", videoId, ":", savedTime);
                
                if (!savedTime) {
                    debugLog("[Timestamp Visualizer] No saved time for", videoId);
                    return;
                }
                
                // Get the VOD length from .z-controls element
                const controlsElement = linkElement.querySelector('.z-controls');
                if (!controlsElement) {
                    debugLog("[Timestamp Visualizer] No controls element found for", videoId);
                    return;
                }
                
                const vodLengthText = controlsElement.textContent.trim();
                const vodLengthSeconds = timeStringToSeconds(vodLengthText);
                debugLog("[Timestamp Visualizer] VOD length:", vodLengthSeconds, "seconds from text:", vodLengthText);
                
                if (vodLengthSeconds <= 0) {
                    debugLog("[Timestamp Visualizer] Invalid VOD length:", vodLengthSeconds);
                    return;
                }
                
                // Calculate the percentage watched
                const percentageWatched = (savedTime / vodLengthSeconds) * 100;
                const clampedPercentage = Math.min(percentageWatched, 100);
                debugLog("[Timestamp Visualizer] Percentage watched:", clampedPercentage.toFixed(2), "%");
                
                // Create the progress line element
                const progressLine = document.createElement('div');
                progressLine.style.position = 'absolute';
                progressLine.style.bottom = '0';
                progressLine.style.left = '0';
                progressLine.style.height = '3px';
                progressLine.style.width = clampedPercentage + '%';
                progressLine.style.backgroundColor = 'rgb(83, 252, 24)';
                progressLine.style.zIndex = '10';
                progressLine.className = 'timestamp-progress-line';
                
                // Make sure the link element has relative positioning
                if (linkElement.style.position === '' || linkElement.style.position === 'static') {
                    linkElement.style.position = 'relative';
                }
                
                // Append the progress line to the link element
                linkElement.appendChild(progressLine);
                debugLog("[Timestamp Visualizer] Added progress line for", videoId, "at", clampedPercentage.toFixed(2), "%");
                
                // Mark as processed
                processedElements.add(linkElement);
            });
        });
    };
    
    
    debugLog("[Timestamp Visualizer] Initializing timestamp visualizer");
    processVideoLinks();
    
    // Set up MutationObserver to handle React updates
    const observer = new MutationObserver((mutations) => {
        debugLog("[Timestamp Visualizer] MutationObserver fired, debouncing processVideoLinks");
        // Debounce to avoid excessive processing
        clearTimeout(observer.debounceTimeout);
        observer.debounceTimeout = setTimeout(processVideoLinks, 100);
    });
    
    // Start observing the document for changes
    debugLog("[Timestamp Visualizer] Starting MutationObserver");
    // Start observing the document for changes
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false,
        characterData: false
    });
    }
}

timestampVisualizerFunction();