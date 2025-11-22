const pool = require('./db');

async function fetchVideo(videoURL) {
    try {
        const params = await processVideoURL(videoURL);
        const queryForVideoID = "SELECT id FROM Video WHERE platform = $1 AND video_id = $2";

        client = await pool.connect();

        const result = await client.query(queryForVideoID, [params.platform, params.video_id]);


    } catch (error) {
        console.error('Error processing video URL:', error);
        throw error;
    }
}

async function processVideoURL(videoURL) {
    if (videoURL.includes('youtube')) {
        platform = 'youtube';
        video_id = videoURL.split("v=")[1].split("?")[0];
        return { platform, video_id };
    }
    else throw new Error('Unsupported platform');
}