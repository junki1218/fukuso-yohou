# -*- coding: utf-8 -*-
"""納品された assets/ を、アプリが使う app/img/ 向けに正規化する。

やること:
  1. 余白をトリムして、絵の大きさと中心位置を枚ごとに揃える
     （納品時は線寸法で11〜20%ばらつき、wx_fog/wx_drizzle が中心から最大84pxズレていた）
  2. 天気・雨具は正方形、服装は縦長の枠に収める（服装は幅:高さ≈1:1.8のため）
  3. app_icon から PWA 用の 192/512 を書き出す

納品原本（assets/）は読むだけで、書き換えない。
"""
import os
import sys
import io
from PIL import Image

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'assets')
DST = os.path.join(ROOT, 'app', 'img')

WEAR = ['wear_1_tee_shorts', 'wear_2_tee_pants', 'wear_3_shirt',
        'wear_4_longsleeve', 'wear_5_jacket', 'wear_6_coat']
SQUARE = ['wx_clear', 'wx_partly', 'wx_cloudy', 'wx_fog', 'wx_drizzle',
          'wx_rain', 'wx_heavy_rain', 'wx_shower', 'wx_sleet', 'wx_snow',
          'wx_thunder']
# 雨具は正方形の枠に入れない。閉じた傘は縦横比が約1:3.6で、
# 正方形に収めると横幅が4px程度まで潰れて何の絵か分からなくなるため、
# 余白なしで切り出し、CSS 側で「高さ基準」で並べる。
GEAR = ['gear_umbrella', 'gear_boots']


def normalize(name, box, fill):
    """絵をトリムし、box の中で fill の割合を占めるよう拡大縮小して中央に置く。"""
    im = Image.open(os.path.join(SRC, name + '.png')).convert('RGBA')
    bb = im.split()[-1].getbbox()
    im = im.crop(bb)
    bw, bh = box
    scale = min(bw * fill / im.width, bh * fill / im.height)
    im = im.resize((max(1, round(im.width * scale)),
                    max(1, round(im.height * scale))), Image.LANCZOS)
    out = Image.new('RGBA', box, (0, 0, 0, 0))
    out.alpha_composite(im, ((bw - im.width) // 2, (bh - im.height) // 2))
    out.save(os.path.join(DST, name + '.png'), optimize=True)
    return im.size


def main():
    os.makedirs(DST, exist_ok=True)
    print('■ 正規化')

    for n in WEAR:
        w, h = normalize(n, (240, 360), 0.94)
        print('  %-22s -> 240x360  絵 %dx%d' % (n, w, h))

    for n in SQUARE:
        w, h = normalize(n, (256, 256), 0.90)
        print('  %-22s -> 256x256  絵 %dx%d' % (n, w, h))

    for n in GEAR:
        im = Image.open(os.path.join(SRC, n + '.png')).convert('RGBA')
        im = im.crop(im.split()[-1].getbbox())
        s = 256 / im.height                      # 高さを揃える（幅は絵なり）
        im = im.resize((max(1, round(im.width * s)), 256), Image.LANCZOS)
        im.save(os.path.join(DST, n + '.png'), optimize=True)
        print('  %-22s -> %dx256（余白なし・高さ基準）' % (n, im.width))

    ic = Image.open(os.path.join(SRC, 'app_icon.png')).convert('RGB')
    for sz in (192, 512):
        ic.resize((sz, sz), Image.LANCZOS).save(
            os.path.join(DST, 'icon-%d.png' % sz), optimize=True)
        print('  app_icon               -> icon-%d.png' % sz)
    # maskable: 安全領域を確保するため周囲に余白を足す
    m = Image.new('RGB', (512, 512), '#3aa6e8')
    t = ic.resize((410, 410), Image.LANCZOS)
    m.paste(t, (51, 51))
    m.save(os.path.join(DST, 'icon-maskable.png'), optimize=True)
    print('  app_icon               -> icon-maskable.png')

    print()
    print('■ 検算（揃ったか）')
    for label, names, box in (('服装', WEAR, (240, 360)), ('天気', SQUARE, (256, 256))):
        sides = []
        offs = []
        for n in names:
            im = Image.open(os.path.join(DST, n + '.png')).convert('RGBA')
            bb = im.split()[-1].getbbox()
            sides.append(max(bb[2] - bb[0], bb[3] - bb[1]))
            offs.append((abs((bb[0] + bb[2]) / 2 - box[0] / 2),
                         abs((bb[1] + bb[3]) / 2 - box[1] / 2)))
        print('  %-10s 最大辺 %d〜%dpx（差%dpx）  中心ズレ 最大 x%.1f y%.1f px'
              % (label, min(sides), max(sides), max(sides) - min(sides),
                 max(o[0] for o in offs), max(o[1] for o in offs)))


if __name__ == '__main__':
    main()
