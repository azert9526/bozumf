document.addEventListener('DOMContentLoaded', () => {
    const modeSwitch = document.getElementById('photosensitiveMode');

    // 1. Încărcăm starea (Default: true)
    chrome.storage.local.get({ isPhotosensitiveMode: true }, (items) => {
        modeSwitch.checked = items.isPhotosensitiveMode;
    });

    // 2. Salvăm la modificare
    modeSwitch.addEventListener('change', () => {
        const isActive = modeSwitch.checked;
        chrome.storage.local.set({ isPhotosensitiveMode: isActive });
    });
});
