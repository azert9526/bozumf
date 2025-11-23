// Doar pentru logging/debugging-ul extensiei pentru CORS

chrome.runtime.onInstalled.addListener(() => {
  console.log('VisionProxy extension installed - CORS rules active');
});

chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener((info) => {
  console.log('VisionProxy CORS rule matched', info);
});

setInterval(() => {
  console.log('VisionProxy service worker active');
}, 30000);