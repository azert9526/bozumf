const pool = require('./db');

async function fetchBlocker(videoURL) {
    let client;
    try {
        const params = await processVideoURL(videoURL);
        const queryForVideoID = "SELECT id FROM Video WHERE platform = $1 AND video_id = $2";

        client = await pool.connect();

        const result = await client.query(queryForVideoID, [params.platform, params.video_id]);

        if (result.rows.length > 0) {
            const video_id = result.rows[0].id;
            const queryForBlockers = "SELECT id, start_time_ms, end_time_ms, description FROM Blocker WHERE video_id = $1";
            const blockersResult = await client.query(queryForBlockers, [video_id]);

            if (blockersResult.rows.length > 0) {
                return blockersResult.rows.map(row => new Blocker(row.id, row.start_time_ms, row.end_time_ms, row.description));
            } else throw new Error("No blockers found for this video");
        } else throw new Error("Video not found");

    } catch (error) {
        console.error(error);
        throw error;
    } finally {
        if (client) client.release();
    }
}

async function addToDatabase(videoURL, blockers) {
    let client;
    try {
        const params = await processVideoURL(videoURL);
        const queryToAddVideo = "INSERT INTO Video (platform, video_id) VALUES ($1, $2) RETURNING id";

        client = await pool.connect();
        const result = await client.query(queryToAddVideo, [params.platform, params.video_id]);

        if (result.rows.length > 0) {
            const video_id = result.rows[0].id;
            const queryToAddBlocker = "INSERT INTO Blocker (video_id, start_time_ms, end_time_ms, description) VALUES ($1, $2, $3, $4)";

            for (const blocker of blockers) {
                await client.query(queryToAddBlocker, [video_id, blocker.start_time_ms, blocker.end_time_ms, blocker.description]);
            }
        } else throw new Error("Could not insert video");
    } catch (error) {
        console.error(error);
        throw error;
    } finally {
        if (client) client.release();
    }
}

async function checkVideoExists(videoURL) {
    let client;
    try {
        const params = await processVideoURL(videoURL);
        const queryForVideoID = "SELECT id FROM Video WHERE platform = $1 AND video_id = $2";
        
        client = await pool.connect(); 
        const result = await client.query(queryForVideoID, [params.platform, params.video_id]);
        
        return result.rows.length > 0;
    } catch (error) {
        console.error(error);
        throw error;
    } finally {
        if (client) client.release();
    }
}

async function processVideoURL(videoURL) {
    if (videoURL.includes('youtube')) {
        const platform = 'youtube';
        const video_id = videoURL.split("v=")[1].split("&")[0];
        return { platform, video_id };
    } else throw new Error('Unsupported platform');
}

class Blocker {
    constructor(id, start_time_ms, end_time_ms, description) {
        this.id = id;
        this.start_time_ms = start_time_ms;
        this.end_time_ms = end_time_ms;
        this.description = description;
    }
}

module.exports = {
    fetchBlocker,
    checkVideoExists,
    addToDatabase
};