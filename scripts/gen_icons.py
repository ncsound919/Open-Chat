"""Generate Android launcher icons for Open-Chat from the 1024x1024 logo."""
import os
from PIL import Image, ImageDraw

LOGO = "public/open chat logo.png"
RES = "android/app/src/main/res"

# density -> (launcher px, adaptive foreground px)
DENSITIES = {
    "mipmap-mdpi": (48, 108),
    "mipmap-hdpi": (72, 162),
    "mipmap-xhdpi": (96, 216),
    "mipmap-xxhdpi": (144, 324),
    "mipmap-xxxhdpi": (192, 432),
}

FORE_SAFE = 0.66  # adaptive-icon safe zone fraction


def make_round(im, size):
    im = im.convert("RGBA").resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse((0, 0, size, size), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    return out


def main():
    logo = Image.open(LOGO).convert("RGBA")
    for den, (icon_px, fore_px) in DENSITIES.items():
        d = os.path.join(RES, den)
        # Square launcher
        logo.resize((icon_px, icon_px), Image.LANCZOS).save(
            os.path.join(d, "ic_launcher.png"), "PNG"
        )
        # Round launcher
        make_round(logo, icon_px).save(
            os.path.join(d, "ic_launcher_round.png"), "PNG"
        )
        # Adaptive foreground: logo scaled to safe zone, centered on transparent
        content = int(fore_px * FORE_SAFE)
        fg = Image.new("RGBA", (fore_px, fore_px), (0, 0, 0, 0))
        logo.resize((content, content), Image.LANCZOS)
        fg.paste(
            logo.resize((content, content), Image.LANCZOS),
            ((fore_px - content) // 2, (fore_px - content) // 2),
        )
        fg.save(os.path.join(d, "ic_launcher_foreground.png"), "PNG")
        print("wrote", den)


if __name__ == "__main__":
    main()
