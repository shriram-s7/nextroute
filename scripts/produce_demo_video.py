"""
NextRoute — Automated Video Production Pipeline (Async Playwright + Edge-TTS + FFmpeg)
Records a 1080p demo walkthrough with smooth visible mouse cursor and synchronized neural voiceover
for the NextRoute adaptive dispatch control room.
"""

import asyncio
import os
import re
import shutil
import subprocess
from playwright.async_api import async_playwright
import edge_tts
import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

SCENES = [
    {
        "id": "scene1_intro",
        "text": (
            "Welcome to NextRoute, an adaptive bus dispatch control room for Chennai's Metropolitan Transport Corporation. "
            "In traditional fixed-schedule transit, traffic variance and heavy boarding create headway instability. "
            "Buses bunch together: leading buses become crush-loaded, while trailing buses run half-empty."
        ),
    },
    {
        "id": "scene2_comparison",
        "text": (
            "NextRoute evaluates adaptive dispatch side-by-side with the baseline timetable under identical simulated passenger demand. "
            "By dynamically balancing headways, NextRoute reduces average passenger wait times by twenty-three percent, "
            "cuts bunching events by sixty-five percent, and virtually eliminates left-behind riders."
        ),
    },
    {
        "id": "scene3_dispatcher",
        "text": (
            "Dispatchers can operate in automatic mode or manual supervisory mode. "
            "In manual mode, every recommendation provides a transparent operational reason and predicted passenger benefit. "
            "Let us approve a regularity hold on line 91 to space out the headway gap."
        ),
    },
    {
        "id": "scene4_telemetry",
        "text": (
            "Clicking any bus opens real-time telemetry, displaying an empirical trip load chart, passenger occupancy, and sensor health. "
            "Dispatchers can inspect the in-cab Driver Console, showing a live holding countdown. "
            "If a sensor fails or gets blocked, NextRoute detects the anomaly and automatically falls back to electronic ticket data."
        ),
    },
    {
        "id": "scene5_forecast",
        "text": (
            "To act proactively rather than reactively, NextRoute features a sixty-minute segment load forecast. "
            "Using time-of-day historical profiles and ridge regression, it anticipates overcrowding before it occurs, "
            "guiding flex-pool dispatches from Kilambakkam depot."
        ),
    },
    {
        "id": "scene6_report",
        "text": (
            "At the end of operations, dispatchers can inspect a comprehensive performance audit, "
            "comparing all key indicators and exporting data to CSV or J SON. "
            "Real network, genuine GTFS corridor, balanced transit. This is NextRoute. Thank you."
        ),
    },
]

TEMP_DIR = os.path.abspath("temp_video_build")
OUTPUT_VIDEO = os.path.abspath("nextroute_demo_walkthrough.mp4")
BUZZY_VIDEO = os.path.abspath("buzzy_demo_walkthrough.mp4")
SAMAM_VIDEO = os.path.abspath("samam_demo_walkthrough.mp4")


def get_media_duration(file_path: str) -> float:
    cmd = [FFMPEG, "-i", file_path, "-f", "null", "-"]
    res = subprocess.run(cmd, capture_output=True, text=True)
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)", res.stderr)
    if m:
        return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    return 0.0


async def generate_audio_tracks():
    shutil.rmtree(TEMP_DIR, ignore_errors=True)
    os.makedirs(TEMP_DIR, exist_ok=True)
    voice = "en-IN-PrabhatNeural"
    durations = {}

    print("Generating neural voiceover tracks...", flush=True)
    for scene in SCENES:
        sid = scene["id"]
        out_mp3 = os.path.join(TEMP_DIR, f"{sid}.mp3")
        comm = edge_tts.Communicate(scene["text"], voice=voice, rate="+2%")
        await comm.save(out_mp3)
        dur = get_media_duration(out_mp3)
        durations[sid] = dur
        print(f"  {sid}: {dur:.2f}s", flush=True)

    silence_mp3 = os.path.join(TEMP_DIR, "silence.mp3")
    cmd_silence = [FFMPEG, "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "2.0", silence_mp3]
    subprocess.run(cmd_silence, check=True, capture_output=True)

    concat_list = os.path.join(TEMP_DIR, "concat.txt")
    with open(concat_list, "w", encoding="utf-8") as f:
        for scene in SCENES:
            sid = scene["id"]
            mp3_path = os.path.join(TEMP_DIR, f"{sid}.mp3").replace("\\", "/")
            f.write(f"file '{mp3_path}'\n")
        f.write(f"file '{silence_mp3.replace('\\', '/')}'\n")

    master_audio = os.path.join(TEMP_DIR, "master_voiceover.mp3")
    cmd = [FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", concat_list, "-c", "copy", master_audio]
    subprocess.run(cmd, check=True, capture_output=True)
    total_audio_dur = get_media_duration(master_audio)
    print(f"Master voiceover ready: {total_audio_dur:.2f}s", flush=True)
    return durations, total_audio_dur, master_audio


async def record_walkthrough(durations: dict, total_audio_dur: float):
    rec_dir = os.path.join(TEMP_DIR, "raw_recordings")
    os.makedirs(rec_dir, exist_ok=True)

    print("Starting Playwright async browser recording...", flush=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-gpu"]
        )
        context = await browser.new_context(
            viewport={"width": 1920, "height": 1080},
            record_video_dir=rec_dir,
            record_video_size={"width": 1920, "height": 1080},
        )
        page = await context.new_page()

        # Injected smooth glowing visible cursor
        await page.add_init_script("""
            window.addEventListener('DOMContentLoaded', () => {
                const pointer = document.createElement('div');
                pointer.id = 'demo-cursor';
                pointer.style.cssText = `
                    position: fixed;
                    top: 0; left: 0;
                    width: 22px; height: 22px;
                    border-radius: 50%;
                    background: rgba(57, 135, 229, 0.75);
                    border: 2.5px solid #ffffff;
                    box-shadow: 0 0 14px rgba(57, 135, 229, 0.95);
                    pointer-events: none;
                    z-index: 99999999;
                    transform: translate(-50%, -50%);
                    transition: transform 0.12s ease, background 0.12s ease;
                `;
                document.body.appendChild(pointer);
                window.addEventListener('mousemove', (e) => {
                    pointer.style.left = e.clientX + 'px';
                    pointer.style.top = e.clientY + 'px';
                });
                window.addEventListener('mousedown', () => {
                    pointer.style.transform = 'translate(-50%, -50%) scale(0.65)';
                    pointer.style.background = 'rgba(250, 178, 25, 0.95)';
                });
                window.addEventListener('mouseup', () => {
                    pointer.style.transform = 'translate(-50%, -50%) scale(1)';
                    pointer.style.background = 'rgba(57, 135, 229, 0.75)';
                });
            });
        """)

        async def smooth_move(target_x, target_y, steps=25):
            await page.mouse.move(target_x, target_y, steps=steps)
            await asyncio.sleep(0.04)

        async def smooth_click(target_x, target_y):
            await smooth_move(target_x, target_y, steps=20)
            await asyncio.sleep(0.12)
            await page.mouse.down()
            await asyncio.sleep(0.15)
            await page.mouse.up()
            await asyncio.sleep(0.2)

        async def click_elem(selector):
            try:
                loc = page.locator(selector).first
                if await loc.count() > 0:
                    box = await loc.bounding_box()
                    if box:
                        await smooth_click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                        return True
                    else:
                        await loc.click()
                        return True
            except Exception as e:
                print(f"Warning: could not click {selector}: {e}", flush=True)
            return False

        print("Navigating to http://localhost:5173/...", flush=True)
        await page.goto("http://localhost:5173/")
        await page.wait_for_selector(".topbar", timeout=20000)
        await asyncio.sleep(3.0)

        # -------------------------------------------------------------
        # Scene 1: Introduction & Bunching Problem
        # -------------------------------------------------------------
        s1_dur = durations["scene1_intro"]
        print(f"Recording Scene 1 (Intro): {s1_dur:.2f}s", flush=True)
        t_start = asyncio.get_event_loop().time()
        await smooth_move(720, 500, steps=30)
        await asyncio.sleep(2.0)
        await smooth_move(880, 420, steps=30)
        await asyncio.sleep(2.5)
        await smooth_move(640, 620, steps=30)
        elapsed = asyncio.get_event_loop().time() - t_start
        if elapsed < s1_dur:
            await asyncio.sleep(s1_dur - elapsed)

        # -------------------------------------------------------------
        # Scene 2: Fixed Schedule vs NextRoute Comparison
        # -------------------------------------------------------------
        s2_dur = durations["scene2_comparison"]
        print(f"Recording Scene 2 (Comparison): {s2_dur:.2f}s", flush=True)
        t_start = asyncio.get_event_loop().time()
        await click_elem("button:has-text('Fixed schedule')")
        await asyncio.sleep(2.5)
        await click_elem("button:has-text('NextRoute')")
        await asyncio.sleep(2.0)
        await smooth_move(280, 1030, steps=25)
        await asyncio.sleep(1.5)
        await smooth_move(480, 1030, steps=25)
        await asyncio.sleep(1.5)
        await smooth_move(700, 1030, steps=25)
        await asyncio.sleep(1.5)
        await smooth_move(920, 1030, steps=25)
        elapsed = asyncio.get_event_loop().time() - t_start
        if elapsed < s2_dur:
            await asyncio.sleep(s2_dur - elapsed)

        # -------------------------------------------------------------
        # Scene 3: Dispatcher Console & Manual Mode
        # -------------------------------------------------------------
        s3_dur = durations["scene3_dispatcher"]
        print(f"Recording Scene 3 (Dispatcher Console): {s3_dur:.2f}s", flush=True)
        t_start = asyncio.get_event_loop().time()
        await click_elem(".console button:has-text('Manual')")
        await asyncio.sleep(1.8)
        await smooth_move(1720, 220, steps=25)
        await asyncio.sleep(1.5)
        approve_btn = page.locator(".console .acts button:has-text('Approve')").first
        if await approve_btn.count() > 0:
            box = await approve_btn.bounding_box()
            if box:
                await smooth_click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            else:
                await approve_btn.click()
            await asyncio.sleep(2.0)
        else:
            await asyncio.sleep(2.0)
        elapsed = asyncio.get_event_loop().time() - t_start
        if elapsed < s3_dur:
            await asyncio.sleep(s3_dur - elapsed)

        # -------------------------------------------------------------
        # Scene 4: Vehicle Telemetry, SVG Load Chart & Driver Console
        # -------------------------------------------------------------
        s4_dur = durations["scene4_telemetry"]
        print(f"Recording Scene 4 (Telemetry & Driver): {s4_dur:.2f}s", flush=True)
        t_start = asyncio.get_event_loop().time()
        await page.evaluate("""() => {
            if (window.__actions) {
                window.__actions.select(0);
            }
        }""")
        await asyncio.sleep(1.0)
        await smooth_move(160, 220, steps=25)
        await asyncio.sleep(1.5)
        # Hover over SVG load chart
        await smooth_move(160, 380, steps=25)
        await asyncio.sleep(2.0)
        # Click "Driver console" subtab to show in-cab phone mockup
        await click_elem("button:has-text('Driver console')")
        await asyncio.sleep(3.0)
        # Switch back to "Bus detail"
        await click_elem("button:has-text('Bus detail')")
        await asyncio.sleep(1.5)
        block_btn = page.locator("button:has-text('Block this sensor')")
        if await block_btn.count() > 0:
            await click_elem("button:has-text('Block this sensor')")
            await asyncio.sleep(2.0)
        elapsed = asyncio.get_event_loop().time() - t_start
        if elapsed < s4_dur:
            await asyncio.sleep(s4_dur - elapsed)

        # -------------------------------------------------------------
        # Scene 5: 60-Minute Forecast Canvas Heatmap
        # -------------------------------------------------------------
        s5_dur = durations["scene5_forecast"]
        print(f"Recording Scene 5 (Forecast Heatmap): {s5_dur:.2f}s", flush=True)
        t_start = asyncio.get_event_loop().time()
        await click_elem("nav.tabs button:has-text('Forecast')")
        await asyncio.sleep(2.0)
        # Move cursor over canvas heatmap cells to trigger tooltip
        await smooth_move(600, 300, steps=25)
        await asyncio.sleep(1.8)
        await smooth_move(780, 420, steps=25)
        await asyncio.sleep(2.0)
        # Click "Forecast vs actual" button
        await click_elem("button:has-text('Forecast vs actual')")
        await asyncio.sleep(2.0)
        # Click "60 min ahead" button
        await click_elem("button:has-text('60 min ahead')")
        await asyncio.sleep(1.8)
        # Switch back to "Load"
        await click_elem("button:has-text('Load')")
        await asyncio.sleep(1.5)
        elapsed = asyncio.get_event_loop().time() - t_start
        if elapsed < s5_dur:
            await asyncio.sleep(s5_dur - elapsed)

        # -------------------------------------------------------------
        # Scene 6: Comprehensive Report & Conclusion
        # -------------------------------------------------------------
        s6_dur = durations["scene6_report"]
        print(f"Recording Scene 6 (Run Report): {s6_dur:.2f}s", flush=True)
        t_start = asyncio.get_event_loop().time()
        await click_elem("nav.tabs button:has-text('Run report')")
        await asyncio.sleep(2.5)
        await smooth_move(960, 450, steps=20)
        await page.mouse.wheel(0, 380)
        await asyncio.sleep(2.5)
        csv_btn = page.locator("button:has-text('Export CSV')")
        if await csv_btn.count() > 0:
            box = await csv_btn.bounding_box()
            if box:
                await smooth_move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=20)
        await asyncio.sleep(2.0)
        elapsed = asyncio.get_event_loop().time() - t_start
        if elapsed < s6_dur:
            await asyncio.sleep(s6_dur - elapsed)

        print("Holding final screen for 2.0s...", flush=True)
        await asyncio.sleep(2.0)

        print("Closing context to flush video...", flush=True)
        video_obj = page.video
        await page.close()
        await context.close()
        video_path = await video_obj.path() if video_obj else None
        await browser.close()

    print(f"Raw video path: {video_path}", flush=True)
    if not video_path or not os.path.exists(video_path):
        vids = [os.path.join(rec_dir, f) for f in os.listdir(rec_dir) if f.endswith(".webm")]
        if not vids:
            raise RuntimeError("No video file recorded by Playwright.")
        video_path = vids[0]

    raw_dur = get_media_duration(video_path)
    print(f"Raw video recorded: {video_path} ({raw_dur:.2f}s)", flush=True)
    return video_path


def stitch_final_video(raw_video: str, master_audio: str):
    print("Stitching video and voiceover with ffmpeg...", flush=True)
    cmd = [
        FFMPEG,
        "-y",
        "-i",
        raw_video,
        "-i",
        master_audio,
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "22",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        OUTPUT_VIDEO,
    ]
    subprocess.run(cmd, check=True)
    shutil.copyfile(OUTPUT_VIDEO, BUZZY_VIDEO)
    shutil.copyfile(OUTPUT_VIDEO, SAMAM_VIDEO)
    final_dur = get_media_duration(OUTPUT_VIDEO)
    file_size_mb = os.path.getsize(OUTPUT_VIDEO) / (1024 * 1024)
    print(f"SUCCESS! Output Video: {OUTPUT_VIDEO}", flush=True)
    print(f"Also copied to: {BUZZY_VIDEO} and {SAMAM_VIDEO}", flush=True)
    print(f"Duration: {final_dur:.2f}s | Size: {file_size_mb:.2f} MB | Resolution: 1920x1080", flush=True)


async def main():
    durations, total_dur, master_audio = await generate_audio_tracks()
    raw_video = await record_walkthrough(durations, total_dur)
    stitch_final_video(raw_video, master_audio)
    try:
        shutil.rmtree(TEMP_DIR)
    except Exception:
        pass


if __name__ == "__main__":
    asyncio.run(main())
