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
        // Helper function to extract video UUID from URL
        const getVideoId = (url) => {
            const match = url.match(/\/videos\/([^/?]+)(?:\?|\/|$)/);
            return match?.[1]?.trim() || '';
        };

        // Kick renders duration as HH:MM:SS and, on shorter VODs, MM:SS.
        const timeStringToSeconds = (timeString) => {
            const match = String(timeString).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
            if (!match) return 0;
            const hours = match[1] ? parseInt(match[1], 10) : 0;
            const minutes = parseInt(match[2], 10);
            const seconds = parseInt(match[3], 10);
            if (minutes > 59 || seconds > 59) return 0;
            return hours * 3600 + minutes * 60 + seconds;
        };

        // .z-controls is a shared z-index utility now: duration badge, view count,
        // chat toggle, and the player control bar. Only the duration badge is a bare timestamp.
        const getVodLengthSeconds = (linkElement) => {
            const badges = linkElement.querySelectorAll('.z-controls');
            let fallback = 0;
            for (const badge of badges) {
                const text = badge.textContent.trim();
                const seconds = timeStringToSeconds(text);
                if (!seconds) continue;
                if (badge.classList.contains('top-1.5') || /\btop-/.test(badge.className)) {
                    return seconds;
                }
                fallback = seconds;
            }
            return fallback;
        };

        const isThumbnailLink = (linkElement) => {
            if (linkElement.getAttribute('data-testid') === 'media-card-thumbnail') return true;
            return !!linkElement.querySelector('img, video, [data-thumbnail]');
        };

        // Function to process video links
        const processVideoLinks = () => {
            debugLog("[Timestamp Visualizer] processVideoLinks called");
            const videoLinks = document.querySelectorAll(
                '[data-testid="media-card-thumbnail"][href*="/videos/"], .group\\/card > a[href*="/videos/"]'
            );
            debugLog("[Timestamp Visualizer] Found", videoLinks.length, 'video links');

            const thumbnails = [...videoLinks].filter(isThumbnailLink);
            if (!thumbnails.length) return;

            chrome.storage.local.get(['timestamps'], (result) => {
                const timestamps = result.timestamps || {};

                thumbnails.forEach((linkElement) => {
                    if (!linkElement.isConnected) return;

                    const href = linkElement.getAttribute('href');
                    const videoId = getVideoId(href);
                    debugLog("[Timestamp Visualizer] Processing video:", videoId, "from href:", href);

                    if (!videoId) return;

                    const savedTime = timestamps[videoId];
                    debugLog("[Timestamp Visualizer] Retrieved saved time for", videoId, ":", savedTime);

                    if (!savedTime) return;

                    const vodLengthSeconds = getVodLengthSeconds(linkElement);
                    debugLog("[Timestamp Visualizer] VOD length:", vodLengthSeconds, "seconds");

                    if (vodLengthSeconds <= 0) {
                        debugLog("[Timestamp Visualizer] Invalid VOD length:", vodLengthSeconds);
                        return;
                    }

                    const percentageWatched = (savedTime / vodLengthSeconds) * 100;
                    const clampedPercentage = Math.min(percentageWatched, 100);
                    debugLog("[Timestamp Visualizer] Percentage watched:", clampedPercentage.toFixed(2), "%");

                    const width = clampedPercentage + '%';
                    let progressLine = linkElement.querySelector(':scope > .timestamp-progress-line');
                    if (!progressLine) {
                        progressLine = document.createElement('div');
                        progressLine.className = 'timestamp-progress-line';
                        progressLine.style.position = 'absolute';
                        progressLine.style.bottom = '0';
                        progressLine.style.left = '0';
                        progressLine.style.height = '3px';
                        progressLine.style.backgroundColor = 'rgb(83, 252, 24)';
                        // Duration and view badges use z-index 202 (the z-controls token).
                        progressLine.style.zIndex = '250';
                        progressLine.style.pointerEvents = 'none';
                        if (getComputedStyle(linkElement).position === 'static') {
                            linkElement.style.position = 'relative';
                        }
                        linkElement.appendChild(progressLine);
                        debugLog("[Timestamp Visualizer] Added progress line for", videoId, "at", clampedPercentage.toFixed(2), "%");
                    }
                    if (progressLine.style.width !== width) {
                        progressLine.style.width = width;
                    }
                });
            });
        };

        debugLog("[Timestamp Visualizer] Initializing timestamp visualizer");
        processVideoLinks();

        let lastVisualizerUrl = window.location.href;
        setInterval(() => {
            if (window.location.href === lastVisualizerUrl) return;
            lastVisualizerUrl = window.location.href;
            processVideoLinks();
        }, 500);

        // Set up MutationObserver to handle React updates
        const observer = new MutationObserver(() => {
            debugLog("[Timestamp Visualizer] MutationObserver fired, debouncing processVideoLinks");
            // Debounce to avoid excessive processing
            clearTimeout(observer.debounceTimeout);
            observer.debounceTimeout = setTimeout(processVideoLinks, 100);
        });

        // Start observing the document for changes
        debugLog("[Timestamp Visualizer] Starting MutationObserver");
        const attachObserver = () => {
            const observeRoot = document.documentElement || document.body;
            if (!observeRoot) return false;
            observer.observe(observeRoot, {
                childList: true,
                subtree: true,
                attributes: false,
                characterData: false
            });
            return true;
        };
        if (!attachObserver()) {
            document.addEventListener('DOMContentLoaded', attachObserver, { once: true });
        }
    }
}

timestampVisualizerFunction();
