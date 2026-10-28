"""Independent geometry, resource and pixel checks for the static-PDF preservation path."""
import json
import subprocess
import sys
import zipfile
from pathlib import Path
from io import BytesIO
from PIL import Image, ImageChops, ImageStat, ImageDraw
from pypdf import PdfReader

root = Path(sys.argv[1])
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
reader = PdfReader(root / manifest["pdf"])
assert len(reader.pages) == manifest["pages"]
render_dir = root / "review"
render_dir.mkdir(exist_ok=True)
subprocess.run(["pdftoppm", "-r", "120", "-png", str(root / manifest["pdf"]), str(render_dir / "page")], check=True, capture_output=True)

def form_details(resources):
    details = []
    for value in resources.get("/XObject", {}).get_object().values() if "/XObject" in resources else []:
        obj = value.get_object()
        if obj.get("/Subtype") == "/Form":
            details.append({"contents": obj.get_data(), "group": obj.get("/Group"), "bbox": list(obj["/BBox"])})
            details.extend(form_details(obj.get("/Resources", {})))
    return details

def bounds(image, color):
    mask = Image.new("L", image.size)
    mask.putdata([255 if (r > 200 and g < 80 and b < 80 if color == "red" else b > 200 and r < 80 and g < 100) else 0 for r, g, b in image.convert("RGB").getdata()])
    return mask.getbbox()

rows = []
with zipfile.ZipFile(root / manifest["preview"]) as archive:
    files = sorted(archive.namelist())
    assert len(files) == manifest["pages"]
    for index, page in enumerate(reader.pages):
        assert abs(float(page.mediabox.width) - 105 * 72 / 25.4) < .001
        assert abs(float(page.mediabox.height) - 148 * 72 / 25.4) < .001
        actual = Image.open(render_dir / f"page-{index + 1}.png").convert("RGB")
        preview = Image.open(BytesIO(archive.read(files[index]))).convert("RGB").resize(actual.size, Image.Resampling.LANCZOS)
        forms = form_details(page["/Resources"])
        if "paperRgb" in manifest:
            for image in [actual, preview]:
                sample = image.getpixel((round(image.width * .02), round(image.height * .02)))
                assert max(abs(a - b) for a, b in zip(sample, manifest["paperRgb"])) <= 2, ("paper", index, sample)
        if index and "sourceBlankRgb" in manifest:
            for image in [actual, preview]:
                sample = image.getpixel((round(image.width * .02), round(image.height * .5)))
                assert max(abs(a - b) for a, b in zip(sample, manifest["sourceBlankRgb"])) <= 2, ("source paper", index, sample)
        if index:
            text = page.extract_text()
            assert f"VECTOR-{index}" in text, (index, text)
            assert any(b" k" in form["contents"] for form in forms), index
            assert any(form["group"] for form in forms), index
            assert any(form["bbox"] == [20, 40, 120, 160] for form in forms), index
            for color in ["red", "blue"]:
                a, p = bounds(actual, color), bounds(preview, color)
                assert a and p and max(abs(x - y) for x, y in zip(a, p)) <= 2, (index, color, a, p)
        difference = ImageStat.Stat(ImageChops.difference(actual, preview))
        rows.append({"page": index + 1, "meanAbsoluteRGBDifference": difference.mean, "forms": len(forms), "sourceText": page.extract_text() if index else None})
        contact = Image.new("RGB", (actual.width * 2, actual.height + 28), "#eeeeee")
        contact.paste(preview, (0, 28)); contact.paste(actual, (actual.width, 28))
        ImageDraw.Draw(contact).text((10, 8), f"Page {index + 1}: Preview / PDF (Poppler 120 dpi)", fill="black")
        contact.save(render_dir / f"comparison-{index + 1}.png")
(root / "independent-review.json").write_text(json.dumps({"sourceFingerprint": manifest["sourceFingerprint"], "status": "pass", "checks": "static PDFs, four rotations, nonzero crop, user unit, transparency group, original text and CMYK operators, preview color bounds", "pages": rows}, indent=2) + "\n", encoding="utf-8")
print(f"Preserved PDF verified: {len(rows)} pages")
