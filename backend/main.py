from fastapi import FastAPI
from logic import check_video_exists, fetch_blockers, add_to_database
from fastapi.middleware.cors import CORSMiddleware
import subprocess
from db import get_pool
from transformers import AutoProcessor, AutoModelForImageTextToText
import torch

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Incarcam modelul de generare a descrierilor
model_path = "HuggingFaceTB/SmolVLM2-2.2B-Instruct"
processor = AutoProcessor.from_pretrained(model_path)
model = AutoModelForImageTextToText.from_pretrained(
    model_path,
    torch_dtype=torch.bfloat16,
    _attn_implementation="flash_attention_2"
).to("cuda")

# Descrierea default pentru blockere la care nu s-a generat inca o descriere (sau prea scurte)
DEFAULT_DESCRIPTION = "Hidden part is too short for a description"

# Endpoint pentru verificare daca un video exista si are blockere
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


# Endpoint pentru adaugare video si blockere in baza de date
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
    
# Endpoint pentru generare descrieri pentru blockere
# Aici se proceseaza fiecare blocker care are descrierea default si o lungime mai mare de 2.5 secunde
@app.post("/generate-descriptions")
async def generate_descriptions(request: dict):
    video_id = request["video_id"]
    platform = request["platform"]
    video_link = f"https://www.youtube.com/watch?v={video_id}"

    print(f"Generating descriptions for {platform} video {video_id}")

    blockers: list = await fetch_blockers(video_link)
    if not blockers:
        return {"success": False, "error": "No blockers found"}
    
    # blockers = list[dictkeys("id", "start_time_ms", "end_time_ms", "description")]

    for blocker in blockers:
        blocker_id = blocker["id"]
        start_time = blocker["start_time_ms"]
        end_time = blocker["end_time_ms"]
        description = blocker["description"]
        timespan = end_time - start_time
        if 4500 > timespan or description.strip() != DEFAULT_DESCRIPTION:
            print(description.strip(), DEFAULT_DESCRIPTION, timespan)
            print(f"Skipping blocker {blocker['id']} because short length")
            continue

        
        # Debug ffmpeg
        print(f"Generating description for blocker {blocker['id']} with video segment {blocker['start_time_ms']} - {blocker['end_time_ms']}, timespan {timespan}ms")

        # Extragem segmentul video necesar (se folosescte yt-dlp cu ffmpeg)
        command = [
            "./yt-dlp",
            video_link,
            "-f", "bestvideo[height<=480][fps<=30]/best",
            "--merge-output-format", "mp4",
            "--downloader", "ffmpeg",
            "--downloader-args", f"ffmpeg_i:-ss {start_time / 1000} -to {end_time / 1000}",
            "--postprocessor-args",
            "ffmpeg:-c:v libx264 -crf 24 -preset fast -r 24 -vf scale=-2:480 -an",
            "-o", f"blocker{blocker_id}.mp4",
        ]


        subprocess.run(command, check=True)

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "video", "path": f"blocker{blocker_id}.mp4"},
                    {"type": "text", "text": f"Describe this video in short, so the reader can read it in {(timespan - 1500) / 1000:.1f} seconds."}
                ]
            },
        ]

        inputs = processor.apply_chat_template(
        messages,
        add_generation_prompt=True,
        tokenize=True,
        return_dict=True,
        return_tensors="pt",
        ).to(model.device, dtype=torch.bfloat16)

        generated_ids = model.generate(**inputs, do_sample=False, max_new_tokens=64)
        generated_texts = processor.batch_decode(
            generated_ids,
            skip_special_tokens=True,
        )

        
        # result_text contine, dupa "Assistant: ", descrierea generata
        result_text = generated_texts[0].split("Assistant: ", 1)[-1].strip()
        print(f"Generated description: {result_text}")


        # Actualizam in baza de date
        pool = await get_pool()
        update_query = """
            UPDATE Blocker
            SET description = $1
            WHERE id = $2
        """

        await pool.execute(update_query, result_text, blocker["id"])


    return {"success": True}
