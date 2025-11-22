const pool = require('./db');

async function fetchBlocker(videoURL) {
    try {
        const params = await processVideoURL(videoURL);
        const queryForVideoID = "SELECT id FROM Video WHERE platform = $1 AND video_id = $2";

        let client =  await pool.connect();

        const result = await client.query(queryForVideoID, [params.platform, params.video_id]);

        if(result.rows.length > 0) {
            const video_id = result.rows[0].id;
            const queryForBlockers =
                "SELECT id, start_time_ms, end_time_ms, description FROM Blocker WHERE video_id = $1";
            const blockersResult = await client.query(queryForBlockers, [video_id]);

            if(blockersResult.rows.length > 0) {
                return blockers =
                    blockersResult.rows.map(row => new Blocker(row.id, row.start_time_ms, row.end_time_ms, row.description));

            } else throw new Error("No blockers found for this video");
        } else throw new Error("Video not found");

    } catch (error) {
        console.error(error);
        throw error;
    } finally {
        if (client) client.release();
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

class Blocker {
    constructor(id, start_time_ms, end_time_ms, description) {
        this.id = id;
        this.start_time_ms = start_time_ms;
        this.end_time_ms = end_time_ms;
        this.description = description;
    }
}