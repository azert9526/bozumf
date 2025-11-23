const express = require('express');
const cors = require('cors');
const { fetchBlocker, checkVideoExists, addToDatabase } = require('./fetch');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/check', async (req, res) => {
    const videoId = req.query.id;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    try {
        const exists = await checkVideoExists(videoUrl);
        if (exists) {
            const blockers = await fetchBlocker(videoUrl);
            res.json({ found: true, blockers: blockers });
        } else {
            res.json({ found: false });
        }
    } catch (error) {
        res.json({ found: false });
    }
});

app.post('/add', async (req, res) => {
    const { video_id, blockers } = req.body;
    const videoUrl = `https://www.youtube.com/watch?v=${video_id}`;

    try {
        await addToDatabase(videoUrl, blockers);
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.listen(8000, () => {
    console.log('Server running on http://localhost:8000');
});