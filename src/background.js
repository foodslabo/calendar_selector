// Service Worker の初期化
let storedGroups = { "__last_saved": [], "__v": 1 };
let initialized = false;

function initializeStorage() {
  if (initialized) return Promise.resolve();

  return new Promise((resolve) => {
    chrome.storage.local.get('calendarSelectorGroups', (items) => {
      if (chrome.runtime.lastError) {
        console.error('Error accessing storage:', chrome.runtime.lastError);
        resolve();
        return;
      }

      if (items && items.calendarSelectorGroups) {
        try {
          storedGroups = items.calendarSelectorGroups;
          console.log('Loaded stored groups:', storedGroups);
        } catch (e) {
          console.error('Error parsing stored groups:', e);
        }
      } else {
        // 初期データがなければストレージを初期化
        try {
          chrome.storage.local.set({ 'calendarSelectorGroups': storedGroups });
        } catch (e) {
          console.error('Error initializing storage:', e);
        }
      }

      initialized = true;
      resolve();
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Calendar Selector extension installed.');
  initializeStorage();
});

// メッセージリスナー
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message.action);

  // 初期化が完了していない場合は待機
  if (!initialized) {
    initializeStorage().then(() => handleMessage(message, sender, sendResponse));
    return true; // 非同期レスポンスのために必要
  }

  return handleMessage(message, sender, sendResponse);
});

function handleMessage(message, sender, sendResponse) {
  try {
    if (message.action === 'ping') {
      sendResponse({ success: true });
    }
    else if (message.action === 'getGroups') {
      console.log('Sending groups to content script:', storedGroups);
      sendResponse({ success: true, groups: storedGroups });
    }
    else if (message.action === 'saveGroups') {
      console.log('Saving groups:', message.groups);
      // message.groups のディープコピーを作成
      storedGroups = JSON.parse(JSON.stringify(message.groups));

      // ストレージに保存
      chrome.storage.local.set({ 'calendarSelectorGroups': storedGroups }, () => {
        if (chrome.runtime.lastError) {
          console.error('Error saving to storage:', chrome.runtime.lastError);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          console.log('Groups saved to storage successfully');
          sendResponse({ success: true });
        }
      });
      return true; // 非同期レスポンスのために必要
    }
  } catch (e) {
    console.error('Error handling message:', e);
    sendResponse({ success: false, error: e.message });
  }

  return true; // 非同期レスポンスのために必要
}