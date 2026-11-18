import fal_client, os, json, urllib.request
os.environ['FAL_KEY'] = [l.split('=', 1)[1].strip().strip('"\'') for l in open(os.path.expanduser('~/.bashrc')) if 'FAL_KEY=' in l][0]
I = os.path.expanduser('~/video-projects/ilbirs/assets/master/')
O = os.path.expanduser('~/projects/barsbek-walk/source-art/')
os.makedirs(O, exist_ok=True)

body = fal_client.upload_file(I + 'barsbek_sheet_1_body_turnaround.jpg')   # утверждённое тело (v2, серо-зелёные глаза)
head = fal_client.upload_file(I + 'barsbek_sheet_2_head_expressions.jpg')   # утверждённая голова
outfit = fal_client.upload_file(I + 'hero_fullbody.png')                    # фирменный гардероб (худи) — только одежда

prompt = {
  "task": "3D-modeling reference sheet (orthographic character turnaround for image-to-3D) of the SAME character as Image 1 and Image 2, dressed in the outfit from Image 3.",
  "layout": "three full-body views side by side on one sheet, equal scale, same height, feet on the same baseline, generous empty space between figures: LEFT = front view, MIDDLE = exact left side profile (90 degrees), RIGHT = back view",
  "pose": "neutral A-pose: standing straight, feet shoulder-width apart, arms straight and angled down about 35 degrees away from the body, palms facing the thighs, fingers relaxed and slightly apart, hands NOT touching the body or clothes, neutral calm face, mouth closed, eyes open looking straight ahead",
  "character": {
    "identity": "copy face, head shape, ears, muzzle, eye shape and eye color, fur color and markings EXACTLY from Image 1 and Image 2",
    "eyes": "pale icy green-grey, ROUND pupils",
    "fur": "smoky-white to pale grey, cream throat, visible individual hairs, charcoal spots on head, open ring rosettes on visible fur",
    "hands": "anthropomorphic hands with thick fluffy fingers and short claws, as in Image 1",
    "tail": "NO TAIL in this sheet: the tail is removed, nothing behind the body"
  },
  "outfit": {
    "top": "oversized heavyweight dusty muted sage-green hoodie, dropped shoulders, hood resting on the shoulders, no print, no logo",
    "bottom": "dark charcoal relaxed joggers, tapered at the ankle",
    "shoes": "chunky off-white designer sneakers, no logo"
  },
  "camera": "orthographic-like straight-on views, camera at mid-body height, no perspective distortion, full figure visible head to toe with margin",
  "lighting": "flat even soft studio light from the front, no cast shadows on the floor, no rim light, no dramatic shading",
  "background": "plain pure white seamless background",
  "style": "high-quality stylized realistic 3D character render, same style as Image 1",
  "negative": ["tail", "two tails", "props", "phone", "coffee cup", "text", "labels", "letters", "logos", "floor shadow", "ground plane", "hands in pockets", "crossed arms", "T-pose", "dynamic pose", "amber eyes", "slit pupils", "extra characters", "cropped feet"]
}

r = fal_client.subscribe('openai/gpt-image-2.5/sunburst/edit', arguments={
    "prompt": json.dumps(prompt, ensure_ascii=False),
    "image_urls": [body, head, outfit],
    "image_size": {"width": 1824, "height": 1024},
    "quality": "high", "num_images": 2, "output_format": "png"}, client_timeout=600)
for i, im in enumerate(r['images']):
    p = O + f'turnaround_3d_{i+1}.png'
    urllib.request.urlretrieve(im['url'], p)
    print('saved', p)
