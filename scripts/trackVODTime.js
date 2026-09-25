function trackVODTimeFunction() {

    if (window.KickVODTracker && window.KickVODTracker.isSetup) return; // already set up

    window.KickVODTracker = {
        isSetup: true,
        currentVideoId: null,
        loadedVideoId: null,
        isLoadingVideo: null,
        boundElement: null,
        lastUrl: window.location.href,
        currentVideoTimeHandler: null,
        saveTimeout: null,
        pendingListeners: null,
        debugLogging: false,
        userActive: false
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
        window.KickVODTracker.boundElement = null;
    };

    // #video-player is still the main element. Kick also mounts short ad videos
    // and, after a player rebuild, can drop the id while leaving the <video> in
    // the embedded player container.
    const findPlayerVideo = () => {
        const byId = document.getElementById('video-player');
        if (byId instanceof HTMLVideoElement) return byId;

        const embedded = document.querySelector('#injected-embedded-channel-player-video video');
        if (embedded instanceof HTMLVideoElement) return embedded;

        const candidates = [...document.querySelectorAll('video')].filter((video) => {
            const src = video.currentSrc || video.src || '';
            return !src.includes('black_2s.mp4');
        });
        candidates.sort((a, b) => (b.duration || 0) - (a.duration || 0));
        return candidates.find((video) => video.duration > 5 || video.readyState > 0) || null;
    };

    const detectUrlChange = () => {
        const currentUrl = window.location.href;
        
        if (currentUrl !== window.KickVODTracker.lastUrl) {
            window.KickVODTracker.lastUrl = currentUrl;
            clearCurrentTracking();
        }
    };

    const startTrackingInterval = (videoId, savedTime) => {
        const currentVideo = findPlayerVideo();
        if (!currentVideo) return;

        let isIgnoringUpdates = false;

        // Set up user interaction detection on video player's parent (only once)
        if (!window.KickVODTracker.userInteractionSetup) {
            let userActivityTimeout;
            const setUserActive = () => {
                clearTimeout(userActivityTimeout);
                window.KickVODTracker.userActive = true;
                userActivityTimeout = setTimeout(() => {
                    window.KickVODTracker.userActive = false;
                }, 1000);
            };
            
            window.addEventListener('pointerdown', setUserActive);
            window.addEventListener('pointerup', setUserActive);
            window.KickVODTracker.userInteractionSetup = true;
        }

        const saveTimeHandler = () => {
            const currentTime = currentVideo.currentTime;
            debugLog("[Kick VODS] timeupdate fired - isIgnoring:", isIgnoringUpdates, "loadedVideoId:", window.KickVODTracker.loadedVideoId, "currentVideoId:", videoId);
            
            // Auto-seek to saved timestamp if time is below 1 second and user isn't actively interacting
            if (currentTime < 1 && !window.KickVODTracker.userActive && window.KickVODTracker.currentVideoTimeHandler?.savedTime !== undefined) {
                debugLog("[Kick VODS] Auto-seeking to saved timestamp:", window.KickVODTracker.currentVideoTimeHandler.savedTime);
                isIgnoringUpdates = true;
                currentVideo.currentTime = window.KickVODTracker.currentVideoTimeHandler.savedTime;
                setTimeout(() => {
                    isIgnoringUpdates = false;
                }, 2000);
            }
            
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
                const duration = currentVideo.duration;
                
                // Disable saving for the first 5 seconds
                if (currentTime < 5) {
                    debugLog("[Kick VODS] Skipping save - video time is below 5 seconds");
                    window.KickVODTracker.saveTimeout = null;
                    return;
                }
                
                // Disable saving for the last 5 seconds
                if (duration && currentTime > duration - 5) {
                    debugLog("[Kick VODS] Skipping save - video time is in last 5 seconds (", currentTime, "of", duration, ")");
                    window.KickVODTracker.saveTimeout = null;
                    return;
                }
                
                debugLog("[Kick VODS] Saving time:", currentTime, "for video:", videoId);
                saveWithRetry(videoId, currentTime);
                // Update the saved time for auto-seek
                if (window.KickVODTracker.currentVideoTimeHandler) {
                    window.KickVODTracker.currentVideoTimeHandler.savedTime = currentTime;
                }
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
            unignoreFlag: () => { isIgnoringUpdates = false; },
            savedTime: savedTime
        };
    };

    const syncFromDom = () => {
        detectUrlChange();
        
        const video = findPlayerVideo();
        const videoId = getVideoId(window.location.href);
        const alreadyBound = video
            && window.KickVODTracker.boundElement === video
            && window.KickVODTracker.currentVideoId === videoId;
        
        if (video && videoId && !alreadyBound) {
            // Video changed or new video detected
            if (window.KickVODTracker.pendingListeners) {
                window.KickVODTracker.pendingListeners();
                window.KickVODTracker.pendingListeners = null;
            }
            if (window.KickVODTracker.currentVideoTimeHandler) {
                const previous = window.KickVODTracker.currentVideoTimeHandler;
                previous.element.removeEventListener('timeupdate', previous.handler);
                previous.element.removeEventListener('seeking', previous.seekingHandler);
                previous.element.removeEventListener('seeked', previous.seekedHandler);
                window.KickVODTracker.currentVideoTimeHandler = null;
            }
            window.KickVODTracker.currentVideoId = videoId;
            window.KickVODTracker.isLoadingVideo = videoId;
            window.KickVODTracker.loadedVideoId = null;
            window.KickVODTracker.boundElement = video;
            
            chrome.storage.local.get(['timestamps'], (result) => {
                const currentVideo = findPlayerVideo();
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
                        startTrackingInterval(videoId, savedTime);
                        
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

                    // Kick's player seeks on startup and then fires `playing`.
                    // Setting currentTime also fires `playing` again, so this
                    // listener has to be one-shot or the restore seek loops.
                    // If playback already started, `playing` will not fire again.
                    const alreadyPlaying = currentVideo.readyState >= 2 && !currentVideo.paused;
                    if (alreadyPlaying) {
                        debugLog("[Kick VODS] Video already playing, restoring immediately");
                        onPlaying();
                    } else {
                        fallbackTimeout = setTimeout(() => {
                            if (!hasInitialized && currentVideo.readyState >= 2) {
                                debugLog("[Kick VODS] Fallback triggered - playing event didn't fire");
                                onPlaying();
                            }
                        }, 5000);

                        currentVideo.addEventListener('canplay', onCanPlay);
                        currentVideo.addEventListener('play', onPlay);
                        currentVideo.addEventListener('playing', onPlaying);
                    }
                }
            });
        } else if ((!video || !videoId) && window.KickVODTracker.currentVideoTimeHandler) {
            clearCurrentTracking();
        }
    };

    const observer = new MutationObserver(() => {
        try {
            syncFromDom();
        } catch (error) {
            console.error("[Kick VODS] Failed to sync after a DOM change:", error);
        }
    });
    const attachObserver = () => {
        const root = document.documentElement || document.body;
        if (!root) return false;
        observer.observe(root, { childList: true, subtree: true });
        return true;
    };
    if (!attachObserver()) {
        document.addEventListener('DOMContentLoaded', attachObserver, { once: true });
    }
    // MutationObserver does not report elements that are already in the document.
    syncFromDom();

    // Kick is a single-page app. Client navigations often reuse the same
    // <video> and only then update the URL, so a childList observer never
    // sees a new player. Watch the URL itself and bind whatever player is mounted.
    const onNavigate = () => {
        try {
            syncFromDom();
        } catch (error) {
            console.error("[Kick VODS] Failed to sync after navigation:", error);
        }
    };

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
        const result = originalPushState.apply(this, args);
        onNavigate();
        return result;
    };

    history.replaceState = function (...args) {
        const result = originalReplaceState.apply(this, args);
        onNavigate();
        return result;
    };

    window.addEventListener('popstate', onNavigate);
    if (window.navigation) {
        window.navigation.addEventListener('navigatesuccess', onNavigate);
    }
    // Next can call History.prototype.pushState and skip the instance patch above.
    window.KickVODTracker.urlPoll = setInterval(onNavigate, 500);

    window.addEventListener('beforeunload', () => {
        clearInterval(window.KickVODTracker.urlPoll);
        clearCurrentTracking();
    });
}

trackVODTimeFunction(); 