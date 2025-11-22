document.addEventListener('DOMContentLoaded', () => {
    const modeSwitch = document.getElementById('photosensitiveMode');

    chrome.storage.local.get({ isPhotosensitiveMode: true }, (items) => {
        modeSwitch.checked = items.isPhotosensitiveMode;
    });

    modeSwitch.addEventListener('change', () => {
        const isActive = modeSwitch.checked;
        chrome.storage.local.set({ isPhotosensitiveMode: isActive });
    });
});
