from fastapi import FastAPI
from logic import check_video_exists, fetch_blockers, add_to_database
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # permite orice frontend
    allow_credentials=True,
    allow_methods=["*"],          # GET, POST, etc
    allow_headers=["*"],          # header-e custom
)

# Endpoint pentru verificare
@app.get("/check")
async def check(id: str):
    video_url = f"https://www.youtube.com/watch?v={id}"

    exists = await check_video_exists(video_url)
    if not exists:
        return {"found": False}

    blockers = await fetch_blockers(video_url)
    if blockers is None or len(blockers) == 0:
        return {"found": False}

    return {"found": True, "blockers": blockers}


# Endpoint pentru adaugare
@app.post("/add")
async def add(request: dict):
    # request contine video_id si blockers
    video_id = request["video_id"]
    blockers = request["blockers"]

    video_url = f"https://www.youtube.com/watch?v={video_id}"

    try:
        await add_to_database(video_url, blockers)
        return {"success": True}
    except Exception as e:
        print(e)
        return {"success": False}
