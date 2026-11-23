"""Generate placeholder app/tray icons (near-black rounded square, white Q, orange dot). Replace with the brand mark later."""
from PIL import Image, ImageDraw, ImageFont

def icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = size // 5
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=(37, 37, 35, 255))
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", int(size * 0.62))
    except OSError:
        font = ImageFont.load_default()
    box = d.textbbox((0, 0), "Q", font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((size - w) / 2 - box[0], (size - h) / 2 - box[1] - size * 0.03), "Q", font=font, fill=(255, 255, 255, 255))
    dot = size * 0.16
    d.ellipse([size - dot * 1.6, size - dot * 1.6, size - dot * 0.6, size - dot * 0.6], fill=(249, 109, 52, 255))
    return img

icon(512).save("assets/icon.png")
icon(64).save("assets/tray.png")
print("icons written")
