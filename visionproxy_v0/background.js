// background.js - Manifest V3 declarativeNetRequest version
chrome.runtime.onInstalled.addListener(() => {
  console.log('NeuroShield extension installed - CORS rules active');
});

// Optional: Log when rules are applied
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener((info) => {
  console.log('NeuroShield: CORS rule matched', info);
});

// Keep service worker alive
setInterval(() => {
  console.log('NeuroShield service worker active');
}, 30000);