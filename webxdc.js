// Mock WebXDC API for testing outside of Delta Chat
if (!window.webxdc) {
  window.webxdc = (function () {
    const listeners = [];
    
    // Auto-generate a local mock address and name
    // To make it 100% distinct for different tabs, we use window.name (which is unique per tab and survives refreshes)
    let selfAddr = window.name;
    if (!selfAddr || !selfAddr.startsWith('mock-')) {
      selfAddr = 'mock-' + Math.random().toString(36).substr(2, 9);
      window.name = selfAddr;
    }
    
    let selfName = sessionStorage.getItem('webxdc_self_name_' + selfAddr);
    if (!selfName) {
      const randIdx = Math.floor(Math.random() * 90) + 10;
      selfName = 'بازیکن_' + randIdx;
      sessionStorage.setItem('webxdc_self_name_' + selfAddr, selfName);
    }

    // Broadcast channel for cross-tab testing locally
    const bc = new BroadcastChannel('webxdc-mock');
    
    bc.onmessage = (event) => {
      // CLEAR_HISTORY is handled by the app's own update listener (it reads
      // update.payload.type), so this branch only needs to forward updates.
      listeners.forEach(listener => listener(event.data));
    };

    return {
      selfAddr: selfAddr,
      selfName: selfName,
      isMock: true,
      setUpdateListener: function (cb) {
        listeners.push(cb);
        // Play historical updates
        const updates = JSON.parse(localStorage.getItem('webxdc_updates') || '[]');
        updates.forEach(update => {
          try {
            cb(update);
          } catch (e) {
            console.error('Error replaying mock update:', e);
          }
        });
      },
      sendUpdate: function (update, description) {
        const updates = JSON.parse(localStorage.getItem('webxdc_updates') || '[]');
        const msg = {
            id: updates.length + 1,
            payload: update.payload,
            info: update.info,
            document: update.document,
            summary: update.summary,
            serial: updates.length + 1
        };
        updates.push(msg);
        localStorage.setItem('webxdc_updates', JSON.stringify(updates));

        // Send to other tabs
        bc.postMessage(msg);
        // Local loopback
        listeners.forEach(listener => listener(msg));
      },
      sendToChat: function (msg) {
        console.log('webxdc.sendToChat called:', msg);
        if (msg && msg.file) {
          const url = msg.file.blob ? URL.createObjectURL(msg.file.blob) : null;
          if (url) {
            const a = document.createElement('a');
            a.href = url;
            a.download = msg.file.name || 'file.webm';
            a.click();
            URL.revokeObjectURL(url);
          }
        }
        return Promise.resolve();
      }
    };
  })();
}
