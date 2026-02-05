function trackVODTimeFunction() {

    if (window.KickVODTracker && window.KickVODTracker.isSetup) return; // already set up

    window.KickVODTracker = {
        isSetup: true,
        currentVideoId: null,
        loadedVideoId: null,
        isLoadingVideo: null,
        lastUrl: window.location.href,
        currentVideoTimeHandler: null,
        saveTimeout: null,
        pendingListeners: null,
        debugLogging: false
    };

    // Helper function for debug logging
    const debugLog = (message, ...args) => {
        if (window.KickVODTracker.debugLogging) {
            console.log(message, ...args);
        }
    };

    // Load debug setting
    chrome.storage.sync.get(['debugLogging'], (result) => {
        window.KickVODTracker.debugLogging = result.debugLogging || false;
    });

    const getVideoId = (url) => {
        const match = url.match(/\/videos\/([^/?]+)(?:\?|\/|$)/);
        return match?.[1]?.trim() || '';
    };

    const saveWithRetry = (videoId, currentTime, retries = 3) => {
        debugLog("[Kick VODS] saveWithRetry called for video:", videoId, "time:", currentTime);
        chrome.storage.local.get(['timestamps'], (result) => {
            if (chrome.runtime.lastError) {
                if (retries > 0) {
                    console.warn("[Kick VODS] Retry saving, attempts left:", retries);
                    setTimeout(() => saveWithRetry(videoId, currentTime, retries - 1), 100 * (4 - retries));
                } else {
                    console.error("[Kick VODS] Failed to save after retries:", chrome.runtime.lastError);
                }
                return;
            }
            
            const timestamps = result.timestamps || {};
            timestamps[videoId] = currentTime;
            debugLog("[Kick VODS] Stored timestamp, calling chrome.storage.local.set");
            chrome.storage.local.set({ timestamps }, () => {
                if (chrome.runtime.lastError && retries > 0) {
                    setTimeout(() => saveWithRetry(videoId, currentTime, retries - 1), 100 * (4 - retries));
                } else if (chrome.runtime.lastError) {
                    console.error("[Kick VODS] Error saving time:", chrome.runtime.lastError);
                } else {
                    debugLog("[Kick VODS] Successfully saved timestamp");
                }
            });
        });
    };

    const clearCurrentTracking = () => {
        if (window.KickVODTracker.currentVideoTimeHandler) {
            const handler = window.KickVODTracker.currentVideoTimeHandler;
            handler.element.removeEventListener('timeupdate', handler.handler);
            handler.element.removeEventListener('seeking', handler.seekingHandler);
            handler.element.removeEventListener('seeked', handler.seekedHandler);
            window.KickVODTracker.currentVideoTimeHandler = null;
        }
        // Clear debounced save timeout
        if (window.KickVODTracker.saveTimeout) {
            clearTimeout(window.KickVODTracker.saveTimeout);
            window.KickVODTracker.saveTimeout = null;
        }
        // Clean up pending event listeners
        if (window.KickVODTracker.pendingListeners) {
            window.KickVODTracker.pendingListeners();
            window.KickVODTracker.pendingListeners = null;
        }
        window.KickVODTracker.currentVideoId = null;
        window.KickVODTracker.loadedVideoId = null;
        window.KickVODTracker.isLoadingVideo = null;
    };

    const detectUrlChange = () => {
        const currentUrl = window.location.href;
        
        if (currentUrl !== window.KickVODTracker.lastUrl) {
            window.KickVODTracker.lastUrl = currentUrl;
            clearCurrentTracking();
        }
    };

    const startTrackingInterval = (videoId) => {
        const currentVideo = document.querySelector("#video-player");
        if (!currentVideo) return;

        let isIgnoringUpdates = false;

        const saveTimeHandler = () => {
            debugLog("[Kick VODS] timeupdate fired - isIgnoring:", isIgnoringUpdates, "loadedVideoId:", window.KickVODTracker.loadedVideoId, "currentVideoId:", videoId);
            if (isIgnoringUpdates || window.KickVODTracker.loadedVideoId !== videoId) {
                debugLog("[Kick VODS] Skipping save - ignoring updates or wrong video");
                return;
            }

            // Debounce: save at most once per second
            // Only set timeout if one doesn't exist - this way it fires 1 second after the LAST timeupdate
            debugLog("[Kick VODS] Debounce check - saveTimeout exists?", !!window.KickVODTracker.saveTimeout);
            if (window.KickVODTracker.saveTimeout) {
                debugLog("[Kick VODS] Timeout already scheduled, skipping");
                return;
            }

            debugLog("[Kick VODS] Setting up debounce timeout, will save in 1 second");
            window.KickVODTracker.saveTimeout = setTimeout(() => {
                const currentTime = currentVideo.currentTime;
                debugLog("[Kick VODS] Saving time:", currentTime, "for video:", videoId);
                saveWithRetry(videoId, currentTime);
                window.KickVODTracker.saveTimeout = null;
            }, 1000);
        };

        const onSeeking = () => {
            debugLog("[Kick VODS] Seeking started");
            isIgnoringUpdates = true;
        };

        const onSeeked = () => {
            debugLog("[Kick VODS] Seek finished, will re-enable saves in 2 seconds");
            setTimeout(() => {
                isIgnoringUpdates = false;
                debugLog("[Kick VODS] Re-enabled saves after seek");
            }, 2000);
        };

        currentVideo.addEventListener('timeupdate', saveTimeHandler);
        currentVideo.addEventListener('seeking', onSeeking);
        currentVideo.addEventListener('seeked', onSeeked);
        window.KickVODTracker.currentVideoTimeHandler = { 
            handler: saveTimeHandler, 
            element: currentVideo, 
            seekingHandler: onSeeking,
            seekedHandler: onSeeked,
            ignoreFlag: () => { isIgnoringUpdates = true; }, 
            unignoreFlag: () => { isIgnoringUpdates = false; } 
        };
    };

    const observer = new MutationObserver(() => {
        detectUrlChange();
        
        const video = document.querySelector("#video-player");
        const videoId = getVideoId(window.location.href);
        
        if (video && videoId && videoId !== window.KickVODTracker.currentVideoId) {
            // Video changed or new video detected
            if (window.KickVODTracker.currentVideoTimeHandler) {
                window.KickVODTracker.currentVideoTimeHandler.element.removeEventListener('timeupdate', window.KickVODTracker.currentVideoTimeHandler.handler);
                window.KickVODTracker.currentVideoTimeHandler = null;
            }
            window.KickVODTracker.currentVideoId = videoId;
            window.KickVODTracker.isLoadingVideo = videoId;
            window.KickVODTracker.loadedVideoId = null;
            
            chrome.storage.local.get(['timestamps'], (result) => {
                const currentVideo = document.querySelector("#video-player");
                const currentVideoId = getVideoId(window.location.href);
                
                debugLog("[Kick VODS] Loading video:", currentVideoId);

                // Only proceed if this is still the video we're loading
                if (window.KickVODTracker.isLoadingVideo !== currentVideoId) {
                    return;
                }
                
                if (currentVideo && currentVideoId === videoId) {
                    const timestamps = result.timestamps || {};
                    const savedTime = timestamps[videoId];
                    
                    let hasInitialized = false;
                    let fallbackTimeout;
                    
                    const onCanPlay = () => {
                        debugLog("[Kick VODS] canplay event fired, readyState:", currentVideo.readyState);
                        // Don't initialize yet, but log that we got here
                    };

                    const onPlay = () => {
                        debugLog("[Kick VODS] play event fired, readyState:", currentVideo.readyState);
                        // Don't initialize yet, but log that we got here
                    };

                    const onPlaying = () => {
                        debugLog("[Kick VODS] playing event fired");
                        // Prevent multiple calls
                        if (hasInitialized) return;
                        hasInitialized = true;
                        
                        clearTimeout(fallbackTimeout);
                        cleanup();
                        window.KickVODTracker.pendingListeners = null;
                        
                        debugLog("[Kick VODS] Initializing tracking for video:", videoId);
                        window.KickVODTracker.loadedVideoId = videoId;
                        startTrackingInterval(videoId);
                        
                        if (savedTime !== undefined && window.KickVODTracker.currentVideoTimeHandler) {
                            debugLog("[Kick VODS] Seeking to saved time:", savedTime);
                            window.KickVODTracker.currentVideoTimeHandler.ignoreFlag();
                            debugLog("[Kick VODS] Ignore flag set");
                            currentVideo.currentTime = savedTime;
                            setTimeout(() => {
                                if (window.KickVODTracker.currentVideoTimeHandler) {
                                    window.KickVODTracker.currentVideoTimeHandler.unignoreFlag();
                                    debugLog("[Kick VODS] Ignore flag unset - saves should now work");
                                }
                            }, 3000);
                        } else {
                            debugLog("[Kick VODS] No saved time to restore or handler not ready");
                        }
                    };

                    const cleanup = () => {
                        clearTimeout(fallbackTimeout);
                        currentVideo.removeEventListener('canplay', onCanPlay);
                        currentVideo.removeEventListener('play', onPlay);
                        currentVideo.removeEventListener('playing', onPlaying);
                    };

                    window.KickVODTracker.pendingListeners = cleanup;

                    // Add a timeout fallback in case playing never fires
                    fallbackTimeout = setTimeout(() => {
                        if (!hasInitialized) {
                            debugLog("[Kick VODS] Fallback triggered - playing event didn't fire, using canplay");
                            if (currentVideo.readyState >= 2) {
                                onPlaying();
                            }
                        }
                    }, 5000);

                    currentVideo.addEventListener('canplay', onCanPlay);
                    currentVideo.addEventListener('play', onPlay);
                    currentVideo.addEventListener('playing', onPlaying);
                }
            });
        } else if ((!video || !videoId) && window.KickVODTracker.currentVideoTimeHandler) {
            clearCurrentTracking();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Detect React navigation via History API
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
        originalPushState.apply(this, args);
        detectUrlChange();
    };

    history.replaceState = function (...args) {
        originalReplaceState.apply(this, args);
        detectUrlChange();
    };

    // Listen for back/forward navigation
    window.addEventListener('popstate', detectUrlChange);

    // Cleanup on page unload
    window.addEventListener('beforeunload', clearCurrentTracking);
}

trackVODTimeFunction(); 