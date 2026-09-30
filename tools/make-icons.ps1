# Makes the site's icons from static/logo.png (a rounded square on a white background).
# Re-run it whenever the logo changes, from the repo folder:
#   powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class LogoIcons
{
    const int NearWhite = 200; // average of R, G and B

    // The logo's rounded square with the white surround made see-through,
    // cropped to a square. `fill` is the rounded square's own colour.
    public static Bitmap CutOut(Bitmap logo, out Color fill)
    {
        int w = logo.Width, h = logo.Height;
        Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(bmp)) g.DrawImage(logo, new Rectangle(0, 0, w, h));

        BitmapData data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        int stride = data.Stride;
        byte[] px = new byte[stride * h];
        Marshal.Copy(data.Scan0, px, 0, px.Length);

        // Flood-fill the near-white surround in from the edges of the image.
        // Light areas inside the rounded square (like the wings) aren't reached.
        bool[] outside = new bool[w * h];
        Queue<int> queue = new Queue<int>();
        for (int x = 0; x < w; x++) { Visit(px, stride, w, h, x, 0, outside, queue); Visit(px, stride, w, h, x, h - 1, outside, queue); }
        for (int y = 0; y < h; y++) { Visit(px, stride, w, h, 0, y, outside, queue); Visit(px, stride, w, h, w - 1, y, outside, queue); }
        while (queue.Count > 0)
        {
            int p = queue.Dequeue(), x = p % w, y = p / w;
            Visit(px, stride, w, h, x + 1, y, outside, queue);
            Visit(px, stride, w, h, x - 1, y, outside, queue);
            Visit(px, stride, w, h, x, y + 1, outside, queue);
            Visit(px, stride, w, h, x, y - 1, outside, queue);
        }

        // The rounded square's colour, a little way in from its left edge.
        int midY = h / 2, edge = 0;
        while (edge < w && outside[midY * w + edge]) edge++;
        int si = midY * stride + Math.Min(w - 1, edge + w / 50) * 4;
        fill = Color.FromArgb(px[si + 2], px[si + 1], px[si]);
        int fillLum = (fill.R + fill.G + fill.B) / 3;

        int minX = w, minY = h, maxX = -1, maxY = -1;
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                int i = y * stride + x * 4;
                if (outside[y * w + x])
                {
                    // See-through, but coloured like the fill so resizing doesn't
                    // bleed white into the edge.
                    px[i] = fill.B; px[i + 1] = fill.G; px[i + 2] = fill.R; px[i + 3] = 0;
                    continue;
                }
                if (NearOutside(outside, w, h, x, y, 2))
                {
                    // Smoothed edge pixels are a blend of the fill and white:
                    // turn the white part into transparency.
                    double a = (255.0 - Lum(px, i)) / (255.0 - fillLum);
                    px[i] = fill.B; px[i + 1] = fill.G; px[i + 2] = fill.R;
                    px[i + 3] = (byte)Math.Round(255 * Math.Max(0.0, Math.Min(1.0, a)));
                }
                if (px[i + 3] > 0)
                {
                    minX = Math.Min(minX, x); maxX = Math.Max(maxX, x);
                    minY = Math.Min(minY, y); maxY = Math.Max(maxY, y);
                }
            }
        }
        Marshal.Copy(px, 0, data.Scan0, px.Length);
        bmp.UnlockBits(data);

        // Crop to a square around the rounded square (the surround is see-through now).
        int side = Math.Max(maxX - minX + 1, maxY - minY + 1);
        int left = Math.Max(0, Math.Min(w - side, (minX + maxX + 1 - side) / 2));
        int top = Math.Max(0, Math.Min(h - side, (minY + maxY + 1 - side) / 2));
        Bitmap square = bmp.Clone(new Rectangle(left, top, side, side), PixelFormat.Format32bppArgb);
        bmp.Dispose();
        return square;
    }

    // The cutout made fully opaque. Its see-through pixels already carry the
    // fill colour, so this is the art with the surround filled in.
    public static Bitmap Flatten(Bitmap cutout)
    {
        Bitmap flat = new Bitmap(cutout.Width, cutout.Height, PixelFormat.Format32bppArgb);
        int stride;
        byte[] px = Bytes(cutout, out stride);
        for (int i = 3; i < px.Length; i += 4) px[i] = 255;
        SetBytes(flat, px);
        return flat;
    }

    // A see-through-cornered icon: colour from the opaque art, shape from the
    // cutout. Resizing them separately stops the edge picking up a light ring.
    public static Bitmap Icon(Bitmap cutout, Bitmap flat, int size)
    {
        Bitmap color = Draw(flat, size, 1.0, Color.Transparent);
        using (Bitmap shape = Draw(cutout, size, 1.0, Color.Transparent))
        {
            int stride;
            byte[] c = Bytes(color, out stride), a = Bytes(shape, out stride);
            for (int i = 3; i < c.Length; i += 4) c[i] = a[i];
            SetBytes(color, c);
        }
        return color;
    }

    // `art` scaled to `scale` of the canvas, centred on a solid background.
    public static Bitmap OnBackground(Bitmap art, int size, double scale, Color background)
    {
        return Draw(art, size, scale, background);
    }

    static Bitmap Draw(Bitmap art, int size, double scale, Color background)
    {
        Bitmap dst = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        int s = (int)Math.Round(size * scale), o = (size - s) / 2;
        using (Graphics g = Graphics.FromImage(dst))
        using (ImageAttributes attrs = new ImageAttributes())
        {
            g.Clear(background);
            g.CompositingQuality = CompositingQuality.HighQuality;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            attrs.SetWrapMode(WrapMode.TileFlipXY); // no dark fringe at the edges
            g.DrawImage(art, new Rectangle(o, o, s, s), 0, 0, art.Width, art.Height, GraphicsUnit.Pixel, attrs);
        }
        return dst;
    }

    static void Visit(byte[] px, int stride, int w, int h, int x, int y, bool[] outside, Queue<int> queue)
    {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        int p = y * w + x;
        if (outside[p] || Lum(px, y * stride + x * 4) <= NearWhite) return;
        outside[p] = true;
        queue.Enqueue(p);
    }

    static bool NearOutside(bool[] outside, int w, int h, int x, int y, int r)
    {
        for (int yy = Math.Max(0, y - r); yy <= Math.Min(h - 1, y + r); yy++)
            for (int xx = Math.Max(0, x - r); xx <= Math.Min(w - 1, x + r); xx++)
                if (outside[yy * w + xx]) return true;
        return false;
    }

    static int Lum(byte[] px, int i)
    {
        return (px[i] + px[i + 1] + px[i + 2]) / 3;
    }

    static byte[] Bytes(Bitmap bmp, out int stride)
    {
        BitmapData d = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        stride = d.Stride;
        byte[] px = new byte[stride * bmp.Height];
        Marshal.Copy(d.Scan0, px, 0, px.Length);
        bmp.UnlockBits(d);
        return px;
    }

    static void SetBytes(Bitmap bmp, byte[] px)
    {
        BitmapData d = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(px, 0, d.Scan0, px.Length);
        bmp.UnlockBits(d);
    }
}
"@

$static = Join-Path (Split-Path -Parent $PSScriptRoot) "static"
$fill = [System.Drawing.Color]::Empty
$logo = New-Object System.Drawing.Bitmap (Join-Path $static "logo.png")
try { $cutout = [LogoIcons]::CutOut($logo, [ref]$fill) } finally { $logo.Dispose() }
$flat = [LogoIcons]::Flatten($cutout)

function Save($bitmap, $name) {
  $path = Join-Path $static $name
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
  "{0,-24} {1,6:N1} KB" -f $name, ((Get-Item $path).Length / 1KB)
}

# Browser tab and desktop app: the rounded square with see-through corners.
Save ([LogoIcons]::Icon($cutout, $flat, 32)) "favicon-32.png"
Save ([LogoIcons]::Icon($cutout, $flat, 192)) "icon-192.png"
Save ([LogoIcons]::Icon($cutout, $flat, 512)) "icon-512.png"

# Android cuts app icons to its own shape (often a circle), so these fill the
# square with the logo's colour and keep the bee inside the middle 70%.
Save ([LogoIcons]::OnBackground($flat, 192, 0.70, $fill)) "icon-maskable-192.png"
Save ([LogoIcons]::OnBackground($flat, 512, 0.70, $fill)) "icon-maskable-512.png"

# iPhone home screen: see-through areas turn black there, and iOS rounds the corners itself.
Save ([LogoIcons]::OnBackground($flat, 180, 0.84, $fill)) "apple-touch-icon.png"

$cutout.Dispose()
$flat.Dispose()
"Logo colour (use for theme_color): #{0:x2}{1:x2}{2:x2}" -f $fill.R, $fill.G, $fill.B
