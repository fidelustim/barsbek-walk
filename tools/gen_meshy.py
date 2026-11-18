import fal_client, os, json, urllib.request, time, sys
os.environ['FAL_KEY'] = [l.split('=', 1)[1].strip().strip('"\'') for l in open(os.path.expanduser('~/.bashrc')) if 'FAL_KEY=' in l][0]
S = os.path.expanduser('~/projects/barsbek-walk/source-art/')
O = os.path.expanduser('~/projects/barsbek-walk/source-art/meshy_v2/')
os.makedirs(O, exist_ok=True)
log = open(O + 'log.json', 'a')

def save(url, name):
    p = O + name
    urllib.request.urlretrieve(url, p)
    print('saved', p, os.path.getsize(p) // 1024, 'KB', flush=True)
    return p

step = sys.argv[1] if len(sys.argv) > 1 else 'all'

if step in ('all', 'mesh'):
    imgs = [fal_client.upload_file(S + f'v2b_{n}.png') for n in ('front', 'side', 'back')]
    args = {
        'image_urls': imgs,
        'symmetry_mode': 'auto',
        'pose_mode': 'a-pose',
        'topology': 'triangle',
        'target_polycount': 30000,
        'should_texture': True,
        'enable_pbr': False,
        'texture_prompt': 'anthropomorphic snow leopard in a dusty sage-green hoodie, dark charcoal joggers, off-white sneakers; smoky-white fur with charcoal spots, pale icy green-grey eyes; long fluffy tail with charcoal ring rosettes and a black tip',
        'enable_rigging': False,
    }
    t0 = time.time()
    r = fal_client.subscribe('meshy/v7.1/multi-image-to-3d', arguments=args, client_timeout=1500)
    print('mesh done in', int(time.time() - t0), 's', flush=True)
    log.write(json.dumps({'step': 'mesh', 'result': r}) + '\n'); log.flush()
    save(r['model_glb']['url'], 'barsbek_mesh.glb')
    if r.get('thumbnail'): save(r['thumbnail']['url'], 'thumb.png')
    json.dump({'model_glb': r['model_glb']['url']}, open(O + 'mesh_url.json', 'w'))

if step in ('all', 'rig'):
    model_url = json.load(open(O + 'mesh_url.json'))['model_glb']
    t0 = time.time()
    r = fal_client.subscribe('meshy/rigging/multi-animation', arguments={
        'model_url': model_url,
        'height_meters': 1.8,
        'animation_action_ids': [0, 466],   # Idle, Regular_Jump (ходьба и бег приходят в basic_animations)
    }, client_timeout=1500)
    print('rig done in', int(time.time() - t0), 's', flush=True)
    log.write(json.dumps({'step': 'rig', 'result': r}) + '\n'); log.flush()
    save(r['rigged_character_glb']['url'], 'rigged.glb')
    ba = r.get('basic_animations') or {}
    if ba.get('walking_glb'): save(ba['walking_glb']['url'], 'walking.glb')
    if ba.get('running_glb'): save(ba['running_glb']['url'], 'running.glb')
    for a in r.get('animations') or []:
        save(a['animation_glb']['url'], f"anim_{a['action_id']}.glb")
