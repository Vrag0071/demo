from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "assets" / "latte-stages-v2.png"
TARGET = ROOT / "public" / "assets" / "latte-stages-v2-aligned.png"

FRAME_COUNT = 6
BACKGROUND = (12, 18, 15)
THRESHOLD = 52
PADDING = 18


def is_object_pixel(pixel: tuple[int, int, int]) -> bool:
    distance = sum(abs(pixel[index] - BACKGROUND[index]) for index in range(3))
    very_dark = pixel[0] < 34 and pixel[1] < 42 and pixel[2] < 38
    return distance > THRESHOLD and not very_dark


def find_bbox(panel: Image.Image) -> tuple[int, int, int, int]:
    width, height = panel.size
    pixels = panel.load()
    left, top = width, height
    right, bottom = 0, 0

    for y in range(height):
        for x in range(width):
            if is_object_pixel(pixels[x, y]):
                left = min(left, x)
                top = min(top, y)
                right = max(right, x)
                bottom = max(bottom, y)

    if left > right or top > bottom:
        raise RuntimeError("Could not detect cup bounds in a sprite frame.")

    return left, top, right, bottom


def crop_with_padding(panel: Image.Image, bbox: tuple[int, int, int, int]) -> tuple[Image.Image, tuple[int, int, int, int]]:
    width, height = panel.size
    left, top, right, bottom = bbox
    crop_box = (
        max(0, left - PADDING),
        max(0, top - PADDING),
        min(width, right + PADDING + 1),
        min(height, bottom + PADDING + 1),
    )
    return panel.crop(crop_box), crop_box


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    width, height = source.size
    frame_width = width // FRAME_COUNT

    panels = [source.crop((index * frame_width, 0, (index + 1) * frame_width, height)) for index in range(FRAME_COUNT)]
    bounds = [find_bbox(panel) for panel in panels]
    object_bottoms = [bbox[3] for bbox in bounds]
    target_center_x = frame_width // 2
    target_bottom_y = max(object_bottoms)

    output = Image.new("RGB", source.size, BACKGROUND)

    for index, panel in enumerate(panels):
        bbox = bounds[index]
        crop, crop_box = crop_with_padding(panel, bbox)
        left, top, right, bottom = bbox
        crop_left, crop_top, _, _ = crop_box

        object_center_x_in_crop = ((left + right) / 2) - crop_left
        object_bottom_in_crop = bottom - crop_top
        paste_x = round(index * frame_width + target_center_x - object_center_x_in_crop)
        paste_y = round(target_bottom_y - object_bottom_in_crop)

        output.paste(crop, (paste_x, paste_y))

        print(
            f"frame {index + 1}: center {((left + right) / 2):.1f} -> {target_center_x}, "
            f"bottom {bottom} -> {target_bottom_y}, paste=({paste_x}, {paste_y})"
        )

    output.save(TARGET, optimize=True)
    print(f"saved {TARGET}")


if __name__ == "__main__":
    main()
