#!/usr/bin/env python3
"""Combine frame PNGs into animated GIFs."""
import sys
from pathlib import Path
from PIL import Image

frames_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/tmp/recomposable-frames')
out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('screenshots')

SPEED = 3  # speed multiplier

# Frame durations in ms (at 1x speed)
base_durations = [
    2500,  #  1: initial list — cursor on api-gateway
    1500,  #  2: navigate down to auth-service
    2000,  #  3: rebuilding — first batch of logs
    3000,  #  4: rebuilding — full build logs
    2500,  #  5: full screen logs
    1200,  #  6: search prompt "/ses"
    1200,  #  7: search prompt "/session"
    3500,  #  8: search results highlighted
    2000,  #  9: back to list, api-gateway with logs
    1500,  # 10: worktree picker opened — main highlighted
    2500,  # 11: worktree picker — navigated to feat-rate-limiting
    2000,  # 12: worktree switched + rebuilding api-gateway — few lines
    3000,  # 13: rebuilding api-gateway — full logs
    1200,  # 14: navigate to auth-service
    1200,  # 15: navigate to user-service
    2000,  # 16: exec opened
    2000,  # 17: exec — typing pwd
    3500,  # 18: exec — pwd result
]

durations = [max(50, d // SPEED) for d in base_durations]

# Worktree-only frames: 9-13 (back to list → picker → switched → rebuild)
WORKTREE_FRAMES = list(range(9, 14))
worktree_durations = [durations[i - 1] for i in WORKTREE_FRAMES]


def load_frames(indices: list[int]) -> list[Image.Image]:
    images = []
    for i in indices:
        path = frames_dir / f'frame-{i}.png'
        if not path.exists():
            print(f'Missing: {path}')
            sys.exit(1)
        images.append(Image.open(path).convert('RGBA'))
    return images


def normalize(images: list[Image.Image]) -> list[Image.Image]:
    max_w = max(img.width for img in images)
    max_h = max(img.height for img in images)
    result = []
    for img in images:
        if img.width == max_w and img.height == max_h:
            result.append(img.convert('RGB'))
        else:
            canvas = Image.new('RGB', (max_w, max_h), (30, 30, 30))
            canvas.paste(img, (0, 0))
            result.append(canvas)
    return result


def save_gif(images: list[Image.Image], durs: list[int], path: Path):
    norm = normalize(images)
    norm[0].save(
        path,
        save_all=True,
        append_images=norm[1:],
        duration=durs,
        loop=0,
        optimize=True,
    )
    size_kb = path.stat().st_size / 1024
    w, h = norm[0].size
    print(f'  {path} ({w}x{h}, {len(norm)} frames, {size_kb:.0f}KB)')


print(f'Speed: {SPEED}x')

# Full demo GIF
all_indices = list(range(1, len(base_durations) + 1))
all_images = load_frames(all_indices)
save_gif(all_images, durations, out_dir / 'demo.gif')

# Worktree-only GIF
wt_images = load_frames(WORKTREE_FRAMES)
save_gif(wt_images, worktree_durations, out_dir / 'worktree.gif')
