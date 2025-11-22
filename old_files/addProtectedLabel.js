const fetchFunctions = require('./fetch')


function getYouTubeVideoURLS() {
    const videoLinks = Array.from(document.querySelectorAll('a[href*="/watch?v="]'));
    return videoLinks.map(link => link.href);
}

async function addLabel() {
    const videoLinkElements = getYouTubeVideoURLS();

    for (const linkElement of videoLinkElements) {
        const videoURL = linkElement.href;

        const isProtected = await fetchFunctions.checkVideoExists(videoURL);

        insertLabelOverThumbnail(linkElement, isProtected);
    }
}

function insertLabelOverThumbnail(linkElement, isProtected) {
    const thumbnailWrapper = linkElement.closest('ytd-thumbnail'); 

    if (!thumbnailWrapper) return;

    thumbnailWrapper.style.position = 'relative';

    const label = document.createElement('div');
    label.textContent = isProtected ? '✅' : '❌';
    label.classList.add('custom-video-label');

    thumbnailWrapper.appendChild(label);
}