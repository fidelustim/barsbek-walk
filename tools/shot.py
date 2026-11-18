#!/usr/bin/env python3
"""Скриншот страницы в headless-Chromium через CDP (без облачного браузера).

Примеры:
  python3 tools/shot.py --url 'https://.../?loc=yard' --out /tmp/a.png --wait 25
  python3 tools/shot.py --url '...' --out /tmp/a.png --wait 40 \
      --js "__game.setCam(0.0,-0.1,3.4)" --js2 "__game.snap(640,400)" --raw-js2

--js  : выполнить до скриншота (можно несколько)
--raw-js2: результат последнего --js2 сохранить как есть (data URL/base64) в --out
"""
import argparse, asyncio, base64, json, os, shutil, signal, subprocess, sys, time, urllib.request

CHROME = os.path.expanduser('~/.hermes/tools/chromium-1208/chrome-linux64/chrome.bin')
# Chromium из ~/.hermes/tools требует библиотеки, распакованные без root в ~/opt/chromium-libs
LIBS = ':'.join(os.path.expanduser(p) for p in (
    '~/opt/chromium-libs/usr/lib/x86_64-linux-gnu', '~/opt/chromium-libs/lib/x86_64-linux-gnu'))


def launch(port, user_dir, w, h):
    os.makedirs(user_dir, exist_ok=True)
    # Флаги как у рабочего локального chromium Hermes: headless + программный WebGL (SwiftShader).
    # Проверено: именно --use-angle=swiftshader + --enable-unsafe-swiftshader дают WebGL2 на SwiftShader.
    # --disable-gpu или --disable-software-rasterizer ломают WebGL (проверено: 'no webgl2').
    args = [CHROME, '--headless=new', f'--remote-debugging-port={port}', f'--user-data-dir={user_dir}',
            '--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
            '--hide-scrollbars', '--mute-audio', '--no-first-run', '--disable-extensions',
            f'--window-size={w},{h}', 'about:blank']
    # Без fontconfig и хотя бы одного шрифта Skia в этом Chromium падает с FATAL ... SkFontMgr ... Not implemented
    env = dict(os.environ, LD_LIBRARY_PATH=(LIBS + ':' + os.environ.get('LD_LIBRARY_PATH', '')).rstrip(':'),
               FONTCONFIG_FILE=os.path.expanduser('~/.config/fontconfig/fonts.conf'),
               FONTCONFIG_PATH=os.path.expanduser('~/.config/fontconfig'))
    log = open(os.path.expanduser('~/projects/barsbek-walk/.chrome.log'), 'wb')
    p = subprocess.Popen(args, stdout=log, stderr=log, env=env)
    for _ in range(60):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version', timeout=1) as r:
                return p, json.load(r)
        except Exception:
            time.sleep(0.5)
    p.kill()
    raise RuntimeError('Chrome не поднялся')


class CDP:
    def __init__(self, ws):
        self.ws, self.n = ws, 0

    async def send(self, method, **params):
        self.n += 1
        await self.ws.send(json.dumps({'id': self.n, 'method': method, 'params': params}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get('id') == self.n:
                if 'error' in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get('result', {})

    async def ev(self, expr, await_promise=False):
        r = await self.send('Runtime.evaluate', expression=expr, returnByValue=True, awaitPromise=await_promise)
        if 'exceptionDetails' in r:
            raise RuntimeError(str(r['exceptionDetails'])[:300])
        return r['result'].get('value')


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--wait', type=int, default=25, help='секунд ждать загрузку')
    ap.add_argument('--poll', default="document.title", help='JS-проверка готовности (true = готово)')
    ap.add_argument('--max-wait', type=int, default=180)
    ap.add_argument('--js', action='append', default=[], help='JS перед скриншотом (можно несколько)')
    ap.add_argument('--size', default='800,500')
    ap.add_argument('--port', type=int, default=9333)
    ap.add_argument('--keep', action='store_true')
    ap.add_argument('--console', action='store_true', help='печатать логи консоли страницы')
    a = ap.parse_args()
    w, h = (int(x) for x in a.size.split(','))
    user_dir = os.path.expanduser('~/.hermes/profiles/video/cache/scratch/bw-chrome')
    proc, ver = launch(a.port, user_dir, w, h)
    try:
        import websockets
        targets = json.load(urllib.request.urlopen(f'http://127.0.0.1:{a.port}/json/list'))
        page = [t for t in targets if t['type'] == 'page'][0]
        async with websockets.connect(page['webSocketDebuggerUrl'], max_size=64 * 1024 * 1024) as ws:
            c = CDP(ws)
            await c.send('Page.enable')
            await c.send('Runtime.enable')
            await c.send('Network.enable')
            await c.send('Network.setCacheDisabled', cacheDisabled=True)
            await c.send('Emulation.setDeviceMetricsOverride', width=w, height=h, deviceScaleFactor=1, mobile=False)
            if a.console:
                asyncio.ensure_future(read_console(ws))
            await c.send('Page.navigate', url=a.url)
            t0 = time.time()
            ready = False
            while time.time() - t0 < a.max_wait:
                await asyncio.sleep(2)
                try:
                    v = await c.ev(a.poll)
                except Exception:
                    v = None
                print(f'  [{int(time.time() - t0)}s] {str(v)[:110]}', flush=True)
                # готово, если JS вернул true/число или строку, не начинающуюся с loading/err
                if v is True or (isinstance(v, (int, float)) and v) or (
                        isinstance(v, str) and v and not v.lower().startswith(('loading', 'err'))):
                    ready = True
                    break
            if not ready:
                print('  ! готовность не подтверждена, снимаю как есть')
            await asyncio.sleep(a.wait)
            for expr in a.js:
                print('  js:', str(await c.ev(expr))[:200], flush=True)
                await asyncio.sleep(1.0)
            shot = await c.send('Page.captureScreenshot', format='png')
            data = base64.b64decode(shot['data'])
            with open(a.out, 'wb') as f:
                f.write(data)
            print(f'  сохранено {a.out} ({len(data)} байт)')
    finally:
        if not a.keep:
            proc.send_signal(signal.SIGTERM)
            try:
                proc.wait(timeout=10)
            except Exception:
                proc.kill()
        else:
            print(f'  chrome оставлен, pid={proc.pid}, порт {a.port}')


async def read_console(ws):
    async for raw in ws:
        m = json.loads(raw)
        if m.get('method') in ('Runtime.consoleAPICalled', 'Log.entryAdded', 'Runtime.exceptionThrown'):
            print('  [console]', json.dumps(m['params'])[:300], flush=True)


if __name__ == '__main__':
    asyncio.run(main())
